// 발굴한 후보를 AI에게 심사시켜, 우리 지도에 실릴 자격이 있는 것만 추린다.
//
//   node scripts/screen-candidates.mjs            # tmp/*-후보.json 전부
//   node scripts/screen-candidates.mjs 인천 광주   # 지정한 지역만
//
// 이름 필터와 블로그 언급량으로 걸러도 동네 근린공원이 남는다. 언급량은 "사람들이
// 아는 곳"은 가려도 "일부러 갈 곳"은 못 가른다. 그 판단만 AI에게 맡긴다.
//
// 결과: tmp/<지역>-후보.json 을 통과분만 남기고 덮어쓴다 (원본은 -전체.json 으로 보관)

import fs from "node:fs";
import path from "node:path";
import { screenCandidates, PASS_SCORE } from "../src/candidate-screen.js";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- Claude 호출은 지역마다 순차로 돈다. */

const vars = loadVars();

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
      // 장소 성격을 가리는 정도라 최고 강도까지 갈 일이 아니다.
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || "").join("");
}

const only = process.argv.slice(2);
const files = fs.readdirSync("tmp")
  .filter((f) => f.endsWith("-후보.json"))
  .filter((f) => !only.length || only.includes(f.replace("-후보.json", "")));

if (!files.length) {
  console.error("tmp/ 에 후보 파일이 없습니다. 먼저 discover-places.mjs 를 돌리세요.");
  process.exit(1);
}

const report = [];
for (const file of files) {
  const region = file.replace("-후보.json", "");
  const entries = JSON.parse(fs.readFileSync(path.join("tmp", file), "utf8"));

  const out = await screenCandidates({
    region,
    places: entries.map((e) => {
      const p = e.record || e;
      return {
        name: p["장소명"], address: p["주소"], hours: p["운영시간"],
        fee: p["입장료"], reason: p["추천이유"],
      };
    }),
    askClaude,
  });

  if (!out.ok) {
    console.log(`[${region}] 심사 실패 — ${out.error} (원본 유지)`);
    continue;
  }

  const byName = new Map(out.verdicts.map((v) => [v.name, v]));
  const passed = entries.filter((e) => byName.get((e.record || e)["장소명"])?.pass);

  // 원본을 지우지 않고 남겨 둔다 — 판정이 마음에 안 들면 되돌릴 수 있어야 한다.
  fs.writeFileSync(path.join("tmp", `${region}-전체.json`), JSON.stringify(entries, null, 2));
  fs.writeFileSync(path.join("tmp", file), JSON.stringify(passed, null, 2));

  console.log(`\n[${region}] ${passed.length}/${entries.length}곳 통과 (${PASS_SCORE}점 이상)`);
  for (const v of out.verdicts.sort((a, b) => b.score - a.score)) {
    console.log(`  ${v.pass ? "✓" : "✗"} ${v.score}점  ${v.name}  — ${v.reason}`);
  }
  if (out.missing?.length) console.log(`  ! 판정 누락: ${out.missing.join(", ")}`);
  report.push({ region, passed: passed.length, total: entries.length, verdicts: out.verdicts });
  await sleep(1000);
}

const total = report.reduce((a, r) => a + r.total, 0);
const kept = report.reduce((a, r) => a + r.passed, 0);
console.log(`\n전체 ${kept}/${total}곳 통과`);
fs.writeFileSync("tmp/심사결과.json", JSON.stringify(report, null, 2));
