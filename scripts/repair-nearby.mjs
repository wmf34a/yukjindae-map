// 코스보기에서 핀이 안 찍히는 근처 맛집·카페를 고친다.
//
//   node scripts/repair-nearby.mjs           # 미리보기
//   node scripts/repair-nearby.mjs --apply   # 노션에 반영
//
// audit-nearby.mjs 가 찾아낸 값들을 실제로 찾아지는 상호로 바꾼다. 화면은 노션에
// 적힌 문자열을 그대로 검색하므로, 검색이 안 되는 문자열은 무엇이 적혀 있든
// 지도에 아무것도 안 나온다.
//
// 실패 유형이 셋이다:
//   1. 접미사 때문에 매칭 실패 — "쌈밥이네 강화도본점"은 0건, "쌈밥이네"는 나온다
//   2. 표기 차이 — "P.ARK Cafe & Bakery"의 실제 등록명은 "피아크"
//   3. 아예 없음 — "박물관 내 전망 좋은 카페" 같은 서술이거나 폐업
//
// 1·2는 찾아낸 정식 상호로 바꾸고, 3은 근처에서 새로 고른다.

import fs from "node:fs";
import { pickNearest, NEARBY_SEARCH_RADIUS_M, distanceKm } from "../src/nearby-lookup.js";
import { pickNearby } from "../src/place-pipeline.js";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 카카오 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const NOTION = { Authorization: `Bearer ${vars.NOTION_API_KEY}`, "Notion-Version": "2022-06-28", "content-type": "application/json" };
const KAKAO = { Authorization: `KakaoAK ${vars.KAKAO_REST_API_KEY}` };
const FIELD = { 맛집: "근처맛집", 카페: "근처카페" };

