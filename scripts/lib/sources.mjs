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

// 반경 안의 음식점(contentTypeId 39)을 가까운 순으로 준다. cat3 로 카페/디저트가 갈린다.
export function makeFindNearby(tour, { radius = 3000 } = {}) {
  return async ({ lat, lng }) => {
    const j = await tour.call("locationBasedList2", {
      mapX: String(lng), mapY: String(lat), radius: String(radius),
      contentTypeId: "39", numOfRows: "30", arrange: "E",
    });
    return tour.items(j).map((x) => ({ title: clean(x.title), dist: Number(x.dist), cat3: x.cat3 }));
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
