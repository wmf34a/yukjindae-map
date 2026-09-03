// 유료 시설의 "무료입장 연령"을 공식 안내 기준으로 확인해 채운다.
//
//   node scripts/fill-free-age.mjs              # 미리보기
//   node scripts/fill-free-age.mjs --apply      # 노션에 반영
//
// 이 필드는 검수에서 확인한 5곳이 5곳 다 틀렸다. 블로그 글쓴이가 자기 아이
// 나이를 적은 걸 그대로 가져왔기 때문이다. 그래서 다른 필드와 달리 블로그를
// 쓰지 않고, 웹 근거를 붙여 답하는 검색 모델(Perplexity)에게 공식 안내를 찾게 한다.

import fs from "node:fs";
import { inferAges, PLACES_PER_CALL } from "../src/free-age-infer.js";
import { loadVars, sleep, notionHeaders } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 검색 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
// 판정 결과 파일을 그대로 넣어 반영만 할 때 쓴다. 이 플래그 없이 판정 파일을
// 넘기면 검색이 처음부터 다시 돌아 결과가 달라진다.
const applyOnly = args.includes("--apply-only");
// 5곳씩 묶어 물으면 검색 모델이 한 장소에 쓰는 근거가 얕아진다. 남은 소수를
// 마저 채울 땐 한 곳씩 묻는다 — 호출은 늘어도 소형 사설 시설이 잡힌다.
const one = args.includes("--one");
const perCall = one ? 1 : PLACES_PER_CALL;
const file = args.find((a) => !a.startsWith("--")) || "tmp/무료연령_대상.json";
const H = notionHeaders(vars);

async function askWeb(prompt) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${vars.PERPLEXITY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

const all = JSON.parse(fs.readFileSync(file, "utf8"));
// 사람이 "확인됨"으로 승격해 둔 곳은 건드리지 않는다.
const targets = all.filter((t) => t.status !== "확인됨");
// 공개된 곳이 먼저다 — 지금 사용자가 보고 있는 정보라 틀렸을 때 대가가 크다.
targets.sort((a, b) => Number(b.pub) - Number(a.pub));
console.log(`대상 ${targets.length}곳 (공개 ${targets.filter((t) => t.pub).length}) · 확인됨이라 제외 ${all.length - targets.length}곳\n`);

const decided = applyOnly ? targets.slice() : [];
let held = 0;
for (let i = 0; applyOnly ? false : i < targets.length; i += perCall) {
  const batch = targets.slice(i, i + perCall).map((e, n) => ({ ...e, no: n + 1 }));
  const out = await inferAges(batch, askWeb);
  if (!out.ok) { console.log(`  판정 실패: ${out.error}`); held += batch.length; continue; }
  for (const r of out.results) {
    const entry = batch.find((b) => b.no === r.no);
    if (r.age) decided.push({ ...entry, newAge: r.age, source: r.source });
    else held += 1;
    // 원래 값과 다를 때가 이 작업의 요점이다. 눈에 띄게 표시한다.
    const changed = r.age && entry.age && !entry.age.includes(r.age);
    const mark = r.age ? (changed ? "≠" : "✓") : "·";
    console.log(`  ${mark} ${entry.pub ? "[공개] " : ""}${r.name}: ${entry.age || "(빈칸)"} -> ${r.age || "판단 보류"}`);
  }
  await sleep(one ? 400 : 800);
}

console.log(`\n확정 ${decided.length}곳 / 보류 ${held}곳`);
fs.mkdirSync("tmp", { recursive: true });
if (!applyOnly) fs.writeFileSync("tmp/무료연령판정.json", JSON.stringify(decided, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  for (const d of decided) {
    // "없음"은 무료 연령이 없다는 뜻이라 칸을 비운다 — 앱에 "없음"이라 뜨면
    // 무슨 뜻인지 알 수 없다.
    const content = d.newAge === "없음" ? "" : `${d.newAge} 무료`;
    const res = await fetch(`https://api.notion.com/v1/pages/${d.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ properties: {
        "무료입장연령": { rich_text: content ? [{ text: { content } }] : [] },
      } }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${d.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}곳 반영`);
}
