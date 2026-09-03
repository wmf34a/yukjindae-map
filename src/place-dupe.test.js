import { describe, it, expect } from "vitest";
import { normalizePlaceName } from "./worker.js";

// 크론이 제보를 받아 장소를 만들 때 중복 검사가 없었다. 화담숲을 누가 추천했는데
// 7월에 등록된 화담숲이 이미 공개 중인데도 같은 이름으로 하나 더 만들었다.
// 좋은 곳일수록 여러 사람이 추천하니 인기 있는 장소부터 겹친다.
describe("normalizePlaceName", () => {
  // 노션 title 검색은 공백에 민감해서 띄어쓰기만 달라도 못 찾는다.
  it("띄어쓰기가 달라도 같은 곳으로 본다", () => {
    expect(normalizePlaceName("화담 숲")).toBe(normalizePlaceName("화담숲"));
    expect(normalizePlaceName(" 서울숲 곤충식물원 ")).toBe(normalizePlaceName("서울숲곤충식물원"));
  });

  it("영문 대소문자를 가리지 않는다", () => {
    expect(normalizePlaceName("Kids Cafe")).toBe(normalizePlaceName("kidscafe"));
  });

  it("다른 곳은 다르게 본다", () => {
    expect(normalizePlaceName("화담숲")).not.toBe(normalizePlaceName("화암사"));
  });

  it("빈 값도 안전하다", () => {
    expect(normalizePlaceName("")).toBe("");
    expect(normalizePlaceName(undefined)).toBe("");
  });
});
