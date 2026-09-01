import { toPlace, toBanner, toCourse, toFestival } from "./notion.js";
import { filterByWindow } from "./banner-window.js";
import { countVisitSampled, readStats, SAMPLE_DENOMINATOR, todayInKst as visitToday } from "./visit-counter.js";
import { decodeNaverHtml } from "./text-utils.js";
import { runEnrichment } from "./enrich.js";
import { runMonthlyTop10 } from "./monthly-top10.js";
import { buildForecastUrl, parseForecast, recommendationFor } from "./today-weather.js";
import { fetchFestivalDescription, searchFestivalsInRange } from "./tourapi.js";
import { rankCandidates, selectNewCandidates, toNotionProperties } from "./festival-import.js";
import { fetchAllNursingRooms, runStationNursingGeocodeRefresh } from "./nursing-rooms.js";
import { findNearestRoom, needsPublicDataMatch, buildPublicDataPatchProperties } from "./nursing-match.js";
import { fetchWithTimeout, fetchWithRetry, upstreamErrorResponse, serverErrorResponse, isNotionId } from "./http.js";
import { parseNotifyEmails, resolveMentionTargets, buildReportComment } from "./notion-notify.js";
import {
  applyApprovedReports, isListField, APPROVED, APPLIED, MODE_ADD, MODE_REPLACE,
} from "./report-apply.js";
import { isValidCoords } from "./nearby-lookup.js";
import { notifySlack } from "./notify.js";
import { prepareUserPlace } from "./new-place.js";
import { handleNearbyPlace, handleGeocode, handleDirections } from "./naver-proxy.js";
import { makeKakaoNearby, makeRoadDistance } from "./place-sources.js";
import {
  consumeRateLimit,
  hashIp,
  tooManyRequestsResponse,
  PROXY_RATE_LIMIT_PER_MINUTE,
  reportQuota,
} from "./rate-limit.js";

// 캐시에 넣어 둔 응답을 언제 만든 것인지 적어 두는 헤더. 엣지 캐시 자체의 수명은
// 길게 잡고(CACHE_HOLD_SECONDS) 신선도는 이 값으로 우리가 판단한다.
const CACHED_AT = "x-cached-at";
// 만료된 뒤에도 이만큼은 들고 있는다. 그 사이 들어온 요청은 옛 응답이라도 바로 받고,
// 새 값은 뒤에서 받아 갈아 끼운다.
const CACHE_HOLD_SECONDS = 3600;

// 장소/배너/코스/축제 목록은 노션 API를 순차 조회(+이미지 미러링 R2 조회)하느라
// 요청마다 1초 안팎이 걸린다. 가족이 직접 관리하는 콘텐츠라 초 단위 최신성이
// 필요하지 않으므로, 엣지에서 짧게 캐싱해서 재방문/새로고침을 빠르게 만든다.
//
// 캐시가 만료된 순간에 들어온 사람만 그 1초를 온전히 뒤집어쓰는 게 문제였다.
// 노션이 한 번 느리면 10초까지 갔다(새벽에 실제로 그랬다). 사람이 뜸한 시간일수록
// 캐시가 자주 비어서 더 자주 걸린다.
//
// 그래서 만료돼도 옛 응답을 먼저 돌려주고 새 값은 뒤에서 받는다. 화면에는 최대
// ttlSeconds 만큼 지난 값이 보일 수 있지만, 노션을 기다리며 멈춰 있는 것보다 낫다.
export async function withEdgeCache(request, ctx, ttlSeconds, handler) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);

  const store = async () => {
    const response = await handler();
    if (response.status !== 200) return response;
    const toCache = new Response(response.body, response);
    // max-age는 브라우저 자체 캐시용으로 짧게(1분) — 이 둘을 분리 안 하면 모바일
    // 브라우저가 엣지 캐시와 똑같이 새로고침해도 재요청을 안 해서, 서버를 고쳐도
    // 한동안 옛날 응답이 계속 보이는 문제가 있었다(실제로 겪음).
    toCache.headers.set("cache-control", `public, max-age=60, s-maxage=${CACHE_HOLD_SECONDS}`);
    toCache.headers.set(CACHED_AT, String(Date.now()));
    const forCache = toCache.clone();
    if (ctx) ctx.waitUntil(cache.put(cacheKey, forCache));
    else await cache.put(cacheKey, forCache);
    return toCache;
  };

  const cached = await cache.match(cacheKey);
  if (!cached) return store();

  const cachedAt = Number(cached.headers.get(CACHED_AT)) || 0;
  const stale = Date.now() - cachedAt > ttlSeconds * 1000;
  // ctx 가 없으면(테스트 등) 뒤에서 돌릴 곳이 없으니 그 자리에서 새로 받는다.
  if (stale && ctx) ctx.waitUntil(store().catch(() => {}));
  else if (stale) return store();
  return cached;
}

// wrangler.jsonc의 triggers.crons 중 축제 자동 수집용 주간 스케줄을 식별하는 값 —
// scheduled()에서 이 값과 event.cron을 비교해 매일 도는 블로그 enrichment와
// 구분한다.
// 크론은 UTC로 돈다. 사람이 가장 안 쓰는 일요일 새벽(KST)에 몰아 두려면 토요일
// 오후 UTC가 된다 — 토 18:00 UTC = 일 03:00 KST. 서로 다른 시각에 하나씩 두어
// 무거운 작업이 겹치지 않게 한다.
const ENRICHMENT_CRON = "0 18 * * 6";
const FESTIVAL_IMPORT_CRON = "0 19 * * 6";
// 수유실 좌표 보정과 장소 대조는 원래 순서대로 도는 한 쌍이라(뒤가 앞의 결과를
// 쓴다) 크론 하나에서 이어 돌린다. 워커당 크론은 5개까지만 걸 수 있는데, 승인
// 제보 반영을 추가하면서 자리가 필요해졌다.
const NURSING_REFRESH_CRON = "0 20 * * 6";
// 승인한 제보를 장소에 옮겨 적는다. 이것만 주 1회가 아니라 10분마다 도는데,
// 운영자가 노션에서 "승인됨"으로 바꾼 뒤 앱에 반영되기까지 일주일을 기다리게
// 할 수는 없기 때문이다.
const REPORT_APPLY_CRON = "*/10 * * * *";
// 매월 1일 09:00 KST(= 1일 00:00 UTC). 지역별 Top 10을 그 달 계절에 맞게 다시 매긴다.
// 다른 크론들처럼 새벽에 돌리려면 UTC 기준 "전달 말일 19시"여야 하는데 말일은
// 28~31일로 달마다 달라 크론으로 표현할 수 없다. 그래서 1일이 확실히 보장되는
// UTC 자정을 쓴다.
// "매월 1일 새벽 KST"는 크론으로 곧장 쓸 수 없다. KST 1일 00:00은 UTC로는 전달
// 마지막 날 15:00인데, 말일이 28~31일로 달마다 달라 날짜를 못 박을 수 없기
// 때문이다. 그래서 말일 후보에 모두 걸어 두고 실행 시점의 KST 날짜가 1일인지
// 코드에서 확인한다.
const MONTHLY_TOP10_CRON = "0 15 28-31 * *";

export function isFirstDayInKst(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).getUTCDate() === 1;
}

const REPORTABLE_FIELDS = new Set([
  "운영시간",
  "입장료",
  "무료입장연령",
  "주차상세",
  "기저귀교환대",
  "수유실",
  "유아의자",
  // 근처 맛집·카페는 코스보기의 재료다. 지도 API는 어떤 가게가 있는지는 알려줘도
  // 아이랑 가도 되는지(유아의자·노키즈존)는 알려주지 않는다. 다녀온 사람만 안다.
  "근처맛집",
  "근처카페",
]);
const BOOLEAN_FIELDS = new Set(["기저귀교환대", "수유실", "유아의자"]);
const BOOLEAN_VALUES = new Set(["있음", "없음"]);
const REPORT_VALUE_MAX_LENGTH = 200;

// placeId/field는 화이트리스트로, 텍스트값은 필드 성격(불리언 vs 자유서술)에 맞게
// 검증한다 — 임의 필드에 임의 값을 쓸 수 없게 해서 승인 큐로 들어오는 데이터의
// 신뢰도를 최소한으로 보장한다(Broken Access Control / 입력 검증 방지).
// 신규 장소 제보는 아직 DB에 없는 곳이라 placeId가 없다. 대신 장소명이 필수이고,
// 주소·이유는 한 덩어리 텍스트로 받아 사람이 읽고 판단한다.
const NEW_PLACE_FIELD = "신규장소";
const NEW_PLACE_NAME_MAX = 60;

// 편의시설은 어떤 지도 API도 알려주지 않는다. 좌표·운영시간은 장소명만 있으면
// API로 채울 수 있지만, 수유실이 있는지는 다녀온 사람만 안다 — 그래서 제보 때
// 같이 받는다. 고르지 않으면(모름) 아예 보내지 않아 추측이 섞이지 않게 한다.
const NEW_PLACE_AMENITIES = new Map([
  ["수유실", new Set(["있음", "없음"])],
  ["기저귀교환대", new Set(["있음", "없음"])],
  ["유아의자", new Set(["있음", "없음"])],
  ["주차", new Set(["무료", "유료", "없음"])],
]);

