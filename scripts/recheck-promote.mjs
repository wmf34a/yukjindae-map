// promote-verified.mjs 가 남긴 조회 결과를 다시 대조한다.
//
//   node scripts/recheck-promote.mjs           # 미리보기
//   node scripts/recheck-promote.mjs --apply   # 노션에 반영
//
// 1차 검수는 조회 모델에게 "우리 값과 같으냐"까지 물었는데, 조회 답과 우리 값이
// 글자까지 같은 곳도 "다름"으로 답한 사례가 여러 건 나왔다. 판정을 조회와 분리해,
// 이미 받아 둔 답변 텍스트만 Claude 로 다시 대조한다. 재조회는 하지 않는다.

import fs from "node:fs";
import { loadVars, sleep } from "./lib/sources.mjs";
import { todayInKst } from "../src/kst.js";

/* oxlint-disable no-await-in-loop -- 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};
const today = todayInKst();

const retryOnly = process.argv.includes("--retry-failed");
const judged = JSON.parse(fs.readFileSync("tmp/승격판정.json", "utf8"));
const prev = fs.existsSync("tmp/승격_2차판정.json")
  ? JSON.parse(fs.readFileSync("tmp/승격_2차판정.json", "utf8"))
  : null;

let queue;
if (retryOnly) {
  if (!prev) { console.error("tmp/승격_2차판정.json 이 없다. --retry-failed 없이 먼저 돌려라."); process.exit(1); }
  queue = prev.failed;
  console.log(`판정 실패했던 ${queue.length}곳만 재시도\n`);
} else {
  queue = judged.differ.filter((d) => d.why !== "조회 실패");
  console.log(`1차에서 어긋난다고 본 ${judged.differ.length}곳 중 ${queue.length}곳 재대조\n`);
}

async function judge(p) {
  const prompt = `장소 "${p.name}" (${p.addr}) 정보다.

[우리가 가진 값]
- 운영시간: ${p.hours || "(빈칸)"}
- 입장료: ${p.fee || "(빈칸)"}
- 주차: ${p.parking || "(빈칸)"}

[웹 조회 결과]
${p.answer}

세 항목 각각에 대해, 우리 값이 조회 결과와 의미상 일치하는지 판정해라.
표현이 달라도 뜻이 같으면 same 이다 (예: "연중무휴" = "휴무 없음", "09:00~19:00(입장 마감 18:00)" = "09:00~19:00, 입장 마감 18:00").
조회 결과가 그 항목을 확인해 주지 못하면 unknown 이다.
값이 실제로 어긋날 때만 diff 다.
우리 값이 빈칸인데 조회 결과에 값이 있으면 missing 이다.

JSON 만 출력해라. 다른 말 금지.
{"hours":"same|diff|unknown|missing","fee":"...","parking":"...","note":"diff 인 항목만 무엇이 어떻게 다른지 한 줄, 없으면 빈 문자열"}`;

  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": vars.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-5",
          max_tokens: 900,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      const body = await res.json();
      const raw = body.content?.map((c) => c.text || "").join("") || "";
      const m = /\{[\s\S]*\}/.exec(raw);
      if (!m) throw new Error("JSON 없음");
      return JSON.parse(m[0]);
    } catch (err) {
      if (i === 2) return { error: err.message };
      await sleep(2000 * (i + 1));
    }
  }
  return { error: "실패" };
}

const ok = retryOnly ? [...prev.ok] : [];
const needFix = retryOnly ? [...prev.needFix] : [];
const failed = [];
for (const [i, p] of queue.entries()) {
  const v = await judge(p);
  if (v.error) {
    failed.push({ ...p, why: v.error });
    console.log(`✗ [${i + 1}/${queue.length}] ${p.name} — ${v.error}`);
    continue;
  }
  const fields = [v.hours, v.fee, v.parking];
  const diffs = ["운영시간", "입장료", "주차"].filter((_, k) => fields[k] === "diff");
  const missing = ["운영시간", "입장료", "주차"].filter((_, k) => fields[k] === "missing");
  const record = { ...p, verdict: v, diffs, missing };
  if (diffs.length === 0) {
    ok.push(record);
    console.log(`✓ [${i + 1}/${queue.length}] ${p.name}${missing.length ? ` (빈칸: ${missing.join(", ")})` : ""}`);
  } else {
    needFix.push(record);
    console.log(`· [${i + 1}/${queue.length}] ${p.name} — 다름: ${diffs.join(", ")}`);
  }
  await sleep(250);
}

fs.writeFileSync("tmp/승격_2차판정.json", JSON.stringify({ ok, needFix, failed }, null, 2));
console.log(`\n실제로 맞는 곳 ${ok.length} · 진짜 다른 곳 ${needFix.length} · 판정 실패 ${failed.length}`);

const lines = ["# 값이 실제로 어긋나는 곳", "",
  `${needFix.length}곳. 조회 결과와 지금 값이 실제로 다르다. 자동으로 덮어쓰지 않았다.`, ""];
for (const d of needFix) {
  lines.push(`## ${d.name}`, `- 다른 항목: ${d.diffs.join(", ")}`, `- 설명: ${d.verdict.note || "(없음)"}`,
    `- 지금 운영시간: ${d.hours || "(빈칸)"}`, `- 지금 입장료: ${d.fee || "(빈칸)"}`, `- 지금 주차: ${d.parking || "(빈칸)"}`, "",
    "```", d.answer.replace(/\n{2,}/g, "\n").slice(0, 600), "```", "");
}
fs.writeFileSync("tmp/승격_실제불일치.md", lines.join("\n"));
console.log("진짜 어긋나는 곳 → tmp/승격_실제불일치.md");

if (!apply) { console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙이세요."); process.exit(0); }

const promote = [...judged.agree, ...ok];
let done = 0;
for (const a of promote) {
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
console.log(`\n${done}곳 확인됨으로 승격 (1차 일치 ${judged.agree.length} + 재대조 통과 ${ok.length})`);
