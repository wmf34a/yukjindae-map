import { describe, it, expect } from "vitest";
import { clipToBounds } from "./worker.js";

const rooms = [
  { name: "서울", lat: 37.55, lng: 126.98 },
  { name: "부산", lat: 35.18, lng: 129.08 },
  { name: "제주", lat: 33.50, lng: 126.53 },
];
const at = (qs) => new URL(`https://x/api/nursing-rooms${qs}`);

describe("clipToBounds", () => {
  it("화면 범위 안의 것만 준다", () => {
    const out = clipToBounds(rooms, at("?minLat=37.4&maxLat=37.7&minLng=126.8&maxLng=127.2"));
    expect(out.map((r) => r.name)).toEqual(["서울"]);
  });

  // Number(null)이 0이라 그냥 Number로 바꾸면 (0,0) 한 점으로 좁혀져 빈 배열이 나간다.
  // 실제로 이렇게 내보내서 지도에서 수유실이 통째로 사라졌다.
  it("범위를 안 주면 전부 준다", () => {
    expect(clipToBounds(rooms, at(""))).toHaveLength(3);
  });

  it("일부만 주거나 빈 값이면 전부 준다", () => {
    expect(clipToBounds(rooms, at("?minLat=37.4"))).toHaveLength(3);
    expect(clipToBounds(rooms, at("?minLat=&maxLat=&minLng=&maxLng="))).toHaveLength(3);
  });

  it("숫자가 아니면 전부 준다", () => {
    expect(clipToBounds(rooms, at("?minLat=아무&maxLat=말&minLng=126&maxLng=127"))).toHaveLength(3);
  });
});
