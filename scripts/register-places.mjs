// 검수를 마친 후보를 Notion 장소 DB에 등록한다.
//
//   node scripts/register-places.mjs tmp/<지역>-후보.json [--publish]
//
// 기본은 공개여부=false 로 만든다. 앱에 바로 노출하지 않고 한 번 더 눈으로 보기 위함이다.
// 사진은 TourAPI 원본을 그대로 걸지 않고 R2로 미러링한다 — TourAPI 이미지는 핫링크가
// 막혀 있어 curl 로는 200이 와도 브라우저에서는 ERR_FAILED 로 죽는다.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadVars, sleep, notionHeaders } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- Notion 쓰기는 초당 3건 제한이 있어 일부러 순차로 돈다. */

const vars = loadVars();
const BASE = "https://yukjindae-map.wmf34a.workers.dev";
const BUCKET = "yukjindae-map-images";
const headers = notionHeaders(vars);
const rt = (s) => (s ? [{ text: { content: String(s).slice(0, 2000) } }] : []);

const file = process.argv[2];
const publish = process.argv.includes("--publish");
if (!file) {
  console.error("사용법: node scripts/register-places.mjs tmp/<지역>-후보.json [--publish]");
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(file, "utf8"));

async function createPage(p) {
  const props = {
    "장소명": { title: [{ text: { content: p["장소명"] } }] },
    "지역": { select: { name: p["지역"] } },
    "주소": { rich_text: rt(p["주소"]) },
    "위도": { number: p["위도"] },
    "경도": { number: p["경도"] },
    "운영시간": { rich_text: rt(p["운영시간"]) },
    "입장료": { rich_text: rt(p["입장료"]) },
    "무료입장연령": { rich_text: rt(p["무료입장연령"]) },
    "주차가능여부": { select: { name: p["주차가능여부"] } },
    // 후보 파일에 요금까지 채워 두고도 여기서 안 써서 통째로 버려지고 있었다.
    // 자연휴양림 여섯 곳의 주차 요금이 그렇게 사라졌다.
    "주차상세": { rich_text: rt(p["주차상세"]) },
    "추천이유": { rich_text: rt(p["추천이유"]) },
    "근처맛집": { rich_text: rt(p["근처맛집"]) },
    "근처카페": { rich_text: rt(p["근처카페"]) },
    "확인상태": { select: { name: p["확인상태"] } },
    "정보확인일": { date: { start: p["정보확인일"] } },
    "등록자": { rich_text: rt("공공데이터 자동 발굴") },
    "사진출처": { rich_text: rt(p["사진출처"]) },
    "공개여부": { checkbox: publish },
  };
  if (p["카테고리"]?.length) props["카테고리"] = { multi_select: p["카테고리"].map((n) => ({ name: n })) };
  if (p["정보출처"]) props["정보출처"] = { url: p["정보출처"] };

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST", headers,
    body: JSON.stringify({ parent: { database_id: vars.NOTION_DATABASE_ID }, properties: props }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 250));
  return data.id;
}

// 원본을 받아 R2에 올리고, Notion 사진 속성을 우리 도메인 URL로 건다.
async function mirrorImage(pageId, name, sourceUrl) {
  const ext = (sourceUrl.split("?")[0].split(".").pop() || "jpg").toLowerCase();
  const key = `places/${pageId}.${ext}`;
  const tmp = `tmp/${pageId}.${ext}`;

  const res = await fetch(sourceUrl, { headers: { "User-Agent": "yukjindae-map-bot/1.0" } });
  if (!res.ok) throw new Error(`이미지 다운로드 실패 ${res.status}`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));

  execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`,
    "--file", tmp, "--content-type", `image/${ext === "jpg" ? "jpeg" : ext}`, "--remote"],
    { stdio: "pipe" });
  fs.unlinkSync(tmp);

  const url = `${BASE}/images/${key}`;
  const patch = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH", headers,
    body: JSON.stringify({ properties: { "사진": { files: [{ type: "external", name: `${name}.${ext}`, external: { url } }] } } }),
  });
  if (!patch.ok) throw new Error((await patch.text()).slice(0, 200));
  return url;
}

fs.mkdirSync("tmp", { recursive: true });
let ok = 0;
for (const entry of entries) {
  const p = entry.record || entry;
  try {
    const pageId = await createPage(p);
    let photo = "";
    if (p["사진"]) {
      try { photo = await mirrorImage(pageId, p["장소명"], p["사진"]); }
      catch (err) { console.log(`  · ${p["장소명"]} 사진 실패: ${err.message}`); }
    }
    ok += 1;
    console.log(`✓ ${p["장소명"]}${photo ? " (사진 미러링 완료)" : ""}`);
  } catch (err) {
    console.log(`✗ ${p["장소명"]}: ${err.message}`);
  }
  await sleep(350);
}
console.log(`\n${ok}/${entries.length}곳 등록 (공개여부=${publish})`);
