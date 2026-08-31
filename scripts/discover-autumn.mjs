// 가을 단풍·억새 명소를 지역별로 발굴한다.
//
//   node scripts/discover-autumn.mjs [지역당개수]
//
// 결과: tmp/단풍-후보.json + tmp/단풍-검수표.md
//
// discover-places.mjs 는 지역 전체를 훑어 "아이와 갈 만한 곳"을 넓게 찾는다.
// 그 방식으로는 단풍 명소가 거의 안 걸린다 — 순위가 연중 인기순이라 계절 명소는
// 밀린다. 실제로 지금 224곳 중 단풍 관련은 3곳뿐이다.
//
// 그런데 monthly-top10.js 의 10월 계절 힌트에는 "단풍·공원·체험을 우대한다"고
// 적혀 있다. 순위 로직은 단풍을 찾는데 풀에 없는 상태였다.
//
// 그래서 여기서는 지역을 훑는 대신 가을 검색어로 직접 찾는다. 걸러내고 채우는
// 일은 기존 파이프라인(preparePlace)을 그대로 쓴다.

import fs from "node:fs";
import path from "node:path";
import {
  preparePlace, destinationScore, isRejected, MIN_BLOG_MENTIONS, appRegion,
} from "../src/place-pipeline.js";
import { inferCategories } from "../src/category-infer.js";
import {
  loadVars, sleep, clean, tourApi, makeKakaoNearby, fetchDetail,
  makeGeocode, makeSearchPosts, makeRoadDistance,
} from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- TourAPI·네이버 모두 초당 제한이 있어 순차로 돈다. */

// 아이를 데리고 갈 만한 가을 풍경. "명산 등산로"처럼 아이가 못 걷는 곳은 뺀다.
const KEYWORDS = [
  "단풍", "은행나무길", "억새", "메타세쿼이아", "핑크뮬리", "코스모스",
  "국화축제", "수목원", "자연휴양림", "생태공원",
];

// 산 정상·등산·암벽은 유아 동반이 어렵다. 사찰·묘역도 나들이 대상이 아니다.
const BAD = /등산|정상|암벽|종주|사찰|사원|암자|묘|릉|공동묘|납골|추모|현충|골프|카지노|펜션|모텔|호텔|리조트/;
// 가을과 무관한데 이름만 걸리는 것들을 막는다.
const GOOD = /단풍|은행|억새|메타세쿼이아|핑크뮬리|코스모스|국화|수목원|휴양림|생태공원|숲|정원|공원|길/;

const perRegion = Number(process.argv[2] || 3);
const vars = loadVars();
const tour = tourApi(vars.TOUR_API_KEY);
const geocode = makeGeocode(vars);
const searchPosts = makeSearchPosts(vars);
const findNearby = makeKakaoNearby(vars.KAKAO_REST_API_KEY);
const roadDistance = makeRoadDistance(vars);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// TourAPI 지역코드 → 우리 권역. appRegion 이 주소로 한 번 더 정확히 나눈다.
const AREAS = {
  서울: "1", 인천: "2", 대전: "3", 대구: "4", 광주: "5", 부산: "6", 울산: "7", 세종: "8",
  경기: "31", 강원: "32", 충북: "33", 충남: "34", 경북: "35", 경남: "36", 전북: "37",
  전남: "38", 제주: "39",
};

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

console.log("[1/4] 기존 장소 확인");
const already = await existingNames();
console.log(`  등록된 곳 ${already.size}개`);

console.log("[2/4] 가을 검색어로 후보 수집");
const seen = new Set();
const byRegion = new Map();
for (const [regionName, areaCode] of Object.entries(AREAS)) {
  for (const keyword of KEYWORDS) {
    const list = tour.items(await tour.call("searchKeyword2", {
      keyword, areaCode, numOfRows: "40", pageNo: "1", arrange: "C",
    }));
    for (const x of list) {
      const title = clean(x.title);
      const key = title.replace(/\s/g, "");
      if (!title || seen.has(key) || already.has(key)) continue;
      if (!GOOD.test(title) || BAD.test(title) || isRejected(title)) continue;
      seen.add(key);
      if (!byRegion.has(regionName)) byRegion.set(regionName, []);
      byRegion.get(regionName).push({
        title, addr: x.addr1 || "", contentid: x.contentid, contenttypeid: x.contenttypeid,
        image: x.firstimage || "", lat: Number(x.mapy), lng: Number(x.mapx), keyword,
      });
    }
    await sleep(180);
  }
  const n = byRegion.get(regionName)?.length || 0;
  if (n) console.log(`  ${regionName}: ${n}곳`);
}

