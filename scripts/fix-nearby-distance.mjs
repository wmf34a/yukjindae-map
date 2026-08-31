// 근처 맛집·카페 거리를 실제 도로 거리로 다시 적는다.
//
//   node scripts/fix-nearby-distance.mjs           # 미리보기
//   node scripts/fix-nearby-distance.mjs --apply   # 노션에 반영
//
// 지금까지 적힌 숫자는 카카오가 준 직선거리다. 실제와 크게 어긋난다 — 대전
// 국립중앙과학관에서 팔선생까지 직선 511m인데 차로는 1,687m다. 강을 건너거나
// 산을 돌면 세 배까지 벌어지고, 지도 앱과 대조한 지역장이 바로 알아챘다.
//
// 상호는 그대로 두고 괄호 안 거리만 바꾼다. 사람이 손으로 고른 가게를 기계가
// 다시 뽑아 덮어쓰지 않기 위해서다.

import fs from "node:fs";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 네이버 길찾기는 초당 제한이 있어 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};

// 항목 하나를 셋으로 나눈다.
//
//   "고메돈까스 (약 736m)"
//     → keep "고메돈까스" / lookup "고메돈까스"
//   "당케올레국수(서귀포시 표선당포로 4, 15:30 라스트오더) (약 700m)"
//     → keep "당케올레국수(서귀포시 표선당포로 4, 15:30 라스트오더)" / lookup "당케올레국수"
//
// keep은 다시 적을 때 그대로 살릴 글자다. 사람이 손으로 적어 둔 주소나 영업정보가
// 거기 들어 있어서 버리면 안 된다 — "아기 식사 무료", "고기 구워줌" 같은 건
// 기계가 다시 못 만든다.
//
// lookup은 카카오에 물어볼 상호명이다. 괄호 안 설명까지 같이 넘겼더니 검색이
// 통째로 실패해 제주 쪽 53건이 거리 없이 남았다.
// 프론트(public/js/util.js 의 splitNearbyList)와 같은 규칙으로 쪼갠다. 슬래시만
// 보고 쪼갰더니 "디프랑, 카페 두촌리" 를 한 덩이로 취급해 거리를 뒤쪽 상호에만
// 붙였고, 화면에서는 쉼표로 다시 갈라져 "카페 두촌리 (약 690m)" 로 보였다.
// 실제로는 디프랑까지의 거리였다.
function splitNearbyList(value) {
  const text = String(value || "");
  // 쉼표가 상호의 일부인 가게가 있다 — 평창 "쉴, 바위길". 거리 표기가 신호다:
  // 슬래시로 가른 조각 안에 "(약 …)"가 딱 하나면 가게 하나이고 쉼표는 상호의
  // 일부다. 없거나 둘 이상이면 쉼표도 구분자로 쓴다.
  const hasSlash = text.split("/").some((part) => part.includes(",") && (part.match(/\(약\s/g) || []).length === 1);
  const items = [];
  let depth = 0;
  let buffer = "";
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth += 1;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "/" || (ch === "," && !hasSlash))) {
      items.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  items.push(buffer);
  return items.map((x) => x.trim()).filter(Boolean);
}

function splitEntry(entry) {
  const keep = entry.trim().replace(/\s*\(약 [^)]*\)\s*$/, "").trim();
  const lookup = keep.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return { keep, lookup: lookup || keep };
}

// 가게가 시설 안에 있으면 길찾기가 0m를 준다(율곡수목원의 율곡식당, 코엑스의
// 카페드리옹). "약 0m"는 읽는 사람에게 아무 뜻이 아니라 상호만 남긴다.
const SAME_SPOT_M = 100;

function formatMeters(meters) {
  if (meters < SAME_SPOT_M) return null;
  const km = meters / 1000;
  return km < 1 ? `${Math.round(meters / 10) * 10}m` : `${km.toFixed(1)}km`;
}

function squash(s) {
  return s.replace(/[\s,·()]/g, "").toLowerCase();
}

