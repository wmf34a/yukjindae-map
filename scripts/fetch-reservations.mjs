// 서울시 공공서비스예약에서 아이 대상 프로그램의 "예약 오픈" 일정을 가져온다.
//
//   node scripts/fetch-reservations.mjs              # 미리보기
//   node scripts/fetch-reservations.mjs --apply      # 노션 예약오픈 DB에 반영
//   node scripts/fetch-reservations.mjs --days 21    # 몇 주치를 볼지 (기본 14일)
//
// 인기 프로그램은 오픈 몇 분 만에 마감된다. 그래서 이 목록은 "좋은 곳"이 아니라
// "언제 신청 버튼이 열리는지"를 나른다. 지나간 오픈은 담지 않는다.
//
// SEOUL_API_KEY 가 없으면 샘플 키로 도는데, 샘플 키는 서비스당 5건까지만 준다.
// 실제 운영에는 data.seoul.go.kr 에서 발급한 키가 있어야 한다.

import fs from "node:fs";
import { RESERVATION_SERVICES, pickReservations, formatOpenAt } from "../src/reservation-open.js";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 서울시 API 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const daysArg = args.indexOf("--days");
const windowDays = daysArg === -1 ? 14 : Number(args[daysArg + 1]) || 14;
const key = vars.SEOUL_API_KEY || "sample";
const pageSize = key === "sample" ? 5 : 1000;
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};

if (key === "sample") {
  console.log("SEOUL_API_KEY 가 없어 샘플 키로 돕니다 — 서비스당 5건만 옵니다.\n");
}

// 서울시 API가 심심찮게 연결을 끊는다(ECONNRESET). 한 번 끊겼다고 그날치를
// 통째로 버리면 목록이 비어 버리므로 몇 번 다시 시도한다.
async function fetchText(url, tries = 3) {
  for (let n = 1; n <= tries; n += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      return await res.text();
    } catch (err) {
      if (n === tries) throw err;
      await sleep(1200 * n);
    }
  }
  return "";
}

async function fetchService(service) {
  const rows = [];
  // 한 번에 1000건까지라 페이지를 넘겨 가며 다 받는다.
  for (let start = 1; start <= 5000; start += pageSize) {
    const url = `http://openapi.seoul.go.kr:8088/${key}/json/${service}/${start}/${start + pageSize - 1}/`;
    const text = await fetchText(url);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.log(`  ${service} ${start}~: ${text.slice(0, 120)}`);
      break;
    }
    const box = data[service];
    if (!box?.row?.length) break;
    rows.push(...box.row);
    if (rows.length >= (box.list_total_count || 0) || key === "sample") break;
    await sleep(200);
  }
  return rows;
}

const all = [];
for (const service of RESERVATION_SERVICES) {
  const rows = await fetchService(service);
  console.log(`${service}: ${rows.length}건`);
  all.push(...rows);
}

const picked = pickReservations(all, { windowDays, limit: 30 });
console.log(`\n아이 대상 · 앞으로 ${windowDays}일 안에 열리거나 지금 접수 중: ${picked.length}건\n`);
for (const p of picked) {
  const when = p.status === "오픈예정" ? `오픈 ${formatOpenAt(p.openAt)}` : `마감 ${formatOpenAt(p.closeAt)}`;
  console.log(`  [${p.status}] ${when} · ${p.title}`);
  console.log(`     ${p.place} (${p.area}) · ${p.fee} · 대상 ${p.target || "-"}`);
}

fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/예약오픈.json", JSON.stringify(picked, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else if (!vars.NOTION_RESERVATION_DATABASE_ID) {
  console.log("\nNOTION_RESERVATION_DATABASE_ID 가 없어 반영을 건너뜁니다.");
} else {
  const db = vars.NOTION_RESERVATION_DATABASE_ID;
  // 이미 들어 있는 것은 건너뛴다. 서울시가 같은 프로그램을 매달 새 SVCID로
  // 올리므로 제목이 아니라 SVCID로 본다.
  const existing = new Set();
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
      method: "POST", headers: H, body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    const data = await res.json();
    for (const page of data.results || []) {
      const id = page.properties["서비스ID"]?.rich_text?.[0]?.plain_text;
      if (id) existing.add(id);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  let added = 0;
  for (const p of picked) {
    if (existing.has(p.id)) continue;
    const properties = {
      "제목": { title: [{ text: { content: p.title.slice(0, 200) } }] },
      "서비스ID": { rich_text: [{ text: { content: p.id } }] },
      "시설명": { rich_text: [{ text: { content: p.place } }] },
      "대상": { rich_text: [{ text: { content: p.target } }] },
      "요금": { select: { name: p.fee || "무료" } },
      "예약오픈": { date: { start: p.openAt } },
      "접수마감": { date: { start: p.closeAt } },
      // 서울 밖 시설(서울농장 등)은 자치구가 비어 있어 권역을 못 정한다.
      // 모르면 비워 둔다 — 아무 권역이나 찍으면 지역 필터가 거짓말을 한다.
      ...(p.region ? { "지역": { select: { name: p.region } } } : {}),
      "자치구": { rich_text: [{ text: { content: p.area } }] },
      "신청링크": { url: p.url || null },
      // 축제와 같은 규칙이다 — 기계가 넣은 것은 사람이 확인해야 공개된다.
      "공개여부": { checkbox: false },
    };
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST", headers: H, body: JSON.stringify({ parent: { database_id: db }, properties }),
    });
    if (res.ok) added += 1;
    else console.log(`✗ ${p.title}: ${(await res.text()).slice(0, 140)}`);
    await sleep(320);
  }
  console.log(`\n새로 넣은 것 ${added}건 (공개여부=false, 사람이 확인해야 노출)`);
}