export function validateNewPlaceAmenities(amenities) {
  if (amenities === undefined || amenities === null) return null;
  if (typeof amenities !== "object" || Array.isArray(amenities)) return "편의시설 정보 형식이 올바르지 않습니다.";
  for (const [key, picked] of Object.entries(amenities)) {
    const allowed = NEW_PLACE_AMENITIES.get(key);
    if (!allowed) return "지원하지 않는 편의시설 항목입니다.";
    if (typeof picked !== "string" || !allowed.has(picked)) return "편의시설 값이 올바르지 않습니다.";
  }
  return null;
}

// 제보 DB에는 편의시설 칸이 따로 없다. 칼럼을 늘리는 대신 제안값 끝에 정해진
// 형식으로 붙여, 사람이 읽기도 쉽고 나중에 파이프라인이 파싱하기도 쉽게 한다.
export function buildNewPlaceValue({ value, amenities }) {
  const picked = Object.entries(amenities || {})
    .filter(([key]) => NEW_PLACE_AMENITIES.has(key))
    .map(([key, v]) => `${key}:${v}`);
  const body = String(value).trim();
  return picked.length ? `${body}\n[편의시설] ${picked.join(" / ")}` : body;
}

// 사람 확인(Turnstile) 토큰은 여기서 요구하지 않는다.
//
// 광고 차단이 challenges.cloudflare.com 을 막으면 토큰을 받을 방법 자체가 없다.
// 여기서 400 으로 끊으면 그 사람은 추천을 아예 못 한다 — 확인 못 거친 제보를 좁게
// 받으려고 따로 만든 허용량(UNVERIFIED_REPORT_RATE_LIMIT_PER_HOUR)이 이 검사 탓에
// 한 번도 쓰이지 못했고, 화면의 "인증을 못 불러와도 보낼 수 있다"는 안내도 거짓말이
// 되어 있었다. 확인 여부는 handleReport 가 판단해 허용량과 알림 표시로 다룬다.
export function validateNewPlacePayload({ placeName, value, amenities }) {
  if (typeof placeName !== "string" || !placeName.trim()) return "장소 이름이 필요합니다.";
  if (placeName.trim().length > NEW_PLACE_NAME_MAX) return "장소 이름이 너무 깁니다.";
  if (typeof value !== "string" || !value.trim()) return "어떤 점이 좋았는지 알려주세요.";
  if (value.length > REPORT_VALUE_MAX_LENGTH) return "내용이 너무 깁니다.";
  return validateNewPlaceAmenities(amenities);
}

// 사람 확인 토큰을 요구하지 않는 이유는 validateNewPlacePayload 주석 참고.
export function validateReportPayload({ placeId, field, value }) {
  if (typeof placeId !== "string" || !placeId.trim()) return "placeId가 필요합니다.";
  // 노션 페이지 ID 형식이 아닌 값이 그대로 API 경로에 들어가지 않도록 막는다.
  if (!isNotionId(placeId)) return "잘못된 장소 ID입니다.";
  if (typeof field !== "string" || !REPORTABLE_FIELDS.has(field)) return "지원하지 않는 필드입니다.";
  if (typeof value !== "string" || !value.trim()) return "제안값이 필요합니다.";
  if (BOOLEAN_FIELDS.has(field)) {
    if (!BOOLEAN_VALUES.has(value)) return "제안값은 있음/없음 중 하나여야 합니다.";
  } else if (value.length > REPORT_VALUE_MAX_LENGTH) {
    return "제안값이 너무 깁니다.";
  }
  return null;
}

// 목록 칸을 통째로 갈아 끼울지, 지금 값에 더할지. 안 보내면 더하는 쪽이다 —
// 덮어쓰기가 기본이던 시절에 근처 가게 데이터가 34번 지워졌다.
export function reportMode(field, mode) {
  if (!isListField(field)) return "";
  return mode === MODE_REPLACE ? MODE_REPLACE : MODE_ADD;
}

export function matchesQuery(place, { region, category, q }) {
  if (region && place.region !== region) return false;
  if (category && !place.categories.includes(category)) return false;
  if (q) {
    const needle = q.toLowerCase();
    const haystack = `${place.name} ${place.address} ${place.region}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

// handlePlaces(목록 API)와 enrich.js(블로그 힌트 배치)가 같은 전체 장소 목록이
// 필요해서, 노션 페이지네이션 순회 로직을 공용 헬퍼로 뺐다.
async function fetchAllPlaces(env) {
  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  let results = [];
  let cursor = undefined;

  // 다음 페이지 커서가 이전 응답에서만 나오므로 순차 호출이 필수라 병렬화 불가
  /* oxlint-disable no-await-in-loop */
  do {
    const body = { page_size: 100, filter: { property: "공개여부", checkbox: { equals: true } } };
    if (cursor) body.start_cursor = cursor;

    const res = await fetchWithRetry(
      `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`,
      { method: "POST", headers: notionHeaders, body: JSON.stringify(body) }
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Notion API 오류: ${errBody}`);
    }

    const data = await res.json();
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  /* oxlint-enable no-await-in-loop */

  return results.map(toPlace).filter((p) => p.name);
}

// 지역장이 노션에 사진을 직접 올리면 서명 URL로 들어와 한 시간쯤 뒤에 깨진다.
// 우리가 올린 사진은 이미 R2 외부 URL이라 손댈 게 없으므로, 노션이 호스팅하는
// 것만 골라 미러링한다 — 매 요청마다 224곳을 훑지 않기 위해서다.
async function withMirroredPlacePhotos(env, places) {
  const needsMirror = places.filter((p) => p.imageSource && !p.imageSource.stable);
  if (needsMirror.length === 0) return places;

  const mirrored = new Map();
  await Promise.all(
    needsMirror.map(async (p) => {
      const path = await ensureMirroredImage(env, "places", p.id, p.imageSource);
      if (path) mirrored.set(p.id, path);
    })
  );

  return places.map((p) => (mirrored.has(p.id) ? { ...p, image: mirrored.get(p.id) } : p));
}

// 상세 화면은 한 곳만 필요한데 목록 전체(195곳·69KB)를 받아 그 안에서 찾고
// 있었다. 노션은 페이지 하나를 바로 줄 수 있으므로 그것만 읽는다.
//
// 공개여부는 여기서 다시 본다 — 아직 공개하지 않은 장소의 id를 주소창에 넣으면
// 목록에 없는 곳이 상세로 열려 버린다.
// 설정이 제대로 들어갔는지 확인하는 곳. 값은 절대 내보내지 않고 있음/없음만 준다.
//
// wrangler secret list 는 이름만 보여주고 값이 비었는지는 알려주지 않는다.
// 대화형 프롬프트로 넣으면 값이 안 들어가도 Success 가 뜨는데, 그걸 세 번
// 놓쳤다 — 예약 DB 아이디, 그리고 월간 순위가 건너뛴 원인이었다. 크론은
// 월 1회라 문제를 알아채는 데도 한 달이 걸린다.
const REQUIRED_ENV = [
  "NOTION_API_KEY", "NOTION_DATABASE_ID", "NOTION_BANNER_DATABASE_ID",
  "NOTION_COURSE_DATABASE_ID", "NOTION_FESTIVAL_DATABASE_ID", "NOTION_REPORTS_DATABASE_ID",
  "ANTHROPIC_API_KEY", "TOUR_API_KEY", "KAKAO_REST_API_KEY",
  "NAVER_MAP_CLIENT_ID", "NAVER_MAP_CLIENT_SECRET",
  "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET",
  "TURNSTILE_SECRET_KEY", "SLACK_WEBHOOK_URL",
];

