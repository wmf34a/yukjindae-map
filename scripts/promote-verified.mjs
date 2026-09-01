// "블로그힌트"로 남아 있는 장소를 공식 안내와 대조해 "확인됨"으로 올린다.
//
//   node scripts/promote-verified.mjs           # 미리보기
//   node scripts/promote-verified.mjs --apply   # 노션에 반영
//
// 블로그힌트는 "블로그 글에서 뽑았고 아직 사람이 확인하지 않았다"는 뜻이다.
// 공개된 곳의 절반이 그 상태로 남아 있으면, 화면에 뜨는 정보의 절반이 미확인이다.
//
// 운영시간·입장료·주차를 공식 안내 기준으로 다시 물어, 지금 값과 맞으면 확인됨으로
// 올리고 어긋나면 무엇이 다른지 남긴다. 값을 자동으로 덮어쓰지는 않는다 — 어긋난
// 것은 사람이 판단해야 한다. 이번 검수에서 조회 답이 틀렸던 적이 여러 번 있다.

import fs from "node:fs";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 검색 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]) || Infinity;
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function ask(q) {
  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${vars.PERPLEXITY_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: q }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()).choices?.[0]?.message?.content || "";
    } catch (err) {
      if (i === 2) return `(조회 실패: ${err.message})`;
      await sleep(2000 * (i + 1));
    }
  }
  return "";
}

const text = (p) => p?.rich_text?.map((t) => t.plain_text).join("") || "";
const places = [];
let cursor;
do {
  const data = await (await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
    method: "POST", headers: H, body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  })).json();
  for (const p of data.results) {
    if (p.properties["공개여부"]?.checkbox !== true) continue;
    if (p.properties["확인상태"]?.select?.name !== "블로그힌트") continue;
    places.push({
      id: p.id,
      name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
      addr: text(p.properties["주소"]),
      hours: text(p.properties["운영시간"]),
      fee: text(p.properties["입장료"]),
      parking: p.properties["주차가능여부"]?.select?.name || "",
    });
  }
  cursor = data.has_more ? data.next_cursor : null;
} while (cursor);

const queue = places.slice(0, limit);
console.log(`블로그힌트 ${places.length}곳 · 이번에 볼 곳 ${queue.length}\n`);

fs.mkdirSync("tmp", { recursive: true });
const agree = [];
const differ = [];
for (const [i, p] of queue.entries()) {
  const answer = await ask(`${p.addr}에 있는 "${p.name}"의 아래 세 가지를 공식 안내 기준으로만 알려줘. 각각 한 줄로, 확인 안 되면 "확인 안 됨".
1) 운영시간과 정기 휴무일
2) 입장료 (무료면 무료)
3) 주차 무료/유료
그리고 마지막 줄에 우리가 가진 아래 값과 어긋나는 항목이 있으면 "다름: 항목명"으로, 모두 맞으면 "일치"라고만 적어라.
- 운영시간: ${p.hours || "(빈칸)"}
- 입장료: ${p.fee || "(빈칸)"}
- 주차: ${p.parking || "(빈칸)"}`);
  await sleep(900);

  const matched = /(^|\n)\s*\**일치\**\s*$/m.test(answer) || /일치합니다|모두 맞습니다/.test(answer);
  const failed = answer.startsWith("(조회 실패");
  const record = { ...p, answer };
  if (failed) { differ.push({ ...record, why: "조회 실패" }); }
  else if (matched) { agree.push(record); }
  else {
    const m = /다름\s*[:：]\s*(.+)/.exec(answer);
    differ.push({ ...record, why: m ? m[1].trim().slice(0, 80) : "판정 불명확" });
  }
  const mark = failed ? "✗" : matched ? "✓" : "·";
  console.log(`${mark} [${i + 1}/${queue.length}] ${p.name}${matched ? "" : ` — ${failed ? "조회 실패" : (/다름\s*[:：]\s*(.+)/.exec(answer)?.[1] || "확인 필요").trim().slice(0, 60)}`}`);
}

fs.writeFileSync("tmp/승격판정.json", JSON.stringify({ agree, differ }, null, 2));
console.log(`\n일치 ${agree.length}곳 · 다르거나 불명확 ${differ.length}곳`);

const lines = ["# 값이 어긋나는 곳", "",
  `${differ.length}곳. 공식 안내와 지금 값이 다르거나 조회로 확정하지 못한 곳이다.`,
  "값을 자동으로 덮어쓰지 않았다 — 조회 답이 틀렸던 적이 여러 번 있어 사람이 봐야 한다.", ""];
for (const d of differ) {
  lines.push(`## ${d.name}`, `- 사유: ${d.why}`, `- 지금 운영시간: ${d.hours || "(빈칸)"}`, `- 지금 입장료: ${d.fee || "(빈칸)"}`, "",
    "```", d.answer.replace(/\n{2,}/g, "\n").slice(0, 700), "```", "");
}
fs.writeFileSync("tmp/승격_확인필요.md", lines.join("\n"));
console.log("어긋나는 곳 → tmp/승격_확인필요.md");

if (!apply) { console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙이세요."); process.exit(0); }

let done = 0;
for (const a of agree) {
  const res = await fetch(`https://api.notion.com/v1/pages/${a.id}`, {
    method: "PATCH", headers: H,
    body: JSON.stringify({ properties: {
      "확인상태": { select: { name: "확인됨" } },
      "정보확인일": { date: { start: today } },
    } }),
  });
  if (res.ok) done += 1;
  else console.log(`✗ ${a.name}: ${(await res.text()).slice(0, 110)}`);
  await sleep(320);
}
console.log(`\n${done}곳 확인됨으로 승격`);