// 상호로 좌표를 찾는다. 장소 근처에서만 찾아야 같은 이름의 다른 지점이 안 걸린다.
//
// 가장 가까운 것을 그냥 집으면 안 된다 — 카카오는 이름이 스쳐도 결과를 준다.
// "율곡식당"을 찾는데 0.01km 떨어진 "율곡수목원 카페,디저트"가 1순위로 왔고,
// 그걸 믿어서 시설 안(0m)으로 적었다. 진짜 율곡식당은 도로로 5.2km다.
// 지역장이 지도를 보고 5.2km라고 제보한 게 맞았다.
//
// 그래서 이름이 실제로 겹치는 후보만 인정하고, 없으면 포기한다.
async function findShop(name, origin) {
  const qs = new URLSearchParams({
    query: name, x: String(origin.lng), y: String(origin.lat),
    radius: "20000", size: "5", sort: "distance",
  });
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${qs}`, {
    headers: { Authorization: `KakaoAK ${vars.KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) return null;
  const want = squash(name);
  for (const doc of (await res.json()).documents || []) {
    const got = squash(doc.place_name || "");
    if (!got.includes(want) && !want.includes(got)) continue;
    return { lat: Number(doc.y), lng: Number(doc.x) };
  }
  return null;
}

const rad = (x) => (x * Math.PI) / 180;

