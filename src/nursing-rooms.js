// 공공데이터포털의 지역별 수유실 API를 모아 지도 레이어용으로 정규화한다.
// - 부산광역시: 좌표를 직접 주는 API라 요청마다 바로 불러온다.
// - 한국철도공사: 역명/역코드만 주고 좌표가 없어서, 주간 크론이 미리 네이버
//   지오코딩으로 좌표를 붙여 KV에 캐싱해두고 /api/nursing-rooms는 그 결과만 읽는다
//   (요청마다 역 100여 개를 라이브로 지오코딩하면 느리고 Workers 서브리퀘스트
//   한도에 걸릴 수 있음).
const BUSAN_BASE = "https://apis.data.go.kr/6260000/BusanNursingroomInfoService/getNursingroomInfo";
const KORAIL_BASE = "https://apis.data.go.kr/B551457/convenience";
const KORAIL_KV_KEY = "nursing-rooms:korail";
const KORAIL_KV_TTL_SECONDS = 60 * 60 * 24 * 14; // 크론은 매주 도니까 2주치 여유

// 장소 자동 보강 시 "정보출처"에 넣을 원본 데이터셋 링크 — 사람이 검토할 때
// 근거를 바로 확인할 수 있게 한다.
export const NURSING_SOURCE_URLS = {
  "부산광역시": "https://www.data.go.kr/data/15034033/openapi.do",
  "한국철도공사": "https://www.data.go.kr/data/15125774/openapi.do",
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

// 주간 크론에서만 호출된다 — 역 100여 개를 순차 지오코딩해 KV에 통째로 저장한다.
export async function runKorailGeocodeRefresh(env) {
  if (!env.RATE_LIMIT) return;

  const stations = await fetchKorailNursingStations(env);
  const rooms = [];

  // 네이버 지오코딩 API는 초당 호출 제한이 있어 순차 호출이 필요하다.
  /* oxlint-disable no-await-in-loop */
  for (const station of stations) {
    const coord = await geocodeStation(env, station.name);
    if (!coord) continue;
    rooms.push({
      name: `${station.name}역`,
      address: "",
      place: "",
      tel: "",
      lat: coord.lat,
      lng: coord.lng,
      fatherAllowed: false,
      source: "한국철도공사",
      sourceUrl: NURSING_SOURCE_URLS["한국철도공사"],
    });
  }
  /* oxlint-enable no-await-in-loop */

  await env.RATE_LIMIT.put(KORAIL_KV_KEY, JSON.stringify(rooms), { expirationTtl: KORAIL_KV_TTL_SECONDS });
}

async function readKorailNursingRooms(env) {
  if (!env.RATE_LIMIT) return [];
  const raw = await env.RATE_LIMIT.get(KORAIL_KV_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// 새 지역 API가 늘어나도 프론트는 이 함수 하나만 호출하면 되도록 결과를 합쳐서 준다.
export async function fetchAllNursingRooms(env) {
  const [busan, korail] = await Promise.all([fetchBusanNursingRooms(env), readKorailNursingRooms(env)]);
  return [...busan, ...korail];
}