function handleHealth(env) {
  // 이름만 돌려준다. 값도, 길이도 담지 않는다.
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  return new Response(JSON.stringify({ ok: missing.length === 0, missing, checked: REQUIRED_ENV.length }, null, 1), {
    status: missing.length ? 503 : 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handlePlaceById(env, url, id) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) {
    return new Response(JSON.stringify({ error: "Notion 환경변수가 설정되지 않았습니다." }), { status: 500, headers });
  }
  if (!isNotionId(id)) {
    return new Response(JSON.stringify({ error: "장소를 찾을 수 없습니다." }), { status: 404, headers });
  }

  try {
    const res = await fetchWithRetry(`https://api.notion.com/v1/pages/${id}`, {
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "장소를 찾을 수 없습니다." }), { status: 404, headers });
    }

    const page = await res.json();
    // 다른 데이터베이스의 페이지 id를 넣어도 장소처럼 열리면 안 된다.
    const parent = page.parent?.database_id?.replace(/-/g, "");
    if (parent !== env.NOTION_DATABASE_ID.replace(/-/g, "")) {
      return new Response(JSON.stringify({ error: "장소를 찾을 수 없습니다." }), { status: 404, headers });
    }

    const place = toPlace(page);
    if (!place.published) {
      return new Response(JSON.stringify({ error: "장소를 찾을 수 없습니다." }), { status: 404, headers });
    }

    const [mirrored] = await withMirroredPlacePhotos(env, [place]);
    return new Response(JSON.stringify({ place: mirrored }), { status: 200, headers });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

async function handlePlaces(env, url) {
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) {
    return new Response(JSON.stringify({ error: "Notion 환경변수가 설정되지 않았습니다." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const places = await withMirroredPlacePhotos(env, await fetchAllPlaces(env));

    const limitParam = url.searchParams.get("limit");
    if (!limitParam) {
      return new Response(JSON.stringify({ count: places.length, places }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    const filters = {
      region: url.searchParams.get("region") || "",
      category: url.searchParams.get("category") || "",
      q: url.searchParams.get("q") || "",
    };
    const filtered = places.filter((p) => matchesQuery(p, filters));
    const limit = Math.max(0, parseInt(limitParam, 10) || 0);
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const page = filtered.slice(offset, offset + limit);

    return new Response(
      JSON.stringify({ places: page, total: filtered.length, hasMore: offset + limit < filtered.length }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    );
  } catch (err) {
    return serverErrorResponse(err, "장소 정보를 불러오지 못했습니다.");
  }
}

function guessImageExt(fingerprint) {
  const match = fingerprint.match(/\.(jpg|jpeg|png|webp|gif)(?:$|[?#])/i);
  return match ? match[1].toLowerCase() : "jpg";
}

async function shortHash(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

// Notion 자체 호스팅 이미지(type: "file")는 서명 URL이라 몇 시간 뒤 만료되므로,
// 요청 시점에 R2로 미러링해서 안정적인 URL로 서빙한다. R2 키 자체에 소스 지문의
// 해시를 박아 넣어서(content-addressed), 배너 이미지를 바꾸면 자동으로 새 키/새
// URL이 되도록 한다 — 이렇게 안 하면 이미지가 바뀌어도 기존 R2 객체(및 브라우저의
// immutable 캐시)가 그대로 남아있어서 반영이 안 되는 문제가 있었다.
async function ensureMirroredImage(env, prefix, pageId, source) {
  if (!source || !env.IMAGES) return "";

  const fingerprint = source.stable ? source.url : source.url.split("?")[0];
  const key = `${prefix}/${pageId}-${await shortHash(fingerprint)}.${guessImageExt(fingerprint)}`;

  const existing = await env.IMAGES.head(key);
  if (existing) return `/images/${key}`;

  try {
    const res = await fetchWithTimeout(source.url, {
      headers: { "User-Agent": "yukjindae-map-bot/1.0 (+https://yukjindae-map.wmf34a.workers.dev)" },
    });
    if (!res.ok) return "";

    const contentType = res.headers.get("content-type") || "image/jpeg";
    await env.IMAGES.put(key, res.body, { httpMetadata: { contentType } });
    return `/images/${key}`;
  } catch {
    return "";
  }
}

async function handleBanners(env) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!env.NOTION_API_KEY || !env.NOTION_BANNER_DATABASE_ID) {
    return new Response(JSON.stringify({ banners: [] }), { status: 200, headers });
  }

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  try {
    const res = await fetchWithRetry(`https://api.notion.com/v1/databases/${env.NOTION_BANNER_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: "노출여부", checkbox: { equals: true } },
        sorts: [{ property: "순서", direction: "ascending" }],
      }),
    });

    if (!res.ok) {
      return upstreamErrorResponse("정보를 불러오지 못했습니다.", await res.text());
    }

    const data = await res.json();
    // 노출기간이 지난 배너를 걸러낸다. 이미지 미러링 전에 걸러야 지난 배너 때문에
    // 쓸데없이 R2를 두드리지 않는다. 기간이 비어 있으면 예전처럼 체크박스만 본다.
    const inWindow = filterByWindow(data.results.map(toBanner));
    const banners = await Promise.all(
      inWindow.map(async (banner) => {
        const image = await ensureMirroredImage(env, "banners", banner.id, banner.imageSource);
        return {
          id: banner.id,
          createdAt: banner.createdAt,
          title: banner.title,
          tagline: banner.tagline,
          link: banner.link,
          image,
        };
      })
    );

    return new Response(JSON.stringify({ banners: banners.filter((b) => b.image) }), { status: 200, headers });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

// 장소 DB의 "사진"은 festivals/banners/courses와 달리 요청마다 R2로 미러링하지
// 않고, 등록 시점에 이미 안정적인 URL(R2 또는 외부 호스팅)로 저장돼 있다 —
// toPlace().image를 그대로 쓰면 된다.
async function fetchFirstStopImage(env, placeId) {
  try {
    const res = await fetchWithTimeout(`https://api.notion.com/v1/pages/${placeId}`, {
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!res.ok) return "";
    return toPlace(await res.json()).image;
  } catch {
    return "";
  }
}

async function handleCourses(env) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!env.NOTION_API_KEY || !env.NOTION_COURSE_DATABASE_ID) {
    return new Response(JSON.stringify({ courses: [] }), { status: 200, headers });
  }

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  try {
    const res = await fetchWithRetry(`https://api.notion.com/v1/databases/${env.NOTION_COURSE_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: "공개여부", checkbox: { equals: true } },
      }),
    });

    if (!res.ok) {
      return upstreamErrorResponse("정보를 불러오지 못했습니다.", await res.text());
    }

    const data = await res.json();
    const courses = await Promise.all(
      data.results.map(async (page) => {
        const course = toCourse(page);
        let image = await ensureMirroredImage(env, "courses", course.id, course.imageSource);
        // 대표이미지를 안 채워둔 코스는 첫 번째 정류장 장소의 사진을 대신 썸네일로
        // 쓴다 — places 목록에서 이미 한 번 미러링된 이미지라 대부분 R2 캐시 히트.
        if (!image && course.placeIds[0]) {
          image = await fetchFirstStopImage(env, course.placeIds[0]);
        }
        return {
          id: course.id,
          createdAt: course.createdAt,
          name: course.name,
          description: course.description,
          image,
          placeIds: course.placeIds,
        };
      })
    );

    return new Response(JSON.stringify({ courses: courses.filter((c) => c.name && c.placeIds.length) }), {
      status: 200,
      headers,
    });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

async function handleFestivals(env) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!env.NOTION_API_KEY || !env.NOTION_FESTIVAL_DATABASE_ID) {
    return new Response(JSON.stringify({ festivals: [] }), { status: 200, headers });
  }

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  try {
    const res = await fetchWithRetry(`https://api.notion.com/v1/databases/${env.NOTION_FESTIVAL_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: "공개여부", checkbox: { equals: true } },
        sorts: [{ property: "기간", direction: "ascending" }],
      }),
    });

    if (!res.ok) {
      return upstreamErrorResponse("정보를 불러오지 못했습니다.", await res.text());
    }

    const data = await res.json();
    // 공개여부 체크만으로는 담당자가 종료 후 체크 해제를 깜빡하면 지난 축제가 계속
    // 노출된다 — top 10을 뽑기 전에 종료일이 지난 항목부터 걸러낸다.
    const todayStr = new Date().toISOString().slice(0, 10);
    const upcoming = data.results.filter((page) => {
      const { periodEnd, periodStart } = toFestival(page);
      const end = (periodEnd || periodStart || "").slice(0, 10);
      return !end || end >= todayStr;
    });
    const festivals = await Promise.all(
      upcoming.slice(0, 10).map((page) => festivalToPayload(env, page))
    );

    return new Response(JSON.stringify({ festivals: festivals.filter((f) => f.title) }), { status: 200, headers });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

// runFestivalImport(중복 검사)와 fetchFestivalsForAutoImport가 함께 쓰는, 공개
// 여부와 무관하게 전체 축제 페이지를 순회하는 헬퍼.
async function fetchAllFestivalPages(env) {
  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  let results = [];
  let cursor = undefined;

  /* oxlint-disable no-await-in-loop */
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetchWithRetry(`https://api.notion.com/v1/databases/${env.NOTION_FESTIVAL_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion API 오류: ${await res.text()}`);

    const data = await res.json();
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  /* oxlint-enable no-await-in-loop */

  return results.map(toFestival);
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

async function createFestivalPage(env, properties) {
  const res = await fetchWithTimeout("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: env.NOTION_FESTIVAL_DATABASE_ID }, properties }),
  });
  if (!res.ok) throw new Error(`Notion 페이지 생성 실패: ${await res.text()}`);
}

// Cron Trigger(매주 1회)로 실행 — TourAPI에서 앞으로 2개월 내 진행되는 축제를
// 모아 가족 단위 키워드로 걸러 순위를 매기고, 새로운 것만 "공개여부=false"
// (검토 대기) 상태로 노션에 만든다. 실제 노출은 사람이 확인 후 체크박스를
// 켜야 한다 — 키워드 필터는 완벽하지 않아 자동 공개는 하지 않는다.
async function runScheduledFestivalImport(env) {
  if (!env.NOTION_API_KEY || !env.NOTION_FESTIVAL_DATABASE_ID || !env.TOUR_API_KEY) return;

  const existing = await fetchAllFestivalPages(env);
  const existingIds = existing.map((f) => f.tourApiId);
  const maxOrder = existing.reduce((max, f) => Math.max(max, f.order || 0), 0);

  const today = new Date();
  const windowEnd = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const candidates = await searchFestivalsInRange(env, {
    startDate: yyyymmdd(today),
    endDate: yyyymmdd(windowEnd),
  });

  const ranked = rankCandidates(candidates, { limit: 10 });
  const fresh = selectNewCandidates(ranked, existingIds, { limit: 10 });

  let order = maxOrder;
  // 순서(순번)를 겹치지 않게 이어서 매기려면 이전 생성 결과를 알아야 해서
  // 순차 실행이 필요하다.
  /* oxlint-disable no-await-in-loop */
  for (const item of fresh) {
    order += 1;
    await createFestivalPage(env, toNotionProperties(item, order));
  }
  /* oxlint-enable no-await-in-loop */

  await notifyFestivalCandidates(env, fresh);
}

// 운영진에게 제보를 알린다. 노션 페이지에 댓글로 멘션하면 노션이 알아서 메일을
// 보내 준다 — 운영진은 개발자가 아니라 슬랙을 안 쓰고, 카카오톡은 단체방 발송
// API가 없으며, 메일을 직접 보내려면 Workers 밖의 발송 서비스가 또 필요하다.
//
// 슬랙과 마찬가지로 실패해도 조용히 넘어간다. 알림이 안 갔다고 제보 저장까지
// 되돌릴 이유는 없다.
async function notifyNotionMention(env, pageId, { placeName, field, value }) {
  const emails = parseNotifyEmails(env.NOTION_NOTIFY_EMAILS);
  if (!emails.length || !env.NOTION_API_KEY) return;

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  try {
    const usersRes = await fetchWithTimeout("https://api.notion.com/v1/users?page_size=100", {
      headers: notionHeaders,
    });
    if (!usersRes.ok) return;
    const { results } = await usersRes.json();
    const { targets, missing } = resolveMentionTargets(results, emails);

    await fetchWithTimeout("https://api.notion.com/v1/comments", {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { page_id: pageId },
        rich_text: buildReportComment({ placeName, field, value, targets, missing }),
      }),
    });
  } catch {
    // 무시 — 위 주석 참고.
  }
}


// 새로 등록된 축제 후보는 항상 공개여부=false(검토 대기)로 들어가므로, 사람이
// 노션을 열어 확인하지 않으면 계속 묻힌다 — 매주 슬랙으로 리마인드한다.
async function notifyFestivalCandidates(env, items) {
  if (items.length === 0) return;

  const dbUrl = `https://www.notion.so/${env.NOTION_FESTIVAL_DATABASE_ID.replace(/-/g, "")}`;
  const lines = items.map((item) => {
    const start = item.eventStartDate ? `${item.eventStartDate.slice(4, 6)}.${item.eventStartDate.slice(6, 8)}~` : "";
    return `• ${item.title}${start ? ` (${start})` : ""}`;
  });
  const text = `🎪 새 축제 후보 ${items.length}개가 노션에 추가됐어요 (검토 대기)\n${lines.join("\n")}\n${dbUrl}`;
  await notifySlack(env, text);
}

async function festivalToPayload(env, page) {
  const festival = toFestival(page);
  const image = await ensureMirroredImage(env, "festivals", festival.id, festival.imageSource);
  return {
    id: festival.id,
    createdAt: festival.createdAt,
    title: festival.title,
    periodStart: festival.periodStart,
    periodEnd: festival.periodEnd,
    placeName: festival.placeName,
    image,
    link: festival.link,
    region: festival.region,
    order: festival.order,
    description: festival.description,
    address: festival.address,
  };
}

// 노션에 "설명"을 직접 채워두지 않은 축제는 한국관광공사 TourAPI에서 제목이
// 확실히 일치하는 항목을 찾아 개요/주소를 보충한다(확신 없는 매칭은 tourapi.js가
// 알아서 null을 반환).
async function handleFestivalDetail(env, id, ctx) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!env.NOTION_API_KEY || !env.NOTION_FESTIVAL_DATABASE_ID) {
    return new Response(JSON.stringify({ error: "축제 정보가 설정되지 않았습니다." }), { status: 500, headers });
  }

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  try {
    const pageRes = await fetchWithTimeout(`https://api.notion.com/v1/pages/${id}`, { headers: notionHeaders });
    if (!pageRes.ok) {
      return new Response(JSON.stringify({ error: "존재하지 않는 축제입니다." }), { status: 404, headers });
    }
    const page = await pageRes.json();
    const belongsToFestivalDb =
      page.parent &&
      page.parent.database_id &&
      page.parent.database_id.replace(/-/g, "") === env.NOTION_FESTIVAL_DATABASE_ID.replace(/-/g, "");
    if (!belongsToFestivalDb || !toFestival(page).published) {
      return new Response(JSON.stringify({ error: "존재하지 않는 축제입니다." }), { status: 404, headers });
    }

    const festival = await festivalToPayload(env, page);
    if (!festival.title) {
      return new Response(JSON.stringify({ error: "존재하지 않는 축제입니다." }), { status: 404, headers });
    }

    if (!festival.description) {
      const enrichment = await fetchFestivalDescription(env, festival.title);
      if (enrichment) {
        festival.description = enrichment.description || festival.description;
        festival.address = festival.address || enrichment.address;
        festival.link = festival.link || enrichment.link;

        // 한 번 찾은 설명/링크는 노션에 그대로 써넣어서, 다음 요청부터는
        // TourAPI를 다시 호출하지 않고 노션 데이터만으로 바로 응답한다.
        const patchProperties = {};
        if (enrichment.description) patchProperties["설명"] = { rich_text: [{ text: { content: enrichment.description.slice(0, 2000) } }] };
        if (!page.properties["주소"]?.rich_text?.length && enrichment.address) {
          patchProperties["주소"] = { rich_text: [{ text: { content: enrichment.address.slice(0, 200) } }] };
        }
        if (!page.properties["링크"]?.url && enrichment.link) {
          patchProperties["링크"] = { url: enrichment.link };
        }
        if (Object.keys(patchProperties).length > 0) {
          const patchPromise = fetchWithTimeout(`https://api.notion.com/v1/pages/${id}`, {
            method: "PATCH",
            headers: notionHeaders,
            body: JSON.stringify({ properties: patchProperties }),
          }).catch(() => {});
          if (ctx) ctx.waitUntil(patchPromise);
          else await patchPromise;
        }
      }
    }

    return new Response(JSON.stringify({ festival }), { status: 200, headers });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

// 우리가 실제로 미러링하는 접두어(+ 파일명 문자셋)만 허용한다 — 임의 키로 R2를
// 훑는 것을 막기 위함.
const IMAGE_KEY_PATTERN = /^(banners|courses|festivals|places)\/[A-Za-z0-9._-]+$/;

async function handleImage(env, request, key) {
  if (!IMAGE_KEY_PATTERN.test(key)) {
    return new Response("이미지를 찾을 수 없습니다.", { status: 404 });
  }
  if (!env.IMAGES) {
    return new Response("이미지 저장소가 설정되지 않았습니다.", { status: 500 });
  }
  const object = await env.IMAGES.get(key);
  if (!object) {
    return new Response("이미지를 찾을 수 없습니다.", { status: 404 });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // 키는 노션 페이지 ID라서 사진을 갈아끼워도 URL이 그대로다. immutable 을 주면
  // 이미 받아 간 브라우저가 새 사진을 영영 안 가져간다(사람이 찍힌 사진을 교체해도
  // 옛 사진이 계속 보였다). 하루 동안은 그냥 쓰되 그 뒤로는 etag 로 재검증하게 한다.
  headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  if (request?.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}

// 공공데이터 수유실은 부모가 직접 큐레이션하는 장소 DB와 성격이 달라(구청/보건소
// 등 일반 공공시설) 노션에 넣지 않고, 주변지도에 얹는 별도 레이어로만 캐싱해서
// 보여준다. 데이터가 자주 바뀌지 않아 엣지 캐시를 길게(하루) 잡는다.
async function handleNursingRooms(env) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  try {
    const rooms = await fetchAllNursingRooms(env);
    return new Response(JSON.stringify({ rooms }), { status: 200, headers });
  } catch (err) {
    // 여기서 던지면 요청 전체가 1101로 죽어 지도 탭이 통째로 깨진다 —
    // 레이어만 비어 보이도록 빈 배열로 응답한다.
    console.error("[nursing-rooms]", err);
    return new Response(JSON.stringify({ rooms: [] }), { status: 200, headers });
  }
}

// 카카오 키워드 검색은 기준 좌표와 반경을 받아 가까운 순으로 준다. 좌표까지 함께
// 주므로 주소를 다시 지오코딩할 필요가 없다.
async function verifyTurnstile(env, token, ip) {
  const res = await fetchWithTimeout("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || "" }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

async function handleReport(request, env, ctx) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "허용되지 않은 메서드입니다." }), { status: 405, headers });
  }
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID || !env.NOTION_REPORTS_DATABASE_ID || !env.TURNSTILE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: "제보 기능이 설정되지 않았습니다." }), { status: 500, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "잘못된 요청 본문입니다." }), { status: 400, headers });
  }

  // 신규 장소 제보는 검증 규칙도 저장 형태도 달라서 먼저 갈라낸다.
  const isNewPlace = (body || {}).field === NEW_PLACE_FIELD;
  const validationError = isNewPlace
    ? validateNewPlacePayload(body || {})
    : validateReportPayload(body || {});
  if (validationError) {
    return new Response(JSON.stringify({ error: validationError }), { status: 400, headers });
  }
  const { placeId, field, value, turnstileToken, placeName, amenities, mode } = body;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  // 사람 확인은 되면 좋지만, 안 된다고 제보를 막지는 않는다.
  //
  // 광고 차단이 challenges.cloudflare.com을 막으면 Turnstile이 아예 안 실린다.
  // 홈 화면에 설치해 쓰는 사람은 브라우저 설정을 바꾸기도 어려운데, 그 때문에
  // "광고 차단을 꺼주세요"를 만나면 대부분 그냥 포기한다.
  //
  // 제보는 장소 DB가 아니라 승인 큐로만 들어가고 사람이 다 읽는다. 그래서 여기서
  // 막아 얻는 것보다 잃는 것이 크다. 대신 확인이 안 된 제보는 시간당 허용량을
  // 좁히고, 알림에 표시해 운영자가 더 살펴보게 한다.
  const verified = await verifyTurnstile(env, turnstileToken, ip);

  const quota = reportQuota({ verified });
  const allowed = await consumeRateLimit(env, {
    scope: quota.scope,
    ip,
    limit: quota.limit,
    windowSeconds: 3600,
  });
  if (!allowed) {
    // 무엇에 걸렸는지 알려준다. "잠시 후"만 보면 고장인지 제한인지 알 수 없어
    // 대부분 그냥 포기한다.
    return new Response(
      JSON.stringify({ error: `제보는 한 시간에 ${quota.limit}건까지 받아요. 잠시 뒤에 다시 보내주세요.` }),
      { status: 429, headers }
    );
  }

  // 사람 확인을 못 거친 제보라는 것을 알림에 남긴다. 조용히 섞이면 운영자가
  // 스팸을 사실로 받아들일 수 있다.
  const unverifiedNote = verified ? "" : " ⚠️ 사람 확인 없이 접수됨";

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  const ipHashEarly = await hashIp(ip);

  // 신규 장소는 아직 DB에 없으므로 존재 확인을 건너뛰고, 관계 없이 제보만 남긴다.
  // 운영자가 노션에서 읽고 판단해 장소 DB에 직접 추가한다 — 사용자가 보낸 값이
  // 장소 DB로 곧장 들어가지 않게 하려는 것이다.
  if (isNewPlace) {
    const reportValue = buildNewPlaceValue({ value, amenities });
    const res = await fetchWithTimeout("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: env.NOTION_REPORTS_DATABASE_ID },
        properties: {
          "장소명": { title: [{ text: { content: placeName.trim().slice(0, 200) } }] },
          "필드명": { select: { name: NEW_PLACE_FIELD } },
          // 편의시설 줄이 붙어 본문 상한보다 길어질 수 있어 넉넉히 자른다.
          "제안값": { rich_text: [{ text: { content: reportValue.slice(0, REPORT_VALUE_MAX_LENGTH * 2) } }] },
          "상태": { select: { name: "대기중" } },
          "제보자IP해시": { rich_text: [{ text: { content: ipHashEarly } }] },
        },
      }),
    });
    if (!res.ok) {
      return upstreamErrorResponse("제보 저장에 실패했습니다.", await res.text());
    }
    const created = await res.json();
    ctx.waitUntil(
      notifySlack(
        env,
        `📍 새 장소 추천이 들어왔습니다${unverifiedNote}\n• ${placeName.trim()}\n• ${reportValue.slice(0, 200)}`
      )
    );
    ctx.waitUntil(
      notifyNotionMention(env, created.id, {
        placeName: placeName.trim(),
        field: NEW_PLACE_FIELD,
        value: reportValue,
      })
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  // placeId가 우리 장소 DB에 실제 존재하는 공개 페이지인지 서버에서 직접 확인한다.
  // 클라이언트가 보낸 placeId를 그대로 믿고 관계를 만들면 임의 페이지 ID를 넣어
  // 엉뚱한 노션 페이지에 관계를 거는 것도 가능해지기 때문.
  const placeRes = await fetchWithTimeout(`https://api.notion.com/v1/pages/${placeId}`, { headers: notionHeaders });
  if (!placeRes.ok) {
    return new Response(JSON.stringify({ error: "존재하지 않는 장소입니다." }), { status: 404, headers });
  }
  const placePage = await placeRes.json();
  const belongsToPlaceDb =
    placePage.parent &&
    placePage.parent.database_id &&
    placePage.parent.database_id.replace(/-/g, "") === env.NOTION_DATABASE_ID.replace(/-/g, "");
  const place = belongsToPlaceDb ? toPlace(placePage) : null;
  if (!place || !place.name) {
    return new Response(JSON.stringify({ error: "존재하지 않는 장소입니다." }), { status: 404, headers });
  }

  const ipHash = await hashIp(ip);
  const createRes = await fetchWithTimeout("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders,
    body: JSON.stringify({
      parent: { database_id: env.NOTION_REPORTS_DATABASE_ID },
      properties: {
        "장소명": { title: [{ text: { content: place.name.slice(0, 200) } }] },
        "장소": { relation: [{ id: placeId }] },
        "필드명": { select: { name: field } },
        "제안값": { rich_text: [{ text: { content: value.trim().slice(0, REPORT_VALUE_MAX_LENGTH) } }] },
        ...(reportMode(field, mode) ? { "반영방식": { select: { name: reportMode(field, mode) } } } : {}),
        "상태": { select: { name: "대기중" } },
        "제보자IP해시": { rich_text: [{ text: { content: ipHash } }] },
      },
    }),
  });

  if (!createRes.ok) {
    return upstreamErrorResponse("제보 저장에 실패했습니다.", await createRes.text());
  }

  const createdReport = await createRes.json();
  const reportsDbUrl = `https://www.notion.so/${env.NOTION_REPORTS_DATABASE_ID.replace(/-/g, "")}`;
  ctx.waitUntil(
    notifySlack(env, `📝 새 제보가 도착했어요${unverifiedNote}\n• ${place.name} — ${field}: ${value.trim().slice(0, REPORT_VALUE_MAX_LENGTH)}\n${reportsDbUrl}`)
  );
  ctx.waitUntil(
    notifyNotionMention(env, createdReport.id, { placeName: place.name, field, value: value.trim() })
  );

  return new Response(JSON.stringify({ ok: true }), { status: 201, headers });
}

