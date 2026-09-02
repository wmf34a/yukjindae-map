import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withEdgeCache, withAssetCache } from "./worker.js";

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

// 정적 자산 캐시. Static Assets 는 기본이 max-age=0, must-revalidate 라
// CSS·JS 가 방문마다 다시 확인되고 그 확인이 Worker 요청으로 잡힌다.
describe("withAssetCache", () => {
  const ok = (type) => new Response("x", { status: 200, headers: { "content-type": type } });

  it("CSS·JS 에는 캐시 수명을 준다", () => {
    for (const path of ["/css/style.css", "/js/app.js", "/assets/logo/character-logo-96.png"]) {
      const res = withAssetCache(new URL(`https://x${path}`), ok("text/css"));
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    }
  });

  // HTML 을 캐시하면 배포한 화면이 안 바뀌고, sw.js 를 캐시하면 새 버전 감지가 늦어진다.
  it("HTML·서비스워커·매니페스트는 그대로 둔다", () => {
    for (const path of ["/", "/place.html", "/sw.js", "/manifest.json"]) {
      const res = withAssetCache(new URL(`https://x${path}`), ok("text/html"));
      expect(res.headers.get("cache-control")).toBeNull();
    }
  });

  it("200 이 아니면 손대지 않는다", () => {
    const res = withAssetCache(new URL("https://x/js/app.js"), new Response("", { status: 404 }));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
