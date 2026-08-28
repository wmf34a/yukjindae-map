// 모든 장소의 근처 맛집·카페가 실제로 그 근처인지 검증한다.
//
//   node scripts/audit-nearby.mjs
//
// 노션에는 상호 텍스트만 있어서, 지역 없는 흔한 상호("신세계백화점 푸드코트")는
// 검색이 엉뚱한 지점을 집어온다. 대전 국립중앙과학관 코스에 서울 강남점이 잡혀
// 총 거리 306km짜리 코스가 나온 적이 있다. 전수로 훑어 그런 값을 찾아낸다.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pickNearest, NEARBY_SEARCH_RADIUS_M } from "../src/nearby-lookup.js";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 카카오 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const H = { Authorization: `Bearer ${vars.NOTION_API_KEY}`, "Notion-Version": "2022-06-28", "content-type": "application/json" };

// 화면이 쓰는 것과 똑같은 규칙으로 대표 상호를 뽑아야 한다. 여기서 다르게 자르면
// 실제로는 멀쩡한 값이 문제로 잡힌다 — 단순 split을 썼다가 괄호 안 주소의 쉼표에서
// 잘려 "별돈별 중문 본점(서귀포시 구산봉로 61" 같은 깨진 검색어가 만들어졌다.
// public/js/util.js는 <script>로 읽히는 클래식 스크립트라 import할 수 없어서
// 파일을 읽어 window를 흉내낸 컨텍스트에서 실행한다.
const sandbox = { window: {}, URL, AbortSignal, fetch: () => {}, Date, Math, JSON, String };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.resolve("public/js/util.js"), "utf8"), sandbox);
const { splitNearbyList } = sandbox.window;

// place.js의 stripParenthetical과 같은 규칙.
const stripParenthetical = (v) => String(v ?? "").replace(/[(（][^)）]*[)）]/g, "").trim();

function primaryName(value) {
  const items = splitNearbyList(value);
  return stripParenthetical(items[0] || value || "");
}

async function findNear(query, origin) {
  const qs = new URLSearchParams({
    query, x: String(origin.lng), y: String(origin.lat),
    radius: String(NEARBY_SEARCH_RADIUS_M), size: "10", sort: "distance",
  });
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${qs}`, {
    headers: { Authorization: `KakaoAK ${vars.KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return pickNearest(data.documents, origin);
}

const places = [];
let cursor;
do {
  const d = await (await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
    method: "POST", headers: H, body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  })).json();
  for (const p of d.results) {
    places.push({
      id: p.id,
      name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
      lat: p.properties["위도"]?.number,
      lng: p.properties["경도"]?.number,
      맛집: p.properties["근처맛집"]?.rich_text?.[0]?.plain_text || "",
      카페: p.properties["근처카페"]?.rich_text?.[0]?.plain_text || "",
    });
  }
  cursor = d.has_more ? d.next_cursor : null;
} while (cursor);

console.log(`장소 ${places.length}곳 검증 시작\n`);

const broken = [];
let checked = 0;
for (const p of places) {
  if (typeof p.lat !== "number" || typeof p.lng !== "number") {
    broken.push({ ...p, 문제: "장소 좌표 없음" });
    continue;
  }
  for (const field of ["맛집", "카페"]) {
    const query = primaryName(p[field]);
    if (!query) continue;
    checked += 1;
    const hit = await findNear(query, p);
    if (!hit) {
      broken.push({ id: p.id, name: p.name, field, query, 문제: "반경 20km 안에 없음" });
      console.log(`  ✗ ${p.name} / ${field}: "${query}" — 근처에 없음`);
    }
    await sleep(120);
  }
}

console.log(`\n검사 ${checked}건 중 문제 ${broken.length}건`);
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/근처검증.json", JSON.stringify(broken, null, 2));
