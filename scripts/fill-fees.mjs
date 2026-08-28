// 입장료가 비어 있는 장소를 최근 블로그 후기로 채운다.
//
//   node scripts/fill-fees.mjs           # 미리보기만 (노션에 쓰지 않음)
//   node scripts/fill-fees.mjs --apply   # 노션에 반영
//
// TourAPI는 공원·수목원의 요금 필드를 대부분 비워 둔다. 사람이 51곳을 하나씩
// 확인하는 건 현실적이지 않아서, 후기를 모아 AI에게 읽히되 확신이 서는 것만 채운다.
// 채운 값은 "블로그힌트"로 표시되어, 사람이 보고 "확인됨"으로 승격해야 확정된다.

import fs from "node:fs";
import { inferFees, pickFeeSnippets, PLACES_PER_CALL } from "../src/fee-infer.js";
import { districtOf, sidoOf } from "../src/place-pipeline.js";
import { loadVars, sleep, makeSearchPosts } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 네이버·Claude 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};
const searchPosts = makeSearchPosts(vars);

async function askClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": vars.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 4000,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || "").join("");
}

// 입장료가 비어 있는 장소만 고른다.
const targets = [];
let cursor;
do {
  const d = await (await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
    method: "POST", headers: H, body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  })).json();
  for (const p of d.results) {
    const fee = p.properties["입장료"]?.rich_text?.[0]?.plain_text || "";
    if (fee.trim()) continue;
    targets.push({
      id: p.id,
      name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
      address: p.properties["주소"]?.rich_text?.[0]?.plain_text || "",
    });
  }
  cursor = d.has_more ? d.next_cursor : null;
} while (cursor);

console.log(`입장료가 빈 장소 ${targets.length}곳\n`);

// 장소마다 후기를 모은다.
const entries = [];
for (const t of targets) {
  const district = districtOf(t.address);
  const sido = sidoOf(t.address);
  // 무료인 곳은 아무도 "입장료"를 말하지 않고 "무료"라고만 적는다. 두 갈래로 찾는다.
  const posts = [
    ...await searchPosts(t.name, "입장료", sido).catch(() => []),
    ...await searchPosts(t.name, "무료 주차", sido).catch(() => []),
  ];
  const snippets = pickFeeSnippets(posts, { name: t.name, regions: [district, sido] });
  if (snippets.length) entries.push({ ...t, region: sido || district, snippets });
  else console.log(`  · ${t.name} — 근거 없음`);
  await sleep(250);
}
console.log(`\n근거를 찾은 장소 ${entries.length}곳. AI 판정 시작\n`);

const decided = [];
for (let i = 0; i < entries.length; i += PLACES_PER_CALL) {
  const batch = entries.slice(i, i + PLACES_PER_CALL).map((e, n) => ({ ...e, no: n + 1 }));
  const out = await inferFees(batch, askClaude);
  if (!out.ok) { console.log(`  판정 실패: ${out.error}`); continue; }
  for (const r of out.results) {
    const entry = batch.find((b) => b.no === r.no);
    if (r.fee) decided.push({ ...entry, fee: r.fee, basis: r.basis });
    console.log(`  ${r.fee ? "✓" : "·"} ${r.name}: ${r.fee || "판단 보류"}${r.basis ? "  — " + r.basis : ""}`);
  }
  await sleep(1000);
}

console.log(`\n확정 ${decided.length}곳 / 보류 ${entries.length - decided.length}곳`);
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/입장료판정.json", JSON.stringify(decided, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  for (const d of decided) {
    const res = await fetch(`https://api.notion.com/v1/pages/${d.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ properties: {
        "입장료": { rich_text: [{ text: { content: d.fee } }] },
        // 블로그에서 뽑은 값이라 "확인됨"이 아니다. 사람이 보고 승격해야 확정.
        "확인상태": { select: { name: "블로그힌트" } },
      } }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${d.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}곳 반영 (확인상태=블로그힌트)`);
}
