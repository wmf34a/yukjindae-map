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
