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

export async function readStats(kv, date) {
  if (!kv) return { today: 0, total: 0 };
  const shards = Array.from({ length: SHARDS }, (_, i) => i);
  const [days, totals] = await Promise.all([
    Promise.all(shards.map((s) => kv.get(dayShardKey(date, s)))),
    Promise.all(shards.map((s) => kv.get(totalShardKey(s)))),
  ]);
  return { today: sumValues(days), total: sumValues(totals) };
}
