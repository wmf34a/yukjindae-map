// 전국 공중화장실 중 "기저귀교환대가 있는 곳"만 뽑아 좌표를 붙인다.
//
//   node scripts/fetch-toilets.mjs            # tmp/화장실.json 생성
//   node scripts/fetch-toilets.mjs --upload   # 만들고 KV 에 올린다
//
// 왜 화장실 전부가 아니라 기저귀교환대만인가. 아이를 데리고 다닐 때 필요한 정보는
// "화장실이 어디 있나"가 아니라 "기저귀를 갈 수 있나"다. 전국 53,572곳 중 9,828곳뿐이라
// 지도에 그릴 양도 이쪽이 맞다.
//
// 아빠 관점이 하나 더 있다. 기저귀교환대의 절반 이상은 여자화장실에만 있다.
// 남자화장실에도 있는 곳은 4,049곳뿐이다 — 수유실의 "아빠 이용 가능"과 같은
// 이유로, 이걸 구분해서 표시해야 아빠가 헛걸음하지 않는다.
//
// 좌표는 우리가 붙인다. 표준데이터에 원래 WGS84 위경도가 있었는데 2025년 2월
// 원천데이터 정책이 바뀌어 제공이 중단됐다(공공데이터포털 안내). 그래서 주소를
// 카카오로 지오코딩한다. 이름으로 찾는 폴백은 두지 않는다 — 평택 솔숲근린공원이
// 전북 좌표로 잡히는 것을 확인했다. 좌표가 틀린 핀은 없느니만 못하다.

import fs from "node:fs";
import { loadVars, sleep } from "./lib/sources.mjs";
import { dadCanChange } from "../src/toilets.js";

/* oxlint-disable no-await-in-loop -- 카카오 호출량 때문에 순차로 돈다. */

const vars = loadVars();
const upload = process.argv.includes("--upload");

const CSV_URL = "https://file.localdata.go.kr/file/download/public_restroom_info/info";
// 이 UA/Referer 가 없으면 403 이다.
const CSV_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36",
  Referer: "https://file.localdata.go.kr/file/public_restroom_info/info",
};

// 한 줄씩 직접 자른다. 따옴표 안에 쉼표가 들어 있어 split(",") 로는 칸이 밀린다.
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function normalize(row) {
  const name = (row["화장실명"] || "").trim();
  const address = (row["소재지도로명주소"] || "").trim() || (row["소재지지번주소"] || "").trim();
  if (!name || !address) return null;
  return {
    name,
    address,
    jibun: (row["소재지지번주소"] || "").trim(),
    place: (row["기저귀교환대장소"] || "").trim(),
    dad: dadCanChange(row["기저귀교환대장소"]),
    hours: (row["개방시간상세"] || "").trim() || (row["개방시간"] || "").trim(),
    tel: (row["전화번호"] || "").trim(),
  };
}

async function geocode(query) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${vars.KAKAO_REST_API_KEY}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const hit = (data.documents || [])[0];
  if (!hit) return null;
  const lat = Number(hit.y);
  const lng = Number(hit.x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

console.log("CSV 내려받는 중...");
const csvRes = await fetch(CSV_URL, { headers: CSV_HEADERS });
if (!csvRes.ok) throw new Error(`CSV 다운로드 실패: ${csvRes.status}`);
// 표준데이터는 CP949 로 내려온다. UTF-8 로 읽으면 컬럼명부터 깨진다.
const csv = new TextDecoder("euc-kr").decode(await csvRes.arrayBuffer());
const lines = csv.split(/\r?\n/).filter((l) => l.trim());
const cols = parseCsvLine(lines[0]);
const all = lines.slice(1).map((l) => {
  const cells = parseCsvLine(l);
  return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
});
console.log(`전체 ${all.length}곳`);

const targets = all
  .filter((r) => r["기저귀교환대유무"] === "Y")
  .map(normalize)
  .filter(Boolean);
console.log(`기저귀교환대 있는 곳 ${targets.length}곳 (남자화장실 포함 ${targets.filter((t) => t.dad).length}곳)`);

// 이미 좌표를 구한 것은 다시 묻지 않는다. 주소는 거의 안 바뀌므로 다음 실행이
// 훨씬 짧아진다.
const CACHE_PATH = "tmp/화장실-좌표.json";
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};

const rooms = [];
let fresh = 0;
let failed = 0;
for (const [i, t] of targets.entries()) {
  let coords = cache[t.address];
  if (coords === undefined) {
    coords = await geocode(t.address);
    // 도로명이 "지하 168" 처럼 부실한 곳이 있어 지번으로 한 번 더 본다.
    if (!coords && t.jibun && t.jibun !== t.address) coords = await geocode(t.jibun);
    cache[t.address] = coords;
    fresh += 1;
    await sleep(40);
    if (fresh % 200 === 0) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
      console.log(`  ${i + 1}/${targets.length} (새로 ${fresh}건)`);
    }
  }
  if (!coords) { failed += 1; continue; }
  // jibun 은 좌표를 찾을 때만 쓰고 응답에는 넣지 않는다 — 도로명 주소로 충분하다.
  const { jibun: _jibun, ...rest } = t;
  rooms.push({ ...rest, lat: coords.lat, lng: coords.lng });
}
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
fs.writeFileSync("tmp/화장실.json", JSON.stringify(rooms));
console.log(`좌표 확보 ${rooms.length}곳 · 실패 ${failed}곳 · 새로 지오코딩 ${fresh}건`);

if (upload) {
  const { execFileSync } = await import("node:child_process");
  execFileSync("npx", ["wrangler", "kv", "key", "put", "toilets:changing", "--path", "tmp/화장실.json",
    "--binding", "RATE_LIMIT", "--remote"], { stdio: "inherit" });
  console.log("KV 업로드 완료");
}