// 방문자 수. POST는 오늘 처음 온 사람만 세고, GET은 숫자만 읽는다.
//
// 홈에서 POST를 부르고(화면에는 아무것도 안 보인다) 소개 페이지에서 GET으로 보여준다.
// 소개 페이지만 세면 대부분의 사용자가 빠져 숫자가 뜻을 잃는다.
// 표본 집계로 바꾸기 전까지 전수로 센 누적. 오픈 첫날 KV 한도가 터지기 전까지
// 쌓인 실제 사람 수다.
//
// 이 값에 배수를 곱하면 안 된다. 처음에는 "섞여도 자릿수를 흔들지 않는다"고 보고
// 전체에 곱했는데, 267명이 1,335명으로 보여 다섯 배가 부풀려졌다. 누적은 계속
// 남는 숫자라 한 번 틀리면 계속 틀린다.
const VISIT_TOTAL_BASELINE = 267;

// 표본만 세므로(visit-counter.js 참고) 읽을 때 배수를 곱해 되돌린다.
// 기준선까지는 전수로 센 값이라 그대로 두고, 그 뒤에 늘어난 만큼만 곱한다.
async function visitStats(env, today) {
  const raw = await readStats(env.RATE_LIMIT, today);
  const sampled = Math.max(0, raw.total - VISIT_TOTAL_BASELINE);
  return {
    today: raw.today * SAMPLE_DENOMINATOR,
    total: VISIT_TOTAL_BASELINE + sampled * SAMPLE_DENOMINATOR,
    approximate: true,
  };
}

