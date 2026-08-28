// 월간 지역별 Top 10을 수동으로 돌린다.
//
//   node scripts/run-monthly-top10.mjs 2026-09           # 미리보기
//   node scripts/run-monthly-top10.mjs 2026-09 --apply   # 노션에 반영
//
// 평소에는 크론이 매월 1일 00:00(KST)에 돌린다. 오픈 시점을 앞당기거나 장소를
// 크게 늘린 뒤처럼, 다음 1일을 기다릴 수 없을 때 쓰는 길이다.
//
// 공개된 장소만 후보다. 검수 대기 중인 곳을 공개 전환한 뒤에는 다시 돌려야
// 새 장소가 순위에 들어간다.

import { runMonthlyTop10 } from "../src/monthly-top10.js";
import { toPlace } from "../src/notion.js";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- Notion 페이징과 Claude 호출은 순차로 돈다. */

const vars = loadVars();
const monthKey = process.argv[2];
const apply = process.argv.includes("--apply");

if (!/^\d{4}-\d{2}$/.test(monthKey || "")) {
  console.error("사용법: node scripts/run-monthly-top10.mjs YYYY-MM [--apply]");
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};

async function fetchPlaces() {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100, filter: { property: "공개여부", checkbox: { equals: true } } };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
      method: "POST", headers: H, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 200));
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results.map(toPlace).filter((p) => p.name);
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

// 미리보기에서는 노션에 쓰지 않고 무엇이 바뀌는지만 모은다.
const preview = [];
async function patchPlace(placeId, properties) {
  if (!apply) {
    preview.push({ placeId, properties });
    return;
  }
  const res = await fetch(`https://api.notion.com/v1/pages/${placeId}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 150));
  await sleep(320);
}

const places = await fetchPlaces();
console.log(`공개 장소 ${places.length}곳 · ${monthKey} 기준으로 순위를 매깁니다\n`);

const result = await runMonthlyTop10({ places, askClaude, patchPlace, monthKey });
const byId = new Map(places.map((p) => [p.id, p]));

for (const region of result.regions) {
  if (!region.ok && region.ranked === 0) {
    console.log(`[${region.region}] 실패 — ${region.error} (지난달 순위 유지)`);
    continue;
  }
  console.log(`[${region.region}] ${region.ranked}곳`);
  if (region.failures?.length) for (const f of region.failures) console.log(`   ✗ ${f}`);
}

if (!apply) {
  // 반영하지 않았으므로 무엇이 1~3위가 됐는지만 보여준다.
  const ranks = preview
    .filter((p) => p.properties["추천순위"].number !== null)
    .map((p) => ({
      name: byId.get(p.placeId)?.name || p.placeId,
      region: byId.get(p.placeId)?.region || "",
      rank: p.properties["추천순위"].number,
      reason: p.properties["추천사유"].rich_text?.[0]?.text?.content || "",
    }));
  console.log("\n지역별 1~3위 미리보기");
  const seen = {};
  for (const r of ranks.toSorted((a, b) => a.rank - b.rank)) {
    seen[r.region] = (seen[r.region] || 0) + 1;
    if (seen[r.region] <= 3) console.log(`  ${r.region} ${r.rank}위  ${r.name} — ${r.reason}`);
  }
  console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙여 다시 실행하세요.");
} else {
  console.log(`\n${monthKey} 순위 반영 완료`);
}
