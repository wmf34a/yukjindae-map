import { describe, it, expect, beforeEach } from "vitest";
import {
  consumeRateLimit,
  hashIp,
  tooManyRequestsResponse,
  PROXY_RATE_LIMIT_PER_MINUTE,
  reportQuota,
  REPORT_RATE_LIMIT_PER_HOUR,
  UNVERIFIED_REPORT_RATE_LIMIT_PER_HOUR,
  REVIEWER_REPORT_RATE_LIMIT_PER_HOUR,
} from "./rate-limit.js";

// KV 바인딩을 흉내내는 최소 구현 — put/get만 쓰므로 TTL은 기록만 해둔다.
function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key).value : null;
    },
    async put(key, value, opts) {
      store.set(key, { value, ttl: opts?.expirationTtl });
    },
  };
}

describe("hashIp", () => {
  it("IP 원문이 아니라 짧은 해시를 만든다", async () => {
    const hash = await hashIp("203.0.113.42");
    expect(hash).toHaveLength(10);
    expect(hash).not.toContain("203.0.113.42");
  });

  it("같은 IP는 항상 같은 해시가 된다", async () => {
    expect(await hashIp("203.0.113.42")).toBe(await hashIp("203.0.113.42"));
  });

  it("다른 IP는 다른 해시가 된다", async () => {
    expect(await hashIp("203.0.113.42")).not.toBe(await hashIp("203.0.113.43"));
  });
});

// 카운터를 순서대로 올리는 게 테스트의 핵심이라 병렬화하면 의미가 없다.
/* oxlint-disable no-await-in-loop */
describe("consumeRateLimit", () => {
  let env;
  beforeEach(() => {
    env = { RATE_LIMIT: fakeKv() };
  });

  it("한도 안에서는 통과시킨다", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await consumeRateLimit(env, { scope: "proxy", ip: "1.1.1.1", limit: 3, windowSeconds: 60 })).toBe(true);
    }
  });

  it("한도를 넘으면 막는다", async () => {
    for (let i = 0; i < 3; i++) {
      await consumeRateLimit(env, { scope: "proxy", ip: "1.1.1.1", limit: 3, windowSeconds: 60 });
    }
    expect(await consumeRateLimit(env, { scope: "proxy", ip: "1.1.1.1", limit: 3, windowSeconds: 60 })).toBe(false);
  });

  it("IP가 다르면 카운터를 공유하지 않는다", async () => {
    for (let i = 0; i < 3; i++) {
      await consumeRateLimit(env, { scope: "proxy", ip: "1.1.1.1", limit: 3, windowSeconds: 60 });
    }
    expect(await consumeRateLimit(env, { scope: "proxy", ip: "2.2.2.2", limit: 3, windowSeconds: 60 })).toBe(true);
  });

  // 프록시 남용 차단과 제보 스팸 차단은 한도/주기가 달라 서로 간섭하면 안 된다.
  it("scope가 다르면 카운터를 공유하지 않는다", async () => {
    await consumeRateLimit(env, { scope: "proxy", ip: "1.1.1.1", limit: 1, windowSeconds: 60 });
    expect(await consumeRateLimit(env, { scope: "report", ip: "1.1.1.1", limit: 1, windowSeconds: 3600 })).toBe(true);
  });

  it("KV에 IP 원문을 저장하지 않는다", async () => {
    await consumeRateLimit(env, { scope: "proxy", ip: "203.0.113.42", limit: 5, windowSeconds: 60 });
    const keys = [...env.RATE_LIMIT.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("203.0.113.42");
    expect(keys[0]).toMatch(/^proxy:[0-9a-f]{10}$/);
  });

  it("만료 TTL을 창 길이로 지정한다", async () => {
    await consumeRateLimit(env, { scope: "proxy", ip: "1.1.1.1", limit: 5, windowSeconds: 60 });
    expect([...env.RATE_LIMIT.store.values()][0].ttl).toBe(60);
  });

  // 로컬 개발(wrangler dev)에서는 KV 바인딩이 없을 수 있는데, 그때 기능이 통째로
  // 막히면 안 된다.
  it("KV 바인딩이 없으면 통과시킨다", async () => {
    expect(await consumeRateLimit({}, { scope: "proxy", ip: "1.1.1.1", limit: 1, windowSeconds: 60 })).toBe(true);
  });
});

/* oxlint-enable no-await-in-loop */

describe("tooManyRequestsResponse", () => {
  it("429와 retry-after를 함께 준다", async () => {
    const res = tooManyRequestsResponse();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await res.json()).error).toMatch(/너무 많아요/);
  });
});

describe("기본 한도값", () => {
  // 코스 하나를 열면 구간 수만큼 /api/directions를 호출한다(정류장 6곳 → 5회).
  // 정상 사용이 걸리지 않을 만큼은 넉넉해야 한다.
  it("프록시 분당 한도가 코스 하나 열기보다 충분히 크다", () => {
    expect(PROXY_RATE_LIMIT_PER_MINUTE).toBeGreaterThanOrEqual(20);
  });
});

describe("reportQuota", () => {
  // 검수 중인 지역장이 한 장소에서 다섯 건을 이어 보내다 막혔다. 화면에는
  // "잠시 후 다시 시도해주세요"만 떠서 고장인지 제한인지 알 수 없었다.
  it("지역장은 넉넉히 받는다", () => {
    expect(reportQuota({ reviewer: true, verified: true }))
      .toEqual({ scope: "report-reviewer", limit: REVIEWER_REPORT_RATE_LIMIT_PER_HOUR });
    expect(REVIEWER_REPORT_RATE_LIMIT_PER_HOUR).toBeGreaterThan(REPORT_RATE_LIMIT_PER_HOUR);
  });

  it("사람 확인을 거친 익명 제보는 보통", () => {
    expect(reportQuota({ reviewer: false, verified: true }))
      .toEqual({ scope: "report", limit: REPORT_RATE_LIMIT_PER_HOUR });
  });

  it("확인을 못 거친 제보는 좁게", () => {
    expect(reportQuota({ reviewer: false, verified: false }))
      .toEqual({ scope: "report-unverified", limit: UNVERIFIED_REPORT_RATE_LIMIT_PER_HOUR });
  });

  // 카운터를 나누지 않으면 지역장이 쓴 건수가 익명 제보 몫까지 깎는다.
  it("세 종류가 서로 다른 카운터를 쓴다", () => {
    const scopes = [
      reportQuota({ reviewer: true, verified: true }).scope,
      reportQuota({ reviewer: false, verified: true }).scope,
      reportQuota({ reviewer: false, verified: false }).scope,
    ];
    expect(new Set(scopes).size).toBe(3);
  });
});
