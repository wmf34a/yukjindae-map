import { toPlace, toBanner } from "./notion.js";

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

function guessImageExt(fingerprint) {
  const match = fingerprint.match(/\.(jpg|jpeg|png|webp|gif)(?:$|[?#])/i);
  return match ? match[1].toLowerCase() : "jpg";
}

// Notion 자체 호스팅 이미지(type: "file")는 서명 URL이라 몇 시간 뒤 만료되므로,
// 요청 시점에 R2로 미러링해서 안정적인 URL로 서빙한다. 소스가 바뀌지 않았으면
// 재다운로드하지 않도록 R2 커스텀 메타데이터에 소스 지문을 저장해 비교한다.
async function ensureBannerImage(env, pageId, source) {
  if (!source) return { image: "", debug: "no source" };
  if (!env.IMAGES) return { image: "", debug: "no IMAGES binding" };

  const fingerprint = source.stable ? source.url : source.url.split("?")[0];
  const key = `banners/${pageId}.${guessImageExt(fingerprint)}`;

  const existing = await env.IMAGES.head(key);
  if (existing && existing.customMetadata && existing.customMetadata.sourceFingerprint === fingerprint) {
    return { image: `/images/${key}`, debug: "cached" };
  }

  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "yukjindae-map-bot/1.0 (+https://yukjindae-map.wmf34a.workers.dev)" },
    });
    if (!res.ok) {
      return { image: existing ? `/images/${key}` : "", debug: `fetch not ok: ${res.status}` };
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    await env.IMAGES.put(key, res.body, {
      httpMetadata: { contentType },
      customMetadata: { sourceFingerprint: fingerprint },
    });
    return { image: `/images/${key}`, debug: "fetched+stored" };
  } catch (err) {
    return { image: existing ? `/images/${key}` : "", debug: `error: ${String(err)}` };
  }
}

async function handleBanners(env) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!env.NOTION_API_KEY || !env.NOTION_BANNER_DATABASE_ID) {
    return new Response(JSON.stringify({ banners: [], configured: false }), { status: 200, headers });
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
        const { image, debug } = await ensureBannerImage(env, banner.id, banner.imageSource);
        return { id: banner.id, title: banner.title, tagline: banner.tagline, link: banner.link, image, debug };
      })
    );

    return new Response(
      JSON.stringify({ banners, configured: true, rawCount: data.results.length }),
      { status: 200, headers }
    );
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
      name: item.title.replace(/<[^>]+>/g, ""),
      address: item.roadAddress || item.address || "",
    }),
    { status: 200, headers }
  );
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
    if (url.pathname === "/naver-config") {
      return handleNaverConfig(env);
    }
    if (url.pathname === "/api/nearby-place") {
      return handleNearbyPlace(env, url);
    }
    if (url.pathname.startsWith("/images/")) {
      return handleImage(env, url.pathname.slice("/images/".length));
    }

    return env.ASSETS.fetch(request);
  },
};
