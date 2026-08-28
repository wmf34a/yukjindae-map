// 검수가 끝난 장소를 앱에 공개한다(공개여부 = true).
//
//   node scripts/publish-places.mjs                    # 비공개 장소 전체를 훑어본다
//   node scripts/publish-places.mjs 충청도             # 그 지역만 훑어본다
//   node scripts/publish-places.mjs 충청도 --apply     # 그 지역을 공개한다
//   node scripts/publish-places.mjs --all --apply      # 준비된 곳을 전부 공개한다
//
// 기본은 미리보기다. 공개는 되돌리기가 번거롭고(사용자가 이미 봤을 수 있다)
// 잘못된 정보가 그대로 노출되므로, 무엇이 켜지는지 먼저 눈으로 보게 한다.

import fs from "node:fs";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- Notion 쓰기는 초당 제한이 있어 순차로 돈다. */

const vars = loadVars();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const all = args.includes("--all");
const region = args.find((a) => !a.startsWith("--")) || "";

const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};

const text = (p, k) => p.properties[k]?.rich_text?.[0]?.plain_text || "";

// 이것들이 비어 있으면 화면이 눈에 띄게 빈다. 사진이 없으면 카드가 회색으로
// 남고, 근처에 들를 곳이 하나도 없으면 코스보기가 장소 하나짜리가 된다.
//
// 다만 장소 자체가 맛집·카페면 그 자체로 코스의 한 정거장이라 근처 가게를
// 요구하지 않는다 — 원주 스톤크릭은 "소금산 나들이 전후로 들르기 좋은 카페"인데
// 근처 가게가 없다는 이유로 걸렸다.
const SELF_IS_STOP = new Set(["맛집", "카페"]);

function missingEssentials(p) {
  const missing = [];
  if (typeof p.properties["위도"]?.number !== "number") missing.push("좌표");
  if (!text(p, "운영시간")) missing.push("운영시간");
  if ((p.properties["사진"]?.files?.length || 0) === 0) missing.push("사진");

  const categories = (p.properties["카테고리"]?.multi_select || []).map((c) => c.name);
  const isStopItself = categories.some((c) => SELF_IS_STOP.has(c));
  if (!isStopItself && !text(p, "근처맛집") && !text(p, "근처카페")) {
    missing.push("근처 맛집·카페");
  }
  return missing;
}

const pending = [];
let cursor;
do {
  const res = await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      page_size: 100,
      start_cursor: cursor,
      filter: { property: "공개여부", checkbox: { equals: false } },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 200));
  pending.push(...data.results);
  cursor = data.has_more ? data.next_cursor : null;
} while (cursor);

const targets = pending
  .map((p) => ({
    id: p.id,
    name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
    region: p.properties["지역"]?.select?.name || "(없음)",
    fee: text(p, "입장료"),
    missing: missingEssentials(p),
  }))
  .filter((p) => !region || p.region === region);

if (targets.length === 0) {
  console.log(region ? `${region}에 공개 대기 중인 장소가 없습니다.` : "공개 대기 중인 장소가 없습니다.");
  process.exit(0);
}

const ready = targets.filter((p) => p.missing.length === 0);
const blocked = targets.filter((p) => p.missing.length > 0);

console.log(`공개 대기 ${targets.length}곳 · 준비됨 ${ready.length}곳 · 항목 누락 ${blocked.length}곳\n`);

for (const p of ready) {
  // 입장료는 없어도 공개는 할 수 있다. 다만 헛걸음의 가장 큰 원인이라 표시해 둔다.
  console.log(`  ○ ${p.region.padEnd(6)} ${p.name}${p.fee ? "" : "  (입장료 미상)"}`);
}
for (const p of blocked) {
  console.log(`  ✗ ${p.region.padEnd(6)} ${p.name}  — ${p.missing.join(", ")} 없음`);
}

fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/공개대기.json", JSON.stringify(targets, null, 2));

if (!apply) {
  console.log("\n미리보기만 했습니다. 공개하려면 --apply 를 붙여 다시 실행하세요.");
  console.log("지역을 지정하지 않고 전부 공개하려면 --all --apply 를 씁니다.");
  process.exit(0);
}

if (!region && !all) {
  console.log("\n지역을 지정하거나 --all 을 붙여주세요. 실수로 전국을 한 번에 켜지 않도록 한 것입니다.");
  process.exit(1);
}

// 항목이 빠진 곳은 켜지 않는다. 빈 화면을 보여주느니 그대로 두는 편이 낫다.
let done = 0;
for (const p of ready) {
  const res = await fetch(`https://api.notion.com/v1/pages/${p.id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ properties: { "공개여부": { checkbox: true } } }),
  });
  if (res.ok) done += 1;
  else console.log(`✗ ${p.name}: ${(await res.text()).slice(0, 120)}`);
  await sleep(320);
}

console.log(`\n${done}곳 공개 전환 완료`);
if (blocked.length) {
  console.log(`${blocked.length}곳은 항목이 빠져 있어 건너뛰었습니다. 채운 뒤 다시 실행하세요.`);
}
console.log("\n새로 공개한 곳은 아직 이달의 순위가 없습니다.");
console.log("순위에 넣으려면: node scripts/run-monthly-top10.mjs 2026-09 --apply");
