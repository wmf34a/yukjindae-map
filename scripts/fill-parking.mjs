// 주차 요금이 확인되지 않은 장소를 최근 블로그 후기로 채운다.
//
//   node scripts/fill-parking.mjs tmp/주차_검색필요.json           # 미리보기
//   node scripts/fill-parking.mjs tmp/주차_검색필요.json --apply   # 노션에 반영
//
// 공식 홈페이지는 주차 요금을 거의 안 적는다(44곳 중 3곳 중 1곳만 검색으로 확인).
// 블로그 후기는 반대로 주차 요금을 꼭 적는다. fill-fees.mjs 와 같은 방식으로
// 후기를 모아 AI에게 읽히되 확신이 서는 것만 채우고 "블로그힌트"로 표시한다.

import fs from "node:fs";
import {
  inferParking, pickParkingSnippets, nameVariants, buildParkingWebPrompt, parseParking, PLACES_PER_CALL,
} from "../src/parking-infer.js";
import { districtOf, sidoOf } from "../src/place-pipeline.js";
import { loadVars, sleep, makeSearchPosts } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 네이버·Claude 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
// 판정 결과 파일을 그대로 다시 넣어 반영만 하고 싶을 때 쓴다. 이 플래그 없이
// tmp/주차판정.json 을 넘기면 검색·판정이 처음부터 다시 돌아 결과가 달라진다.
const applyOnly = args.includes("--apply-only");
// 블로그 근거로 못 채운 곳에 쓴다. 네이버 블로그 대신 웹 검색 모델에게 직접 묻는다.
const web = args.includes("--web");
const file = args.find((a) => !a.startsWith("--")) || "tmp/주차_검색필요.json";
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};
const searchPosts = makeSearchPosts(vars);

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

const targets = JSON.parse(fs.readFileSync(file, "utf8"));
// 공개된 곳이 먼저다 — 지금 사용자가 보고 있는 정보라 틀렸을 때 대가가 크다.
targets.sort((a, b) => Number(b.pub) - Number(a.pub));
console.log(`대상 ${targets.length}곳 (공개 ${targets.filter((t) => t.pub).length})\n`);

const entries = [];
for (const t of applyOnly || web ? [] : targets) {
  const district = districtOf(t.addr);
  const sido = sidoOf(t.addr);
  // "주차비"라 쓰는 글과 "주차 무료"라 쓰는 글이 서로 다르다. 두 갈래로 찾는다.
  //
  // 지역을 붙이면 결과가 급격히 준다 — "국립전주박물관 주차비"는 18건인데
  // "전북 국립전주박물관 주차비"는 2건이었다. 블로그 제목에 시·도를 안 쓰기 때문이다.
  // 그래서 지역 없이도 한 번 더 찾고, 엉뚱한 지역 글은 pickParkingSnippets의
  // mentionsPlace(region) 가 걸러 준다.
  //
  // 이름도 그대로만 쓰지 않는다. "나주 국립나주박물관" 으로 검색하면 안 나오고
  // "국립나주박물관" 으로 검색해야 나온다.
  const posts = [];
  for (const v of nameVariants(t.name)) {
    posts.push(...await searchPosts(v, "주차비", sido).catch(() => []));
    posts.push(...await searchPosts(v, "주차 무료", sido).catch(() => []));
    posts.push(...await searchPosts(v, "주차비").catch(() => []));
    posts.push(...await searchPosts(v, "주차 무료").catch(() => []));
    await sleep(120);
  }
  const snippets = pickParkingSnippets(posts, { name: t.name, regions: [district, sido] });
  if (snippets.length) entries.push({ ...t, region: sido || district, snippets });
  else console.log(`  · ${t.name} — 근거 없음`);
  await sleep(250);
}
console.log(`\n근거를 찾은 장소 ${entries.length}곳. AI 판정 시작\n`);

const decided = applyOnly ? targets.slice() : [];
const held = [];
// 웹 모드는 블로그 스니펫이 아니라 장소 목록 자체를 그대로 묻는다.
const batches = web ? targets : entries;
for (let i = 0; applyOnly ? false : i < batches.length; i += PLACES_PER_CALL) {
  const batch = batches.slice(i, i + PLACES_PER_CALL).map((e, n) => ({ ...e, no: n + 1 }));
  const out = web
    ? parseParking(await askWeb(buildParkingWebPrompt(batch)).catch(() => ""), batch)
    : await inferParking(batch, askClaude);
  if (!out.ok) { console.log(`  판정 실패: ${out.error}`); continue; }
  for (const r of out.results) {
    const entry = batch.find((b) => b.no === r.no);
    if (r.status) decided.push({ ...entry, status: r.status, detail: r.detail, basis: r.basis });
    else held.push(entry);
    const mark = r.status ? "✓" : "·";
    const val = r.status ? `${r.status}${r.detail ? " · " + r.detail : ""}` : "판단 보류";
    console.log(`  ${mark} ${entry.pub ? "[공개] " : ""}${r.name}: ${val}${r.basis ? "  — " + r.basis : ""}`);
  }
  await sleep(1000);
}

console.log(`\n확정 ${decided.length}곳 / 보류 ${targets.length - decided.length}곳`);
fs.mkdirSync("tmp", { recursive: true });
if (!applyOnly) fs.writeFileSync("tmp/주차판정.json", JSON.stringify(decided, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  let kept = 0;
  for (const d of decided) {
    // 사람이 "확인됨"으로 승격해 둔 곳은 건드리지 않는다. 현장에서 본 사람의
    // 판단이 블로그 후기보다 낫고, 덮어쓰면 확인상태까지 블로그힌트로 내려간다.
    const cur = await (await fetch(`https://api.notion.com/v1/pages/${d.id}`, { headers: H })).json();
    if (cur?.properties?.["확인상태"]?.select?.name === "확인됨") {
      console.log(`- ${d.name}: 확인됨 상태라 건너뜀`);
      kept += 1;
      await sleep(320);
      continue;
    }
    const props = {
      "주차가능여부": { select: { name: d.status } },
      // 블로그에서 뽑은 값이라 "확인됨"이 아니다. 사람이 보고 승격해야 확정.
      "확인상태": { select: { name: "블로그힌트" } },
    };
    if (d.detail) {
      // 기존 주차상세에 수용 대수가 적혀 있으면 살린다. 블로그는 요금은 말해도
      // "372대"는 안 쓰는데, 그 숫자는 공공데이터에서 온 정확한 값이다.
      const old = cur?.properties?.["주차상세"]?.rich_text?.[0]?.plain_text || "";
      const capacity = /\d[\d,]*\s*대/.exec(old);
      const detail = capacity && !/\d[\d,]*\s*대/.test(d.detail)
        ? `${d.detail} · ${capacity[0]}`
        : d.detail;
      props["주차상세"] = { rich_text: [{ text: { content: detail } }] };
    }
    const res = await fetch(`https://api.notion.com/v1/pages/${d.id}`, {
      method: "PATCH", headers: H, body: JSON.stringify({ properties: props }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${d.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}곳 반영 (확인상태=블로그힌트)${kept ? ` · 확인됨이라 보존 ${kept}곳` : ""}`);
}
