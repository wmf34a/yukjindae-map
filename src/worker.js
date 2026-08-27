import { toPlace, toBanner, toCourse, toFestival } from "./notion.js";
import { decodeNaverHtml } from "./text-utils.js";
import { runEnrichment } from "./enrich.js";
import { runMonthlyTop10 } from "./monthly-top10.js";
import { buildForecastUrl, parseForecast, recommendationFor } from "./today-weather.js";
import { fetchFestivalDescription, searchFestivalsInRange } from "./tourapi.js";
import { rankCandidates, selectNewCandidates, toNotionProperties } from "./festival-import.js";
import { fetchAllNursingRooms, runStationNursingGeocodeRefresh } from "./nursing-rooms.js";
import { findNearestRoom, needsPublicDataMatch, buildPublicDataPatchProperties } from "./nursing-match.js";
import { fetchWithTimeout, upstreamErrorResponse, serverErrorResponse, isNotionId } from "./http.js";
import {
  consumeRateLimit,
  hashIp,
  tooManyRequestsResponse,
  PROXY_RATE_LIMIT_PER_MINUTE,
  REPORT_RATE_LIMIT_PER_HOUR,
} from "./rate-limit.js";

// 장소/배너/코스/축제 목록은 노션 API를 순차 조회(+이미지 미러링 R2 조회)하느라
// 요청마다 1초 안팎이 걸린다. 가족이 직접 관리하는 콘텐츠라 초 단위 최신성이
// 필요하지 않으므로, 엣지에서 짧게 캐싱해서 재방문/새로고침을 빠르게 만든다.
async function withEdgeCache(request, ctx, ttlSeconds, handler) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await handler();
  if (response.status === 200) {
    const toCache = new Response(response.body, response);
    // max-age는 브라우저 자체 캐시용으로 짧게(1분), s-maxage는 Cloudflare 엣지용으로
    // 원래 ttlSeconds를 그대로 준다 — 이 둘을 분리 안 하면 모바일 브라우저가 엣지
    // 캐시(1시간)와 똑같이 새로고침해도 재요청을 안 해서, 서버를 고쳐도 한동안 옛날
    // 응답이 계속 보이는 문제가 있었다(실제로 겪음).
    toCache.headers.set("cache-control", `public, max-age=60, s-maxage=${ttlSeconds}`);
    const forCache = toCache.clone();
    if (ctx) ctx.waitUntil(cache.put(cacheKey, forCache));
    else await cache.put(cacheKey, forCache);
    return toCache;
  }
  return response;
}

// wrangler.jsonc의 triggers.crons 중 축제 자동 수집용 주간 스케줄을 식별하는 값 —
// scheduled()에서 이 값과 event.cron을 비교해 매일 도는 블로그 enrichment와
// 구분한다.
const FESTIVAL_IMPORT_CRON = "0 19 * * 1";
const STATION_GEOCODE_CRON = "0 20 * * 1";
const PUBLIC_DATA_PLACE_MATCH_CRON = "0 21 * * 1";
// 매월 1일 09:00 KST(= 1일 00:00 UTC). 지역별 Top 10을 그 달 계절에 맞게 다시 매긴다.
// 다른 크론들처럼 새벽에 돌리려면 UTC 기준 "전달 말일 19시"여야 하는데 말일은
// 28~31일로 달마다 달라 크론으로 표현할 수 없다. 그래서 1일이 확실히 보장되는
// UTC 자정을 쓴다.
const MONTHLY_TOP10_CRON = "0 0 1 * *";

