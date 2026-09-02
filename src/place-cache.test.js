import { describe, it, expect, afterEach } from "vitest";
import { placeFromCachedList } from "./worker.js";

// 상세가 주는 값은 목록의 한 항목과 완전히 같다. 그런데 상세는 장소마다 캐시가
// 따로라 260곳 각각의 첫 방문자가 노션 응답을 그대로 기다린다 — 실측 로그에
// 6.4초짜리가 남아 있다. 목록 캐시에서 꺼낼 수 있으면 노션을 부를 이유가 없다.
describe("placeFromCachedList", () => {
  const req = (url = "https://x/api/places/abc") => new Request(url);
  const withCache = (matchFn) => { globalThis.caches = { default: { match: matchFn } }; };

  afterEach(() => { globalThis.caches = undefined; });

  it("목록 캐시에서 같은 id 를 꺼낸다", async () => {
    withCache(async () => new Response(JSON.stringify({ places: [{ id: "abc", name: "여의도한강공원" }] })));
    expect(await placeFromCachedList(req(), "abc")).toEqual({ id: "abc", name: "여의도한강공원" });
  });

  // 목록에 없는 장소가 있다. 비공개거나 검수 토큰으로만 보이는 것들이다 —
  // 그때는 노션에 물어야 하므로 null 을 준다.
  it("목록에 없으면 null", async () => {
    withCache(async () => new Response(JSON.stringify({ places: [{ id: "other" }] })));
    expect(await placeFromCachedList(req(), "abc")).toBeNull();
  });

  it("캐시가 비어 있으면 null", async () => {
    withCache(async () => undefined);
    expect(await placeFromCachedList(req(), "abc")).toBeNull();
  });

  // 여기서 실패해도 잃는 것은 속도뿐이다. 상세가 통째로 깨지면 안 된다.
  it("캐시가 깨져 있어도 던지지 않는다", async () => {
    withCache(async () => new Response("{"));
    expect(await placeFromCachedList(req(), "abc")).toBeNull();
  });

  it("Cache API 가 없는 환경에서도 안전하다", async () => {
    globalThis.caches = undefined;
    expect(await placeFromCachedList(req(), "abc")).toBeNull();
  });

  // 상세 URL 이 아니라 목록 URL 로 물어야 한다. 쿼리스트링도 떼야 캐시 키가 맞는다.
  it("목록 URL 로 캐시를 찾는다", async () => {
    let asked = "";
    withCache(async (r) => { asked = r.url; return undefined; });
    await placeFromCachedList(req("https://x/api/places/abc?bust=1"), "abc");
    expect(asked).toBe("https://x/api/places");
  });
});