async function handleVisit(request, env, url) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const today = visitToday();

  if (request.method !== "POST") {
    return new Response(JSON.stringify(await visitStats(env, today)), { status: 200, headers });
  }

  // 기기 ID가 없으면(시크릿 창 등) IP 해시로 대신한다. 같은 와이파이를 쓰는 가족이
  // 한 명으로 잡히지만, 아무도 안 세는 것보다는 낫다.
  const device = String(url.searchParams.get("d") || "").slice(0, 64).replace(/[^A-Za-z0-9-]/g, "");
  const id = device || (await hashIp(request.headers.get("cf-connecting-ip") || "unknown"));

  // 들어온 사람을 하나도 빠짐없이 적어 둔다.
  //
  // 화면에 보이는 숫자는 아래 KV 카운터가 만들지만 그건 표본이라 어림값이고, 하루
  // 쓰기 한도에 걸리면 그마저 멈춘다(오픈 첫날 오후를 그렇게 잃었다). 여기는 매
  // 방문을 그대로 적고 나중에 날짜별로 세면 되므로, 지나간 날의 숫자를 다시 물을
  // 수 있다. 같은 사람이 여러 번 와도 그대로 적고, 셀 때 기기 ID로 중복을 지운다.
  if (env.VISITS) {
    try {
      env.VISITS.writeDataPoint({
        blobs: [today, id, request.headers.get("cf-ipcountry") || "??"],
        doubles: [1],
        indexes: [today],
      });
    } catch (err) {
      console.warn(`방문 기록 실패: ${err.message}`);
    }
  }

  try {
    await countVisitSampled(env.RATE_LIMIT, id, today);
  } catch (err) {
    // 숫자를 못 세는 것 때문에 화면이 막히면 안 된다.
    console.warn(`방문자 집계 실패: ${err.message}`);
  }
  return new Response(JSON.stringify(await visitStats(env, today)), { status: 200, headers });
}

