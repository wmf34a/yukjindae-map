import { toPlace } from "./notion.js";

async function handlePlaces(env) {
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

    return new Response(JSON.stringify({ count: places.length, places }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "서버 오류", detail: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
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
      return handlePlaces(env);
    }
    if (url.pathname === "/naver-config") {
      return handleNaverConfig(env);
    }

    return env.ASSETS.fetch(request);
  },
};
