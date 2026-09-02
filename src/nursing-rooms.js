import { fetchWithTimeout } from "./http.js";
import { USER_ROOMS_KV_KEY } from "./nursing-reports.js";

// 공공데이터포털의 지역별 수유실 API를 모아 지도 레이어용으로 정규화한다.
// - 부산광역시: 좌표를 직접 주는 API라 요청마다 바로 불러온다.
// - 한국철도공사/서울교통공사: 역명만 주고 좌표가 없어서, 주간 크론이 미리 네이버
//   지오코딩으로 좌표를 붙여 KV에 캐싱해두고 /api/nursing-rooms는 그 결과만 읽는다.
//   역 좌표는 한 번 구하면 거의 안 바뀌므로 station-coords 캐시에 누적 저장하고,
//   매주 새로 필요한 역만(최대 MAX_NEW_GEOCODES_PER_RUN개) 지오코딩한다 — 한 번의
//   실행에서 200개 넘게 순차 fetch하면 Workers 서브리퀘스트 한도에 걸려 뒷부분이
//   조용히 비어버리는 것을 실측으로 확인했다.
const BUSAN_BASE = "https://apis.data.go.kr/6260000/BusanNursingroomInfoService/getNursingroomInfo";
const KORAIL_BASE = "https://apis.data.go.kr/B551457/convenience";
const SEOUL_METRO_BASE = "https://apis.data.go.kr/B553766/facility";
const KORAIL_KV_KEY = "nursing-rooms:korail";
const SEOUL_METRO_KV_KEY = "nursing-rooms:seoul-metro";
const STATION_COORDS_KV_KEY = "nursing-rooms:station-coords";
const STATION_KV_TTL_SECONDS = 60 * 60 * 24 * 14; // 크론은 매주 도니까 2주치 여유
const STATION_COORDS_KV_TTL_SECONDS = 60 * 60 * 24 * 90; // 역 좌표는 거의 안 바뀌어서 길게
// 실측 결과 한 번의 Worker 실행(크론 1틱)에서 순차 fetch를 200개 넘게 하면
// "Too many subrequests by single Worker invocation" 오류로 조용히 끊긴다 —
// 그래서 이미 좌표를 구한 역은 캐시에서 재사용하고, 새로 필요한 역만 이
// 한도 안에서 매주 조금씩 채운다(첫 백필은 몇 주에 걸쳐 완성됨).
const MAX_NEW_GEOCODES_PER_RUN = 40;

// 장소 자동 보강 시 "정보출처"에 넣을 원본 데이터셋 링크 — 사람이 검토할 때
// 근거를 바로 확인할 수 있게 한다.
export const NURSING_SOURCE_URLS = {
  "부산광역시": "https://www.data.go.kr/data/15034033/openapi.do",
  "한국철도공사": "https://www.data.go.kr/data/15125774/openapi.do",
  "서울교통공사": "https://www.data.go.kr/data/15143841/openapi.do",
  "수유정보 알리미": "https://sooyusil.com/home/39.htm",
};

// 인구보건복지협회가 운영하는 전국 수유시설 명부. 앞의 세 곳은 부산과 역사에
// 몰려 있어 그 밖의 지역이 비어 있었는데, 여기는 전국 3,000곳을 좌표까지 붙여
// 준다. 아빠가 들어갈 수 있는지도 알려 준다 — 이 앱에서는 그게 핵심이다.
const SOOYUSIL_BASE = "https://sooyusil.com/api/nursingRoomJSON.do";
const SOOYUSIL_KV_KEY = "nursing-rooms:sooyusil";
const SOOYUSIL_KV_TTL_SECONDS = 60 * 60 * 24 * 14;
// 한 번에 전국을 주지 않아 시·도로 나눠 부른다. 열일곱 번이면 끝나서 크론 한 틱에
// 들어간다.
export const SOOYUSIL_ZONES = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];

