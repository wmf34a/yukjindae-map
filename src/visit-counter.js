// 방문자 수를 센다.
//
// "오늘 몇 명"이 뜻이 있으려면 같은 사람이 하루에 다섯 번 열어도 한 명이어야 한다.
// 그래서 기기마다 임의의 ID를 만들어 브라우저에 저장해 두고, 그 ID로 하루 한 번만
// 센다. ID가 없으면(시크릿 창 등) IP 해시로 대신한다 — 다만 가족이 같은 와이파이를
// 쓰면 한 명으로 잡히니 기기 ID 쪽이 정확하다.
//
// 저장은 이미 있는 KV를 쓴다. 카운터를 한 키에 몰아 넣으면 KV가 같은 키에 초당 한 번만
// 쓰기를 허용해서, 사람이 몰리는 순간 숫자가 새어 나간다. 그래서 열 조각으로 나눠 두고
// 읽을 때 합친다.

export const SHARDS = 10;
// 어제 방문 기록은 이틀만 지나면 필요 없다. 오늘 이미 센 사람인지 가리는 용도뿐이다.
export const VISIT_TTL_SECONDS = 60 * 60 * 48;

export function todayInKst(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function visitKey(date, id) {
  return `visit:${date}:${id}`;
}

export function pickShard(id) {
  // ID 글자를 더해 조각을 고른다. 같은 사람은 늘 같은 조각으로 가서 읽기가 안정적이다.
  let sum = 0;
  for (const ch of String(id || "")) sum = (sum + ch.charCodeAt(0)) % 9973;
  return sum % SHARDS;
}

export function dayShardKey(date, shard) {
  return `count:day:${date}:s${shard}`;
}

export function totalShardKey(shard) {
  return `count:total:s${shard}`;
}

export function sumValues(values) {
  return (values || []).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

/**
 * 오늘 처음 온 사람이면 숫자를 올린다.
 *
 * @param {object} kv Cloudflare KV 네임스페이스
 * @param {string} id 기기 ID 또는 IP 해시
 * @param {string} date YYYY-MM-DD (한국 기준)
 * @returns {Promise<boolean>} 이번에 새로 셌으면 true
 */
export async function countVisit(kv, id, date) {
  if (!kv || !id) return false;
  const seenKey = visitKey(date, id);
  if (await kv.get(seenKey)) return false;

  const shard = pickShard(id);
  // 먼저 "봤다"고 적어 둔다. 여기서 실패하면 숫자를 올리지 않으므로 부풀지 않는다.
  await kv.put(seenKey, "1", { expirationTtl: VISIT_TTL_SECONDS });

  const dayKey = dayShardKey(date, shard);
  const totalKey = totalShardKey(shard);
  const [day, total] = await Promise.all([kv.get(dayKey), kv.get(totalKey)]);
  await Promise.all([
    kv.put(dayKey, String((Number(day) || 0) + 1), { expirationTtl: VISIT_TTL_SECONDS * 15 }),
    kv.put(totalKey, String((Number(total) || 0) + 1)),
  ]);
  return true;
}

// 무료 플랜 KV는 하루 1,000회만 쓸 수 있다. 새 방문자 한 명에 put이 세 번(봤다 표시,
// 오늘 카운터, 누적 카운터) 나가므로 300명대에서 하루치를 다 쓴다 — 오픈 첫날 30분
// 만에 소진됐고, 같은 KV를 쓰는 남용 방지 카운터까지 같이 죽었다.
//
// 그래서 표본만 센다. 기기 ID로 조각을 골라 일부만 실제로 세고, 읽을 때 배수를 곱해
// 되돌린다. 같은 사람은 늘 같은 조각이라 "세는 사람"이 날마다 바뀌지 않는다.
export const SAMPLE_DENOMINATOR = 5;

export function isSampled(id) {
  return pickShard(id) % SAMPLE_DENOMINATOR === 0;
}

/**
 * 표본만 세는 방문 집계. 세지 않기로 한 사람에게는 KV 쓰기가 한 번도 나가지 않는다.
 */
export async function countVisitSampled(kv, id, date) {
  if (!kv || !id) return false;
  if (!isSampled(id)) return false;
  return countVisit(kv, id, date);
}

export async function readStats(kv, date) {
  if (!kv) return { today: 0, total: 0 };
  const shards = Array.from({ length: SHARDS }, (_, i) => i);
  const [days, totals] = await Promise.all([
    Promise.all(shards.map((s) => kv.get(dayShardKey(date, s)))),
    Promise.all(shards.map((s) => kv.get(totalShardKey(s)))),
  ]);
  return { today: sumValues(days), total: sumValues(totals) };
}
