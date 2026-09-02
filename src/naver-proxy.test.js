import { describe, it, expect, vi, afterEach } from "vitest";
import { handleDirections, handleGeocode, handleNearbyPlace } from "./naver-proxy.js";

// 바깥 API 가 느릴 때 예외가 그대로 나가면 Worker 가 1101 을 반환하고 화면이
// 통째로 깨진다. 실제로 네이버 길찾기가 시간을 넘겨 코스보기가 깨진 적이 있다.
// 핀 하나가 안 찍히는 것과 화면이 깨지는 것은 다르다.
describe("프록시는 바깥이 죽어도 화면을 깨뜨리지 않는다", () => {
  const env = {
    NAVER_MAP_CLIENT_ID: "id",
    NAVER_MAP_CLIENT_SECRET: "secret",
    NAVER_SEARCH_CLIENT_ID: "id",
    NAVER_SEARCH_CLIENT_SECRET: "secret",
    KAKAO_REST_API_KEY: "kakao",
  };

  afterEach(() => { vi.unstubAllGlobals(); });

  const boom = () => vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("The operation was aborted due to timeout"))));

  it("길찾기: 타임아웃이어도 200 found:false", async () => {
    boom();
    const res = await handleDirections(env, new URL("https://x/api/directions?start=127,37&goal=127.1,37.1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  it("주소 좌표 변환: 타임아웃이어도 200 found:false", async () => {
    boom();
    const res = await handleGeocode(env, new URL("https://x/api/geocode?query=서울시청"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  it("근처 장소 검색: 타임아웃이어도 200 found:false", async () => {
    boom();
    const res = await handleNearbyPlace(env, new URL("https://x/api/nearby-place?q=김밥천국&lat=37.5&lng=127"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  // 파라미터 검증은 그대로 400 이어야 한다 — 삼키면 안 되는 오류다.
  it("파라미터가 없으면 400 은 그대로", async () => {
    const res = await handleDirections(env, new URL("https://x/api/directions"));
    expect(res.status).toBe(400);
  });
});
