// 장소의 공식 사이트를 네이버 지역검색으로 채운다.
//
//   node scripts/fill-official-site.mjs           # 미리보기
//   node scripts/fill-official-site.mjs --apply   # 노션에 반영
//
// "정보출처"와 다르다. 정보출처는 우리가 값을 어디서 얻었는지이고 절반 이상이
// 블로그 글이라 사용자에게 내보낼 수 없다. 네이버 지역검색은 업체가 등록한
// 홈페이지 주소(link)를 주는데, 그게 우리가 원하는 공식 사이트다.
//
// 요금과 휴관은 수시로 바뀐다. 우리가 아무리 자주 검수해도 원본만큼 최신일 수
// 없으니, 사용자가 직접 확인할 길을 열어 둔다.

import fs from "node:fs";
import { loadVars, sleep, notionHeaders, queryAll } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 네이버 검색은 초당 제한이 있어 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = notionHeaders(vars);

// 블로그·카페·SNS는 공식 사이트가 아니다. 지도 링크도 원본이 아니라 중계다.
const NOT_OFFICIAL = /blog\.|cafe\.|instagram\.|facebook\.|youtube\.|tistory\.|brunch\.|map\.naver|place\.naver|booking\.naver/i;

async function searchLocal(query) {
  const res = await fetch(`https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5`, {
    headers: {
      "X-Naver-Client-Id": vars.NAVER_SEARCH_CLIENT_ID,
      "X-Naver-Client-Secret": vars.NAVER_SEARCH_CLIENT_SECRET,
    },
  });
  if (!res.ok) return [];
  return (await res.json()).items || [];
}

const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s/g, "");

const places = [];
for (const p of await queryAll(vars, vars.NOTION_DATABASE_ID)) {
  places.push({
    id: p.id,
    name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
    addr: p.properties["주소"]?.rich_text?.[0]?.plain_text || "",
    official: p.properties["공식사이트"]?.url || "",
    pub: p.properties["공개여부"]?.checkbox === true,
  });
}

const targets = places.filter((p) => !p.official);
console.log(`전체 ${places.length}곳 · 공식사이트 없는 곳 ${targets.length}곳\n`);

const found = [];
for (const t of targets) {
  // 이름만으로 찾으면 같은 이름의 다른 지점이 잡힌다. 시·군까지 붙여 좁힌다.
  const city = t.addr.split(/\s+/).slice(0, 2).join(" ");
  const items = [...await searchLocal(`${city} ${t.name}`), ...await searchLocal(t.name)];
  const key = strip(t.name);
  const hit = items.find((i) => {
    const title = strip(i.title);
    if (!(title.includes(key) || key.includes(title))) return false;
    return i.link && !NOT_OFFICIAL.test(i.link);
  });
  if (hit) {
    found.push({ ...t, url: hit.link, matched: strip(hit.title) });
    console.log(`  ✓ ${t.name} → ${hit.link.slice(0, 70)}`);
  }
  await sleep(220);
}

console.log(`\n찾음 ${found.length}곳 / 못 찾음 ${targets.length - found.length}곳`);
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/공식사이트.json", JSON.stringify(found, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  for (const f of found) {
    const res = await fetch(`https://api.notion.com/v1/pages/${f.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ properties: { "공식사이트": { url: f.url } } }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${f.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}곳 반영`);
}