console.log("[3/4] 블로그 언급량으로 목적지만 추리기");
const picks = [];
for (const [regionName, list] of byRegion) {
  // 사진 있는 곳을 먼저 본다 — 사진 없는 카드는 목록에서 비어 보인다.
  const ordered = list.toSorted((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0));
  let taken = 0;
  for (const c of ordered) {
    if (taken >= perRegion) break;
    const posts = await searchPosts(c.title, "아이랑", regionName).catch(() => []);
    const score = destinationScore(posts, c.title, regionName);
    await sleep(250);
    if (score < MIN_BLOG_MENTIONS) continue;
    picks.push({ ...c, regionName, score });
    taken += 1;
    console.log(`  · [${regionName}] ${c.title} (${c.keyword}, 언급 ${score}건)`);
  }
}
console.log(`  ${picks.length}곳 진행`);

console.log("[4/4] 상세·좌표·근처맛집·편의시설 수집");
const results = [];
for (const c of picks) {
  const detail = await fetchDetail(tour, c.contentid, c.contenttypeid);
  await sleep(200);
  const out = await preparePlace({
    base: {
      name: c.title, region: appRegion(c.regionName, c.addr),
      categories: inferCategories({ name: c.title, fee: detail.fee }), address: c.addr,
      lat: c.lat, lng: c.lng,
      hours: [detail.hours, detail.rest && `휴무 ${detail.rest}`].filter(Boolean).join(" / "),
      fee: detail.fee, parking: detail.parking ? "무료" : "확인 필요",
      reason: detail.overview,
      sourceUrl: detail.homepage,
      photoUrl: c.image, photoCredit: c.image ? "한국관광공사" : "",
    },
    geocode, findNearby, searchPosts, roadDistance, today,
  });
  await sleep(300);
  if (!out.ok) { console.log(`  ✗ ${c.title} — ${out.error}`); continue; }
  results.push({ ...out, contentid: c.contentid, tel: detail.tel, score: c.score, keyword: c.keyword });
  console.log(`  ✓ ${c.title}${out.warnings.length ? ` (${out.warnings.join(", ")})` : ""}`);
}

fs.mkdirSync("tmp", { recursive: true });
const jsonPath = path.join("tmp", "단풍-후보.json");
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

const lines = [`# 가을 명소 검수표 (${today})`, "",
  `후보 ${results.length}곳. 확인하고 등록할 곳만 남긴 뒤 \`node scripts/register-places.mjs ${jsonPath}\` 를 돌린다.`,
  "", "10월 1일 크론이 순위를 다시 매기기 전에 등록해야 그 달 Top 10에 잡힌다.", ""];
for (const r of results) {
  const p = r.record;
  lines.push(`## ${p["장소명"]} — ${r.keyword}`, "");
  lines.push(`- 지역: ${p["지역"]} · 블로그 언급 ${r.score}건`);
  lines.push(`- 주소: ${p["주소"]}`);
  lines.push(`- 운영시간: ${p["운영시간"] || "**확인 필요**"}`);
  lines.push(`- 입장료: ${p["입장료"] || "**확인 필요**"}`);
  lines.push(`- 주차: ${p["주차가능여부"]}`);
  lines.push(`- 근처맛집: ${p["근처맛집"] || "**없음 — 코스보기 핀이 안 찍힌다**"}`);
  lines.push(`- 근처카페: ${p["근처카페"] || "**없음**"}`);
  lines.push(`- 사진: ${p["사진"] ? "있음" : "**없음**"}`);
  lines.push("");
}
fs.writeFileSync(path.join("tmp", "단풍-검수표.md"), lines.join("\n"));
console.log(`\n${results.length}곳 → ${jsonPath} · tmp/단풍-검수표.md`);