async function kakao(pathname, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${pathname}?${qs}`, { headers: KAKAO });
  if (!res.ok) return [];
  const data = await res.json();
  return data.documents || [];
}

// 지점 접미사가 붙으면 매칭이 깨진다. 짧은 쪽부터가 아니라 긴 쪽부터 시도해
// 가장 구체적인 이름이 맞으면 그걸 쓴다.
function nameVariants(query) {
  const out = [query];
  const trimmed = query.replace(/\s*(본점|직영점|점|지점)$/, "").trim();
  if (trimmed && trimmed !== query) out.push(trimmed);
  const head = query.split(/\s+/)[0];
  if (head && !out.includes(head)) out.push(head);
  return out;
}

// 카테고리를 안 걸면 음식점·카페가 아닌 것이 걸린다. 실제로 국립민속박물관의
// 근처 카페로 "주한브라질대사관", 서대문형무소역사관에 "독립문역 3호선",
// 대전 국립중앙과학관 맛집에 패션 매장이 잡혔다.
const GROUP = { 맛집: "FD6", 카페: "CE7" };

// 장소 자신이나 부속 시설(주차장·충전소·매표소)이 잡히면 코스가 성립하지 않는다.
// 무인·자판기 카페는 들를 곳이 못 된다.
const NOT_A_STOP = /주차장|충전소|매표소|화장실|정문|출입구|안내소|관리사무소|역 \d호선|무인|자판기|캡슐/;

// 상호가 아니라 설명인 값들이 있다("박물관 내 전망 좋은 카페", "삼청동 카페거리 내
// 한옥 카페"). 이런 문장으로 이름 검색을 하면 엉뚱한 곳이 흐릿하게 걸린다 —
// 국립항공박물관에 7km 떨어진 다른 박물관 카페가 잡혔다. 처음부터 새로 고른다.
const LOOKS_LIKE_DESCRIPTION = /\s내\s|인근|거리 내|카페거리|음식거리|운영|이용|및\s|좋은|조용한/;

function usable(hit, placeName) {
  if (!hit) return false;
  if (NOT_A_STOP.test(hit.name)) return false;
  // 장소 이름을 그대로 품은 결과는 그 시설 자체다.
  const own = String(placeName).replace(/\s/g, "");
  return !(own.length >= 3 && hit.name.replace(/\s/g, "").includes(own));
}

async function findByName(query, origin, kind, placeName) {
  for (const variant of nameVariants(query)) {
    const docs = await kakao("keyword.json", {
      query: variant, x: String(origin.lng), y: String(origin.lat),
      radius: String(NEARBY_SEARCH_RADIUS_M), size: "10", sort: "distance",
      category_group_code: GROUP[kind],
    });
    const hit = pickNearest(docs, origin);
    await sleep(120);
    if (usable(hit, placeName)) return hit;
  }
  return null;
}

// 이름으로 못 찾으면 근처에서 새로 고른다. 발굴 파이프라인과 같은 규칙을 쓴다.
async function findReplacement(origin, kind, placeName) {
  const code = kind === "카페" ? "CE7" : "FD6";
  const docs = await kakao("category.json", {
    category_group_code: code, x: String(origin.lng), y: String(origin.lat),
    radius: "5000", size: "15", sort: "distance",
  });
  const items = docs.map((d) => ({
    title: d.place_name,
    dist: Number(d.distance),
    kind: kind === "카페" ? "cafe" : "food",
    category: d.category_name || "",
  }));
  const { restaurants, cafes } = pickNearby(items, { maxEach: 3, placeName });
  const list = kind === "카페" ? cafes : restaurants;
  const picked = list.find((x) => !NOT_A_STOP.test(x.title));
  return picked ? { name: picked.title, distanceM: picked.dist } : null;
}

const broken = JSON.parse(fs.readFileSync("tmp/근처검증.json", "utf8"));
const places = new Map();
let cursor;
do {
  const d = await (await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
    method: "POST", headers: NOTION, body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  })).json();
  for (const p of d.results) {
    places.set(p.id, {
      lat: p.properties["위도"]?.number, lng: p.properties["경도"]?.number,
      근처맛집: p.properties["근처맛집"]?.rich_text?.[0]?.plain_text || "",
      근처카페: p.properties["근처카페"]?.rich_text?.[0]?.plain_text || "",
    });
  }
  cursor = d.has_more ? d.next_cursor : null;
} while (cursor);

const fixes = [];
for (const b of broken) {
  const place = places.get(b.id);
  if (!place || typeof place.lat !== "number") continue;
  const origin = { lat: place.lat, lng: place.lng };

  const byName = LOOKS_LIKE_DESCRIPTION.test(b.query)
    ? null
    : await findByName(b.query, origin, b.field, b.name);
  if (byName) {
    const km = byName.distanceM === null ? distanceKm(origin, byName) : byName.distanceM / 1000;
    fixes.push({ ...b, 새값: byName.name, 방식: "정식 상호", 거리: km });
    console.log(`  ↻ ${b.name} / ${b.field}: "${b.query}" → "${byName.name}" (${km.toFixed(1)}km)`);
    continue;
  }
  const fresh = await findReplacement(origin, b.field, b.name);
  await sleep(120);
  if (fresh) {
    fixes.push({ ...b, 새값: fresh.name, 방식: "근처에서 새로", 거리: fresh.distanceM / 1000 });
    console.log(`  ✚ ${b.name} / ${b.field}: "${b.query}" → "${fresh.name}" (${(fresh.distanceM/1000).toFixed(1)}km, 새로 고름)`);
  } else {
    console.log(`  ✗ ${b.name} / ${b.field}: "${b.query}" — 대체할 곳도 못 찾음`);
  }
}

console.log(`\n고칠 수 있는 것 ${fixes.length}/${broken.length}건`);
fs.writeFileSync("tmp/근처수리.json", JSON.stringify(fixes, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  for (const f of fixes) {
    const prop = FIELD[f.field];
    const res = await fetch(`https://api.notion.com/v1/pages/${f.id}`, {
      method: "PATCH", headers: NOTION,
      body: JSON.stringify({ properties: { [prop]: { rich_text: [{ text: { content: f.새값 } }] } } }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${f.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}건 반영`);
}