const REPORTABLE_FIELDS = new Set([
  "운영시간",
  "입장료",
  "무료입장연령",
  "주차상세",
  "기저귀교환대",
  "수유실",
  "유아의자",
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

export function validateNewPlacePayload({ placeName, value, turnstileToken }) {
  if (typeof turnstileToken !== "string" || !turnstileToken) return "사람인지 확인이 필요합니다.";
  if (typeof placeName !== "string" || !placeName.trim()) return "장소 이름이 필요합니다.";
  if (placeName.trim().length > NEW_PLACE_NAME_MAX) return "장소 이름이 너무 깁니다.";
  if (typeof value !== "string" || !value.trim()) return "어떤 점이 좋았는지 알려주세요.";
  if (value.length > REPORT_VALUE_MAX_LENGTH) return "내용이 너무 깁니다.";
  return null;
}

export function validateReportPayload({ placeId, field, value, turnstileToken }) {
  if (typeof placeId !== "string" || !placeId.trim()) return "placeId가 필요합니다.";
  // 노션 페이지 ID 형식이 아닌 값이 그대로 API 경로에 들어가지 않도록 막는다.
  if (!isNotionId(placeId)) return "잘못된 장소 ID입니다.";
  if (typeof field !== "string" || !REPORTABLE_FIELDS.has(field)) return "지원하지 않는 필드입니다.";
  if (typeof turnstileToken !== "string" || !turnstileToken) return "사람인지 확인이 필요합니다.";
  if (typeof value !== "string" || !value.trim()) return "제안값이 필요합니다.";
  if (BOOLEAN_FIELDS.has(field)) {
    if (!BOOLEAN_VALUES.has(value)) return "제안값은 있음/없음 중 하나여야 합니다.";
  } else if (value.length > REPORT_VALUE_MAX_LENGTH) {
    return "제안값이 너무 깁니다.";
  }
  return null;
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
    const body = {
      page_size: 100,
      filter: { property: "공개여부", checkbox: { equals: true } },
    };
    if (cursor) body.start_cursor = cursor;

    const res = await fetchWithTimeout(
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

async function handlePlaces(env, url) {
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) {
    return new Response(JSON.stringify({ error: "Notion 환경변수가 설정되지 않았습니다." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const places = await fetchAllPlaces(env);

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
    const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${env.NOTION_BANNER_DATABASE_ID}/query`, {
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
    const banners = await Promise.all(
      data.results.map(async (page) => {
        const banner = toBanner(page);
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
    const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${env.NOTION_COURSE_DATABASE_ID}/query`, {
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
    const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${env.NOTION_FESTIVAL_DATABASE_ID}/query`, {
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

    const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${env.NOTION_FESTIVAL_DATABASE_ID}/query`, {
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

// SLACK_WEBHOOK_URL이 없으면(로컬 등) 조용히 건너뛴다. 알림 실패가 원래 하려던
// 작업(노션 등록 등)을 막을 이유는 없으므로 에러도 조용히 무시한다.
async function notifySlack(env, text) {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetchWithTimeout(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
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

async function handleImage(env, key) {
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
  headers.set("cache-control", "public, max-age=31536000, immutable");
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

async function handleNearbyPlace(env, url) {
  const q = url.searchParams.get("q");
  if (!q) {
    return new Response(JSON.stringify({ error: "q 파라미터가 필요합니다." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (!env.NAVER_SEARCH_CLIENT_ID || !env.NAVER_SEARCH_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: "네이버 검색 API 환경변수가 설정되지 않았습니다." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
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
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=86400",
  };

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

async function handleGeocode(env, url) {
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
async function handleDirections(env, url) {
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

  const res = await fetchWithTimeout(
    `https://maps.apigw.ntruss.com/map-direction/v1/driving?start=${encodeURIComponent(start)}&goal=${encodeURIComponent(goal)}&option=trafast`,
    {
      headers: {
        "x-ncp-apigw-api-key-id": env.NAVER_MAP_CLIENT_ID,
        "x-ncp-apigw-api-key": env.NAVER_MAP_CLIENT_SECRET,
      },
    }
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
  const { placeId, field, value, turnstileToken, placeName } = body;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  const allowed = await consumeRateLimit(env, {
    scope: "report",
    ip,
    limit: REPORT_RATE_LIMIT_PER_HOUR,
    windowSeconds: 3600,
  });
  if (!allowed) {
    return new Response(JSON.stringify({ error: "잠시 후 다시 시도해주세요." }), { status: 429, headers });
  }

  const isHuman = await verifyTurnstile(env, turnstileToken, ip);
  if (!isHuman) {
    return new Response(JSON.stringify({ error: "사람인지 확인에 실패했습니다." }), { status: 400, headers });
  }

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
    const res = await fetchWithTimeout("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: env.NOTION_REPORTS_DATABASE_ID },
        properties: {
          "장소명": { title: [{ text: { content: placeName.trim().slice(0, 200) } }] },
          "필드명": { select: { name: NEW_PLACE_FIELD } },
          "제안값": { rich_text: [{ text: { content: value.trim().slice(0, REPORT_VALUE_MAX_LENGTH) } }] },
          "상태": { select: { name: "대기중" } },
          "제보자IP해시": { rich_text: [{ text: { content: ipHashEarly } }] },
        },
      }),
    });
    if (!res.ok) {
      return upstreamErrorResponse("제보 저장에 실패했습니다.", await res.text());
    }
    ctx.waitUntil(
      notifySlack(
        env,
        `📍 새 장소 추천이 들어왔습니다\n• ${placeName.trim()}\n• ${value.trim().slice(0, 120)}`
      )
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
        "상태": { select: { name: "대기중" } },
        "제보자IP해시": { rich_text: [{ text: { content: ipHash } }] },
      },
    }),
  });

  if (!createRes.ok) {
    return upstreamErrorResponse("제보 저장에 실패했습니다.", await createRes.text());
  }

  const reportsDbUrl = `https://www.notion.so/${env.NOTION_REPORTS_DATABASE_ID.replace(/-/g, "")}`;
  ctx.waitUntil(
    notifySlack(env, `📝 새 제보가 도착했어요\n• ${place.name} — ${field}: ${value.trim().slice(0, REPORT_VALUE_MAX_LENGTH)}\n${reportsDbUrl}`)
  );

  return new Response(JSON.stringify({ ok: true }), { status: 201, headers });
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
async function handleToday(url) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return new Response(JSON.stringify({ error: "좌표가 필요합니다." }), { status: 400, headers });
  }

  try {
    const res = await fetchWithTimeout(buildForecastUrl({ lat, lng }));
    if (!res.ok) return new Response(JSON.stringify({ weather: null }), { status: 200, headers });

    const forecast = parseForecast(await res.json());
    if (!forecast) return new Response(JSON.stringify({ weather: null }), { status: 200, headers });

    return new Response(
      JSON.stringify({ weather: forecast, recommendation: recommendationFor(forecast) }),
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
async function runScheduledMonthlyTop10(env) {
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID || !env.ANTHROPIC_API_KEY) {
    await notifySlack(env, "⚠️ 월간 Top10 갱신을 건너뛰었습니다 — 환경변수가 설정되지 않았습니다.");
    return;
  }

  const places = await fetchAllPlaces(env);
  // KST 기준의 "이번 달"이어야 한다. UTC로 계산하면 매월 1일 09:00 KST 실행
  // 시점이 UTC로는 아직 1일 00:00이라 문제없지만, 실행이 밀리거나 수동으로
  // 돌릴 때 달이 어긋날 수 있어 명시적으로 KST로 옮긴다.
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
  const lines = [
    `🗓️ ${monthKey} 지역별 Top 10 갱신 ${result.ok ? "완료" : "일부 실패"}`,
    `• 성공 ${ok.length}개 지역 (${ok.reduce((sum, r) => sum + r.ranked, 0)}곳 순위 부여)`,
  ];
  if (failed.length) {
    lines.push(`• 실패 ${failed.length}개 지역 — 지난달 순위를 그대로 유지합니다`);
    for (const r of failed.slice(0, 5)) {
      lines.push(`   - ${r.region}: ${r.error || (r.failures || []).join(", ")}`);
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

// 라우팅 본문. 바깥 fetch()가 이 응답에 CORS 헤더를 덧씌운다.
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/api/places") {
    if (request.method === "GET" && !url.search) {
      return withEdgeCache(request, ctx, 60, () => handlePlaces(env, url));
    }
    return handlePlaces(env, url);
  }
  if (url.pathname === "/api/banners") {
    return withEdgeCache(request, ctx, 60, () => handleBanners(env));
  }
  if (url.pathname === "/api/courses") {
    return withEdgeCache(request, ctx, 60, () => handleCourses(env));
  }
  if (url.pathname === "/api/festivals") {
    return withEdgeCache(request, ctx, 60, () => handleFestivals(env));
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
    // 하루 단위 예보라 자주 바뀌지 않는다. 좌표를 소수점 1자리로 뭉개서 캐시
    // 키를 만들기 때문에(약 11km) 같은 동네 사용자는 캐시를 함께 쓴다.
    return withEdgeCache(request, ctx, 1800, () => handleToday(url));
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
    return handleImage(env, url.pathname.slice("/images/".length));
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
    if (event.cron === STATION_GEOCODE_CRON) {
      ctx.waitUntil(runStationNursingGeocodeRefresh(env));
      return;
    }
    if (event.cron === PUBLIC_DATA_PLACE_MATCH_CRON) {
      ctx.waitUntil(runPublicDataPlaceMatch(env));
      return;
    }
    if (event.cron === FESTIVAL_IMPORT_CRON) {
      ctx.waitUntil(runScheduledFestivalImport(env));
      return;
    }
    if (event.cron === MONTHLY_TOP10_CRON) {
      ctx.waitUntil(runScheduledMonthlyTop10(env));
      return;
    }
    ctx.waitUntil(runScheduledEnrichment(env));
  },
};