function handleNaverConfig(env) {
  const body = `window.__ENV__ = ${JSON.stringify({
    NAVER_MAP_CLIENT_ID: env.NAVER_MAP_CLIENT_ID || "",
    TURNSTILE_SITE_KEY: env.TURNSTILE_SITE_KEY || "",
  })};`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

async function searchNaverEndpoint(env, endpoint, query) {
  const res = await fetchWithTimeout(
    `https://openapi.naver.com/v1/search/${endpoint}?query=${encodeURIComponent(query)}&display=5&sort=sim`,
    {
      headers: {
        "X-Naver-Client-Id": env.NAVER_SEARCH_CLIENT_ID,
        "X-Naver-Client-Secret": env.NAVER_SEARCH_CLIENT_SECRET,
      },
    }
  );
  if (!res.ok) return [];

  const data = await res.json();
  return (data.items || []).map((item) => ({
    title: decodeNaverHtml(item.title || ""),
    description: decodeNaverHtml(item.description || ""),
    link: item.link || "",
  }));
}

// 블로그 + 카페글을 함께 본다. 유아 편의시설 정보는 지역 맘카페 글에 더 자세히
// 적혀 있는 경우가 많은데, 그동안 blog.json만 호출하고 있어서 그쪽을 통째로
// 놓치고 있었다. 한쪽이 실패해도 다른 쪽 결과로 계속 진행한다.
async function searchNaverPosts(env, query) {
  if (!env.NAVER_SEARCH_CLIENT_ID || !env.NAVER_SEARCH_CLIENT_SECRET) return [];

  const [blog, cafe] = await Promise.all([
    searchNaverEndpoint(env, "blog.json", query).catch(() => []),
    searchNaverEndpoint(env, "cafearticle.json", query).catch(() => []),
  ]);
  return [...blog, ...cafe];
}

async function patchPlaceProperties(env, placeId, properties) {
  const res = await fetchWithTimeout(`https://api.notion.com/v1/pages/${placeId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion PATCH 실패: ${detail}`);
  }
}

// Cron Trigger(매일 1회)로 실행 — 블로그 검색은 무료 API지만 일일 25,000회
// 한도가 있어 배치당 처리 장소 수를 enrich.js의 maxPlaces(기본 10)로 제한한다.
async function runScheduledEnrichment(env) {
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) return;

  const places = await fetchAllPlaces(env);
  const today = new Date().toISOString().slice(0, 10);
  await runEnrichment({
    places,
    today,
    searchBlog: (query) => searchNaverPosts(env, query),
    patchPlace: (placeId, properties) => patchPlaceProperties(env, placeId, properties),
  });
}

// 오늘 날씨를 보고 어떤 장소를 위로 올릴지 알려준다. Open-Meteo는 키가 필요 없어서
// 환경변수 없이 동작하고, 실패하면 추천 없이 조용히 비운다 — 날씨를 못 가져왔다고
// 홈 화면이 깨지면 안 된다.
// 좌표를 "의정부시" 같은 이름으로 바꾼다.
//
// 화면에 "비 소식이 있어요"만 떠 있으면 어디 날씨인지 알 수 없다. 위치를
// 허용하지 않아 서울 기준으로 보고 있는 사람은 자기 동네 얘기인 줄 안다.
//
// 이름을 못 가져와도 날씨는 보여야 하므로 실패하면 빈 문자열을 준다.
async function reverseGeocodeArea(env, { lat, lng }) {
  if (!env.NAVER_MAP_CLIENT_ID || !env.NAVER_MAP_CLIENT_SECRET) return "";
  try {
    const qs = new URLSearchParams({
      coords: `${lng},${lat}`, output: "json", orders: "legalcode",
    });
    const res = await fetchWithTimeout(
      `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?${qs}`,
      {
        headers: {
          "x-ncp-apigw-api-key-id": env.NAVER_MAP_CLIENT_ID,
          "x-ncp-apigw-api-key": env.NAVER_MAP_CLIENT_SECRET,
        },
      }
    );
    if (!res.ok) return "";
    const region = (await res.json().catch(() => ({})))?.results?.[0]?.region;
    if (!region) return "";
    // area2가 시·군·구다. 세종처럼 area2가 비는 광역시는 area1(시·도)을 쓴다.
    return region.area2?.name || region.area1?.name || "";
  } catch {
    return "";
  }
}

// 한국 기준 "YYYY-MM-DD-HH". 캐시 키에 붙여 시각이 바뀌면 새 예보를 받게 한다.
function kstStamp(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 13);
}

async function handleToday(url, env) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  // Number(null)은 NaN이 아니라 0이다. lat/lng를 아예 안 넘기면 (0, 0)이 유효한
  // 좌표로 통과해 기니만 앞바다 날씨를 한국 날씨라고 답했다. /api/nearby-place
  // 에서 한 번 고친 것과 같은 함정이 여기 남아 있었다.
  if (!isValidCoords({ lat: url.searchParams.get("lat"), lng: url.searchParams.get("lng") })) {
    return new Response(JSON.stringify({ error: "좌표가 필요합니다." }), { status: 400, headers });
  }
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return new Response(JSON.stringify({ error: "좌표가 필요합니다." }), { status: 400, headers });
  }

  try {
    const res = await fetchWithTimeout(buildForecastUrl({ lat, lng }));
    if (!res.ok) return new Response(JSON.stringify({ weather: null }), { status: 200, headers });

    const forecast = parseForecast(await res.json());
    if (!forecast) return new Response(JSON.stringify({ weather: null }), { status: 200, headers });

    // 이름 조회가 늦어도 날씨는 나와야 한다. 실패하면 빈 값으로 넘어간다.
    const area = await reverseGeocodeArea(env, { lat, lng });

    return new Response(
      JSON.stringify({ weather: forecast, area, recommendation: recommendationFor(forecast) }),
      { status: 200, headers }
    );
  } catch {
    return new Response(JSON.stringify({ weather: null }), { status: 200, headers });
  }
}

// Claude에 프롬프트 하나를 보내고 응답 텍스트만 돌려준다. 이 저장소는 런타임
// 의존성 없이 모든 외부 API를 fetch로 부르는 구조라 SDK 대신 같은 방식을 쓴다.
async function askClaude(env, prompt) {
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 4000,
      // 순위를 매기는 정도라 최고 강도까지 갈 일이 아니다. medium이면 계절
      // 판단은 충분히 하면서 토큰을 아낀다.
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// Cron Trigger(매월 1일)로 실행 — 장소 풀은 계절을 안 가리고 쌓이지만 그 달에
// 갈 만한 곳은 달마다 다르다. 지역별로 Claude를 한 번씩 불러 순위를 다시 매긴다.
// 노션 제보함에서 "승인됨"으로 바꾼 건을 장소 DB에 옮겨 적는다.
// 운영자는 상태만 바꾸면 되고, 같은 값을 두 번 입력하지 않아도 된다.
// 승인된 "신규장소" 추천을 실제 장소로 만든다.
//
// 추천 폼은 이름과 이유, 편의시설만 받는다. 나머지(좌표·주소·운영시간·근처 맛집)는
// 여기서 API로 채운다 — 제보자에게 물어봐야 아는 것과, 기계가 찾을 수 있는 것을
// 나눈 결과다. 편의시설은 제보자 값이 언제나 이긴다.
//
// 만든 장소는 공개여부를 꺼 둔다. 사람이 추천한 곳이라도 기계가 채운 값이 섞여
// 있어 한 번은 눈으로 봐야 한다.
async function createPlacesFromReports(env, notionHeaders, reports) {
  if (reports.length === 0) return;

  const kakao = env.KAKAO_REST_API_KEY;
  const findNearby = kakao ? makeKakaoNearby(kakao) : async () => [];
  // 근처 맛집·카페 거리는 도로 거리로 적는다. 직선거리를 적었더니 지역장이
  // 지도와 대조해 몇 km씩 틀렸다고 바로 알아챘다.
  const roadDistance = env.NAVER_MAP_CLIENT_ID
    ? makeRoadDistance({
      mapClientId: env.NAVER_MAP_CLIENT_ID,
      mapClientSecret: env.NAVER_MAP_CLIENT_SECRET,
    })
    : null;
  const searchPlace = async (name) => {
    if (!kakao) return [];
    const qs = new URLSearchParams({ query: name, size: "5" });
    const res = await fetchWithTimeout(`https://dapi.kakao.com/v2/local/search/keyword.json?${qs}`, {
      headers: { Authorization: `KakaoAK ${kakao}` },
    });
    if (!res.ok) return [];
    return (await res.json()).documents || [];
  };

  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const made = [];
  const failed = [];

  for (const report of reports) {
    /* oxlint-disable no-await-in-loop */
    const prepared = await prepareUserPlace({
      placeName: report.placeName,
      reportValue: report.value,
      searchPlace,
      findNearby,
      roadDistance,
      today,
    });

    if (!prepared.ok) {
      failed.push({ ...report, reason: prepared.error });
      continue;
    }

    const created = await fetchWithTimeout("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: env.NOTION_DATABASE_ID },
        properties: prepared.properties,
      }),
    });

    if (!created.ok) {
      failed.push({ ...report, reason: (await created.text()).slice(0, 120) });
      continue;
    }

    // 제보를 만든 장소에 연결해 두면, 나중에 이 장소가 어디서 왔는지 알 수 있다.
    const page = await created.json();
    await fetchWithTimeout(`https://api.notion.com/v1/pages/${report.id}`, {
      method: "PATCH",
      headers: notionHeaders,
      body: JSON.stringify({
        properties: {
          "상태": { select: { name: APPLIED } },
          "장소": { relation: [{ id: page.id }] },
        },
      }),
    });
    made.push({ ...report, created: prepared.candidate });
    /* oxlint-enable no-await-in-loop */
  }

  const lines = [];
  if (made.length) {
    lines.push(`🆕 추천받은 장소 ${made.length}곳을 등록했습니다. 확인 후 공개여부를 켜주세요.`);
    for (const r of made) lines.push(`• ${r.created.name} — ${r.created.address}`);
  }
  if (failed.length) {
    lines.push(`\n⚠️ 등록하지 못한 ${failed.length}곳 — 직접 확인이 필요합니다.`);
    for (const r of failed) lines.push(`• ${r.placeName}: ${r.reason}`);
  }
  if (lines.length) await notifySlack(env, lines.join("\n"));
}

