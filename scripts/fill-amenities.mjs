// 유아 편의시설이 비어 있는 장소를 최근 블로그·카페 글로 채운다.
//
//   node scripts/fill-amenities.mjs           # 미리보기만
//   node scripts/fill-amenities.mjs --apply   # 노션에 반영
//
// 수유실이 있는지는 어떤 지도 API도 모른다. "있음"만 채우고 "없음"은 절대 쓰지
// 않는다 — 글에 안 나온 것은 없다는 뜻이 아니라 아무도 안 적었다는 뜻이다.

import fs from "node:fs";
import {
  inferAmenities, pickAmenitySnippets, buildAmenityProperties,
  AMENITY_FIELDS, PLACES_PER_CALL,
} from "../src/amenity-infer.js";
import { districtOf, sidoOf } from "../src/place-pipeline.js";
import { loadVars, sleep, makeSearchPosts, notionHeaders, queryAll } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 네이버·Claude 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = notionHeaders(vars);
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

// 세 항목 중 하나라도 비어 있으면 대상이다.
const targets = [];
for (const p of await queryAll(vars, vars.NOTION_DATABASE_ID)) {
  const has = Object.fromEntries(AMENITY_FIELDS.map((f) => [f, Boolean(p.properties[f]?.checkbox)]));
  if (AMENITY_FIELDS.every((f) => has[f])) continue;
  targets.push({
    id: p.id,
    name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
    address: p.properties["주소"]?.rich_text?.[0]?.plain_text || "",
    has,
  });
}

console.log(`편의시설이 덜 채워진 장소 ${targets.length}곳\n`);

const entries = [];
for (const t of targets) {
  const district = districtOf(t.address);
  const sido = sidoOf(t.address);
  // 단어를 여러 개 붙이면 결과가 급감한다("수유실 기저귀" 2건 vs "수유실" 25건).
  // 지역도 쿼리에 넣으면 줄어들어, 검색은 넓게 하고 지역 검증은 뒤에서 한다.
  const posts = [];
  for (const keyword of ["수유실", "기저귀교환대", "유아의자"]) {
    posts.push(...await searchPosts(t.name, keyword).catch(() => []));
    await sleep(200);
  }
  const snippets = pickAmenitySnippets(posts, { name: t.name, regions: [district, sido] });
  if (snippets.length) entries.push({ ...t, region: sido || district, snippets });
  await sleep(250);
}
console.log(`근거를 찾은 장소 ${entries.length}곳. AI 판정 시작\n`);

const decided = [];
for (let i = 0; i < entries.length; i += PLACES_PER_CALL) {
  const batch = entries.slice(i, i + PLACES_PER_CALL).map((e, n) => ({ ...e, no: n + 1 }));
  const out = await inferAmenities(batch, askClaude);
  if (!out.ok) { console.log(`  판정 실패: ${out.error}`); continue; }
  for (const r of out.results) {
    const entry = batch.find((b) => b.no === r.no);
    // 이미 켜져 있는 항목은 다시 쓸 필요가 없다.
    const fresh = {};
    for (const f of AMENITY_FIELDS) fresh[f] = r.fields[f] === true && !entry.has[f] ? true : null;
    const found = AMENITY_FIELDS.filter((f) => fresh[f]);
    if (found.length) {
      decided.push({ ...entry, fields: fresh, basis: r.basis });
      console.log(`  ✓ ${r.name}: ${found.join(", ")}  — ${r.basis}`);
    }
  }
  await sleep(1000);
}

console.log(`\n새로 확인된 장소 ${decided.length}곳`);
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/편의시설판정.json", JSON.stringify(decided, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  let done = 0;
  for (const d of decided) {
    const res = await fetch(`https://api.notion.com/v1/pages/${d.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ properties: buildAmenityProperties(d.fields) }),
    });
    if (res.ok) done += 1;
    else console.log(`✗ ${d.name}: ${(await res.text()).slice(0, 120)}`);
    await sleep(320);
  }
  console.log(`\n${done}곳 반영`);
}
