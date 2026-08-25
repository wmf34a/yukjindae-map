// 공공데이터포털의 지역별 수유실 API를 모아 지도 레이어용으로 정규화한다.
// - 부산광역시: 좌표를 직접 주는 API라 요청마다 바로 불러온다.
// - 한국철도공사/서울교통공사: 역명만 주고 좌표가 없어서, 주간 크론이 미리 네이버
//   지오코딩으로 좌표를 붙여 KV에 캐싱해두고 /api/nursing-rooms는 그 결과만 읽는다
//   (요청마다 역 100여 개를 라이브로 지오코딩하면 느리고 Workers 서브리퀘스트
//   한도에 걸릴 수 있음).
const BUSAN_BASE = "https://apis.data.go.kr/6260000/BusanNursingroomInfoService/getNursingroomInfo";
const KORAIL_BASE = "https://apis.data.go.kr/B551457/convenience";
const SEOUL_METRO_BASE = "https://apis.data.go.kr/B553766/facility";
const KORAIL_KV_KEY = "nursing-rooms:korail";
const SEOUL_METRO_KV_KEY = "nursing-rooms:seoul-metro";
const STATION_KV_TTL_SECONDS = 60 * 60 * 24 * 14; // 크론은 매주 도니까 2주치 여유

// 장소 자동 보강 시 "정보출처"에 넣을 원본 데이터셋 링크 — 사람이 검토할 때
// 근거를 바로 확인할 수 있게 한다.
export const NURSING_SOURCE_URLS = {
  "부산광역시": "https://www.data.go.kr/data/15034033/openapi.do",
  "한국철도공사": "https://www.data.go.kr/data/15125774/openapi.do",
  "서울교통공사": "https://www.data.go.kr/data/15143841/openapi.do",
};

export function parseBusanItems(data) {
  const item = data && data.response && data.response.body && data.response.body.items && data.response.body.items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export function normalizeBusanItem(item) {
  return {
    name: item.sj || "",
    address: item.address || "",
    place: item.place || "",
    tel: item.tel || "",
    lat: Number(item.lat),
    lng: Number(item.lng),
    fatherAllowed: item.father === "가능",
    source: "부산광역시",
    sourceUrl: NURSING_SOURCE_URLS["부산광역시"],
  };
}

// data.go.kr 서비스키는 이미 URL 인코딩된 형태라 URLSearchParams에 그대로 넣으면
// 이중 인코딩되므로(tourapi.js의 callTourApi와 동일한 이유) 먼저 디코딩한다.
export async function fetchBusanNursingRooms(env) {
  if (!env.TOUR_API_KEY) return [];

  const query = new URLSearchParams({
    serviceKey: decodeURIComponent(env.TOUR_API_KEY),
    pageNo: "1",
    numOfRows: "500",
    resultType: "json",
  });

  try {
    const res = await fetch(`${BUSAN_BASE}?${query.toString()}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();
    return parseBusanItems(data)
      .map(normalizeBusanItem)
      .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch {
    return [];
  }
}

export function parseKorailItems(data) {
  const item = data && data.response && data.response.body && data.response.body.items && data.response.body.items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

// 코드정보(stn_cd)는 지오코딩에 쓸모가 없어 역명만 남긴다. 수유실 없는 역까지
// 좌표 변환할 이유가 없어 nrsrm_estnc==="Y"인 역만 골라낸다.
export function filterNursingStations(items) {
  return items.filter((item) => item.nrsrm_estnc === "Y" && item.stn_nm).map((item) => ({ name: item.stn_nm }));
}

export async function fetchKorailNursingStations(env) {
  if (!env.TOUR_API_KEY) return [];

  const query = new URLSearchParams({
    serviceKey: decodeURIComponent(env.TOUR_API_KEY),
    numOfRows: "1000",
    pageNo: "1",
    _type: "json",
  });

  try {
    const res = await fetch(`${KORAIL_BASE}/stationFacilities?${query.toString()}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return filterNursingStations(parseKorailItems(data));
  } catch {
    return [];
  }
}

// 네이버 지오코딩(map-geocode)은 도로명주소 전용이라 "강릉역" 같은 시설명은
// 못 찾는다 — 실제로 써보니 항상 0건이었다. 대신 /api/nearby-place가 쓰는
// 지역검색 API(local.json)를 쓴다: 장소명으로 검색되고 mapx/mapy(WGS84 좌표에
// 10^7을 곱한 정수)를 바로 준다.
export async function geocodeStation(env, stationName) {
  if (!env.NAVER_SEARCH_CLIENT_ID || !env.NAVER_SEARCH_CLIENT_SECRET) return null;

  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(`${stationName}역`)}&display=1`,
      {
        headers: {
          "X-Naver-Client-Id": env.NAVER_SEARCH_CLIENT_ID,
          "X-Naver-Client-Secret": env.NAVER_SEARCH_CLIENT_SECRET,
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items && data.items[0];
    if (!item || !item.mapx || !item.mapy) return null;
    return { lat: Number(item.mapy) / 1e7, lng: Number(item.mapx) / 1e7 };
  } catch {
    return null;
  }
}

// 서울교통공사 편의시설위치정보(B553766)는 JSON 응답을 지원하지 않아 XML만 온다
// — Workers 런타임엔 DOMParser가 없어서 <item>...</item> 블록 단위로 정규식
// 파싱한다. 데이터가 정부기관 API라 구조가 안정적이라 이 정도로 충분하다.
function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1] : "";
}

export function parseSeoulMetroNursingItems(xml) {
  const blocks = [...String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return blocks
    .map((block) => ({
      stnNm: extractTag(block, "stnNm"),
      lineNm: extractTag(block, "lineNm"),
      stnFlr: extractTag(block, "stnFlr"),
      exitNo: extractTag(block, "exitNo"),
      dtlPstn: extractTag(block, "dtlPstn"),
      tel: extractTag(block, "operInstTelno"),
      utztnHr: extractTag(block, "utztnHr"),
    }))
    .filter((item) => item.stnNm);
}

export async function fetchSeoulMetroNursingRooms(env) {
  if (!env.TOUR_API_KEY) return [];

  const query = new URLSearchParams({
    serviceKey: decodeURIComponent(env.TOUR_API_KEY),
    numOfRows: "500",
    pageNo: "1",
  });

  try {
    const res = await fetch(`${SEOUL_METRO_BASE}/getFcNrsrm?${query.toString()}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    return parseSeoulMetroNursingItems(await res.text());
  } catch {
    return [];
  }
}

