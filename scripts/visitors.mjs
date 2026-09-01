// 날짜별 방문자 수를 본다.
//
//   node scripts/visitors.mjs           # 최근 30일
//   node scripts/visitors.mjs --days 7  # 최근 7일
//   node scripts/visitors.mjs --hourly  # 어제를 시간대별로
//
// 앱은 방문을 Analytics Engine 에 하나씩 적어 둔다(worker.js handleVisit).
// 여기서는 그걸 날짜별로 세어 본다. 같은 사람이 여러 번 와도 기기 ID 로 묶어
// 하루 한 명으로 센다.
//
// 화면에 뜨는 숫자(KV 카운터)는 다섯 명 중 한 명만 세는 표본이라 어림값이지만,
// 여기 값은 전수라 정확하다. Cloudflare 가 3개월치를 들고 있다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ACCOUNT_ID = "4f082846f63415e0d1300ec9c6e5c6cb";
const DATASET = "yukjindae_visits";

const args = process.argv.slice(2);
const hourly = args.includes("--hourly");
const daysIdx = args.indexOf("--days");
const days = daysIdx === -1 ? 30 : Number(args[daysIdx + 1]) || 30;

// wrangler 가 로그인할 때 받아 둔 토큰을 그대로 쓴다 — 조회 전용으로 토큰을
// 따로 발급받지 않아도 되게.
function readToken() {
  const candidates = [
    path.join(os.homedir(), "Library/Preferences/.wrangler/config/default.toml"),
    path.join(os.homedir(), ".wrangler/config/default.toml"),
    path.join(os.homedir(), ".config/.wrangler/config/default.toml"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const found = /oauth_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(file, "utf8"));
    if (found) return found[1];
  }
  return process.env.CLOUDFLARE_API_TOKEN || "";
}

async function query(sql) {
  const token = readToken();
  if (!token) {
    console.error("Cloudflare 토큰을 찾지 못했습니다. `npx wrangler login` 을 먼저 하세요.");
    process.exit(1);
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`조회 실패 (${res.status}): ${text.slice(0, 300)}`);
    process.exit(1);
  }
  return JSON.parse(text);
}

function bar(n, max) {
  return "█".repeat(Math.max(1, Math.round((n / Math.max(max, 1)) * 40)));
}

if (hourly) {
  // 어제(한국 기준)를 시간대별로. blob1 이 한국 날짜라 그대로 고르면 된다.
  const yesterday = new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  const rows = (await query(`
    SELECT toHour(toDateTime(timestamp + 32400)) AS hour,
           COUNT(DISTINCT blob2) AS visitors,
           SUM(_sample_interval) AS visits
    FROM ${DATASET}
    WHERE blob1 = '${yesterday}'
    GROUP BY hour ORDER BY hour
  `)).data || [];
  if (rows.length === 0) {
    console.log(`${yesterday} 기록이 없습니다.`);
    process.exit(0);
  }
  const max = Math.max(...rows.map((r) => Number(r.visitors)));
  console.log(`${yesterday} 시간대별 (한국 시간)\n`);
  for (const r of rows) {
    console.log(`  ${String(r.hour).padStart(2, "0")}시  ${String(r.visitors).padStart(5)}명  ${bar(Number(r.visitors), max)}`);
  }
  process.exit(0);
}

const rows = (await query(`
  SELECT blob1 AS day,
         COUNT(DISTINCT blob2) AS visitors,
         SUM(_sample_interval) AS visits
  FROM ${DATASET}
  WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
  GROUP BY day ORDER BY day
`)).data || [];

if (rows.length === 0) {
  console.log("아직 기록이 없습니다. 앱에 한 번 들어갔다 오면 쌓이기 시작합니다.");
  process.exit(0);
}

const max = Math.max(...rows.map((r) => Number(r.visitors)));
console.log(`날짜        방문자   열어본 횟수\n${"─".repeat(46)}`);
for (const r of rows) {
  const v = Number(r.visitors);
  console.log(`${r.day}  ${String(v).padStart(6)}  ${String(Math.round(Number(r.visits))).padStart(8)}   ${bar(v, max)}`);
}
const total = rows.reduce((a, r) => a + Number(r.visitors), 0);
console.log(`${"─".repeat(46)}\n${rows.length}일 합계 ${total.toLocaleString()}명 (같은 날 중복은 뺀 값, 날짜별로는 다시 셈)`);
