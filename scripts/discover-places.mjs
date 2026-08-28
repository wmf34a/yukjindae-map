// 지역 하나의 신규 장소 후보를 한 번에 만든다.
//
// 예전에는 발굴·좌표·상세정보·근처 맛집·편의시설을 따로따로 돌렸고, 그 사이에
// 근처 맛집이 비어 코스보기 핀이 안 찍히거나 편의시설이 통째로 빠지는 일이 생겼다.
// 여기서 한 번에 다 채운 뒤 검수표를 내고, 사람이 읽고 판단해 등록한다.
//
//   node scripts/discover-places.mjs <지역명> [최대개수]
//
// 결과: tmp/<지역>-후보.json (등록용) + tmp/<지역>-검수표.md (사람이 읽는 용)

import fs from "node:fs";
import path from "node:path";
import {
  preparePlace, destinationScore, isRejected, MIN_BLOG_MENTIONS,
} from "../src/place-pipeline.js";
import {

/* oxlint-disable no-await-in-loop -- TourAPI·네이버 모두 초당 호출 제한이 있어 일부러 순차로 돈다. */
  loadVars, sleep, clean, tourApi, makeKakaoNearby, fetchDetail,
  makeGeocode, makeSearchPosts,
} from "./lib/sources.mjs";

const REGION_AREA_CODE = {
  서울: "1", 인천: "2", 대전: "3", 대구: "4", 광주: "5", 부산: "6", 울산: "7", 세종: "8",
  경기: "31", 강원: "32", 충북: "33", 충남: "34", 경북: "35", 경남: "36", 전북: "37",
  전남: "38", 제주: "39",
};

// 앱은 광역시를 따로 두지 않고 권역으로 묶어 보여준다(public/js/app.js REGION_GROUPS).
// 노션에 TourAPI 기준 이름("충남")을 그대로 넣으면 지역 필터에 걸리지 않아 장소가
// 앱에서 사라진다 — 실제로 50곳을 그렇게 등록했다가 고쳤다.
const APP_REGION = {
  인천: "인천", 제주: "제주", 강원: "강원도",
  충남: "충청도", 충북: "충청도", 대전: "충청도", 세종: "충청도",
  전남: "전라도", 전북: "전라도", 광주: "전라도",
  경남: "경상도", 경북: "경상도", 대구: "경상도", 부산: "경상도", 울산: "경상도",
};
// 서울과 경기는 한강·남북으로 갈리므로 주소를 봐야 한다.
const SEOUL_SOUTH = /영등포|강남|서초|송파|강동|관악|동작|금천|구로|양천|강서/;
const GYEONGGI_NORTH = /파주|연천|고양|의정부|남양주|동두천|포천|가평|양주|구리/;

export function appRegion(region, address = "") {
  if (region === "서울") return SEOUL_SOUTH.test(address) ? "서울강남" : "서울강북";
  if (region === "경기") return GYEONGGI_NORTH.test(address) ? "경기북부" : "경기남부";
  return APP_REGION[region] || region;
}

