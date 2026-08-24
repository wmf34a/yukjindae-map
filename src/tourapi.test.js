import { describe, it, expect } from "vitest";
import { normalizeTitle, findMatchingItem, parseSearchItems, parseOverview } from "./tourapi.js";

describe("normalizeTitle", () => {
  it("공백/괄호/구두점을 제거하고 소문자로 비교 가능하게 만든다", () => {
    expect(normalizeTitle("강릉 경포벚꽃축제(2026)")).toBe("강릉경포벚꽃축제2026");
  });

  it("빈 값은 빈 문자열이다", () => {
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle(undefined)).toBe("");
  });
});

describe("findMatchingItem", () => {
  const items = [
    { title: "강릉 경포벚꽃축제", contentid: "1" },
    { title: "강서 낙동강30리 벚꽃축제", contentid: "2" },
  ];

  it("완전히 같은 제목은 바로 매칭한다", () => {
    expect(findMatchingItem(items, "강릉 경포벚꽃축제")).toBe(items[0]);
  });

  it("4자 이상이면 포함 관계도 매칭한다", () => {
    expect(findMatchingItem(items, "경포벚꽃축제")).toBe(items[0]);
  });

  it("일치하는 항목이 없으면 null이다", () => {
    expect(findMatchingItem(items, "전혀 다른 축제")).toBeNull();
  });

  it("제목이 비어있으면 null이다", () => {
    expect(findMatchingItem(items, "")).toBeNull();
  });

  it("결과가 비어있으면 null이다", () => {
    expect(findMatchingItem([], "강릉 경포벚꽃축제")).toBeNull();
  });
});

describe("parseSearchItems", () => {
  it("item이 배열이면 그대로 반환한다", () => {
    const data = { response: { body: { items: { item: [{ title: "a" }, { title: "b" }] } } } };
    expect(parseSearchItems(data)).toHaveLength(2);
  });

  it("item이 단일 객체면 배열로 감싼다", () => {
    const data = { response: { body: { items: { item: { title: "a" } } } } };
    expect(parseSearchItems(data)).toEqual([{ title: "a" }]);
  });

  it("결과가 없으면(items가 빈 문자열) 빈 배열이다", () => {
    const data = { response: { body: { items: "" } } };
    expect(parseSearchItems(data)).toEqual([]);
  });

  it("data가 null이면 빈 배열이다", () => {
    expect(parseSearchItems(null)).toEqual([]);
  });
});

describe("parseOverview", () => {
  it("overview/addr1/addr2/homepage를 뽑아낸다", () => {
    const data = {
      response: {
        body: { items: { item: [{ overview: "설명", addr1: "강릉시", addr2: "경포동", homepage: "https://example.com" }] } },
      },
    };
    expect(parseOverview(data)).toEqual({
      overview: "설명",
      addr1: "강릉시",
      addr2: "경포동",
      homepage: "https://example.com",
    });
  });

  it("homepage가 <a href>로 감싸져 오면 href만 뽑아낸다", () => {
    const data = {
      response: {
        body: { items: { item: [{ overview: "설명", homepage: '<a href="https://example.com" target="_blank">공식 사이트</a>' }] } },
      },
    };
    expect(parseOverview(data).homepage).toBe("https://example.com");
  });

  it("결과가 없으면 null이다", () => {
    expect(parseOverview({ response: { body: { items: "" } } })).toBeNull();
  });
});
