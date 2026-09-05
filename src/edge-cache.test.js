import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withEdgeCache } from "./worker.js";

// caches.default 를 흉내낸다. put/match 만 쓴다.
function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      store.set(req.url, res.clone());
    },
  };
}

// waitUntil 로 넘긴 작업을 모아 두었다가 직접 기다린다.
function fakeCtx() {
  const jobs = [];
  return { waitUntil: (p) => jobs.push(p), settle: () => Promise.all(jobs) };
}

const req = () => new Request("https://x/api/places");
const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let cache;
beforeEach(() => {
  cache = fakeCache();
  vi.stubGlobal("caches", { default: cache });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("withEdgeCache", () => {
  it("처음에는 직접 받아서 캐시에 넣는다", async () => {
    const handler = vi.fn(async () => json({ n: 1 }));
    const ctx = fakeCtx();
    const res = await withEdgeCache(req(), ctx, 300, handler);
    await ctx.settle();

    expect(await res.json()).toEqual({ n: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);
  });

  it("아직 안 지났으면 노션을 다시 부르지 않는다", async () => {
    const handler = vi.fn(async () => json({ n: 1 }));
    const ctx = fakeCtx();
    await withEdgeCache(req(), ctx, 300, handler);
    await ctx.settle();

    const res = await withEdgeCache(req(), fakeCtx(), 300, handler);
    expect(await res.json()).toEqual({ n: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // 캐시가 만료된 순간에 들어온 사람이 노션을 기다리며 10초씩 멈춰 있었다.
  it("지났으면 옛 응답을 그대로 주고, 새 값은 뒤에서 받는다", async () => {
    vi.useFakeTimers();
    let n = 1;
    const handler = vi.fn(async () => json({ n }));

    const first = fakeCtx();
    await withEdgeCache(req(), first, 300, handler);
    await first.settle();

    vi.advanceTimersByTime(301_000);
    n = 2;

    const second = fakeCtx();
    const res = await withEdgeCache(req(), second, 300, handler);
    // 기다리지 않고 곧바로 옛 값을 받는다.
    expect(await res.json()).toEqual({ n: 1 });

    // 뒤에서 돌던 갱신이 끝나면 캐시는 새 값이 된다.
    await second.settle();
    const after = await withEdgeCache(req(), fakeCtx(), 300, handler);
    expect(await after.json()).toEqual({ n: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("뒤에서 돌던 갱신이 실패해도 응답은 정상이다", async () => {
    vi.useFakeTimers();
    const handler = vi
      .fn()
      .mockResolvedValueOnce(json({ n: 1 }))
      .mockRejectedValueOnce(new Error("notion down"));

    const first = fakeCtx();
    await withEdgeCache(req(), first, 300, handler);
    await first.settle();

    vi.advanceTimersByTime(301_000);
    const second = fakeCtx();
    const res = await withEdgeCache(req(), second, 300, handler);
    expect(await res.json()).toEqual({ n: 1 });
    await expect(second.settle()).resolves.toBeDefined();
  });

  it("200이 아니면 캐시에 넣지 않는다", async () => {
    const handler = vi.fn(async () => new Response("nope", { status: 502 }));
    const ctx = fakeCtx();
    const res = await withEdgeCache(req(), ctx, 300, handler);
    await ctx.settle();

    expect(res.status).toBe(502);
    expect(cache.store.size).toBe(0);
  });
});

describe("긴 TTL", () => {
  // 엣지가 실제로 들고 있는 기간은 s-maxage 다. 이걸 CACHE_HOLD_SECONDS 로만
  // 고정하면 하루짜리로 잡은 프록시 캐시가 한 시간 뒤 사라져 바깥 API 를 다시
  // 부른다 — 그 호출에 돈이 나간다.
  it("ttl 이 기본 보관 기간보다 길면 s-maxage 도 그만큼 늘어난다", async () => {
    globalThis.caches = { default: fakeCache() };
    const res = await withEdgeCache(
      new Request("https://x/api/directions?start=1&goal=2"),
      null,
      86400,
      async () => new Response("ok", { status: 200 })
    );
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
  });

  it("짧은 ttl 은 기본 보관 기간을 그대로 쓴다", async () => {
    globalThis.caches = { default: fakeCache() };
    const res = await withEdgeCache(
      new Request("https://x/api/places"),
      null,
      300,
      async () => new Response("ok", { status: 200 })
    );
    expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});

// HEAD 요청은 캐시에 넣을 수 없다. 그대로 두면 cache.put 이
// "Cannot cache response to non-GET request" 로 터지고 그 예외가 워커 밖으로
// 나가 1101 이 된다 — 봇이나 상태 확인 도구가 HEAD 를 보낸다.
describe("GET 이 아닌 요청", () => {
  it("HEAD 는 캐시를 건너뛰고 그대로 응답한다", async () => {
    const put = vi.fn();
    globalThis.caches = { default: { match: async () => undefined, put } };
    const res = await withEdgeCache(
      new Request("https://x/api/today?lat=37&lng=127", { method: "HEAD" }),
      null,
      3600,
      async () => new Response("ok", { status: 200 })
    );
    expect(res.status).toBe(200);
    expect(put).not.toHaveBeenCalled();
  });
});

// 만료 직후 요청이 몰리면 각자 갱신을 띄워 노션을 동시에 두드렸다. 갱신을 시작할 때
// 캐시에 표시를 남겨 뒤따르는 요청이 다시 띄우지 않게 한 부분을 확인한다.
describe("withEdgeCache 갱신 표시", () => {
  // claim() 안의 await 몇 단계를 흘려보낸다. 타이머가 아니라 마이크로태스크라
  // 시간을 진행시킬 필요가 없다.
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  // 첫 호출만 바로 답하고, 그 뒤 갱신은 풀어 줄 때까지 매달려 있는 핸들러.
  function gatedHandler() {
    let release;
    const gate = new Promise((r) => (release = r));
    let calls = 0;
    const handler = async () => {
      calls += 1;
      if (calls > 1) await gate;
      return json({ n: calls });
    };
    return { handler, release: () => release(), get calls() { return calls; } };
  }

  const T0 = Date.parse("2026-09-05T00:00:00Z");

  it("갱신이 도는 동안 들어온 요청은 갱신을 또 띄우지 않는다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const g = gatedHandler();

    await withEdgeCache(req(), fakeCtx(), 300, g.handler);
    expect(g.calls).toBe(1);

    vi.setSystemTime(T0 + 301_000); // 만료됨
    const first = fakeCtx();
    await withEdgeCache(req(), first, 300, g.handler);
    await flush();
    expect(g.calls).toBe(2); // 갱신 하나 시작

    const second = fakeCtx();
    await withEdgeCache(req(), second, 300, g.handler);
    await second.settle();
    expect(g.calls).toBe(2); // 표시를 보고 다시 띄우지 않음

    g.release();
    await first.settle();
  });

  it("원본을 받은 지 보관 기간을 넘겼으면 표시하지 않는다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const g = gatedHandler();

    await withEdgeCache(req(), fakeCtx(), 300, g.handler);

    vi.setSystemTime(T0 + 3_601_000); // 보관 기간(1시간) 지남
    const first = fakeCtx();
    await withEdgeCache(req(), first, 300, g.handler);
    await flush();
    expect(g.calls).toBe(2);

    const second = fakeCtx();
    await withEdgeCache(req(), second, 300, g.handler);
    await flush();
    expect(g.calls).toBe(3); // 표시가 없으니 요청마다 갱신을 띄운다

    g.release();
    await Promise.all([first.settle(), second.settle()]);
  });
});
