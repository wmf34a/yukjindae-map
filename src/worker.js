import { toPlace, toBanner, toCourse, toFestival } from "./notion.js";

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

async function handlePlaces(env, url) {
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) {
    return new Response(JSON.stringify({ error: "Notion 환경변수가 설정되지 않았습니다." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  let results = [];
  let cursor = undefined;

  try {
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
        return new Response(JSON.stringify({ error: "Notion API 오류", detail: errBody }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      const data = await res.json();
      results = results.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    /* oxlint-enable no-await-in-loop */

    const places = results.map(toPlace).filter((p) => p.name);

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

// 네이버 검색 API는 title/description을 HTML로 반환해서 매칭된 키워드를 <b> 태그로
// 감싸고 &, <, > 같은 문자를 엔티티로 이스케이프한다. 태그만 벗겨내고 엔티티를
// 그대로 두면 "&amp;"처럼 이스케이프된 문자열이 그대로 화면에 노출된다.
function decodeNaverHtml(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
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
        const image = await ensureMirroredImage(env, "courses", course.id, course.imageSource);
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
        sorts: [{ property: "순서", direction: "ascending" }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "Notion API 오류", detail }), { status: 502, headers });
    }

    const data = await res.json();
    const festivals = await Promise.all(
      data.results.slice(0, 10).map(async (page) => {
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
        };
      })
    );

    return new Response(JSON.stringify({ festivals: festivals.filter((f) => f.title) }), { status: 200, headers });
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

function handleNaverConfig(env) {
  const body = `window.__ENV__ = ${JSON.stringify({
    NAVER_MAP_CLIENT_ID: env.NAVER_MAP_CLIENT_ID || "",
  })};`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/places") {
      return handlePlaces(env, url);
    }
    if (url.pathname === "/api/banners") {
      return handleBanners(env);
    }
    if (url.pathname === "/api/courses") {
      return handleCourses(env);
    }
    if (url.pathname === "/api/festivals") {
      return handleFestivals(env);
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
    if (url.pathname.startsWith("/images/")) {
      return handleImage(env, url.pathname.slice("/images/".length));
    }

    return env.ASSETS.fetch(request);
  },
};