async function runScheduledReportApply(env) {
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID || !env.NOTION_REPORTS_DATABASE_ID) return;

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  const res = await fetchWithTimeout(
    `https://api.notion.com/v1/databases/${env.NOTION_REPORTS_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        page_size: 50,
        filter: { property: "상태", select: { equals: APPROVED } },
      }),
    }
  );
  if (!res.ok) return;

  const data = await res.json();
  const reports = data.results.map((page) => ({
    id: page.id,
    placeId: page.properties["장소"]?.relation?.[0]?.id || "",
    field: page.properties["필드명"]?.select?.name || "",
    value: page.properties["제안값"]?.rich_text?.[0]?.plain_text || "",
    // 예전 제보에는 이 칸이 없다. 없으면 더하는 쪽으로 본다.
    mode: page.properties["반영방식"]?.select?.name || MODE_ADD,
    placeName: page.properties["장소명"]?.title?.[0]?.plain_text || "",
  }));
  if (reports.length === 0) return;

  // 신규 장소 추천은 고칠 장소가 없다. 대신 장소를 새로 만들어야 하므로 따로 뗀다.
  const newPlaces = reports.filter((r) => r.field === NEW_PLACE_FIELD);
  const edits = reports.filter((r) => r.field !== NEW_PLACE_FIELD);
  await createPlacesFromReports(env, notionHeaders, newPlaces);

  const patch = (id, properties) =>
    fetchWithTimeout(`https://api.notion.com/v1/pages/${id}`, {
      method: "PATCH",
      headers: notionHeaders,
      body: JSON.stringify({ properties }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.text()).slice(0, 150));
    });

  if (edits.length === 0) return;

  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = await applyApprovedReports({
    reports: edits,
    patchPlace: (id, properties) => patch(id, properties),
    patchReport: (id, properties) => patch(id, properties),
    readPlaceField: async (id, name) => {
      const pageRes = await fetchWithTimeout(`https://api.notion.com/v1/pages/${id}`, { headers: notionHeaders });
      if (!pageRes.ok) throw new Error((await pageRes.text()).slice(0, 150));
      const page = await pageRes.json();
      return page.properties[name]?.rich_text?.map((t) => t.plain_text).join("") || "";
    },
    today,
  });

  const lines = [`✅ 승인된 제보 ${result.applied.length}건을 장소에 반영했습니다.`];
  for (const r of result.applied) lines.push(`• ${r.placeName} — ${r.field}: ${r.value}`);
  if (result.skipped.length) {
    lines.push(`\n⚠️ 반영하지 못한 ${result.skipped.length}건 — 노션에서 확인이 필요합니다.`);
    for (const r of result.skipped) lines.push(`• ${r.placeName} — ${r.field}: ${r.reason}`);
  }
  await notifySlack(env, lines.join("\n"));
}

async function runScheduledMonthlyTop10(env) {
  // 어느 값이 비었는지 말해주지 않으면 셋 중 무엇을 고쳐야 할지 알 수 없다.
  // 실제로 wrangler secret put 은 대화형 프롬프트에 값을 붙여넣어도 빈 값으로
  // 올라가면서 성공 메시지를 띄운다 — 목록에는 있는데 값이 없는 상태가 된다.
  const missing = ["NOTION_API_KEY", "NOTION_DATABASE_ID", "ANTHROPIC_API_KEY"].filter((k) => !env[k]);
  if (missing.length) {
    await notifySlack(env, [
      "⚠️ 월간 Top10 갱신을 건너뛰었습니다",
      `• 비어 있는 값: ${missing.join(", ")}`,
      "• 시크릿 목록에 이름이 있어도 값이 비어 있을 수 있습니다. 대화형 프롬프트 대신",
      "  `printf '값' | npx wrangler secret put 이름` 으로 넣어주세요.",
    ].join("\n"));
    return;
  }

  const places = await fetchAllPlaces(env);
  // KST 기준의 "이번 달"이어야 한다. 크론이 UTC로는 전달 말일에 도는 탓에
  // UTC로 계산하면 지난달이 잡힌다.
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthKey = kst.toISOString().slice(0, 7);

  const result = await runMonthlyTop10({
    places,
    monthKey,
    askClaude: (prompt) => askClaude(env, prompt),
    patchPlace: (placeId, properties) => patchPlaceProperties(env, placeId, properties),
  });

  const ok = result.regions.filter((r) => r.ok);
  const failed = result.regions.filter((r) => !r.ok);
  // 열 개 지역이 전부 실패했는데 "일부 실패"라고 보내면 심각성이 안 드러난다.
  const allFailed = ok.length === 0 && failed.length > 0;
  const headline = result.ok ? "완료" : allFailed ? "전부 실패" : "일부 실패";
  const lines = [
    `🗓️ ${monthKey} 지역별 Top 10 갱신 ${headline}`,
    `• 성공 ${ok.length}개 지역 (${ok.reduce((sum, r) => sum + r.ranked, 0)}곳 순위 부여)`,
  ];
  if (failed.length) {
    lines.push(`• 실패 ${failed.length}개 지역 — 지난달 순위를 그대로 유지합니다`);
    // 크레딧이 떨어지면 열 지역이 같은 이유로 무너진다. 지역별 오류를 줄줄이
    // 나열하는 대신 원인과 할 일을 한 줄로 알린다.
    const detail = failed.map((r) => r.error || (r.failures || []).join(", ")).join(" ");
    if (/credit balance is too low/i.test(detail)) {
      lines.push("• 원인: Anthropic API 크레딧 소진입니다. console.anthropic.com 에서 충전한 뒤");
      lines.push("  `node scripts/run-monthly-top10.mjs " + monthKey + " --apply` 로 다시 돌려주세요.");
    } else {
      for (const r of failed.slice(0, 5)) {
        lines.push(`   - ${r.region}: ${r.error || (r.failures || []).join(", ")}`);
      }
    }
  }
  lines.push("https://yukjindae-map.wmf34a.workers.dev");
  await notifySlack(env, lines.join("\n"));
}

// Cron Trigger(매주 1회, 역명 지오코딩 다음 슬롯)로 실행 — 우리 장소 좌표와
// 공공 수유실 좌표를 250m 반경으로 대조해서, 아직 수유실이 미확인인 장소에
// "수유실" 체크박스를 자동으로 켜준다. 확신할 수 없는 매칭이라 확인상태는
// 항상 "공공데이터"(검토 대기)로만 남기고, 최종 확정은 사람이 한다.
async function runPublicDataPlaceMatch(env) {
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) return;

  const [places, rooms] = await Promise.all([fetchAllPlaces(env), fetchAllNursingRooms(env)]);
  const today = new Date().toISOString().slice(0, 10);
  const candidates = places.filter(needsPublicDataMatch);

  // 순서대로 PATCH해야 Notion API 요청 실패가 다른 장소 처리에 영향을 안 준다.
  /* oxlint-disable no-await-in-loop */
  for (const place of candidates) {
    const match = findNearestRoom(place, rooms);
    if (!match) continue;
    await patchPlaceProperties(env, place.id, buildPublicDataPatchProperties(match, today));
  }
  /* oxlint-enable no-await-in-loop */
}

