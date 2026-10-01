// 이미 등록된 장소 중 "가을명소" 체크가 빠진 곳을 찾는다.
//
//   node scripts/audit-autumn-flag.mjs           # 검수표만 만든다
//   node scripts/audit-autumn-flag.mjs --apply   # 확실한 것만 노션에 체크한다
//
// 가을명소 체크는 10~11월 월간 Top10 에서 가점으로 쓰인다(monthly-top10.js).
// 그래서 짐작으로 붙이면 그 달 추천이 통째로 흔들린다 — 블로그·카페에서 그 장소를
// 가을 소재로 실제로 얼마나 다루는지를 세어 근거로 삼는다.
//
// 이름만으로 판단하지 않는 이유: "○○수목원"은 전부 가을 명소처럼 보이지만, 실제로
// 단풍으로 사람이 찾는 곳과 그냥 수목원인 곳은 블로그 언급량이 확연히 갈린다.
import fs from "node:fs";
import { loadVars, sleep, queryAll, notionHeaders } from "./lib/sources.mjs";
import { toPlace } from "../src/notion.js";

/* oxlint-disable no-await-in-loop -- 네이버 검색은 초당 제한이 있어 순차로 돈다. */

// 가을에 사람을 부르는 소재들. "가을"만으로는 "가을에 다녀왔어요" 같은 글이 섞인다.
const KEYWORDS = ["단풍", "억새", "은행나무"];

// 언급 수만으로는 안 갈린다. "단풍 보고 ○○ 갔다" 는 글에 실내 시설이 그대로 묻어
// 올라온다 — 실제로 코엑스 아쿠아리움 36건, 전쟁기념관 19건이 잡혔다. 야외 자연인지
// 한 번 더 본다.
const OUTDOOR_NAME = /수목원|휴양림|생태|숲|공원|길|정원|목장|호수|계곡|둘레/;
// 바다·항구는 억새 글에 함께 걸리지만 단풍 나들이로 가는 곳이 아니다.
const NOT_AUTUMN = /해수욕장|해변|항$|해안|스피디움|아쿠아|미디어아트/;

function isOutdoorNature(place) {
  if (NOT_AUTUMN.test(place.name)) return false;
  if ((place.categories || []).includes("자연·공원")) return true;
  return OUTDOOR_NAME.test(place.name);
}
// 이만큼은 걸려야 "가을 소재로 알려진 곳"이라고 본다. 발굴 파이프라인의
// MIN_BLOG_MENTIONS(5) 와 같은 눈높이다.
// 2026-10-01 에 기준을 다시 잡았다. 표본을 100건으로 늘리자 8건은 너무 느슨해져
// 266곳 중 83곳이 걸렸다 — 그 정도면 가점이 가점 구실을 못 한다.
const STRONG = 25;
const MAYBE = 12;

// 검색을 두 번 돌리면 결과가 달라진다 — makeSearchPosts 가 최신순 20건만 받아오는데
// 가을에는 글이 계속 올라와서 표본이 매번 갈린다. 2026-10-01 에 같은 스크립트를
// 두 번 돌려 확실 17곳과 13곳이 나왔다(곡교천 은행나무길·담양 죽녹원이 경계에서
// 넘나들었다). 그래서 여기서는 정확도순으로 100건까지 따로 받는다.
const PAGE = 100;

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = notionHeaders(vars);

const pages = await queryAll(vars, vars.NOTION_DATABASE_ID, {
  filter: { property: "공개여부", checkbox: { equals: true } },
});
const places = pages.map((p) => ({ id: p.id, ...toPlace(p) })).filter((p) => p.name);
const targets = places.filter((p) => !p.autumnSpot);
console.log(`공개 ${places.length}곳 · 이미 체크됨 ${places.length - targets.length}곳 · 확인 대상 ${targets.length}곳\n`);

