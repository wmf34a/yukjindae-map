// 장소 정보를 채우는 외부 API 어댑터.
//
// 원래는 발굴 스크립트(scripts/lib/sources.mjs) 안에만 있었는데, 운영자가 노션에서
// 체크박스를 켜면 크론이 대신 채우도록 하면서 Worker에서도 같은 호출이 필요해졌다.
// 두 벌로 나뉘면 한쪽만 고치는 사고가 나므로 여기 한 곳에 둔다.
//
// Node의 fs나 process에 기대지 않고 키를 인자로 받는다 — 그래야 Worker에서 그대로 돈다.

import { fetchWithTimeout } from "./http.js";

export const clean = (s) =>
  String(s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

// ── TourAPI ─────────────────────────────────────────────
const TOUR_BASE = "https://apis.data.go.kr/B551011/KorService2";
const TOUR_COMMON = { MobileOS: "ETC", MobileApp: "yukjindaemap", _type: "json" };

// 항목이 1건이면 배열이 아니라 객체로 온다.
export function tourItems(json) {
  const body = json && json.response && json.response.body;
  if (!body || !body.items || !body.items.item) return [];
  return Array.isArray(body.items.item) ? body.items.item : [body.items.item];
}

export function tourApi(key) {
  return {
    call: async (path, params) => {
      const qs = new URLSearchParams({ ...TOUR_COMMON, ...params });
      const res = await fetchWithTimeout(`${TOUR_BASE}/${path}?serviceKey=${key}&${qs}`);
      // 공공데이터 포털은 장애 때 JSON 대신 XML 에러 문서를 준다.
      try {
        return JSON.parse(await res.text());
      } catch {
        return {};
      }
    },
    items: tourItems,
  };
}



// ── 카카오 ──────────────────────────────────────────────
const KAKAO_FOOD = "FD6";
const KAKAO_CAFE = "CE7";
const KAKAO_CAFE_NAME = /카페|디저트|베이커리|제과|커피/;

// 좌표 반경 검색을 그대로 지원하고 거리까지 응답에 담아 준다. TourAPI는 관광 등록
// 업소만 담고 있어 지방에서 반경 3km가 통째로 비었고, 네이버 지역검색에는 좌표
// 파라미터가 없어 키워드로 위치를 짐작해야 했다.
export function makeKakaoNearby(key, { radius = 5000 } = {}) {
  const headers = { Authorization: `KakaoAK ${key}` };

  const search = async ({ lat, lng }, code) => {
    const qs = new URLSearchParams({
      x: String(lng), y: String(lat), radius: String(radius),
      category_group_code: code, size: "15", sort: "distance",
    });
    const res = await fetchWithTimeout(`https://dapi.kakao.com/v2/local/search/category.json?${qs}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.documents || []).map((p) => ({
      title: p.place_name,
      dist: Number(p.distance),
      // 카카오가 주는 dist는 직선거리다. 실제로 적을 거리는 도로 거리라
      // 좌표를 같이 들고 나간다 — 고른 뒤에 길찾기로 다시 잰다.
      lat: Number(p.y),
      lng: Number(p.x),
      kind: code === KAKAO_CAFE ? "cafe" : "food",
      category: p.category_name || "",
    }));
  };

  return async (coords) => {
    const [food, cafe] = await Promise.all([search(coords, KAKAO_FOOD), search(coords, KAKAO_CAFE)]);
    // FD6에도 카페가 섞여 온다. 카페는 CE7 결과만 쓰고 음식점 쪽에서는 걸러 낸다.
    return [...food.filter((f) => !KAKAO_CAFE_NAME.test(f.category)), ...cafe];
  };
}

// ── 네이버 ──────────────────────────────────────────────
export function makeGeocode({ mapClientId, mapClientSecret }) {
  return async (address) => {
    const res = await fetchWithTimeout(
      `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
      { headers: { "x-ncp-apigw-api-key-id": mapClientId, "x-ncp-apigw-api-key": mapClientSecret } }
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const hit = data && data.addresses && data.addresses[0];
    return hit ? { lat: Number(hit.y), lng: Number(hit.x) } : null;
  };
}

// 두 좌표 사이 실제 도로 거리(m). 직선거리를 적었더니 지역장이 지도와 대조해
// 바로 알아챘다 — 대전 국립중앙과학관에서 팔선생까지 직선 511m인데 차로는 1,687m다.
//
// 저장된 좌표가 차가 못 다니는 지점에 찍혀 있으면(환선굴은 동굴 자체, 농다리는
// 돌다리 위) 네이버가 산을 통째로 도는 경로를 내놓는다. 직선 2.9km인 환선굴에서
// 35.5km가 그렇게 나왔다. 그런 경로는 믿지 않고 null을 준다 — 그러면 거리를
// 아예 안 적는다. 틀린 숫자보다 없는 편이 낫다.
//
// 배수만 보고 자르면 안 된다. 도심에서 일방통행 때문에 직선 200m가 700m가 되는 건
// 정상이고, 율곡수목원에서 율곡식당도 직선 1.4km에 도로 5.2km(3.6배)인데 그 5.2km가
// 지역장이 확인해준 맞는 값이었다. 그래서 절대 거리도 같이 본다.
const DETOUR_MIN_M = 10000;
const DETOUR_RATIO = 3;

export function straightKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function makeRoadDistance({ mapClientId, mapClientSecret }) {
  return async (from, to) => {
    const res = await fetchWithTimeout(
      "https://maps.apigw.ntruss.com/map-direction/v1/driving"
      + `?start=${from.lng},${from.lat}&goal=${to.lng},${to.lat}&option=trafast`,
      { headers: { "x-ncp-apigw-api-key-id": mapClientId, "x-ncp-apigw-api-key": mapClientSecret } }
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const meters = data?.route?.trafast?.[0]?.summary?.distance;
    if (!Number.isFinite(meters)) return null;
    if (meters > DETOUR_MIN_M && meters / 1000 > straightKm(from, to) * DETOUR_RATIO) return null;
    return meters;
  };
}

// 블로그와 카페를 같이 뒤진다. 편의시설은 공식 사이트보다 방문 후기에 더 많이 적힌다.
export function makeSearchPosts({ searchClientId, searchClientSecret }) {
  const headers = {
    "X-Naver-Client-Id": searchClientId,
    "X-Naver-Client-Secret": searchClientSecret,
  };
  const one = async (kind, query) => {
    const res = await fetchWithTimeout(
      `https://openapi.naver.com/v1/search/${kind}?query=${encodeURIComponent(query)}&display=20&sort=date`,
      { headers }
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return (data.items || []).map((i) => ({
      title: clean(i.title),
      description: clean(i.description),
      link: i.link || "",
      // 블로그는 postdate(YYYYMMDD), 카페는 날짜 필드가 없다.
      date: i.postdate || "",
    }));
  };
  // 지역까지 붙여 검색한다 — "장미공원 수유실"만으로는 중랑 장미공원 글이 먼저 걸린다.
  return async (placeName, keyword, region = "") => {
    const query = [region, placeName, keyword].filter(Boolean).join(" ");
    const [blog, cafe] = await Promise.all([
      one("blog.json", query).catch(() => []),
      one("cafearticle.json", query).catch(() => []),
    ]);
    return [...blog, ...cafe];
  };
}

