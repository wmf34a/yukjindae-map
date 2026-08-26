// /api/geocode, /api/nearby-place, /api/directions는 우리 네이버 API 키로 외부
// 유료 API를 호출해주는 프록시라, 인증 없이 열어두면 제3자가 그대로 호출해 우리
// 일일 쿼터(지역검색 25,000회/일 등)를 태울 수 있다. 제보(/api/reports)에 쓰던
// IP 기준 카운터를 일반화해서 프록시 엔드포인트에도 씌운다.
//
// KV는 최종적 일관성이라 동시 요청에서 카운트가 조금 새는 건 감수한다 — 목적이
// 정밀 과금 제어가 아니라 "한 IP가 무한정 긁어가는 것"을 막는 것이기 때문.

export const PROXY_RATE_LIMIT_PER_MINUTE = 30;
export const REPORT_RATE_LIMIT_PER_HOUR = 5;

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

export async function consumeRateLimit(env, { scope, ip, limit, windowSeconds }) {
  if (!env.RATE_LIMIT) return true; // KV 미바인딩 환경(로컬 등)에서는 통과시킨다.

  const key = `${scope}:${await hashIp(ip)}`;
  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: windowSeconds });
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