export function normalizeSooyusilRoom(room) {
  // Number("")가 0이라 빈 좌표가 그대로 통과한다. 그러면 아프리카 앞바다(0,0)에
  // 수유실 핀이 찍힌다 — 좌표가 비어 오는 행이 실제로 있다.
  const lat = Number(String(room.gpsLat ?? "").trim() || Number.NaN);
  const lng = Number(String(room.gpsLong ?? "").trim() || Number.NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
  return {
    name: room.roomName || "",
    address: room.address || "",
    // 건물 안 어디인지. "3층 여자화장실 옆" 같은 안내가 들어 있어 실제로 찾아갈 때 쓸모가 있다.
    place: room.location || "",
    tel: room.managerTelNo || "",
    lat,
    lng,
    // 명세상 1이 가능, 0이 불가. 이름 쪽도 같이 보는 이유는 코드가 비어 오는 행이 있어서다.
    fatherAllowed: String(room.fatherUseCode) === "1" || room.fatherUseNm === "아빠이용가능",
    source: "수유정보 알리미",
    sourceUrl: NURSING_SOURCE_URLS["수유정보 알리미"],
  };
}

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

async function readStationCoords(env) {
  if (!env.RATE_LIMIT) return {};
  const raw = await env.RATE_LIMIT.get(STATION_COORDS_KV_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// 주간 크론에서만 호출된다. 정류장명이 겹치는 환승역(예: 종로3가 1/3/5호선)도
// 역명 기준으로 좌표 캐시를 공유하고, 이미 캐시에 있는 역은 다시 지오코딩하지
// 않는다 — 새로 필요한 역만(최대 MAX_NEW_GEOCODES_PER_RUN개) 이번 실행에서
// 채운다.
export async function runStationNursingGeocodeRefresh(env) {
  if (!env.RATE_LIMIT) return;

  const [korailStations, seoulMetroItems, coords] = await Promise.all([
    fetchKorailNursingStations(env),
    fetchSeoulMetroNursingRooms(env),
    readStationCoords(env),
  ]);

  const neededNames = new Set([...korailStations.map((s) => s.name), ...seoulMetroItems.map((i) => i.stnNm)]);
  const newNames = [...neededNames].filter((name) => !coords[name]).slice(0, MAX_NEW_GEOCODES_PER_RUN);

  // 네이버 지역검색 API는 초당 호출 제한이 있어 순차 호출이 필요하다.
  /* oxlint-disable no-await-in-loop */
  for (const name of newNames) {
    const coord = await geocodeStation(env, name);
    if (coord) coords[name] = coord;
  }
  /* oxlint-enable no-await-in-loop */

  const korailRooms = korailStations
    .filter((s) => coords[s.name])
    .map((s) => ({
      name: `${s.name}역`,
      address: "",
      place: "",
      tel: "",
      lat: coords[s.name].lat,
      lng: coords[s.name].lng,
      fatherAllowed: false,
      source: "한국철도공사",
      sourceUrl: NURSING_SOURCE_URLS["한국철도공사"],
    }));

  const seoulMetroRooms = seoulMetroItems
    .filter((i) => coords[i.stnNm])
    .map((i) => ({
      name: `${i.stnNm}역 (${i.lineNm})`,
      address: "",
      place: [i.stnFlr, i.exitNo ? `${i.exitNo}번 출구` : "", i.dtlPstn].filter(Boolean).join(" · "),
      tel: i.tel,
      lat: coords[i.stnNm].lat,
      lng: coords[i.stnNm].lng,
      fatherAllowed: false,
      source: "서울교통공사",
      sourceUrl: NURSING_SOURCE_URLS["서울교통공사"],
    }));

  await Promise.all([
    env.RATE_LIMIT.put(STATION_COORDS_KV_KEY, JSON.stringify(coords), {
      expirationTtl: STATION_COORDS_KV_TTL_SECONDS,
    }),
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
// 시·도를 하나씩 물어 전국을 받아 KV에 넣어 둔다. 주간 크론이 부른다.
export async function refreshSooyusilRooms(env) {
  if (!env.NURSING_API_KEY || !env.RATE_LIMIT) return 0;
  const rooms = [];
  /* oxlint-disable no-await-in-loop -- 한 번에 다 부르면 상대 서버에 부담이다. */
  for (const zone of SOOYUSIL_ZONES) {
    const qs = new URLSearchParams({ confirmApiKey: env.NURSING_API_KEY, zoneName: zone });
    try {
      const res = await fetchWithTimeout(`${SOOYUSIL_BASE}?${qs}`, {}, 20_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const room of data.roomList || []) {
        const one = normalizeSooyusilRoom(room);
        if (one) rooms.push(one);
      }
    } catch (err) {
      // 한 지역이 실패해도 나머지는 받는다. 다음 주에 다시 채워진다.
      console.warn(`수유정보 알리미 ${zone} 실패: ${err.message}`);
    }
  }
  /* oxlint-enable no-await-in-loop */
  if (rooms.length === 0) return 0;
  await env.RATE_LIMIT.put(SOOYUSIL_KV_KEY, JSON.stringify(rooms), {
    expirationTtl: SOOYUSIL_KV_TTL_SECONDS,
  });
  return rooms.length;
}

// 같은 수유실이 출처마다 따로 잡힌다. 부산 데이터와 전국 명부가 특히 많이 겹쳐서,
// 지도에 핀이 두 개씩 찍히면 사용자는 다른 곳인 줄 안다. 120m 안이면 같은 곳으로 본다.
export function dedupeByDistance(rooms, meters = 120) {
  const kept = [];
  const grid = new Map();
  const key = (lat, lng) => `${Math.round(lat * 1000)},${Math.round(lng * 1000)}`;
  for (const room of rooms) {
    if (!Number.isFinite(room.lat) || !Number.isFinite(room.lng)) continue;
    let dup = false;
    for (let dy = -1; dy <= 1 && !dup; dy += 1) {
      for (let dx = -1; dx <= 1 && !dup; dx += 1) {
        const near = grid.get(`${Math.round(room.lat * 1000) + dy},${Math.round(room.lng * 1000) + dx}`);
        for (const other of near || []) {
          const ky = (room.lat - other.lat) * 111_000;
          const kx = (room.lng - other.lng) * 111_000 * Math.cos((room.lat * Math.PI) / 180);
          if (ky * ky + kx * kx < meters * meters) { dup = true; break; }
        }
      }
    }
    if (dup) continue;
    kept.push(room);
    const k = key(room.lat, room.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(room);
  }
  return kept;
}

export async function fetchAllNursingRooms(env) {
  const [busan, korail, seoulMetro, sooyusil, user] = await Promise.all([
    fetchBusanNursingRooms(env),
    readCachedRooms(env, KORAIL_KV_KEY),
    readCachedRooms(env, SEOUL_METRO_KV_KEY),
    readCachedRooms(env, SOOYUSIL_KV_KEY),
    readCachedRooms(env, USER_ROOMS_KV_KEY),
  ]);
  // 좌표를 직접 확인한 출처를 앞에 둔다 — 겹칠 때 이쪽이 남는다. 사람이 알려준
  // 것은 맨 뒤에 둬서, 이미 명부에 있는 곳을 다시 올리면 조용히 묻히게 한다.
  return dedupeByDistance([...busan, ...korail, ...seoulMetro, ...sooyusil, ...user]);
}
