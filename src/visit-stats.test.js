import { describe, it, expect, vi, afterEach } from "vitest";
import {
  todayInKst, countVisitors, refreshVisitStats, readVisitStats,
  STATS_KV_KEY, TOTAL_BASELINE,
} from "./visit-stats.js";

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("todayInKst", () => {
  // UTC 자정 직후는 한국에서 이미 그날 오전 9시다. UTC 로 날짜를 끊으면 하루가 밀린다.
  it("한국 날짜로 끊는다", () => {
    expect(todayInKst(new Date("2026-09-02T00:30:00Z"))).toBe("2026-09-02");
    expect(todayInKst(new Date("2026-09-01T15:30:00Z"))).toBe("2026-09-02");
    expect(todayInKst(new Date("2026-09-01T14:30:00Z"))).toBe("2026-09-01");
  });
});

describe("countVisitors", () => {
  it("오늘 수와 누적을 센다 — 누적에는 기준선을 더한다", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, opts) => {
      calls.push(opts.body);
      const n = calls.length === 1 ? 12 : 40;
      return new Response(JSON.stringify({ data: [{ n }] }), { status: 200 });
    }));
    const out = await countVisitors("tok", "2026-09-02");
    expect(out).toEqual({ today: 12, total: TOTAL_BASELINE + 40, date: "2026-09-02" });
    expect(calls[0]).toContain("blob1 = '2026-09-02'");
  });

  it("SQL이 실패하면 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    await expect(countVisitors("tok", "2026-09-02")).rejects.toThrow(/403/);
  });
});

describe("refreshVisitStats", () => {
  it("세어서 KV에 넣는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ n: 5 }] }), { status: 200 })));
    const kv = fakeKv();
    const out = await refreshVisitStats({ CF_ANALYTICS_TOKEN: "t", RATE_LIMIT: kv }, new Date("2026-09-02T01:00:00Z"));
    expect(out.today).toBe(5);
    expect(JSON.parse(kv.store.get(STATS_KV_KEY)).date).toBe("2026-09-02");
  });

  it("토큰이 없으면 아무것도 안 한다", async () => {
    const kv = fakeKv();
    expect(await refreshVisitStats({ RATE_LIMIT: kv })).toBeNull();
    expect(kv.store.size).toBe(0);
  });
});

describe("readVisitStats", () => {
  it("크론이 넣어 둔 값을 읽는다", async () => {
    const kv = fakeKv();
    await kv.put(STATS_KV_KEY, JSON.stringify({ today: 30, total: 400, date: "2026-09-02" }));
    const out = await readVisitStats({ RATE_LIMIT: kv }, new Date("2026-09-02T05:00:00Z"));
    expect(out).toEqual({ today: 30, total: 400, stale: false });
  });

  // 자정을 넘겼는데 크론이 아직 안 돌았으면, 어제 수가 오늘 것처럼 보이면 안 된다.
  it("날짜가 넘어갔으면 오늘 수를 0으로 준다", async () => {
    const kv = fakeKv();
    await kv.put(STATS_KV_KEY, JSON.stringify({ today: 30, total: 400, date: "2026-09-01" }));
    const out = await readVisitStats({ RATE_LIMIT: kv }, new Date("2026-09-02T05:00:00Z"));
    expect(out).toEqual({ today: 0, total: 400, stale: true });
  });

  it("아직 아무것도 없으면 기준선만 준다", async () => {
    const out = await readVisitStats({ RATE_LIMIT: fakeKv() });
    expect(out).toEqual({ today: 0, total: TOTAL_BASELINE, stale: true });
  });
});
