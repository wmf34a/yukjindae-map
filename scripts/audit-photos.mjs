// 장소 사진에 언론사 워터마크나 식별 가능한 얼굴이 있는지 살핀다.
//
//   node scripts/audit-photos.mjs           # 전체
//   node scripts/audit-photos.mjs --no-credit  # 사진출처가 빈 곳만
//
// 결과: tmp/사진감사.json
//
// 출처를 안 적고 넣은 사진 중에 뉴스 기사 사진이 섞여 있었다. YONHAP NEWS,
// NEWSIS, SBN NEWS 워터마크가 그대로 박힌 채였다. 개관식 테이프커팅처럼 얼굴이
// 정면으로 나온 사진도 있었고, 사진이 아니라 안내도 일러스트도 있었다.
//
// 사람이 109장을 하나씩 열어보는 대신 눈이 달린 모델에게 먼저 묻는다. 판정이
// 애매한 것만 사람이 본다.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadVars, sleep, queryAll } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 이미지를 한 장씩 보내야 한다. */

const vars = loadVars();
const onlyNoCredit = process.argv.includes("--no-credit");
// 앞선 실행에서 판정에 실패한 것만 다시 본다.
const onlyFailed = process.argv.includes("--retry-failed");

const PROMPT = `이 사진을 장소 소개 카드에 쓸 수 있는지 판단해라. JSON만 출력한다.

{"watermark": "없음 또는 보이는 워터마크 글자",
 "faces": 얼굴이 식별되는 사람 수(대략, 뒷모습이나 아주 작게 나온 사람은 세지 않는다),
 "kind": "장소사진" | "안내도" | "행사사진" | "포스터" | "기타",
 "usable": true 또는 false,
 "why": "판단 이유 한 문장"}

usable 이 false 인 경우:
- 언론사 워터마크가 있다(저작권 문제)
- 얼굴이 식별되는 사람이 여럿 나온다(초상권 문제)
- 장소 사진이 아니라 안내도·포스터다`;

async function classify(buf, mime) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": vars.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      // 300 으로 잡았더니 판정 JSON 이 중간에 잘려 열한 장이 실패했다.
      max_tokens: 700,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("");
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`판정을 못 읽음: ${text.slice(0, 100)}`);
  return JSON.parse(m[0]);
}

const places = [];
for (const p of await queryAll(vars, vars.NOTION_DATABASE_ID)) {
  if (p.properties["공개여부"]?.checkbox !== true) continue;
  const url = p.properties["사진"]?.files?.[0]?.external?.url;
  if (!url) continue;
  const credit = p.properties["사진출처"]?.rich_text?.map((t) => t.plain_text).join("") || "";
  if (onlyNoCredit && credit) continue;
  places.push({ id: p.id, name: p.properties["장소명"]?.title?.[0]?.plain_text || "", url, credit });
}

let queue = places;
if (onlyFailed && fs.existsSync("tmp/사진감사.json")) {
  const prev = JSON.parse(fs.readFileSync("tmp/사진감사.json", "utf8"));
  const failed = new Set(prev.filter((r) => r.error).map((r) => r.id));
  queue = places.filter((p) => failed.has(p.id));
}
console.log(`${queue.length}장 검사\n`);
fs.mkdirSync("tmp", { recursive: true });
const results = [];
for (const [i, p] of queue.entries()) {
  try {
    const res = await fetch(p.url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) { results.push({ ...p, error: `이미지 ${res.status}` }); console.log(`  ✗ ${p.name}: 이미지 ${res.status}`); continue; }
    const raw = Buffer.from(await res.arrayBuffer());
    // 원본을 그대로 보내면 토큰이 크다. 판정에 필요한 만큼만 줄인다.
    const src = `tmp/audit-${i}`;
    const out = `tmp/audit-${i}.jpg`;
    fs.writeFileSync(src, raw);
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "900", src, "--out", out], { stdio: "pipe" });
    const small = fs.readFileSync(out);
    fs.unlinkSync(src); fs.unlinkSync(out);

    const verdict = await classify(small, "image/jpeg");
    results.push({ ...p, ...verdict });
    const mark = verdict.usable ? "  " : "⚠️";
    console.log(`${mark} [${i + 1}/${queue.length}] ${p.name} — ${verdict.kind}${verdict.watermark && verdict.watermark !== "없음" ? ` · 워터마크 "${verdict.watermark}"` : ""}${verdict.faces ? ` · 얼굴 ${verdict.faces}명` : ""}`);
  } catch (err) {
    results.push({ ...p, error: err.message.slice(0, 120) });
    console.log(`  ✗ ${p.name}: ${err.message.slice(0, 90)}`);
  }
  await sleep(400);
}

let merged = results;
if (onlyFailed && fs.existsSync("tmp/사진감사.json")) {
  const prev = JSON.parse(fs.readFileSync("tmp/사진감사.json", "utf8"));
  const fresh = new Map(results.map((r) => [r.id, r]));
  merged = prev.map((r) => fresh.get(r.id) || r);
}
fs.writeFileSync("tmp/사진감사.json", JSON.stringify(merged, null, 2));
const results2 = merged;
const bad = results2.filter((r) => r.usable === false);
console.log(`\n쓸 수 있음 ${results2.filter((r) => r.usable).length} · 문제 ${bad.length} · 검사 실패 ${results2.filter((r) => r.error).length}`);
