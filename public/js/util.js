// 노션에서 온 텍스트(장소명/추천이유/제보로 반영된 값 등)를 innerHTML에 꽂기 전에
// 반드시 거쳐야 하는 이스케이프 유틸. 지금은 가족이 직접 입력하지만, 퍼블릭 제보가
// 운영자 승인을 거쳐 같은 필드에 들어오게 되므로 렌더링 시점에 한 번 더 막아둔다.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

// href/src로 쓰기 전에 http(s) 스킴인지 확인한다 — javascript: 같은 스킴으로 된
// URL 속성값이 그대로 링크가 되는 걸 막기 위함. 노션 "링크" 필드에 "공식 홈페이지
// https://..." 처럼 라벨이 앞에 붙은 값이 수동 입력돼 있는 경우가 있어, 문자열
// 전체가 아니라 그 안에서 http(s) URL만 추출한다 — 전체를 그대로 넘기면 절대 URL로
// 파싱이 안 돼 우리 사이트 자신을 기준으로 한 상대경로로 잘못 해석돼버린다.
function safeHref(url) {
  if (!url) return "";
  const match = String(url).match(/https?:\/\/\S+/);
  if (!match) return "";
  try {
    const parsed = new URL(match[0]);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

// 앱인토스 미니앱 번들은 *.tossmini.com 오리진에서 실행되지만 API와 이미지는 그대로
// Cloudflare Worker가 서빙한다 — 그래서 미니앱에서만 절대경로가 필요하다. 웹
// (workers.dev)에서는 같은 오리진이라 빈 문자열로 두고 기존 상대경로를 유지한다.
const API_ORIGIN = globalThis.location?.hostname.endsWith(".tossmini.com")
  ? "https://yukjindae-map.wmf34a.workers.dev"
  : "";

function apiUrl(path) {
  const value = String(path ?? "");
  return API_ORIGIN && value.startsWith("/") && !value.startsWith("//") ? API_ORIGIN + value : value;
}

// 검수 모드. ?review=토큰 으로 들어오면 아직 공개하지 않은 장소까지 앱에서 보인다.
// 지역장이 노션을 직접 고치다 데이터를 날리는 것보다, 앱에서 보고 제보로 알려주는
// 편이 안전하다. 토큰은 이 탭에만 남겨 두어 상세페이지로 넘어가도 유지된다.
const REVIEW_KEY = "yukjindae_review_token";

function reviewToken() {
  try {
    const fromUrl = new URLSearchParams(location.search).get("review");
    if (fromUrl) {
      sessionStorage.setItem(REVIEW_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(REVIEW_KEY) || "";
  } catch {
    // 저장소가 막혀 있으면 이 페이지에서만 동작한다.
    return new URLSearchParams(location.search).get("review") || "";
  }
}

// 검수 모드일 때만 토큰을 붙인다. 일반 사용자의 요청에는 아무것도 달라지지 않는다.
function withReview(path) {
  const token = reviewToken();
  if (!token) return path;
  return path + (path.includes("?") ? "&" : "?") + "review=" + encodeURIComponent(token);
}

// img src 전용. 우리 이미지는 R2 미러링 결과라 "/images/..." 상대경로로 오고,
// 장소 사진은 외부 https URL로 오는 경우도 있어서 safeHref(http(s) 전용)로는
// 상대경로가 전부 걸러진다. 같은 출처 절대경로와 http(s)만 허용하고 javascript:,
// data: 등 나머지 스킴은 빈 문자열로 떨군다.
function safeImageSrc(url) {
  const value = String(url ?? "").trim();
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return apiUrl(value);
  return safeHref(value);
}

// 축제 카드/상세에 붙이는 디데이 딱지. 시작 전이면 "D-n", 기간 중이면 "진행중",
// periodStart가 없으면 빈 문자열(딱지 없음).
function festivalDday(festival) {
  const start = String(festival?.periodStart || "").slice(0, 10);
  if (!start) return "";
  const end = String(festival?.periodEnd || start).slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  if (todayStr < start) {
    const days = Math.round((new Date(start) - new Date(todayStr)) / 86400000);
    return `D-${days}`;
  }
  if (todayStr <= end) return "진행중";
  return "";
}

// 매월 1일 크론이 매기는 "이달의 지역별 Top 10" 순위. 갱신이 실패하면 지난달
// 순위가 노션에 그대로 남으므로, 추천월이 이번 달과 같을 때만 순위로 인정한다 —
// 8월에 뽑은 물놀이장이 9월에도 1위로 서 있으면 추천이 아니라 방해가 된다.
function currentMonthKey() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

// 막아야 하는 것은 "지난달 순위가 남아 있는 것"이지 "다음 달 것이 미리 매겨진 것"이
// 아니다. 오픈 전에 다음 달 순위를 미리 돌려 두는 일이 있는데, 정확히 같은 달만
// 인정하면 그게 통째로 안 보인다.
function monthlyRank(place) {
  if (!place || typeof place.rank !== "number") return null;
  if (!place.rankMonth || place.rankMonth < currentMonthKey()) return null;
  return place.rank;
}

// 순위가 있는 곳을 앞에, 없는 곳을 뒤에 둔다. 순위 없는 곳끼리는 원래 순서를
// 유지한다 — 목록 순서가 새로고침마다 바뀌면 아까 본 곳을 다시 못 찾는다.
function sortByMonthlyRank(places) {
  return places
    .map((place, index) => ({ place, index, rank: monthlyRank(place) }))
    .toSorted((a, b) => {
      if (a.rank === null && b.rank === null) return a.index - b.index;
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    })
    .map((entry) => entry.place);
}

// 근처맛집/근처카페는 노션에 자유 텍스트로 들어있고, 형식이 두 가지로 섞여 있다.
//   "사생활 영도점, 올바릇식당 영도점"                     ← 쉼표, 상호만
//   "포도호텔 레스토랑(주소, 일식) / 두도 레스토랑(주소)"    ← 슬래시, 괄호에 주소·메모
// 괄호 안에도 쉼표가 들어가므로 단순 split은 상호를 두 동강 낸다. 괄호 깊이를
// 세면서 바깥에 있는 구분자에서만 자른다.
function splitNearbyList(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];

  const items = [];
  let depth = 0;
  let buffer = "";
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth += 1;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);

    if (depth === 0 && (ch === "," || ch === "/")) {
      items.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  items.push(buffer);

  return items.map((s) => s.trim()).filter(Boolean);
}

// 코스 지도 핀과 상세페이지 대표 표시에 쓸 첫 번째 가게. 여러 곳이 적혀 있으면
// 지금까지는 코스에서 통째로 버려져 핀이 안 찍혔다 — 맨 앞을 대표로 쓴다.
function primaryNearby(value) {
  return splitNearbyList(value)[0] || "";
}

// 오늘 날씨에 맞는 카테고리를 앞으로 당긴다. 서버(/api/today)가 boost/avoid를
// 계산해 주므로 여기서는 순서만 바꾼다. 걸러내지 않는 이유는, 비 온다고 야외를
// 목록에서 지우면 "다음에 갈 곳"을 찾는 사람이 아무것도 못 보게 되기 때문이다.
// src/today-weather.js에 같은 규칙이 있지만 그쪽은 ESM이라 여기서 못 불러온다.
// 0이 오늘 날씨에 가장 맞고 2가 가장 안 맞는다. 지역별 1위를 고를 때도 같은
// 기준을 써야, 화면 위에서는 "실내에서 놀기 좋은 곳"이라 해놓고 아래에는 야외만
// 늘어놓는 일이 생기지 않는다.
//
// avoid를 boost보다 먼저 본다. 목장·수목원은 "자연·공원"과 "체험·문화"를 둘 다
// 달고 있어서, boost를 먼저 보면 비 오는 날에도 체험이라는 이유로 통과했다.
// 비가 오면 "야외다"라는 사실이 "체험이다"보다 앞선다.
function weatherScore(place, recommendation) {
  if (!recommendation) return 1;
  const categories = place.categories || [];
  if ((recommendation.avoid || []).some((c) => categories.includes(c))) return 2;
  if ((recommendation.boost || []).some((c) => categories.includes(c))) return 0;
  return 1;
}

function sortByWeather(places, recommendation) {
  if (!recommendation) return places;
  const score = (place) => weatherScore(place, recommendation);
  return places
    .map((place, index) => ({ place, index, score: score(place) }))
    .toSorted((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index))
    .map((entry) => entry.place);
}

// 진행 중인 할인·이벤트만 통과시킨다. 종료일이 없으면("상시 할인" 등) 언제
// 내려야 할지 알 수 없어 아예 노출하지 않는다 — 끝난 행사가 계속 붙어 있는 쪽이
// 정보가 없는 것보다 나쁘다. 종료일 당일까지는 유효한 것으로 본다.
function activeEvent(place) {
  const info = String(place?.eventInfo || "").trim();
  const end = String(place?.eventEndDate || "").slice(0, 10);
  if (!info || !end) return null;
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (end < today) return null;
  return { info, end, source: place.eventSourceUrl || "" };
}

// 브라우저 fetch도 기본 타임아웃이 없다 — 네트워크가 불안정한 이동 중(주 사용
// 상황)에 응답이 안 오면 "불러오는 중..."에서 영영 멈춘다. 공통 래퍼로 10초에
// 끊어서 각 화면의 catch가 에러 문구를 띄우게 한다.
const FETCH_TIMEOUT_MS = 10000;

function fetchJson(url, options = {}) {
  return fetch(apiUrl(url), { ...options, signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS) }).then(
    (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
  );
}

// 홈은 지역을 고르기 전까지 전국 장소를 전부 그린다. 224곳이 되면서 화면을 끝까지
// 내려야 제보 버튼이 나오는 지경이 됐다. 첫 화면에는 이만큼만 보여주고 나머지는
// "더보기"로 넘긴다.
const HOME_PLACE_LIMIT = 12;

function distanceKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 위치를 알려준 사람에게는 가까운 곳부터 보여준다. 전국 목록을 처음부터 훑게
// 하는 것보다, 지금 갈 수 있는 곳을 먼저 보여주는 편이 맞다.
// 좌표가 없는 장소는 거리를 알 수 없으므로 뒤로 보낸다.
function sortByDistance(places, coords) {
  if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
    return places.slice();
  }
  return places
    .map((place) => {
      const hasCoords = typeof place.lat === "number" && typeof place.lng === "number";
      return { place, dist: hasCoords ? distanceKm(coords, { lat: place.lat, lng: place.lng }) : Infinity };
    })
    .toSorted((a, b) => a.dist - b.dist)
    .map((x) => x.place);
}

// 지역을 고르기 전 홈에 무엇을 보여줄지.
//
// 예전에는 전국 224곳을 날씨순으로 정렬해 앞 12곳을 잘랐다. 그랬더니 비 오는 날
// 실내 시설이 우대되면서 전라도 박물관 다섯 곳이 연달아 뜨는 식이 됐다 — 서울에
// 사는 사람이 열면 전주가 첫 화면이었다.
//
// 대신 지역마다 이달의 1위를 한 곳씩 모은다. AI가 그 달 계절에 맞춰 고른 곳들이라
// 아무 곳이나 열두 개 뽑는 것보다 낫고, 지역이 골고루 섞여 어디 사는 사람이 열어도
// 자기 지역이 보인다.
function pickRegionTops(places, recommendation) {
  // 날씨가 먼저다. 비 오는 날 그 지역 1위가 야외라면, 순위를 조금 양보하더라도
  // 오늘 갈 수 있는 곳을 보여주는 편이 맞다. 같은 날씨 조건 안에서는 순위로 가린다.
  const key = (place) => [
    weatherScore(place, recommendation),
    monthlyRank(place) ?? Number.MAX_SAFE_INTEGER,
  ];

  const best = new Map();
  for (const place of places) {
    if (!place.region) continue;
    const current = best.get(place.region);
    if (!current) {
      best.set(place.region, place);
      continue;
    }
    const [aWeather, aRank] = key(place);
    const [bWeather, bRank] = key(current);
    if (aWeather < bWeather || (aWeather === bWeather && aRank < bRank)) {
      best.set(place.region, place);
    }
  }
  return [...best.values()];
}

// 네이버 지도 길찾기 주소를 만든다.
//
// 예전에는 주소로 검색만 시켰다(/p/search/{주소}). 그랬더니 그 주소에 있는 업소가
// 줄줄이 나오고 정작 목적지는 두 번째였다 — 한성백제박물관을 누르면 같은 건물의
// 비샵 레스토랑이 먼저 떴다. 버튼 이름은 "길찾기"인데 검색 결과 목록이 열린 셈이다.
//
// 좌표가 있으면 길찾기 화면을 자동차 모드로 바로 연다. 칸 순서는 정해져 있다:
//   /p/directions/{출발}/{도착}/{경유지}/{모드}
// 출발을 "-"로 비우면 네이버가 내 위치를 묻는다.
function toWebMercator(lat, lng) {
  const R = 20037508.34;
  return {
    x: (lng * R) / 180,
    y: (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (R / 180),
  };
}

function naverDirectionsUrl({ lat, lng, name, address }) {
  const label = String(name || address || "").trim();
  const hasCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && (Number(lat) !== 0 || Number(lng) !== 0);

  if (!hasCoords) {
    // 좌표를 모르면 검색으로 넘긴다. 주소보다 이름이 낫다 — 주소로 찾으면
    // 같은 건물의 다른 가게가 먼저 나온다.
    return `https://map.naver.com/p/search/${encodeURIComponent(label)}`;
  }
  const { x, y } = toWebMercator(Number(lat), Number(lng));
  const goal = `${x},${y},${encodeURIComponent(label)}`;
  return `https://map.naver.com/p/directions/-/${goal}/-/car`;
}

// 이 기기를 가리키는 임의의 ID. 방문자를 하루 한 번만 세기 위한 것이고
// 개인을 알아볼 수 있는 값은 담지 않는다.
//
// 시크릿 창이나 저장이 막힌 브라우저에서는 빈 문자열을 준다 — 그때는 서버가
// IP 해시로 대신 센다.
function deviceId() {
  const KEY = "yukjindae-device";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2))
        .replace(/[^A-Za-z0-9-]/g, "");
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

window.deviceId = deviceId;
window.naverDirectionsUrl = naverDirectionsUrl;
window.escapeHtml = escapeHtml;
window.safeHref = safeHref;
window.safeImageSrc = safeImageSrc;
window.festivalDday = festivalDday;
window.monthlyRank = monthlyRank;
window.sortByMonthlyRank = sortByMonthlyRank;
window.splitNearbyList = splitNearbyList;
window.primaryNearby = primaryNearby;
window.sortByWeather = sortByWeather;
window.activeEvent = activeEvent;
window.fetchJson = fetchJson;
window.apiUrl = apiUrl;
window.sortByDistance = sortByDistance;
window.distanceKm = distanceKm;
window.HOME_PLACE_LIMIT = HOME_PLACE_LIMIT;
window.pickRegionTops = pickRegionTops;
window.weatherScore = weatherScore;
window.reviewToken = reviewToken;
window.withReview = withReview;