function straightKm(a, b) {
  const R = 6371;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 카카오에 없는 가게가 있다. 일산호수공원의 "일산칼국수본점"이 그렇다 — 카카오는
// 그 이름으로 아무것도 못 찾는데 네이버 지역검색에는 있다. 그래서 거리가 비었고,
// 지역장이 손으로 "4km"라고 제보해 주셔야 했다(실제 도로 3.79km, 정확했다).
//
// 네이버 지역검색은 좌표로 범위를 좁힐 수 없어서, 주소를 지오코딩한 뒤 장소에서
// 너무 멀면 버린다. 같은 상호의 다른 지역 지점이 걸리기 때문이다.
const NAVER_FALLBACK_MAX_KM = 30;

async function findShopNaver(name, origin) {
  const res = await fetch(
    `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(name)}&display=5`,
    {
      headers: {
        "X-Naver-Client-Id": vars.NAVER_SEARCH_CLIENT_ID,
        "X-Naver-Client-Secret": vars.NAVER_SEARCH_CLIENT_SECRET,
      },
    }
  );
  if (!res.ok) return null;
  const want = squash(name);
  for (const item of (await res.json()).items || []) {
    const got = squash(String(item.title || "").replace(/<[^>]*>/g, ""));
    if (!got.includes(want) && !want.includes(got)) continue;
    const address = item.roadAddress || item.address;
    if (!address) continue;
    const coords = await geocode(address).catch(() => null);
    await sleep(120);
    if (!coords) continue;
    if (straightKm(origin, coords) > NAVER_FALLBACK_MAX_KM) continue;
    return coords;
  }
  return null;
}

async function geocode(address) {
  const res = await fetch(
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
    {
      headers: {
        "x-ncp-apigw-api-key-id": vars.NAVER_MAP_CLIENT_ID,
        "x-ncp-apigw-api-key": vars.NAVER_MAP_CLIENT_SECRET,
      },
    }
  );
  if (!res.ok) return null;
  const hit = (await res.json().catch(() => ({})))?.addresses?.[0];
  return hit ? { lat: Number(hit.y), lng: Number(hit.x) } : null;
}

async function roadDistance(from, to) {
  const url = "https://maps.apigw.ntruss.com/map-direction/v1/driving"
    + `?start=${from.lng},${from.lat}&goal=${to.lng},${to.lat}&option=trafast`;
  const res = await fetch(url, {
    headers: {
      "x-ncp-apigw-api-key-id": vars.NAVER_MAP_CLIENT_ID,
      "x-ncp-apigw-api-key": vars.NAVER_MAP_CLIENT_SECRET,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const meters = data?.route?.trafast?.[0]?.summary?.distance;
  return Number.isFinite(meters) ? meters : null;
}

// 길찾기는 실시간 교통을 반영하는 trafast라 같은 구간도 돌릴 때마다 조금씩 다르게
// 나온다. 4.1km가 4.2km가 되는 식이다. 그런 차이까지 노션에 다시 쓰면 갱신 기록만
// 지저분해지고 읽는 사람에게는 아무 의미가 없다.
//
// 그래서 거리가 새로 생기거나 사라진 경우, 또는 300m 넘게 달라진 경우에만 쓴다.
const MEANINGFUL_DIFF_M = 300;

function metersOf(entry) {
  const m = /\(약 ([\d.]+)(m|km)\)\s*$/.exec(entry);
  if (!m) return null;
  return m[2] === "km" ? Number(m[1]) * 1000 : Number(m[1]);
}

function worthWriting(before, after) {
  if (after === undefined || after === before) return false;
  const a = splitNearbyList(before);
  const b = splitNearbyList(after);
  if (a.length !== b.length) return true;
  return a.some((entry, i) => {
    if (splitEntry(entry).keep !== splitEntry(b[i]).keep) return true;
    const x = metersOf(entry);
    const y = metersOf(b[i]);
    // 한쪽에만 거리가 있으면 쓴다 — 새로 구했거나 못 믿게 된 것이다.
    if (x === null || y === null) return x !== y;
    return Math.abs(x - y) >= MEANINGFUL_DIFF_M;
  });
}

const places = [];
let cursor;
do {
  const res = await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
    method: "POST", headers: H, body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 200));
  for (const p of data.results) {
    const t = (k) => p.properties[k]?.rich_text?.[0]?.plain_text || "";
    const lat = p.properties["위도"]?.number;
    const lng = p.properties["경도"]?.number;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!t("근처맛집") && !t("근처카페")) continue;
    places.push({
      id: p.id, name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
      lat, lng, 맛집: t("근처맛집"), 카페: t("근처카페"),
    });
  }
  cursor = data.has_more ? data.next_cursor : null;
} while (cursor);

console.log(`근처 가게가 적힌 장소 ${places.length}곳\n`);

const changes = [];
let looked = 0;
let unresolved = 0;

for (const place of places) {
  const origin = { lat: place.lat, lng: place.lng };
  const next = {};

  for (const field of ["맛집", "카페"]) {
    const raw = place[field];
    if (!raw) continue;

    const rebuilt = [];
    for (const entry of splitNearbyList(raw)) {
      const { keep, lookup } = splitEntry(entry);
      if (!keep) continue;
      looked += 1;

      let shop = await findShop(lookup, origin).catch(() => null);
      await sleep(120);
      if (!shop) {
        shop = await findShopNaver(lookup, origin).catch(() => null);
        await sleep(120);
      }
      let meters = shop ? await roadDistance(origin, shop).catch(() => null) : null;
      await sleep(180);

      // 저장된 좌표가 차가 못 다니는 지점(환선굴은 동굴 자체, 농다리는 돌다리 위)에
      // 찍혀 있으면 네이버가 엉뚱하게 멀리 돌아가는 경로를 내놓는다. 직선 2.9km인
      // 환선굴에서 환선밥상까지 35.5km가 그렇게 나왔다.
      //
      // 다만 배수만 보면 안 된다 — 도심에서 직선 200m가 일방통행 때문에 700m가
      // 되는 건 정상인데 그것도 3.5배다. 율곡수목원에서 율곡식당도 직선 1.4km에
      // 도로 5.2km(3.6배)인데, 지역장이 지도로 확인해준 5.2km가 맞는 값이었다.
      // 그래서 정말 멀리 돌아간 경우만 걸러지도록 절대 거리를 10km로 잡는다.
      const detour = shop && meters !== null
        && meters > 10000 && meters / 1000 > straightKm(origin, shop) * 3;
      if (detour) meters = null;

      const label = meters === null ? null : formatMeters(meters);
      if (label === null) {
        // 못 구했거나 시설 안이면 거리를 빼고 상호만 남긴다.
        // 틀린 숫자나 "약 0m"보다 없는 편이 낫다.
        if (meters === null) unresolved += 1;
        rebuilt.push(keep);
      } else {
        rebuilt.push(`${keep} (약 ${label})`);
      }
    }
    next[field] = rebuilt.join(" / ");
  }

  const changedFood = worthWriting(place["맛집"], next["맛집"]);
  const changedCafe = worthWriting(place["카페"], next["카페"]);
  if (!changedFood && !changedCafe) continue;

  changes.push({ ...place, 새맛집: next["맛집"], 새카페: next["카페"] });
  console.log(`  ${place.name}`);
  if (changedFood) console.log(`    맛집: ${place["맛집"]}\n       → ${next["맛집"]}`);
  if (changedCafe) console.log(`    카페: ${place["카페"]}\n       → ${next["카페"]}`);
}

console.log(`\n조회 ${looked}건 · 도로거리 못 구함 ${unresolved}건 · 바뀌는 장소 ${changes.length}곳`);
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/거리수정.json", JSON.stringify(changes, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  for (const c of changes) {
    const props = {};
    if (c.새맛집 !== undefined) props["근처맛집"] = { rich_text: [{ text: { content: c.새맛집 } }] };
    if (c.새카페 !== undefined) props["근처카페"] = { rich_text: [{ text: { content: c.새카페 } }] };
    const res = await fetch(`https://api.notion.com/v1/pages/${c.id}`, {
      method: "PATCH", headers: H, body: JSON.stringify({ properties: props }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${c.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}곳 반영`);
}
