// 모든 장소의 근처 맛집·카페를 지금 규칙으로 다시 고른다.
//
//   node scripts/refresh-nearby.mjs           # 미리보기
//   node scripts/refresh-nearby.mjs --apply   # 노션에 반영
//
// 아이 친화 카테고리 우대(키즈카페·베이커리·분식)와 관내 시설 제외가 새로 붙어서,
// 예전에 고른 값들은 그 규칙을 안 거쳤다. 사람이 직접 적은 값은 건드리지 않는다 —
// 다녀와서 적은 것이 기계가 고른 것보다 항상 낫다.

import fs from "node:fs";
import { pickNearby, formatNearby } from "../src/place-pipeline.js";
import { loadVars, sleep, makeKakaoNearby, notionHeaders, queryAll } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 카카오·노션 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = notionHeaders(vars);
const findNearby = makeKakaoNearby(vars.KAKAO_REST_API_KEY);

// 기계가 채운 곳만 다시 고른다. 등록자가 사람이면 직접 다녀와 적은 값이다.
const MACHINE_AUTHORS = /공공데이터|TourAPI|자동/;

const places = [];
for (const p of await queryAll(vars, vars.NOTION_DATABASE_ID)) {
  places.push({
    id: p.id,
    name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
    lat: p.properties["위도"]?.number,
    lng: p.properties["경도"]?.number,
    author: p.properties["등록자"]?.rich_text?.[0]?.plain_text || "",
    addr: p.properties["주소"]?.rich_text?.[0]?.plain_text || "",
    맛집: p.properties["근처맛집"]?.rich_text?.[0]?.plain_text || "",
    카페: p.properties["근처카페"]?.rich_text?.[0]?.plain_text || "",
  });
}

const targets = places.filter((p) => typeof p.lat === "number" && MACHINE_AUTHORS.test(p.author));
console.log(`전체 ${places.length}곳 중 기계가 채운 ${targets.length}곳을 다시 고릅니다\n`);

const changes = [];
for (const p of targets) {
  const raw = await findNearby({ lat: p.lat, lng: p.lng }).catch(() => []);
  const { restaurants, cafes } = pickNearby(raw, { maxEach: 2, placeName: p.name, placeAddress: p.addr });
  const 맛집 = formatNearby(restaurants);
  const 카페 = formatNearby(cafes);
  await sleep(150);

  if (!맛집 && !카페) continue;
  if (맛집 === p.맛집 && 카페 === p.카페) continue;
  changes.push({ ...p, 새맛집: 맛집, 새카페: 카페 });
  console.log(`  ${p.name}`);
  if (맛집 !== p.맛집) console.log(`    맛집: ${p.맛집 || "(없음)"} → ${맛집 || "(없음)"}`);
  if (카페 !== p.카페) console.log(`    카페: ${p.카페 || "(없음)"} → ${카페 || "(없음)"}`);
}

console.log(`\n바뀌는 곳 ${changes.length}곳`);
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/근처재선정.json", JSON.stringify(changes, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  for (const c of changes) {
    const props = {};
    if (c.새맛집) props["근처맛집"] = { rich_text: [{ text: { content: c.새맛집 } }] };
    if (c.새카페) props["근처카페"] = { rich_text: [{ text: { content: c.새카페 } }] };
    const res = await fetch(`https://api.notion.com/v1/pages/${c.id}`, {
      method: "PATCH", headers: H, body: JSON.stringify({ properties: props }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${c.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}곳 반영`);
}
