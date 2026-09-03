// 사람이 구해 온 장소 사진을 올린다.
//
//   node scripts/upload-photos.mjs <폴더>            # 미리보기
//   node scripts/upload-photos.mjs <폴더> --apply    # 반영
//
// 파일명이 장소명이면 알아서 짝을 맞춘다. 예) "담양 죽녹원.png"
//
// 공공 API 에 없는 곳은 결국 사람이 사진을 구해 와야 한다. 그때 R2 업로드와
// 노션 갱신을 손으로 하면 경로를 틀리기 쉽다 — 실제로 원더팜과 충북혁신도시
// 물놀이장이 places/ 가 빠진 주소로 저장돼 카드가 깨져 있었다.
//
// 올리기 전에 워터마크와 얼굴을 한 번 더 본다. 사람이 골라 온 사진이라도
// 기사에서 받아온 것이면 같은 문제가 반복된다.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadVars, sleep, notionHeaders, queryAll } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- R2 업로드와 노션 쓰기는 순차로 돈다. */

const vars = loadVars();
const dir = process.argv[2];
const apply = process.argv.includes("--apply");
const skipCheck = process.argv.includes("--skip-check");
if (!dir) {
  console.error("사용법: node scripts/upload-photos.mjs <폴더> [--apply] [--skip-check]");
  process.exit(1);
}
const BASE = "https://yukjindae-map.wmf34a.workers.dev";
const BUCKET = "yukjindae-map-images";
const H = notionHeaders(vars);
const CREDIT = process.env.PHOTO_CREDIT || "육진대 제공";

const PROMPT = `이 사진을 장소 소개 카드에 쓸 수 있는지 판단해라. JSON만 출력한다.
{"watermark":"없음 또는 글자","faces":얼굴이 또렷하게 식별되는 사람 수,"kind":"장소사진|안내도|행사사진|포스터|기타","usable":true/false,"why":"한 문장"}
usable=false 조건: 언론사 워터마크 / 얼굴이 또렷하게 식별되는 사람이 여럿 / 장소 사진이 아닌 안내도·포스터
멀리 찍혀 이목구비가 안 보이는 사람은 세지 않는다.`;

async function check(buf) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": vars.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-5", max_tokens: 700,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } },
        { type: "text", text: PROMPT },
      ] }],
    }),
  });
  if (!res.ok) return null;
  const text = ((await res.json()).content || []).map((c) => c.text || "").join("");
  const m = /\{[\s\S]*\}/.exec(text);
  return m ? JSON.parse(m[0]) : null;
}

const places = [];
for (const p of await queryAll(vars, vars.NOTION_DATABASE_ID)) {
  places.push({
    id: p.id,
    name: p.properties["장소명"]?.title?.[0]?.plain_text || "",
    credit: p.properties["사진출처"]?.rich_text?.map((t) => t.plain_text).join("") || "",
  });
}

// macOS 는 한글 파일명을 자모 분리(NFD)로 저장한다 — "농"이 ㄴ+ㅗ+ㅇ 세 글자다.
// 노션에서 온 "농"(한 글자)과 그대로 비교하면 열여섯 장이 모두 짝을 못 찾는다.
const norm = (s) => s.normalize("NFC").replace(/\s|\(.*?\)/g, "");
const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
console.log(`사진 ${files.length}장 · 장소 ${places.length}곳\n`);

fs.mkdirSync("tmp", { recursive: true });
const jobs = [];
for (const file of files) {
  const stem = path.basename(file).replace(/\.[^.]+$/, "");
  const key = norm(stem);
  const hit = places.find((p) => norm(p.name) === key)
    || places.find((p) => norm(p.name).includes(key) || key.includes(norm(p.name)));
  if (!hit) { console.log(`  ✗ ${stem} — 짝이 되는 장소를 못 찾음`); continue; }
  // 출처가 확실한 사진을 출처 모르는 사진으로 되돌리지 않는다.
  if (/한국관광공사|제주관광공사|서울시/.test(hit.credit) && !process.argv.includes("--overwrite-official")) {
    console.log(`  · ${stem} — 이미 ${hit.credit} 사진이 있어 건너뜀`);
    continue;
  }
  jobs.push({ file: path.join(dir, file), stem, ...hit });
  console.log(`  ✓ ${stem} → ${hit.name}`);
}

console.log(`\n짝 맞은 것 ${jobs.length}장`);
if (!jobs.length) process.exit(0);

let done = 0;
for (const j of jobs) {
  const out = `tmp/up-${j.id}.jpg`;
  // 카드에 쓸 크기로 줄인다. 원본 그대로 올리면 3MB 짜리가 섞인다.
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "900", j.file, "--out", out], { stdio: "pipe" });
  const buf = fs.readFileSync(out);

  if (!skipCheck) {
    const verdict = await check(buf);
    await sleep(300);
    if (verdict && !verdict.usable) {
      console.log(`⚠️ ${j.name} — ${verdict.kind}${verdict.watermark && verdict.watermark !== "없음" ? ` · 워터마크 "${verdict.watermark}"` : ""}${verdict.faces ? ` · 얼굴 ${verdict.faces}명` : ""}`);
      console.log(`   ${verdict.why} — 올리지 않았습니다. 확인 후 --skip-check 로 강행할 수 있습니다.`);
      fs.unlinkSync(out);
      continue;
    }
  }

  if (!apply) { console.log(`  · ${j.name} (${Math.round(buf.length / 1024)}KB) — 반영 대기`); fs.unlinkSync(out); continue; }

  execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/places/${j.id}.jpg`,
    "--file", out, "--content-type", "image/jpeg", "--remote"], { stdio: "pipe" });
  fs.unlinkSync(out);

  const patch = await fetch(`https://api.notion.com/v1/pages/${j.id}`, {
    method: "PATCH", headers: H,
    body: JSON.stringify({ properties: {
      "사진": { files: [{ type: "external", name: `${j.name}.jpg`, external: { url: `${BASE}/images/places/${j.id}.jpg` } }] },
      "사진출처": { rich_text: [{ text: { content: CREDIT } }] },
    } }),
  });
  if (patch.ok) { done += 1; console.log(`✓ ${j.name} (${Math.round(buf.length / 1024)}KB)`); }
  else console.log(`✗ ${j.name}: ${(await patch.text()).slice(0, 120)}`);
  await sleep(320);
}

if (apply) console.log(`\n${done}장 반영 (출처: ${CREDIT})`);
else console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙이세요.");
