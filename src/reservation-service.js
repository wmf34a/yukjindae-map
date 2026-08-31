// 서울시 공공서비스예약 연동. 주 1회 후보를 긁어 노션에 쌓고, 앱에는 공개된
// 것만 내보낸다.
//
// worker.js 가 2,100줄을 넘어가면서 주제별로 갈랐다. 여기는 "예약 오픈"에
// 관한 것만 모은다 — 수집, 슬랙 알림, 앱에 내보내는 조회.
//
// 걸러내는 규칙(누구 대상인지, 무엇이 나들이인지)은 reservation-open.js 에
// 순수 함수로 있고 테스트가 붙어 있다. 여기는 네트워크와 노션만 다룬다.
import { fetchWithTimeout, upstreamErrorResponse, serverErrorResponse } from "./http.js";
import { RESERVATION_SERVICES, pickReservations, formatOpenAt } from "./reservation-open.js";
import { notifySlack } from "./notify.js";

// 서울시 공공서비스예약에서 아이 대상 프로그램을 주 1회 긁어 노션에 쌓는다.
// 이 정보는 주마다 통째로 갈린다 — 사람이 손으로 돌리는 한 앱에는 지난주 목록이
// 계속 걸려 있게 된다.
//
// 서울시 API는 8088 포트라 wrangler.jsonc 에 allow_custom_ports 플래그가 있어야
// Worker에서 부를 수 있다. 한 번에 1,000건까지 준다.
const SEOUL_RESERVATION_PAGE = 1000;
const RESERVATION_IMPORT_MAX = 30;

async function fetchSeoulReservations(env) {
  const rows = [];
  for (const service of RESERVATION_SERVICES) {
    /* oxlint-disable-next-line no-await-in-loop -- 서울시 API 호출량 때문에 순차로 돈다. */
    const res = await fetchWithTimeout(
      `http://openapi.seoul.go.kr:8088/${env.SEOUL_API_KEY}/json/${service}/1/${SEOUL_RESERVATION_PAGE}/`,
      {},
      20_000
    );
    /* oxlint-disable-next-line no-await-in-loop */
    const text = await res.text();
    try {
      // 오류는 JSON이 아니라 XML로 온다. 한 서비스가 실패해도 나머지는 살린다.
      const box = JSON.parse(text)[service];
      if (box?.row?.length) rows.push(...box.row);
    } catch {
      console.error(`[reservations] ${service} 응답을 못 읽었습니다:`, text.slice(0, 160));
    }
  }
  return rows;
}

/* oxlint-disable-next-line no-unused-vars -- 홈 띠를 내린 동안만 호출을 뺐다. 위 크론에서 되살린다. */
export async function runReservationImport(env) {
  if (!env.SEOUL_API_KEY || !env.NOTION_API_KEY || !env.NOTION_RESERVATION_DATABASE_ID) {
    console.error("[reservations] 자동 수집 설정이 없어 건너뜁니다.");
    return;
  }

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  let rows;
  try {
    rows = await fetchSeoulReservations(env);
  } catch (err) {
    // 주 1회만 도는 작업이라 조용히 실패하면 다음 주까지 아무도 모른다.
    console.error("[reservations] 서울시 API 호출 실패:", err);
    return;
  }

  const picked = pickReservations(rows, { limit: RESERVATION_IMPORT_MAX });
  console.log(`[reservations] 서울시 ${rows.length}건 조회 · 아이 대상 ${picked.length}건`);
  if (picked.length === 0) return;

  // 서울시가 같은 프로그램을 회차마다 새 SVCID로 올리므로 제목이 아니라 ID로 본다.
  const known = new Set();
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    /* oxlint-disable-next-line no-await-in-loop */
    const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${env.NOTION_RESERVATION_DATABASE_ID}/query`, {
      method: "POST", headers: notionHeaders, body: JSON.stringify(body),
    });
    if (!res.ok) break;
    /* oxlint-disable-next-line no-await-in-loop */
    const data = await res.json();
    for (const page of data.results || []) {
      const id = plainText(page.properties["서비스ID"]);
      if (id) known.add(id);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  const fresh = picked.filter((p) => !known.has(p.id));
  const added = [];
  for (const p of fresh) {
    const properties = {
      "제목": { title: [{ text: { content: p.title.slice(0, 200) } }] },
      "서비스ID": { rich_text: [{ text: { content: p.id } }] },
      "시설명": { rich_text: [{ text: { content: p.place } }] },
      "대상": { rich_text: [{ text: { content: p.target } }] },
      "요금": { select: { name: p.fee || "무료" } },
      "예약오픈": { date: { start: p.openAt } },
      "접수마감": { date: { start: p.closeAt } },
      "자치구": { rich_text: [{ text: { content: p.area } }] },
      "신청링크": { url: p.url || null },
      // 축제와 같은 규칙이다 — 기계가 넣은 것은 사람이 확인해야 앱에 뜬다.
      "공개여부": { checkbox: false },
      // 서울 밖 시설(서울농장 등)은 자치구가 비어 있어 권역을 못 정한다.
      // 모르면 비워 둔다 — 아무 권역이나 찍으면 지역 필터가 거짓말을 한다.
      ...(p.region ? { "지역": { select: { name: p.region } } } : {}),
    };
    /* oxlint-disable-next-line no-await-in-loop */
    const res = await fetchWithTimeout("https://api.notion.com/v1/pages", {
      method: "POST", headers: notionHeaders,
      body: JSON.stringify({ parent: { database_id: env.NOTION_RESERVATION_DATABASE_ID }, properties }),
    });
    if (res.ok) added.push(p);
    /* oxlint-disable-next-line no-await-in-loop */
    else console.error(`[reservations] ${p.title} 등록 실패:`, (await res.text()).slice(0, 160));
  }

  console.log(`[reservations] 이미 있는 것 ${picked.length - fresh.length}건 · 새로 넣은 것 ${added.length}건`);
  await notifyReservationCandidates(env, added);
}

// 새로 들어온 것은 공개여부=false 라 사람이 노션을 열지 않으면 계속 묻힌다.
// 축제 후보와 같은 방식으로 매주 슬랙에 알린다.
async function notifyReservationCandidates(env, items) {
  if (items.length === 0) return;

  const dbUrl = `https://www.notion.so/${env.NOTION_RESERVATION_DATABASE_ID.replace(/-/g, "")}`;
  const lines = items.slice(0, 10).map((item) => {
    const when = item.status === "오픈예정" ? `오픈 ${formatOpenAt(item.openAt)}` : `마감 ${formatOpenAt(item.closeAt)}`;
    return `• [${when}] ${item.title} — ${item.area || item.place}`;
  });
  const more = items.length > lines.length ? `\n… 그 밖에 ${items.length - lines.length}건` : "";
  const text = `🎟️ 새 예약 오픈 후보 ${items.length}건이 노션에 추가됐어요 (검토 대기)\n${lines.join("\n")}${more}\n${dbUrl}`;
  await notifySlack(env, text);
}

