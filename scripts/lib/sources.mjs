// 장소 파이프라인이 쓰는 외부 API 어댑터.
//
// src/place-pipeline.js 는 네트워크를 인자로 받는 순수 모듈이라 테스트가 붙는다.
// 실제 호출은 전부 여기에 모아 두어, 스크립트마다 TourAPI 호출을 다시 짜지 않게 한다.

import fs from "node:fs";

export function loadVars(path = ".dev.vars") {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const clean = (s) =>
  String(s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

// ── TourAPI ─────────────────────────────────────────────
const TOUR_BASE = "https://apis.data.go.kr/B551011/KorService2";
const TOUR_COMMON = { MobileOS: "ETC", MobileApp: "yukjindaemap", _type: "json" };

// 응답은 항목이 1건이면 배열이 아니라 객체로 온다.
function tourItems(j) {
  const b = j?.response?.body;
  if (!b?.items?.item) return [];
  return Array.isArray(b.items.item) ? b.items.item : [b.items.item];
}

export function tourApi(key) {
  const call = async (path, params) => {
    const qs = new URLSearchParams({ ...TOUR_COMMON, ...params });
    const res = await fetch(`${TOUR_BASE}/${path}?serviceKey=${key}&${qs}`);
    // 공공데이터 포털은 장애 때 JSON 대신 XML 에러 문서를 준다. 파싱 실패는 빈 결과로 본다.
    try { return JSON.parse(await res.text()); } catch { return {}; }
  };
  return { call, items: tourItems };
}

// ── 근처 맛집·카페 ───────────────────────────────────────
// 카카오 장소 카테고리 그룹 코드. FD6 음식점 / CE7 카페.
const KAKAO_FOOD = "FD6";
const KAKAO_CAFE = "CE7";
const KAKAO_CAFE_NAME = /카페|디저트|베이커리|제과|커피/;

// 카카오는 좌표 반경 검색을 그대로 지원하고 거리까지 응답에 담아 준다.
//
// 전에는 TourAPI 반경 → "지역 장소명 맛집" → "시군구 맛집" 3단으로 우회했다.
// TourAPI가 관광 등록 업소만 담고 있어 지방에서 반경 3km가 통째로 비었고(해남
// 공룡박물관은 20km를 뒤져야 한 곳 나왔다), 네이버 지역검색에는 좌표 파라미터가
// 없어 키워드로 위치를 짐작해야 했기 때문이다. 카카오는 같은 자리에서 3km 안에
// 음식점 5곳·카페 2곳을 바로 준다.
export function makeKakaoNearby(key, { radius = 5000 } = {}) {
  const headers = { Authorization: `KakaoAK ${key}` };

  const search = async ({ lat, lng }, code) => {
    const qs = new URLSearchParams({
      x: String(lng), y: String(lat), radius: String(radius),
      category_group_code: code, size: "15", sort: "distance",
    });
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${qs}`, { headers });
    if (!res.ok) throw new Error(`카카오 ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const data = await res.json();
    return (data.documents || []).map((p) => ({
      title: p.place_name,
      dist: Number(p.distance),
      kind: code === KAKAO_CAFE ? "cafe" : "food",
      category: p.category_name || "",
      url: p.place_url || "",
    }));
  };

  return async (coords) => {
    const [food, cafe] = await Promise.all([
      search(coords, KAKAO_FOOD),
      search(coords, KAKAO_CAFE),
    ]);
    // FD6에도 카페가 섞여 온다(카카오가 "음식점 > 카페"로 분류하는 것들).
    // 카페는 CE7 결과만 쓰고 음식점 쪽에서는 걸러 낸다.
    return [...food.filter((f) => !KAKAO_CAFE_NAME.test(f.category)), ...cafe];
  };
}

// 운영시간·요금·주차는 콘텐츠 타입마다 필드 이름이 달라 두 벌을 같이 본다.
export async function fetchDetail(tour, contentid, contenttypeid) {
  const intro = tour.items(await tour.call("detailIntro2", { contentId: contentid, contentTypeId: contenttypeid }))[0] || {};
  const common = tour.items(await tour.call("detailCommon2", { contentId: contentid }))[0] || {};
  return {
    hours: clean(intro.usetime || intro.usetimeculture),
    rest: clean(intro.restdate || intro.restdateculture),
    fee: clean(intro.usefee || intro.usefeeculture),
    parking: clean(intro.parking || intro.parkingculture),
    tel: clean(intro.infocenter || intro.infocenterculture),
    ageRange: clean(intro.expagerange),
    overview: clean(common.overview).slice(0, 300),
    homepage: clean(common.homepage).match(/https?:\/\/[^\s"'<]+/)?.[0] || "",
  };
}

// ── 네이버 ──────────────────────────────────────────────
export function makeGeocode(vars) {
  return async (address) => {
    const res = await fetch(
      `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
      {
        headers: {
          "x-ncp-apigw-api-key-id": vars.NAVER_MAP_CLIENT_ID,
          "x-ncp-apigw-api-key": vars.NAVER_MAP_CLIENT_SECRET,
        },
      }
    );
    const data = await res.json().catch(() => ({}));
    const hit = data?.addresses?.[0];
    return hit ? { lat: Number(hit.y), lng: Number(hit.x) } : null;
  };
}

// 블로그와 카페를 같이 뒤진다. 편의시설은 공식 사이트보다 방문 후기에 더 많이 적힌다.
export function makeSearchPosts(vars) {
  const headers = {
    "X-Naver-Client-Id": vars.NAVER_SEARCH_CLIENT_ID,
    "X-Naver-Client-Secret": vars.NAVER_SEARCH_CLIENT_SECRET,
  };
  const one = async (kind, query) => {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/${kind}?query=${encodeURIComponent(query)}&display=20&sort=date`,
      { headers }
    );
    const data = await res.json().catch(() => ({}));
    return (data.items || []).map((i) => ({
      title: clean(i.title),
      description: clean(i.description),
      link: i.link || "",
      // 블로그는 postdate(YYYYMMDD), 카페는 날짜 필드가 없다.
      date: i.postdate || "",
    }));
  };
  // 지역까지 붙여 검색한다 — "장미공원 수유실" 만으로는 중랑 장미공원 글이 먼저 걸린다.
  return async (placeName, keyword, region = "") => {
    const query = [region, placeName, keyword].filter(Boolean).join(" ");
    const [blog, cafe] = await Promise.all([
      one("blog.json", query).catch(() => []),
      one("cafearticle.json", query).catch(() => []),
    ]);
    return [...blog, ...cafe];
  };
}