// geocode/nearby-place/directions는 우리 네이버 키로 외부 유료 API를 대신 호출해주는
// 프록시라 인증 없이 열려 있으면 제3자가 우리 쿼터를 그대로 태울 수 있다. IP당
// 분당 호출 수를 제한한다 — 정상 사용(코스 한 개 열 때 구간 수만큼)은 넉넉히 통과한다.
async function withProxyRateLimit(request, env, handler) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const allowed = await consumeRateLimit(env, {
    scope: "proxy",
    ip,
    limit: PROXY_RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
  if (!allowed) return tooManyRequestsResponse();
  return handler();
}

// HTML/정적 자산 응답에 기본 보안 헤더를 얹는다. CSP는 네이버 지도 SDK와
// Turnstile, Pretendard 폰트 CDN을 실제로 쓰고 있어서 그 출처만 허용한다.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://oapi.map.naver.com https://*.pstatic.net https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://oapi.map.naver.com https://*.pstatic.net https://*.map.naver.net",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "geolocation=(self), camera=(), microphone=(), payment=()");
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set("content-security-policy", CSP);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// 앱인토스 미니앱 번들은 *.tossmini.com 오리진에서 실행되는데 API와 이미지는 계속
// 이 Worker가 서빙한다 — 웹(workers.dev)과 달리 교차 출처 요청이라 CORS 허용이
// 필요하다. 오리진은 콘솔 appName(yukjindae-map)으로 고정 발급되고, SDK 버전과
// 업로드 시점에 따라 apps/web 두 계열이 모두 쓰일 수 있어 넷 다 열어둔다.
const MINIAPP_ORIGINS = new Set([
  "https://yukjindae-map.apps.tossmini.com",
  "https://yukjindae-map.private-apps.tossmini.com",
  "https://yukjindae-map.web.tossmini.com",
  "https://yukjindae-map.private-web.tossmini.com",
]);

function miniAppOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin && MINIAPP_ORIGINS.has(origin) ? origin : null;
}

function withCors(request, response) {
  const origin = miniAppOrigin(request);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  // 허용 오리진이 여러 개라 응답이 오리진별로 달라진다 — 엣지 캐시가 한 오리진의
  // 응답을 다른 오리진에 재사용하지 않도록 Vary를 붙인다.
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// /api/reports는 JSON 본문 POST라 브라우저가 먼저 preflight를 보낸다. 라우터는
// OPTIONS를 모르고 405로 떨구므로 여기서 먼저 받아낸다.
function handlePreflight(request, origin) {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": request.headers.get("Access-Control-Request-Headers") || "content-type",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}

// 목록 엣지 캐시 수명. 60초로 뒀더니 오픈 첫날 재보니 열 번 중 네 번이 캐시를
// 놓쳤다 — 엣지가 지역별로 나뉘어 있어 한 곳에 채워도 다른 곳은 비어 있고, 그
// 요청은 노션을 세 번 순차로 부르느라 1.6~3.1초가 걸렸다. 캐시에 맞으면 0.6초다.
//
// 데이터를 바꾸는 크론이 10분 주기라 5분은 최신성을 해치지 않는다. 노션에서 손으로
// 고친 내용도 5분 안에는 보인다.
const LIST_CACHE_SECONDS = 300;

// 라우팅 본문. 바깥 fetch()가 이 응답에 CORS 헤더를 덧씌운다.
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return handleHealth(env);
  }
  if (url.pathname.startsWith("/api/places/")) {
    const id = url.pathname.slice("/api/places/".length);
    return withEdgeCache(request, ctx, LIST_CACHE_SECONDS, () => handlePlaceById(env, url, id));
  }
  if (url.pathname === "/api/places") {
    if (request.method === "GET" && !url.search) {
      return withEdgeCache(request, ctx, LIST_CACHE_SECONDS, () => handlePlaces(env, url));
    }
    return handlePlaces(env, url);
  }
  if (url.pathname === "/api/banners") {
    return withEdgeCache(request, ctx, LIST_CACHE_SECONDS, () => handleBanners(env));
  }
  if (url.pathname === "/api/courses") {
    return withEdgeCache(request, ctx, LIST_CACHE_SECONDS, () => handleCourses(env));
  }
  if (url.pathname === "/api/festivals") {
    return withEdgeCache(request, ctx, LIST_CACHE_SECONDS, () => handleFestivals(env));
  }
  if (url.pathname.startsWith("/api/festivals/")) {
    const id = url.pathname.slice("/api/festivals/".length);
    // 클라이언트가 준 값을 그대로 노션 API 경로에 넣기 전에 ID 형식을 확인한다.
    if (!isNotionId(id)) {
      return new Response(JSON.stringify({ error: "존재하지 않는 축제입니다." }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return withEdgeCache(request, ctx, 3600, () => handleFestivalDetail(env, id, ctx));
  }
  if (url.pathname === "/api/nursing-rooms") {
    // 24시간 캐싱 중에 주간 크론이 KV를 갱신하면 다음 캐시 만료 전까지 최대
    // 하루 동안 옛 데이터가 보일 수 있어서(오늘 실제로 겪음) 1시간으로 줄였다.
    return withEdgeCache(request, ctx, 3600, () => handleNursingRooms(env));
  }
  if (url.pathname === "/api/today") {
    // 좌표를 소수점 2자리(약 1.1km)로 뭉갠다. 같은 동네 사용자가 캐시를 함께
    // 쓰기 위해서다. 뭉개는 코드 없이 주석만 있던 시절에는 사용자마다 GPS
    // 소수점이 달라 캐시가 사실상 한 번도 맞지 않았다.
    //
    // 처음에는 1자리(약 11km)로 뭉갰는데 지역 이름이 어긋났다 — 의정부가
    // 양주시로, 서울시청이 성북구로 나왔다. 날씨는 11km쯤 움직여도 같지만
    // 시·군·구 경계는 그 안에서 여러 번 바뀐다.
    //
    // 캐시 키에 "몇 시인지"를 함께 넣는다. 나들이 시간대가 시각에 따라 달라진다.
    // (원래 주석) 이 응답은 지금부터 남은 시간의
    // 예보를 담고 있어서, 시간이 바뀌면 값도 달라져야 한다. 시각을 안 넣으면
    // 오전에 채운 캐시가 오후까지 살아남아 지나간 비를 계속 알린다.
    // 날짜도 함께 넣어 자정을 넘겼는데 어제 예보가 남는 일을 막는다.
    const rounded = new URL(url);
    for (const key of ["lat", "lng"]) {
      const raw = Number(rounded.searchParams.get(key));
      if (Number.isFinite(raw)) rounded.searchParams.set(key, raw.toFixed(2));
    }
    const cacheKeyUrl = new URL(rounded);
    cacheKeyUrl.searchParams.set("h", kstStamp());
    const cacheKeyRequest = new Request(cacheKeyUrl.toString(), request);
    // 같은 시각 안에서만 재사용한다. 한 시간이 지나면 키가 바뀌어 새로 받는다.
    return withEdgeCache(cacheKeyRequest, ctx, 3600, () => handleToday(rounded, env));
  }
  if (url.pathname === "/api/visit") {
    return handleVisit(request, env, url);
  }
  if (url.pathname === "/naver-config") {
    return handleNaverConfig(env);
  }
  if (url.pathname === "/api/nearby-place") {
    return withProxyRateLimit(request, env, () => handleNearbyPlace(env, url));
  }
  if (url.pathname === "/api/geocode") {
    return withProxyRateLimit(request, env, () => handleGeocode(env, url));
  }
  if (url.pathname === "/api/directions") {
    return withProxyRateLimit(request, env, () => handleDirections(env, url));
  }
  if (url.pathname === "/api/reports") {
    return handleReport(request, env, ctx);
  }
  if (url.pathname.startsWith("/images/")) {
    return handleImage(env, request, url.pathname.slice("/images/".length));
  }

  return withSecurityHeaders(await env.ASSETS.fetch(request));
}

export default {
  async fetch(request, env, ctx) {
    const origin = miniAppOrigin(request);
    if (request.method === "OPTIONS" && origin) {
      return handlePreflight(request, origin);
    }
    return withCors(request, await handleRequest(request, env, ctx));
  },

  async scheduled(event, env, ctx) {
    if (event.cron === NURSING_REFRESH_CRON) {
      // 좌표를 먼저 갱신하고 그 결과로 장소를 대조한다. 순서가 바뀌면 대조가
      // 지난주 좌표를 쓰게 된다.
      ctx.waitUntil(
        runStationNursingGeocodeRefresh(env).then(() => runPublicDataPlaceMatch(env))
      );
      return;
    }
    if (event.cron === FESTIVAL_IMPORT_CRON) {
      // 크론은 워커당 5개까지라 자리가 없다. 축제 수집과 성격이 같아 — 주 1회
      // 외부 API에서 후보를 긁어 노션에 넣고 슬랙으로 알린다 — 같은 칸에 태운다.
      ctx.waitUntil(runScheduledFestivalImport(env));
      return;
    }
    if (event.cron === MONTHLY_TOP10_CRON) {
      // 말일 후보 네 날짜에 모두 걸려 있어, 실제로 다음이 1일일 때만 돌린다.
      if (isFirstDayInKst(event.scheduledTime || Date.now())) {
        ctx.waitUntil(runScheduledMonthlyTop10(env));
      }
      return;
    }
    if (event.cron === REPORT_APPLY_CRON) {
      ctx.waitUntil(runScheduledReportApply(env));
      return;
    }
    if (event.cron === ENRICHMENT_CRON) {
      ctx.waitUntil(runScheduledEnrichment(env));
      return;
    }
    // 크론 목록에 없는 값이 오면(수동 트리거 등) 가장 가벼운 보강만 돌린다.
    ctx.waitUntil(runScheduledEnrichment(env));
  },
};