function plainText(prop) {
  return prop?.rich_text?.map((t) => t.plain_text).join("") || "";
}

// 예약 오픈은 축제와 성질이 다르다. 축제는 "기간 중이면 계속 유효"하지만
// 예약은 오픈 시각이 지나면 알림으로서 가치가 없다 — 접수마감이 지난 것은
// 담당자가 체크를 안 풀어도 여기서 걸러 낸다.
export async function handleReservations(env) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!env.NOTION_API_KEY || !env.NOTION_RESERVATION_DATABASE_ID) {
    // 조용히 빈 배열을 주면 "노션에 데이터가 없다"와 "설정이 빠졌다"가 구별되지
    // 않는다. 실제로 시크릿이 안 들어간 걸 데이터 문제로 한참 찾았다.
    console.error("[reservations] 설정 없음:", {
      apiKey: Boolean(env.NOTION_API_KEY),
      dbId: Boolean(env.NOTION_RESERVATION_DATABASE_ID),
    });
    return new Response(JSON.stringify({ reservations: [] }), { status: 200, headers });
  }

  const notionHeaders = {
    Authorization: `Bearer ${env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "content-type": "application/json",
  };

  try {
    const res = await fetchWithTimeout(`https://api.notion.com/v1/databases/${env.NOTION_RESERVATION_DATABASE_ID}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: "공개여부", checkbox: { equals: true } },
        sorts: [{ property: "예약오픈", direction: "ascending" }],
      }),
    });

    if (!res.ok) {
      return upstreamErrorResponse("정보를 불러오지 못했습니다.", await res.text());
    }

    const data = await res.json();
    if (!data.results?.length) console.error("[reservations] 노션 결과 0건 — 공개여부 체크를 확인하세요");
    const now = Date.now();
    const reservations = (data.results || [])
      .map((page) => {
        const p = page.properties;
        const openAt = p["예약오픈"]?.date?.start || "";
        const closeAt = p["접수마감"]?.date?.start || "";
        return {
          id: page.id,
          title: p["제목"]?.title?.map((t) => t.plain_text).join("") || "",
          place: plainText(p["시설명"]),
          target: plainText(p["대상"]),
          fee: p["요금"]?.select?.name || "",
          region: p["지역"]?.select?.name || "",
          area: plainText(p["자치구"]),
          url: p["신청링크"]?.url || "",
          note: plainText(p["메모"]),
          openAt,
          closeAt,
          // 아직 안 열린 것과 지금 신청 가능한 것을 화면에서 다르게 보여준다.
          status: openAt && Date.parse(openAt) > now ? "오픈예정" : "접수중",
        };
      })
      .filter((r) => r.title && (!r.closeAt || Date.parse(r.closeAt) >= now));

    // 노션 정렬(예약오픈 오름차순)만으로는 오래전에 열린 "접수중"이 앞을 다 먹고
    // 정작 알려야 할 "오픈 예정"이 뒤로 밀린다. 아직 안 열린 것을 먼저, 그 안에서는
    // 빨리 열리는 순으로. 이미 열린 것은 마감이 임박한 순으로 뒤에 붙인다.
    const soon = reservations
      .filter((r) => r.status === "오픈예정")
      .toSorted((a, b) => a.openAt.localeCompare(b.openAt));
    const open = reservations
      .filter((r) => r.status !== "오픈예정")
      .toSorted((a, b) => (a.closeAt || "").localeCompare(b.closeAt || ""));
    const ordered = [...soon, ...open].slice(0, 12);

    return new Response(JSON.stringify({ reservations: ordered }), { status: 200, headers });
  } catch (err) {
    return serverErrorResponse(err);
  }
}
