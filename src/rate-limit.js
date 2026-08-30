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

// 검수용 링크를 가진 지역장. 한 장소를 훑으면 고칠 것이 여러 개 나오는 게 정상이라
// 시간당 5건은 너무 좁다 — 실제로 한 분이 다섯 건을 이어 보내다 막혀서
// "잠시 후 다시 시도해주세요"만 보고 손을 놓으셨다.
//
// 토큰을 가진 사람은 우리가 이름을 아는 소수라 크게 열어도 된다. 그래도 상한을
// 두는 이유는 링크가 새어 나갔을 때를 대비해서다.
export const REVIEWER_REPORT_RATE_LIMIT_PER_HOUR = 60;

/**
 * 제보 한 건에 적용할 시간당 허용량과 카운터 이름.
 *
 * 셋을 따로 센다. 지역장은 넉넉히, 사람 확인을 거친 익명 제보는 보통,
 * 확인을 못 거친 제보는 좁게. 카운터를 나누지 않으면 지역장이 쓴 건수가
 * 익명 제보 몫까지 같이 깎는다.
 */
export function reportQuota({ reviewer, verified }) {
  if (reviewer) return { scope: "report-reviewer", limit: REVIEWER_REPORT_RATE_LIMIT_PER_HOUR };
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
