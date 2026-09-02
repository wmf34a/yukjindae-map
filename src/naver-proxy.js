// 네이버·카카오 지도 API로 나가는 프록시. 키를 프론트로 내보내지 않으려고
// 워커가 대신 부른다 — 이 파일의 함수는 모두 env 를 받아 서버에서만 돈다.
//
// worker.js 가 2,100줄을 넘어가면서 주제별로 갈랐다. 여기는 "바깥 지도 서비스에
// 물어보는 일"만 모은다: 근처 가게 찾기, 주소→좌표, 두 지점 사이 도로거리.
import { fetchWithTimeout, upstreamErrorResponse } from "./http.js";
import { decodeNaverHtml } from "./text-utils.js";
import {
  pickNearest,
  distanceKm,
  isValidCoords,
  nameMatches,
  NEARBY_SEARCH_RADIUS_M,
  MAX_ACCEPT_KM,
} from "./nearby-lookup.js";

async function searchNearbyByCoords(env, query, origin) {
  const qs = new URLSearchParams({
    query,
    x: String(origin.lng),
    y: String(origin.lat),
    radius: String(NEARBY_SEARCH_RADIUS_M),
    size: "10",
    sort: "distance",
  });
  try {
    const res = await fetchWithTimeout(`https://dapi.kakao.com/v2/local/search/keyword.json?${qs}`, {
      headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    });
    if (!res.ok) {
      // 조용히 삼키면 키가 잘못됐을 때 "근처에 없음"으로만 보여 원인을 못 찾는다.
      console.warn(`카카오 장소 검색 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return pickNearest(data.documents, { lat: Number(origin.lat), lng: Number(origin.lng) }, query);
  } catch (err) {
    console.warn(`카카오 장소 검색 예외: ${err.message}`);
    return null;
  }
}

// 상호 텍스트로 실제 가게를 찾는다.
//
// 이름만으로 찾으면 같은 상호의 다른 지점이 걸린다 — 대전 국립중앙과학관의
// "신세계백화점 푸드코트"가 서울 강남점으로 잡혀 총 거리 306km짜리 코스가
// 나왔다. 장소 좌표(lat/lng)를 함께 받으면 카카오 반경 검색으로 가장 가까운
// 지점을 고른다. 좌표가 없거나 카카오가 비면 예전처럼 네이버로 찾는다.
async function geocodeAddress(env, address) {
  try {
    const res = await fetchWithTimeout(
      `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
      {
        headers: {
          "x-ncp-apigw-api-key-id": env.NAVER_MAP_CLIENT_ID,
          "x-ncp-apigw-api-key": env.NAVER_MAP_CLIENT_SECRET,
        },
      }
    );
    if (!res.ok) return null;
    const hit = (await res.json().catch(() => ({})))?.addresses?.[0];
    if (!hit) return null;
    const lat = Number(hit.y);
    const lng = Number(hit.x);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

// 네이버 지역검색은 좌표로 범위를 좁힐 수 없다. 주소를 지오코딩해 장소에서
// 얼마나 떨어졌는지 재고, 너무 멀면 같은 상호의 다른 지점으로 보고 버린다.
async function searchNearbyByNaver(env, query, origin) {
  if (!env.NAVER_SEARCH_CLIENT_ID || !env.NAVER_SEARCH_CLIENT_SECRET) return null;
  if (!env.NAVER_MAP_CLIENT_ID || !env.NAVER_MAP_CLIENT_SECRET) return null;
  try {
    const res = await fetchWithTimeout(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5`,
      {
        headers: {
          "X-Naver-Client-Id": env.NAVER_SEARCH_CLIENT_ID,
          "X-Naver-Client-Secret": env.NAVER_SEARCH_CLIENT_SECRET,
        },
      }
    );
    if (!res.ok) return null;
    const here = { lat: Number(origin.lat), lng: Number(origin.lng) };
    for (const item of (await res.json()).items || []) {
      const name = decodeNaverHtml(item.title);
      if (!nameMatches(query, name)) continue;
      const address = item.roadAddress || item.address;
      if (!address) continue;
      const coords = await geocodeAddress(env, address);
      if (!coords) continue;
      if (distanceKm(here, coords) > MAX_ACCEPT_KM) continue;
      return {
        found: true,
        name,
        address,
        lat: coords.lat,
        lng: coords.lng,
        distanceM: Math.round(distanceKm(here, coords) * 1000),
      };
    }
    return null;
  } catch (err) {
    console.warn(`네이버 장소 검색 예외: ${err.message}`);
    return null;
  }
}

// 바깥 API 가 느릴 때 예외가 그대로 나가면 Worker 가 1101 을 반환하고 화면이
// 통째로 깨진다. 실제로 네이버 길찾기가 한 번 시간을 넘겨 코스보기가 깨졌다.
//
// 이 셋은 모두 "찾으면 좋고 못 찾으면 마는" 성격이다 — 핀 하나가 안 찍히는 것과
// 화면이 깨지는 것은 다르다. 그래서 실패를 found:false 로 돌려준다.
async function guarded(label, handler) {
  try {
    return await handler();
  } catch (err) {
    console.warn(`${label} 실패: ${err.message}`);
    return new Response(JSON.stringify({ found: false }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

export function handleNearbyPlace(env, url) {
  return guarded("근처 장소 검색", () => handleNearbyPlaceInner(env, url));
}

async function handleNearbyPlaceInner(env, url) {
  const q = url.searchParams.get("q");
  if (!q) {
    return new Response(JSON.stringify({ error: "q 파라미터가 필요합니다." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=86400",
  };
  // searchParams.get은 없으면 null을 준다. Number(null)이 0이라 그대로 넘기면
  // 좌표가 없는 요청이 (0, 0) 근처 검색으로 둔갑한다.
  const origin = { lat: url.searchParams.get("lat"), lng: url.searchParams.get("lng") };

  // 좌표를 받았으면 그 근처에서만 찾는다. 못 찾았다고 네이버로 넘어가면 위치를
  // 안 보고 다시 검색해 엉뚱한 지점을 집어온다 — 300km 떨어진 핀을 찍느니
  // 아무것도 안 찍는 편이 낫다.
  if (isValidCoords(origin)) {
    if (!env.KAKAO_REST_API_KEY) {
      // 조용히 넘어가면 코스 핀이 전부 사라진 채로도 아무 신호가 없다.
      console.warn("KAKAO_REST_API_KEY가 없어 좌표 기반 장소 검색을 건너뜁니다.");
      return new Response(JSON.stringify({ found: false }), { status: 200, headers });
    }
    const hit = await searchNearbyByCoords(env, q, origin)
      // 카카오에 없는 가게가 있다. 일산호수공원의 "일산칼국수본점"이 그렇다 —
      // 네이버 지역검색에만 있어서, 이름을 맞춰 찾으면 카카오 쪽은 빈손이다.
      // 그대로 두면 코스 핀이 사라지므로 네이버로 한 번 더 찾는다.
      || await searchNearbyByNaver(env, q, origin);
    return new Response(JSON.stringify(hit || { found: false }), { status: 200, headers });
  }

  if (!env.NAVER_SEARCH_CLIENT_ID || !env.NAVER_SEARCH_CLIENT_SECRET) {
    return new Response(JSON.stringify({ found: false }), { status: 200, headers });
  }

  const res = await fetchWithTimeout(
    `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=1`,
    {
      headers: {
        "X-Naver-Client-Id": env.NAVER_SEARCH_CLIENT_ID,
        "X-Naver-Client-Secret": env.NAVER_SEARCH_CLIENT_SECRET,
      },
    }
  );

  if (!res.ok) {
    return upstreamErrorResponse("장소 검색에 실패했습니다.", await res.text());
  }

  const data = await res.json();
  const item = data.items && data.items[0];

  if (!item) {
    return new Response(JSON.stringify({ found: false }), { status: 200, headers });
  }

  return new Response(
    JSON.stringify({
      found: true,
      name: decodeNaverHtml(item.title),
      address: item.roadAddress || item.address || "",
    }),
    { status: 200, headers }
  );
}

export function handleGeocode(env, url) {
  return guarded("주소 좌표 변환", () => handleGeocodeInner(env, url));
}

async function handleGeocodeInner(env, url) {
  const query = url.searchParams.get("query");
  if (!query) {
    return new Response(JSON.stringify({ error: "query 파라미터가 필요합니다." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (!env.NAVER_MAP_CLIENT_ID || !env.NAVER_MAP_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: "네이버 지도 API 환경변수가 설정되지 않았습니다." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const res = await fetchWithTimeout(
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
    {
      headers: {
        "x-ncp-apigw-api-key-id": env.NAVER_MAP_CLIENT_ID,
        "x-ncp-apigw-api-key": env.NAVER_MAP_CLIENT_SECRET,
      },
    }
  );

  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=86400",
  };

  if (!res.ok) {
    return upstreamErrorResponse("주소를 찾지 못했습니다.", await res.text());
  }

  const data = await res.json();
  const item = data.addresses && data.addresses[0];

  if (!item) {
    return new Response(JSON.stringify({ found: false }), { status: 200, headers });
  }

  return new Response(
    JSON.stringify({ found: true, lat: Number(item.y), lng: Number(item.x) }),
    { status: 200, headers }
  );
}

// 네이버 클라우드에는 도보 길찾기 API가 따로 없어서, 자동차 길찾기(Direction 5)의
// 도로 기반 거리값만 가져다 쓴다. 소요 시간은 이 거리에 도보 속도(4km/h)를 적용해
// 프론트에서 직접 계산 — 자동차 소요시간을 "도보 시간"으로 보여주면 안 되기 때문.
export function handleDirections(env, url) {
  return guarded("길찾기", () => handleDirectionsInner(env, url));
}

async function handleDirectionsInner(env, url) {
  const start = url.searchParams.get("start");
  const goal = url.searchParams.get("goal");
  if (!start || !goal) {
    return new Response(JSON.stringify({ error: "start/goal 파라미터가 필요합니다." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (!env.NAVER_MAP_CLIENT_ID || !env.NAVER_MAP_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: "네이버 지도 API 환경변수가 설정되지 않았습니다." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=86400",
  };

  // 기본 8초로는 빠듯하다. 네이버를 직접 부르면 0.8초인데 워커를 거치면 1~5초가
  // 나오고, 코스 하나가 구간 여러 개를 한꺼번에 부르는 순간 무더기로 타임아웃이
  // 났다(실제로 한 번에 아홉 건이 함께 실패한 로그가 있다).
  //
  // 실패해도 화면이 깨지지는 않는다 — 프론트가 직선거리로 대체하고 "예상"이라고
  // 적는다. 그래도 도로 거리를 보여줄 수 있으면 그게 낫다. 사람은 코스 화면이
  // 그려진 뒤 거리 숫자가 채워지기를 기다릴 뿐이라 몇 초 더 기다릴 여유가 있다.
  const DIRECTIONS_TIMEOUT_MS = 15_000;
  const res = await fetchWithTimeout(
    `https://maps.apigw.ntruss.com/map-direction/v1/driving?start=${encodeURIComponent(start)}&goal=${encodeURIComponent(goal)}&option=trafast`,
    {
      headers: {
        "x-ncp-apigw-api-key-id": env.NAVER_MAP_CLIENT_ID,
        "x-ncp-apigw-api-key": env.NAVER_MAP_CLIENT_SECRET,
      },
    },
    DIRECTIONS_TIMEOUT_MS
  );

  if (!res.ok) {
    return upstreamErrorResponse("경로를 계산하지 못했습니다.", await res.text());
  }

  const data = await res.json();
  const summary = data.route && data.route.trafast && data.route.trafast[0] && data.route.trafast[0].summary;

  if (data.code !== 0 || !summary) {
    return new Response(JSON.stringify({ found: false }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ found: true, distance: summary.distance }), { status: 200, headers });
}
