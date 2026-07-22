import { describe, it, expect } from "vitest";
import { matchesQuery } from "./worker.js";

const place = {
  name: "전쟁기념관",
  region: "서울",
  categories: ["무료", "체험·문화"],
  address: "서울 용산구 이태원로 29",
};

describe("matchesQuery", () => {
  it("필터가 없으면 통과한다", () => {
    expect(matchesQuery(place, { region: "", category: "", q: "" })).toBe(true);
  });

  it("지역이 일치하지 않으면 걸러낸다", () => {
    expect(matchesQuery(place, { region: "제주", category: "", q: "" })).toBe(false);
  });

  it("카테고리를 포함하지 않으면 걸러낸다", () => {
    expect(matchesQuery(place, { region: "", category: "카페", q: "" })).toBe(false);
  });

  it("카테고리를 포함하면 통과한다", () => {
    expect(matchesQuery(place, { region: "", category: "무료", q: "" })).toBe(true);
  });

  it("검색어가 이름/주소/지역 어디에도 없으면 걸러낸다", () => {
    expect(matchesQuery(place, { region: "", category: "", q: "제주도" })).toBe(false);
  });

  it("검색어가 이름에 포함되면 통과한다(대소문자 무시)", () => {
    expect(matchesQuery(place, { region: "", category: "", q: "전쟁" })).toBe(true);
  });
});
