// 방문자 수를 Analytics Engine 에서 읽어 온다.
//
// 화면에 뜨는 숫자를 만드는 곳이다. 예전에는 KV 카운터가 이 일을 했는데, 무료
// 플랜의 하루 쓰기 한도(1,000회)를 오픈 첫날 30분 만에 소진해 그날 오후 방문자를
// 통째로 놓쳤다. 다섯 명 중 한 명만 세는 표본으로 바꿔 버텼지만 그건 어림값이다.
//
// 지금은 방문 하나하나를 Analytics Engine 에 적어 두고(worker.js handleVisit),
// 여기서 SQL 로 세어 정확한 숫자를 낸다. 요청마다 SQL 을 부르면 느리므로 10분마다
// 도는 크론이 미리 계산해 KV 에 넣어 두고, 화면은 그 값을 읽는다 — KV 쓰기가
// 하루 144번뿐이라 한도에 걸릴 일이 없다.

export const STATS_KV_KEY = "visit:stats";
export const ACCOUNT_ID = "4f082846f63415e0d1300ec9c6e5c6cb";
export const DATASET = "yukjindae_visits";

// Analytics Engine 을 붙이기 전, 전수로 세어 둔 누적. 여기에는 표본 배수를 곱하면
// 안 된다(그렇게 곱했다가 267명이 1,335명으로 보였다).
export const TOTAL_BASELINE = 267;
// 그 기준선을 쌓은 마지막 날. 이 날까지는 KV 가, 다음 날부터는 Analytics Engine 이
// 센다. 둘을 더해야 전체 누적이 된다.
export const BASELINE_UNTIL = "2026-09-01";

export function todayInKst(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function runSql(token, sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: sql, signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error(`SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data || [];
}

/**
 * 오늘과 누적 방문자를 센다. 같은 사람이 여러 번 와도 기기 ID 로 묶어 하루 한 명이다.
 *
 * @param {string} token Account Analytics 읽기 권한 토큰
 * @param {string} today YYYY-MM-DD (한국 기준)
 */
export async function countVisitors(token, today) {
  const [todayRows, totalRows] = await Promise.all([
    runSql(token, `SELECT COUNT(DISTINCT blob2) AS n FROM ${DATASET} WHERE blob1 = '${today}'`),
    runSql(token, `SELECT COUNT(DISTINCT blob2) AS n FROM ${DATASET} WHERE blob1 > '${BASELINE_UNTIL}'`),
  ]);
  const todayCount = Number(todayRows[0]?.n) || 0;
  const sinceBaseline = Number(totalRows[0]?.n) || 0;
  return { today: todayCount, total: TOTAL_BASELINE + sinceBaseline, date: today };
}

/** 크론이 부른다 — 세어서 KV 에 넣어 둔다. */
export async function refreshVisitStats(env, now = new Date()) {
  if (!env.CF_ANALYTICS_TOKEN || !env.RATE_LIMIT) return null;
  const stats = await countVisitors(env.CF_ANALYTICS_TOKEN, todayInKst(now));
  await env.RATE_LIMIT.put(STATS_KV_KEY, JSON.stringify({ ...stats, at: now.toISOString() }));
  return stats;
}

/** 화면이 부른다 — 크론이 넣어 둔 값을 읽는다. */
export async function readVisitStats(env, now = new Date()) {
  const today = todayInKst(now);
  if (!env.RATE_LIMIT) return { today: 0, total: TOTAL_BASELINE, stale: true };
  let saved;
  try {
    saved = JSON.parse((await env.RATE_LIMIT.get(STATS_KV_KEY)) || "null");
  } catch {
    saved = null;
  }
  if (!saved) return { today: 0, total: TOTAL_BASELINE, stale: true };
  // 날짜가 넘어갔는데 아직 크론이 안 돌았으면 오늘 수는 0으로 보여준다 — 어제 값을
  // 오늘 것처럼 보여주는 것보다 낫다.
  if (saved.date !== today) return { today: 0, total: saved.total, stale: true };
  return { today: saved.today, total: saved.total, stale: false };
}
