import { describe, it, expect, vi, afterEach } from "vitest";
import { warmCaches } from "./worker.js";

// 사람이 없는 시간에는 캐시가 통째로 비어서, 새벽에 처음 들어온 한 사람이 노션
// 응답을 그대로 뒤집어쓴다. 실측 로그에 19.8초짜리가 있다.
describe("warmCaches", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("자주 열리는 목록 네 개를 미리 받아 둔다", async () => {
    const seen = [];
    vi.stubGlobal("fetch", vi.fn((url) => { seen.push(String(url)); return Promise.resolve(new Response("{}", { status: 200 })); }));
    expect(await warmCaches({}, "https://x")).toBe(4);
    expect(seen.map((u) => new URL(u).pathname).toSorted()).toEqual(
      ["/api/banners", "/api/courses", "/api/festivals", "/api/places"]
    );
  });

  // 하나가 실패해도 나머지는 데워야 한다. 예열이 크론을 멈춰 세우면 안 된다.
  it("일부가 실패해도 나머지는 채운다", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      n += 1;
      return n === 1 ? Promise.reject(new Error("timeout")) : Promise.resolve(new Response("{}", { status: 200 }));
    }));
    expect(await warmCaches({}, "https://x")).toBe(3);
  });

  it("전부 실패해도 던지지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    expect(await warmCaches({}, "https://x")).toBe(0);
  });
});
