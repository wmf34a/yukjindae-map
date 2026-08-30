import { describe, expect, it } from "vitest";
import { inferCategories } from "./category-infer.js";

describe("inferCategories", () => {
  it("수목원·공원은 자연·공원", () => {
    expect(inferCategories({ name: "미동산수목원", fee: "무료" }))
      .toEqual(expect.arrayContaining(["자연·공원", "무료"]));
    expect(inferCategories({ name: "별천지공원" })).toContain("자연·공원");
  });

  it("박물관·과학관은 체험·문화이면서 실내놀이", () => {
    const cats = inferCategories({ name: "보령석탄박물관" });
    expect(cats).toContain("체험·문화");
    expect(cats).toContain("실내놀이");
  });

  it("자전거공원은 스포츠까지 붙는다", () => {
    expect(inferCategories({ name: "증평 자전거공원" }))
      .toEqual(expect.arrayContaining(["자연·공원", "스포츠"]));
  });

  // 일부만 무료인 곳을 무료로 묶으면 무료 필터가 거짓말이 된다.
  it("일부 연령만 무료인 곳은 무료가 아니다", () => {
    expect(inferCategories({ name: "세계꽃식물원", fee: "어른 10,000원 / 36개월 미만 무료" }))
      .not.toContain("무료");
    expect(inferCategories({ name: "한라수목원", fee: "무료" })).toContain("무료");
  });

  // 소개글에는 "근처 공원" 같은 주변 설명이 섞인다. 그것만 보고 자연·공원을
  // 붙이면 실내 박물관이 야외로 분류돼 비 오는 날 추천에 올라온다.
  // 실내 시설 이름에 야외 낱말이 들어가는 경우가 많다.
  it("자연사박물관·산악박물관은 실내지 야외가 아니다", () => {
    for (const n of ["땅끝해양자연사박물관", "국립산악박물관", "광나루안전체험관"]) {
      const cats = inferCategories({ name: n });
      expect(cats).toContain("실내놀이");
      expect(cats).not.toContain("자연·공원");
    }
  });

  it("실내 성격은 이름으로만 정한다", () => {
    const cats = inferCategories({ name: "진안역사박물관", reason: "근처에 공원이 있다" });
    expect(cats).toContain("실내놀이");
    expect(cats).not.toContain("자연·공원");
  });

  it("아무 규칙에도 안 걸리면 빈 배열", () => {
    expect(inferCategories({ name: "이름없는곳" })).toEqual([]);
  });
});