// 아이 동반에 맞는 곳을 넓게 잡고, 최종 판단은 검수표를 보는 사람이 한다.
const GOOD = /어린이|키즈|아동|유아|박물관|과학관|동물|수목원|식물원|체험|테마파크|놀이|공원|아쿠아|생태|숲|목장|농장|미술관|문화센터|천문|공룡|캠핑|수영장|물놀이|워터/;
const BAD = /술|와인|카지노|골프|사격|낚시|성인|모텔|호텔|펜션|리조트|사찰|사우나|찜질|클럽|바[( ]|묘|릉|성당|교회|공동묘/;

const region = process.argv[2];
const limit = Number(process.argv[3] || 5);
const areaCode = REGION_AREA_CODE[region];
if (!areaCode) {
  console.error(`지역명을 확인해주세요. 가능한 값: ${Object.keys(REGION_AREA_CODE).join(", ")}`);
  process.exit(1);
}

const vars = loadVars();
const tour = tourApi(vars.TOUR_API_KEY);
const geocode = makeGeocode(vars);
const searchPosts = makeSearchPosts(vars);
const findNearby = makeKakaoNearby(vars.KAKAO_REST_API_KEY);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 이미 등록된 곳은 다시 발굴하지 않는다.
async function existingNames() {
  const names = new Set();
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vars.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    const data = await res.json();
    for (const page of data.results || []) {
      const t = page.properties?.["장소명"]?.title?.[0]?.plain_text;
      if (t) names.add(t.replace(/\s/g, ""));
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return names;
}

console.log(`[1/4] 기존 장소 확인`);
const already = await existingNames();

console.log(`[2/4] ${region} 후보 수집`);
const seen = new Set();
const candidates = [];
for (const contentTypeId of ["12", "14", "28"]) {
  for (let pageNo = 1; pageNo <= 4; pageNo += 1) {
    const list = tour.items(await tour.call("areaBasedList2", {
      areaCode, contentTypeId, numOfRows: "100", pageNo: String(pageNo), arrange: "C",
    }));
    for (const x of list) {
      const title = clean(x.title);
      const key = title.replace(/\s/g, "");
      if (!title || seen.has(key) || already.has(key)) continue;
      seen.add(key);
      if (!GOOD.test(title) || BAD.test(title) || isRejected(title)) continue;
      candidates.push({
        title, addr: x.addr1 || "", contentid: x.contentid, contenttypeid: x.contenttypeid,
        image: x.firstimage || "", lat: Number(x.mapy), lng: Number(x.mapx),
      });
    }
    if (list.length < 100) break;
    await sleep(150);
  }
}
// 사진이 있는 곳을 앞에 둔다 — 사진 없는 카드는 목록에서 눈에 띄게 비어 보인다.
const ordered = candidates.toSorted((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0));

// 이름만으로 거르면 동네 근린공원이 그대로 올라온다. 블로그에 다녀온 글이 쌓인 곳만
// 남겨, 아빠가 아이를 데리고 일부러 찾아갈 만한 곳인지 걸러낸다.
console.log(`  후보 ${ordered.length}곳 — 블로그 언급량으로 목적지만 추린다`);
const picks = [];
for (const c of ordered) {
  if (picks.length >= limit) break;
  const posts = await searchPosts(c.title, "아이랑", region).catch(() => []);
  const score = destinationScore(posts, c.title, region);
  await sleep(250);
  if (score < MIN_BLOG_MENTIONS) continue;
  picks.push({ ...c, score });
  console.log(`  · ${c.title} (언급 ${score}건)`);
}
console.log(`  ${picks.length}곳 진행`);

console.log(`[3/4] 상세·좌표·근처맛집·편의시설 수집`);
const results = [];
for (const c of picks) {
  const detail = await fetchDetail(tour, c.contentid, c.contenttypeid);
  await sleep(200);

  const out = await preparePlace({
    base: {
      name: c.title, region: appRegion(region, c.addr), categories: [], address: c.addr,
      lat: c.lat, lng: c.lng,
      hours: [detail.hours, detail.rest && `휴무 ${detail.rest}`].filter(Boolean).join(" / "),
      fee: detail.fee, parking: detail.parking ? "무료" : "확인 필요",
      reason: detail.overview,
      sourceUrl: detail.homepage,
      photoUrl: c.image, photoCredit: c.image ? "한국관광공사" : "",
    },
    geocode, findNearby, searchPosts, today,
  });
  await sleep(300);

  if (!out.ok) { console.log(`  ✗ ${c.title} — ${out.error}`); continue; }
  results.push({ ...out, contentid: c.contentid, tel: detail.tel, ageRange: detail.ageRange, score: c.score });
  const warn = out.warnings.length ? ` (${out.warnings.join(", ")})` : "";
  console.log(`  ✓ ${c.title}${warn}`);
}

console.log(`[4/4] 검수표 작성`);
fs.mkdirSync("tmp", { recursive: true });
const jsonPath = path.join("tmp", `${region}-후보.json`);
const mdPath = path.join("tmp", `${region}-검수표.md`);
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

const lines = [`# ${region} 신규 장소 검수표 (${today})`, "",
  `후보 ${results.length}곳. 아래를 확인하고 등록할 곳만 남긴 뒤 \`node scripts/register-places.mjs ${jsonPath}\` 를 돌린다.`, ""];
for (const r of results) {
  const p = r.record;
  lines.push(`## ${p["장소명"]}`, "");
  lines.push(`- 블로그 언급: ${r.score}건`);
  lines.push(`- 주소: ${p["주소"]}`);
  lines.push(`- 좌표: ${p["위도"]}, ${p["경도"]}`);
  lines.push(`- 운영시간: ${p["운영시간"] || "**확인 필요**"}`);
  lines.push(`- 입장료: ${p["입장료"] || "**확인 필요 — 아래 근거 참고**"}`);
  lines.push(`- 주차: ${p["주차가능여부"]}`);
  lines.push(`- 문의: ${r.tel || "-"}`);
  lines.push(`- 근처맛집: ${p["근처맛집"] || "**없음 — 코스보기 핀이 안 찍힌다**"}`);
  lines.push(`- 근처카페: ${p["근처카페"] || "**없음**"}`);
  lines.push(`- 사진: ${p["사진"] || "없음"}`);
  lines.push(`- 공식: ${p["정보출처"] || "-"}`);
  if (r.feeHints?.length) {
    lines.push("", "입장료 근거 (읽고 판단할 것):");
    for (const h of r.feeHints.slice(0, 4)) {
      lines.push(`- (${h.date || "날짜미상"}) ${h.snippet}`);
      if (h.link) lines.push(`  - ${h.link}`);
    }
  }
  const hints = Object.entries(r.amenityHints);
  if (hints.length) {
    lines.push("", "편의시설 근거 (읽고 판단할 것):");
    for (const [field, hits] of hints) {
      for (const h of hits.slice(0, 3)) {
        lines.push(`- **${field}** (${h.date || "날짜미상"}) ${h.snippet}`);
        if (h.link) lines.push(`  - ${h.link}`);
      }
    }
  } else {
    lines.push("", "편의시설 근거: 찾지 못함");
  }
  lines.push("");
}
fs.writeFileSync(mdPath, lines.join("\n"));
console.log(`\n${jsonPath}\n${mdPath}`);
