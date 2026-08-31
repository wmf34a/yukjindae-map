// 감사에서 걸러진 사진을 공공 출처 사진으로 바꾼다.
//
//   node scripts/audit-photos.mjs --no-credit   # 먼저 감사
//   node scripts/replace-photos.mjs             # 미리보기
//   node scripts/replace-photos.mjs --apply     # 반영
//
// 사진을 지우지는 않는다. 대체할 것을 찾았을 때만 바꾸고, 못 찾은 곳은
// tmp/사진필요.md 로 따로 남긴다 — 사진 없는 카드보다는 있는 편이 낫고,
// 무엇을 새로 찍어야 하는지는 사람이 알아야 한다.
//
// 출처는 반드시 함께 적는다. 출처를 안 적고 넣은 사진 무리에서 문제가 났다.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadVars, sleep, clean, tourApi } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- TourAPI 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const tour = tourApi(vars.TOUR_API_KEY);
const BASE = "https://yukjindae-map.wmf34a.workers.dev";
const BUCKET = "yukjindae-map-images";
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};

const audit = JSON.parse(fs.readFileSync("tmp/사진감사.json", "utf8"));
// 검사 자체가 실패한 것(이미지 404 등)도 대체 대상이다.
const targets = audit.filter((r) => r.usable === false || r.error);
console.log(`대체가 필요한 곳 ${targets.length}\n`);

// 이름이 조금씩 달라 한 번에 못 찾는다. 괄호와 지역 접두어를 떼며 넓혀 간다.
function nameVariants(name) {
  const base = name.replace(/\s*\([^)]*\)\s*/g, "").trim();
  const out = [base];
  const sp = base.indexOf(" ");
  if (sp > 0 && base.length - sp - 1 >= 4) out.push(base.slice(sp + 1));
  return [...new Set(out)];
}

async function findPhotos(name) {
  for (const q of nameVariants(name)) {
    const list = tour.items(await tour.call("searchKeyword2", { keyword: q, numOfRows: "8", pageNo: "1" }));
    await sleep(180);
    const key = name.replace(/\s|\(.*\)/g, "");
    for (const it of list) {
      const t = clean(it.title).replace(/\s/g, "");
      if (!(t.includes(key) || key.includes(t))) continue;
      const imgs = tour.items(await tour.call("detailImage2", { contentId: it.contentid, imageYN: "Y", numOfRows: "20", pageNo: "1" }));
      await sleep(180);
      const urls = imgs.map((x) => x.originimgurl).filter(Boolean);
      if (it.firstimage) urls.unshift(it.firstimage);
      if (urls.length) return { title: clean(it.title), urls: [...new Set(urls)] };
    }
  }
  return null;
}

fs.mkdirSync("tmp", { recursive: true });
const replaced = [];
const unresolved = [];
for (const t of targets) {
  const found = await findPhotos(t.name);
  if (!found) { unresolved.push(t); console.log(`  · ${t.name} — 대체 사진 없음`); continue; }
  console.log(`  ✓ ${t.name} — ${found.title}에서 ${found.urls.length}장`);
  replaced.push({ ...t, candidate: found.urls[0], all: found.urls });
}

console.log(`\n찾음 ${replaced.length} · 못 찾음 ${unresolved.length}`);

const lines = ["# 사진을 새로 구해야 하는 곳", "",
  "아래는 지금 사진에 문제가 있는데(언론사 워터마크·얼굴 노출·안내도) 공공 API 에서",
  "대체 사진을 못 찾은 곳이다. 사진은 지우지 않았다 — 그대로 두면 저작권·초상권",
  "문제가 남으므로, 지역장 촬영본이나 시설 공식 사진을 받아 바꿔야 한다.", ""];
for (const u of unresolved) {
  lines.push(`- **${u.name}** — ${u.error ? `이미지 오류(${u.error})` : `${u.kind}${u.watermark && u.watermark !== "없음" ? ` · 워터마크 "${u.watermark}"` : ""}${u.faces ? ` · 얼굴 ${u.faces}명` : ""}`}`);
  if (u.why) lines.push(`  - ${u.why}`);
}
fs.writeFileSync("tmp/사진필요.md", lines.join("\n"));
console.log("못 찾은 곳 목록 → tmp/사진필요.md");

if (!apply) { console.log("\n미리보기만 했습니다. 반영하려면 --apply 를 붙이세요."); process.exit(0); }

let done = 0;
for (const r of replaced) {
  try {
    const res = await fetch(r.candidate, { headers: { "User-Agent": "yukjindae-map-bot/1.0" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) { console.log(`✗ ${r.name}: 내려받기 ${res.status}`); continue; }
    const raw = Buffer.from(await res.arrayBuffer());
    const src = `tmp/rep-${r.id}`;
    const out = `tmp/rep-${r.id}.jpg`;
    fs.writeFileSync(src, raw);
    // 카드에 쓸 크기로 줄인다. 원본 그대로 두면 3MB 짜리가 섞인다.
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "900", src, "--out", out], { stdio: "pipe" });
    execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/places/${r.id}.jpg`,
      "--file", out, "--content-type", "image/jpeg", "--remote"], { stdio: "pipe" });
    fs.unlinkSync(src); fs.unlinkSync(out);

    const patch = await fetch(`https://api.notion.com/v1/pages/${r.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ properties: {
        "사진": { files: [{ type: "external", name: `${r.name}.jpg`, external: { url: `${BASE}/images/places/${r.id}.jpg` } }] },
        "사진출처": { rich_text: [{ text: { content: "한국관광공사" } }] },
      } }),
    });
    if (patch.ok) { done += 1; console.log(`✓ ${r.name}`); }
    else console.log(`✗ ${r.name}: ${(await patch.text()).slice(0, 120)}`);
    await sleep(320);
  } catch (err) {
    console.log(`✗ ${r.name}: ${err.message.slice(0, 90)}`);
  }
}
console.log(`\n${done}곳 사진 교체 (출처: 한국관광공사)`);
