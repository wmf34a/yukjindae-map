function text(prop) {
  if (!prop || !prop.rich_text || prop.rich_text.length === 0) return "";
  return prop.rich_text.map((t) => t.plain_text).join("");
}

function title(prop) {
  if (!prop || !prop.title || prop.title.length === 0) return "";
  return prop.title.map((t) => t.plain_text).join("");
}

function selectName(prop) {
  return prop && prop.select ? prop.select.name : "";
}

function multiSelectNames(prop) {
  if (!prop || !prop.multi_select) return [];
  return prop.multi_select.map((o) => o.name);
}

function firstFileUrl(prop) {
  if (!prop || !prop.files || prop.files.length === 0) return "";
  const f = prop.files[0];
  if (f.type === "external") return f.external.url;
  if (f.type === "file") return f.file.url;
  return "";
}

function toPlace(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: title(p["장소명"]),
    region: selectName(p["지역"]),
    categories: multiSelectNames(p["카테고리"]),
    address: text(p["주소"]),
    lat: p["위도"] && p["위도"].number,
    lng: p["경도"] && p["경도"].number,
    image: firstFileUrl(p["사진"]),
    hours: text(p["운영시간"]),
    fee: text(p["입장료"]),
    reason: text(p["추천이유"]),
    parkingAvailable: selectName(p["주차가능여부"]),
    parkingDetail: text(p["주차상세"]),
    strollerAccess: selectName(p["유모차동선"]),
    diaperChange: p["기저귀교환대"] && p["기저귀교환대"].checkbox,
    nursingRoom: p["수유실"] && p["수유실"].checkbox,
    nearbyRestaurant: text(p["근처맛집"]),
    nearbyCafe: text(p["근처카페"]),
    registeredBy: text(p["등록자"]),
  };
}

export async function onRequestGet(context) {
  const { env } = context;

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
