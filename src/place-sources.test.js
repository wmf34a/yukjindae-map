import { afterEach, describe, expect, it } from "vitest";
import { makeRoadDistance, straightKm } from "./place-sources.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("straightKm", () => {
  it("서울시청에서 광화문까지 약 1km", () => {
    const d = straightKm({ lat: 37.5665, lng: 126.978 }, { lat: 37.5759, lng: 126.9769 });
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.2);
  });
});

describe("makeRoadDistance", () => {
  const naver = { mapClientId: "id", mapClientSecret: "secret" };
  const stub = (meters) => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ route: { trafast: [{ summary: { distance: meters } }] } }),
    });
  };
  // 서울시청과 광화문 — 직선 약 1km
  const from = { lat: 37.5665, lng: 126.9780 };
  const to = { lat: 37.5759, lng: 126.9769 };

  it("도로 거리를 미터로 준다", async () => {
    stub(1687);
    expect(await makeRoadDistance(naver)(from, to)).toBe(1687);
  });

  // 좌표가 차가 못 다니는 곳에 찍혀 있으면 네이버가 산을 통째로 도는 경로를 준다.
  it("직선의 세 배가 넘고 10km도 넘으면 못 믿을 경로로 보고 버린다", async () => {
    stub(35530);
    expect(await makeRoadDistance(naver)(from, to)).toBeNull();
  });

  // 도심에서 일방통행 때문에 직선의 서너 배가 되는 건 정상이다.
  it("10km 안쪽이면 배수가 커도 그대로 준다", async () => {
    stub(5220);
    expect(await makeRoadDistance(naver)(from, to)).toBe(5220);
  });
});