// 정류장명이 겹치는 환승역(예: 종로3가 1/3/5호선)까지 매번 다시 지오코딩할
// 이유가 없어 역명 기준으로 한 번만 좌표를 구하고 나머지 항목에 재사용한다.
async function geocodeUniqueStations(env, stationNames) {
  const coordByName = new Map();
  // 네이버 지역검색 API는 초당 호출 제한이 있어 순차 호출이 필요하다.
  /* oxlint-disable no-await-in-loop */
  for (const name of stationNames) {
    const coord = await geocodeStation(env, name);
    if (coord) coordByName.set(name, coord);
  }
  /* oxlint-enable no-await-in-loop */
  return coordByName;
}

// 주간 크론에서만 호출된다 — 코레일/서울교통공사 역명 100여 개를 순차
// 지오코딩해 KV에 통째로 저장한다.
export async function runStationNursingGeocodeRefresh(env) {
  if (!env.RATE_LIMIT) return;

  const [korailStations, seoulMetroItems] = await Promise.all([
    fetchKorailNursingStations(env),
    fetchSeoulMetroNursingRooms(env),
  ]);

  const korailCoords = await geocodeUniqueStations(env, korailStations.map((s) => s.name));
  const korailRooms = korailStations
    .filter((s) => korailCoords.has(s.name))
    .map((s) => ({
      name: `${s.name}역`,
      address: "",
      place: "",
      tel: "",
      lat: korailCoords.get(s.name).lat,
      lng: korailCoords.get(s.name).lng,
      fatherAllowed: false,
      source: "한국철도공사",
      sourceUrl: NURSING_SOURCE_URLS["한국철도공사"],
    }));

  const seoulMetroStationNames = [...new Set(seoulMetroItems.map((i) => i.stnNm))];
  const seoulMetroCoords = await geocodeUniqueStations(env, seoulMetroStationNames);
  const seoulMetroRooms = seoulMetroItems
    .filter((i) => seoulMetroCoords.has(i.stnNm))
    .map((i) => ({
      name: `${i.stnNm}역 (${i.lineNm})`,
      address: "",
      place: [i.stnFlr, i.exitNo ? `${i.exitNo}번 출구` : "", i.dtlPstn].filter(Boolean).join(" · "),
      tel: i.tel,
      lat: seoulMetroCoords.get(i.stnNm).lat,
      lng: seoulMetroCoords.get(i.stnNm).lng,
      fatherAllowed: false,
      source: "서울교통공사",
      sourceUrl: NURSING_SOURCE_URLS["서울교통공사"],
    }));

  await Promise.all([
    env.RATE_LIMIT.put(KORAIL_KV_KEY, JSON.stringify(korailRooms), { expirationTtl: STATION_KV_TTL_SECONDS }),
    env.RATE_LIMIT.put(SEOUL_METRO_KV_KEY, JSON.stringify(seoulMetroRooms), {
      expirationTtl: STATION_KV_TTL_SECONDS,
    }),
  ]);
}

async function readCachedRooms(env, key) {
  if (!env.RATE_LIMIT) return [];
  const raw = await env.RATE_LIMIT.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// 새 지역 API가 늘어나도 프론트는 이 함수 하나만 호출하면 되도록 결과를 합쳐서 준다.
export async function fetchAllNursingRooms(env) {
  const [busan, korail, seoulMetro] = await Promise.all([
    fetchBusanNursingRooms(env),
    readCachedRooms(env, KORAIL_KV_KEY),
    readCachedRooms(env, SEOUL_METRO_KV_KEY),
  ]);
  return [...busan, ...korail, ...seoulMetro];
}