// 같은 이름이 지역마다 있어서 지역을 함께 넣는다(장미공원 문제).
async function searchWide(place, keyword) {
  const query = [place.region, place.name, keyword].filter(Boolean).join(" ");
  const headers = {
    "X-Naver-Client-Id": vars.NAVER_SEARCH_CLIENT_ID,
    "X-Naver-Client-Secret": vars.NAVER_SEARCH_CLIENT_SECRET,
  };
  const one = async (kind) => {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/${kind}?query=${encodeURIComponent(query)}&display=${PAGE}&sort=sim`,
      { headers }
    );
    const data = await res.json().catch(() => ({}));
    return (data.items || []).map((i) => `${i.title || ""} ${i.description || ""}`.replace(/<[^>]+>/g, ""));
  };
  const [blog, cafe] = await Promise.all([one("blog.json").catch(() => []), one("cafearticle.json").catch(() => [])]);
  return [...blog, ...cafe];
}

async function autumnMentions(place) {
  let total = 0;
  const hits = [];
  for (const kw of KEYWORDS) {
    const posts = await searchWide(place, kw).catch(() => []);
    // 제목·본문에 장소 이름과 키워드가 함께 있는 글만 센다. 네이버는 둘 중
    // 하나만 맞아도 돌려주므로 그대로 믿으면 수가 부풀려진다.
    const matched = posts.filter((t) => t.includes(place.name) && t.includes(kw));
    total += matched.length;
    if (matched.length) hits.push(`${kw} ${matched.length}`);
    await sleep(120);
  }
  return { total, hits };
}

const strong = [];
const maybe = [];
for (const [i, place] of targets.entries()) {
  const { total, hits } = await autumnMentions(place);
  if (total >= STRONG && isOutdoorNature(place)) strong.push({ ...place, total, hits });
  else if (total >= MAYBE) maybe.push({ ...place, total, hits, outdoor: isOutdoorNature(place) });
  if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${targets.length}`);
}

const line = (p) => `| ${p.name} | ${p.region} | ${p.total} | ${p.hits.join(" · ")} | ${p.outdoor === false ? "실내·바다 — 제외" : ""} |`;
const sheet = [
  `# 가을명소 체크 검수표 (${new Date().toISOString().slice(0, 10)})`,
  "",
  `확인 대상 ${targets.length}곳 중 가을 언급이 잡힌 곳입니다.`,
  "`단풍·억새·은행나무` 세 키워드로 블로그·카페를 찾아, 장소 이름과 키워드가 **함께** 있는 글만 셌습니다.",
  "",
  `## 확실 (${STRONG}건 이상) — ${strong.length}곳`,
  "",
  "| 장소 | 지역 | 언급 | 내역 | 비고 |",
  "|---|---|---|---|---|",
  ...strong.map(line),
  "",
  `## 애매 (${MAYBE}~${STRONG - 1}건) — ${maybe.length}곳 · 사람이 판단`,
  "",
  "| 장소 | 지역 | 언급 | 내역 | 비고 |",
  "|---|---|---|---|---|",
  ...maybe.map(line),
  "",
].join("\n");
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/가을명소-검수표.md", sheet);
console.log(`\n확실 ${strong.length}곳 · 애매 ${maybe.length}곳 → tmp/가을명소-검수표.md`);

if (!apply) {
  console.log("검수표만 만들었습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}

for (const p of strong) {
  const res = await fetch(`https://api.notion.com/v1/pages/${p.id}`, {
    method: "PATCH", headers: H,
    body: JSON.stringify({ properties: { "가을명소": { checkbox: true } } }),
  });
  console.log(res.ok ? `  ✔ ${p.name} (${p.total})` : `  ✗ ${p.name}: ${(await res.text()).slice(0, 100)}`);
  await sleep(320);
}
console.log(`\n${strong.length}곳에 가을명소를 켰습니다. 애매 ${maybe.length}곳은 검수표를 보고 직접 정해주세요.`);
