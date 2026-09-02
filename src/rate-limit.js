// /api/geocode, /api/nearby-place, /api/directions는 우리 네이버 API 키로 외부
// 유료 API를 호출해주는 프록시라, 인증 없이 열어두면 제3자가 그대로 호출해 우리
// 일일 쿼터(지역검색 25,000회/일 등)를 태울 수 있다. 제보(/api/reports)에 쓰던
// IP 기준 카운터를 일반화해서 프록시 엔드포인트에도 씌운다.
//
// KV는 최종적 일관성이라 동시 요청에서 카운트가 조금 새는 건 감수한다 — 목적이
// 정밀 과금 제어가 아니라 "한 IP가 무한정 긁어가는 것"을 막는 것이기 때문.

export const PROXY_RATE_LIMIT_PER_MINUTE = 30;
export const REPORT_RATE_LIMIT_PER_HOUR = 5;

// 사람 확인(Turnstile)을 못 거친 제보. 광고 차단으로 스크립트가 안 실리는 브라우저가
// 있어 아예 막지는 않되, 확인된 제보보다는 좁게 받는다. 제보는 승인 큐로만 들어가고
// 사람이 다 읽으므로 여기서 새는 비용은 "운영자가 스팸을 몇 건 더 본다" 정도다.
export const UNVERIFIED_REPORT_RATE_LIMIT_PER_HOUR = 2;

/**
 * 제보 한 건에 적용할 시간당 허용량과 카운터 이름.
 *
 * 사람 확인을 거친 제보와 못 거친 제보를 따로 센다. 카운터를 나누지 않으면
 * 확인된 제보가 확인 안 된 제보 몫까지 같이 깎는다.
 */
export function reportQuota({ verified }) {
  if (verified) return { scope: "report", limit: REPORT_RATE_LIMIT_PER_HOUR };
  return { scope: "report-unverified", limit: UNVERIFIED_REPORT_RATE_LIMIT_PER_HOUR };
}

async function shortHash(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

// IP 자체는 저장하지 않고 해시만 남긴다 — 남용 차단용이지 개인 식별용이 아님.
export async function hashIp(ip) {
  return shortHash(ip || "unknown");
}

// 프록시 남용 방지는 Cache API 로 센다.
//
// KV 로 세던 시절, 이 카운터 하나가 무료 플랜의 하루 쓰기 한도(1,000회)를 절반
// 넘게 먹었다. 장소 상세를 열 때마다 근처 맛집·카페 조회가 나가므로 방문자가
// 수백 명이면 쓰기도 수백 번이다. 한도를 넘기면 put 이 throw 하고, 같은 KV 를
// 쓰는 방문자 집계까지 함께 멈춘다.
//
// Cache API 는 쓰기 한도가 없다. 대신 엣지마다 따로 세므로 정확한 총합이 아니다.
// 그래도 이 카운터의 목적은 "한 IP 가 우리 네이버 쿼터를 태우는 것"을 막는 것이라,
// 엣지별 근사로 충분하다 — 여러 엣지에 나눠 때리려면 그만큼 여러 지역에서
// 접속해야 하고, 그건 이 앱이 상대할 규모의 남용이 아니다.
export async function consumeProxyLimit({ scope, ip, limit, windowSeconds }) {
  if (typeof caches === "undefined" || !caches.default) return true;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = new Request(`https://rate-limit.internal/${scope}/${await hashIp(ip)}/${bucket}`);
  const cache = caches.default;
  let count = 0;
  try {
    const hit = await cache.match(key);
    if (hit) count = Number(await hit.text()) || 0;
  } catch {
    return true; // 못 읽으면 세지 못할 뿐이다. 막을 근거가 없다.
  }
  if (count >= limit) return false;
  try {
    await cache.put(key, new Response(String(count + 1), {
      headers: { "cache-control": `max-age=${windowSeconds}` },
    }));
  } catch {
    // 세지 못해도 요청은 살린다. KV 시절과 같은 이유다.
  }
  return true;
}

export async function consumeRateLimit(env, { scope, ip, limit, windowSeconds }) {
  if (!env.RATE_LIMIT) return true; // KV 미바인딩 환경(로컬 등)에서는 통과시킨다.

  const key = `${scope}:${await hashIp(ip)}`;
  let count = 0;
  try {
    const raw = await env.RATE_LIMIT.get(key);
    count = raw ? parseInt(raw, 10) : 0;
  } catch {
    return true; // KV를 못 읽으면 세지 못할 뿐이다. 막을 근거가 없으니 통과시킨다.
  }
  if (count >= limit) return false;
  try {
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: windowSeconds });
  } catch (err) {
    // KV 일일 쓰기 한도를 넘기면 put이 throw 한다. 여기서 터지면 남용 방지 장치가
    // 서비스 자체를 멈춰 세운다 — 실제로 오픈 첫날 근처 맛집·카페 조회가 전부
    // 500으로 떨어졌다. 카운트를 못 올리는 건 감수하고 요청은 살린다.
    console.warn(`남용 방지 카운트 실패(${scope}): ${err.message}`);
  }
  return true;
}

export function tooManyRequestsResponse(message = "요청이 너무 많아요. 잠시 후 다시 시도해주세요.") {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
    },
  });
}
