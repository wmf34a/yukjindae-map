import { toPlace, toBanner, toCourse, toFestival } from "./notion.js";
import { decodeNaverHtml } from "./text-utils.js";
import { runEnrichment } from "./enrich.js";
import { fetchFestivalDescription, searchFestivalsInRange } from "./tourapi.js";
import { rankCandidates, selectNewCandidates, toNotionProperties } from "./festival-import.js";
import { fetchAllNursingRooms, runStationNursingGeocodeRefresh } from "./nursing-rooms.js";
import { findNearestRoom, needsPublicDataMatch, buildPublicDataPatchProperties } from "./nursing-match.js";

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

const REPORTABLE_FIELDS = new Set(["기저귀교환대", "수유실", "유아의자", "무료입장연령"]);
const BOOLEAN_FIELDS = new Set(["기저귀교환대", "수유실", "유아의자"]);
const BOOLEAN_VALUES = new Set(["있음", "없음"]);
const REPORT_VALUE_MAX_LENGTH = 200;
const REPORT_RATE_LIMIT_PER_HOUR = 5;

// placeId/field는 화이트리스트로, 텍스트값은 필드 성격(불리언 vs 자유서술)에 맞게
// 검증한다 — 임의 필드에 임의 값을 쓸 수 없게 해서 승인 큐로 들어오는 데이터의
// 신뢰도를 최소한으로 보장한다(Broken Access Control / 입력 검증 방지).
export function validateReportPayload({ placeId, field, value, turnstileToken }) {
  if (typeof placeId !== "string" || !placeId.trim()) return "placeId가 필요합니다.";
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

    const res = await fetch(
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
    return new Response(JSON.stringify({ error: "서버 오류", detail: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
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
    const res = await fetch(source.url, {
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
    const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_BANNER_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: "노출여부", checkbox: { equals: true } },
        sorts: [{ property: "순서", direction: "ascending" }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "Notion API 오류", detail }), { status: 502, headers });
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
    return new Response(JSON.stringify({ error: "서버 오류", detail: String(err) }), { status: 500, headers });
  }
}

// 장소 DB의 "사진"은 festivals/banners/courses와 달리 요청마다 R2로 미러링하지
// 않고, 등록 시점에 이미 안정적인 URL(R2 또는 외부 호스팅)로 저장돼 있다 —
// toPlace().image를 그대로 쓰면 된다.
async function fetchFirstStopImage(env, placeId) {
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${placeId}`, {
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
    const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_COURSE_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: "공개여부", checkbox: { equals: true } },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "Notion API 오류", detail }), { status: 502, headers });
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
    return new Response(JSON.stringify({ error: "서버 오류", detail: String(err) }), { status: 500, headers });
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
    const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_FESTIVAL_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: "공개여부", checkbox: { equals: true } },
        sorts: [{ property: "기간", direction: "ascending" }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "Notion API 오류", detail }), { status: 502, headers });
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
    return new Response(JSON.stringify({ error: "서버 오류", detail: String(err) }), { status: 500, headers });
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

    const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_FESTIVAL_DATABASE_ID}/query`, {
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
  const res = await fetch("https://api.notion.com/v1/pages", {
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
    await fetch(env.SLACK_WEBHOOK_URL, {
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
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${id}`, { headers: notionHeaders });
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
          const patchPromise = fetch(`https://api.notion.com/v1/pages/${id}`, {
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
    return new Response(JSON.stringify({ error: "서버 오류", detail: String(err) }), { status: 500, headers });
  }
}

async function handleImage(env, key) {
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
  const rooms = await fetchAllNursingRooms(env);
  return new Response(JSON.stringify({ rooms }), { status: 200, headers });
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

  const res = await fetch(
    `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=1`,
    {
      headers: {
        "X-Naver-Client-Id": env.NAVER_SEARCH_CLIENT_ID,
        "X-Naver-Client-Secret": env.NAVER_SEARCH_CLIENT_SECRET,
      },
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    return new Response(JSON.stringify({ error: "네이버 검색 API 오류", detail }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
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

  const res = await fetch(
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
    const detail = await res.text();
    return new Response(JSON.stringify({ error: "네이버 지오코딩 API 오류", detail }), { status: 502, headers });
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

  const res = await fetch(
    `https://maps.apigw.ntruss.com/map-direction/v1/driving?start=${encodeURIComponent(start)}&goal=${encodeURIComponent(goal)}&option=trafast`,
    {
      headers: {
        "x-ncp-apigw-api-key-id": env.NAVER_MAP_CLIENT_ID,
        "x-ncp-apigw-api-key": env.NAVER_MAP_CLIENT_SECRET,
      },
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    return new Response(JSON.stringify({ error: "네이버 길찾기 API 오류", detail }), { status: 502, headers });
  }

  const data = await res.json();
  const summary = data.route && data.route.trafast && data.route.trafast[0] && data.route.trafast[0].summary;

  if (data.code !== 0 || !summary) {
    return new Response(JSON.stringify({ found: false }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ found: true, distance: summary.distance }), { status: 200, headers });
}

async function verifyTurnstile(env, token, ip) {
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || "" }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

// IP 자체는 저장하지 않고 해시만 남긴다 — 스팸 패턴 파악용이지 개인 식별용이 아님.
async function checkRateLimit(env, ip) {
  const key = `report:${await shortHash(ip)}`;
  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= REPORT_RATE_LIMIT_PER_HOUR) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
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

  const validationError = validateReportPayload(body || {});
  if (validationError) {
    return new Response(JSON.stringify({ error: validationError }), { status: 400, headers });
  }
  const { placeId, field, value, turnstileToken } = body;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  const allowed = await checkRateLimit(env, ip);
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

  // placeId가 우리 장소 DB에 실제 존재하는 공개 페이지인지 서버에서 직접 확인한다.
  // 클라이언트가 보낸 placeId를 그대로 믿고 관계를 만들면 임의 페이지 ID를 넣어
  // 엉뚱한 노션 페이지에 관계를 거는 것도 가능해지기 때문.
  const placeRes = await fetch(`https://api.notion.com/v1/pages/${placeId}`, { headers: notionHeaders });
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

  const ipHash = await shortHash(ip);
  const createRes = await fetch("https://api.notion.com/v1/pages", {
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
    const detail = await createRes.text();
    return new Response(JSON.stringify({ error: "제보 저장에 실패했습니다.", detail }), { status: 502, headers });
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

async function searchNaverBlog(env, query) {
  if (!env.NAVER_SEARCH_CLIENT_ID || !env.NAVER_SEARCH_CLIENT_SECRET) return [];

  const res = await fetch(
    `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=5&sort=sim`,
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

async function patchPlaceProperties(env, placeId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${placeId}`, {
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
    searchBlog: (query) => searchNaverBlog(env, query),
    patchPlace: (placeId, properties) => patchPlaceProperties(env, placeId, properties),
  });
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

export default {
  async fetch(request, env, ctx) {
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
      return withEdgeCache(request, ctx, 3600, () => handleFestivalDetail(env, id, ctx));
    }
    if (url.pathname === "/api/nursing-rooms") {
      // 24시간 캐싱 중에 주간 크론이 KV를 갱신하면 다음 캐시 만료 전까지 최대
      // 하루 동안 옛 데이터가 보일 수 있어서(오늘 실제로 겪음) 1시간으로 줄였다.
      return withEdgeCache(request, ctx, 3600, () => handleNursingRooms(env));
    }
    if (url.pathname === "/naver-config") {
      return handleNaverConfig(env);
    }
    if (url.pathname === "/api/nearby-place") {
      return handleNearbyPlace(env, url);
    }
    if (url.pathname === "/api/geocode") {
      return handleGeocode(env, url);
    }
    if (url.pathname === "/api/directions") {
      return handleDirections(env, url);
    }
    if (url.pathname === "/api/reports") {
      return handleReport(request, env, ctx);
    }
    // TEMP: 사용자 기기가 접속하는 엣지 PoP의 캐시를 지우려면 그 기기가 직접
    // 요청해야 한다(PoP별로 캐시가 분리돼있음) — 링크 탭 한 번으로 되게 GET으로
    // 만든 일회성 삭제용. 확인 후 바로 삭제 예정.
    if (url.pathname === "/api/admin/purge-nursing-cache") {
      if (url.searchParams.get("token") !== "008369bb-d746-452b-8f40-78a91c46dd45") {
        return new Response("Forbidden", { status: 403 });
      }
      const deleted = await caches.default.delete(new Request("https://yukjindae-map.wmf34a.workers.dev/api/nursing-rooms"));
      return new Response(`purged: ${deleted}`, { status: 200 });
    }
    if (url.pathname.startsWith("/images/")) {
      return handleImage(env, url.pathname.slice("/images/".length));
    }

    return env.ASSETS.fetch(request);
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
    ctx.waitUntil(runScheduledEnrichment(env));
  },
};
