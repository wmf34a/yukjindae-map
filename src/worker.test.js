import { describe, it, expect } from "vitest";
import { matchesQuery, validateReportPayload } from "./worker.js";

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

describe("validateReportPayload", () => {
  const valid = { placeId: "page-1", field: "기저귀교환대", value: "있음", turnstileToken: "token" };

  it("정상 요청은 통과한다(불리언 필드)", () => {
    expect(validateReportPayload(valid)).toBeNull();
  });

  it("정상 요청은 통과한다(자유서술 필드)", () => {
    expect(
      validateReportPayload({ ...valid, field: "무료입장연령", value: "36개월 미만" })
    ).toBeNull();
  });

  it("placeId가 없으면 걸러낸다", () => {
    expect(validateReportPayload({ ...valid, placeId: "" })).toMatch(/placeId/);
  });

  it("화이트리스트에 없는 필드는 걸러낸다", () => {
    expect(validateReportPayload({ ...valid, field: "장소명" })).toMatch(/지원하지 않는/);
  });

  it("turnstileToken이 없으면 걸러낸다", () => {
    expect(validateReportPayload({ ...valid, turnstileToken: "" })).toMatch(/사람인지/);
  });

  it("불리언 필드에 있음/없음이 아닌 값은 걸러낸다", () => {
    expect(validateReportPayload({ ...valid, value: "아마도" })).toMatch(/있음\/없음/);
  });

  it("자유서술 필드는 최대 길이를 넘으면 걸러낸다", () => {
    const longValue = "a".repeat(201);
    expect(
      validateReportPayload({ ...valid, field: "무료입장연령", value: longValue })
    ).toMatch(/너무 깁니다/);
  });
});
