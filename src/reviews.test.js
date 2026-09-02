import { describe, it, expect } from "vitest";
import {
  validateReview, averageRating, summarize,
  readPublicReviews, REVIEW_TEXT_MAX, MAX_PHOTOS, MIN_AGE_BAND_COUNT,
} from "./reviews.js";

const ok = { placeId: "abc", rating: "5" };

describe("validateReview", () => {
  it("장소와 별점만 있으면 통과한다 — 글은 선택이다", () => {
    expect(validateReview(ok)).toBeNull();
  });

  it("별점이 없으면 막는다", () => {
    expect(validateReview({ placeId: "abc" })).toBe("별점을 골라주세요.");
    expect(validateReview({ placeId: "abc", rating: "6" })).toBe("별점을 골라주세요.");
  });

  it("장소가 없으면 막는다", () => {
    expect(validateReview({ rating: "5" })).toBe("장소를 알 수 없어요.");
  });

  it("목록에 없는 선택지는 막는다", () => {
    expect(validateReview({ ...ok, ageBand: "10세" })).toBe("아이 나이를 다시 골라주세요.");
    expect(validateReview({ ...ok, stayTime: "이틀" })).toBe("머문 시간을 다시 골라주세요.");
    expect(validateReview({ ...ok, revisit: "글쎄" })).toBe("다시 갈지 여부를 다시 골라주세요.");
  });

  it("선택 항목을 비워도 통과한다", () => {
    expect(validateReview({ ...ok, ageBand: null, stayTime: undefined, text: null })).toBeNull();
  });

  it("너무 긴 글은 막는다", () => {
    expect(validateReview({ ...ok, text: "가".repeat(REVIEW_TEXT_MAX + 1) })).toContain("자까지");
  });

  it(`사진은 ${MAX_PHOTOS}장까지다`, () => {
    expect(validateReview({ ...ok, photos: ["a", "b", "c"] })).toBeNull();
    expect(validateReview({ ...ok, photos: ["a", "b", "c", "d"] })).toContain("장까지");
  });
});

describe("averageRating", () => {
  it("소수점 한 자리로 낸다", () => {
    expect(averageRating([{ rating: "5" }, { rating: "4" }, { rating: "4" }])).toBe(4.3);
  });

  // 0.0 으로 보이면 최악 평가처럼 읽힌다.
  it("후기가 없으면 null 이다 — 0 이 아니다", () => {
    expect(averageRating([])).toBeNull();
    expect(averageRating(null)).toBeNull();
  });
});

describe("summarize", () => {
  const reviews = [
    { rating: "5", ageBand: "3~5세", revisit: "또 갈래요", stayTime: "반나절" },
    { rating: "4", ageBand: "3~5세", revisit: "또 갈래요", stayTime: "반나절" },
    { rating: "2", ageBand: "0~2세", revisit: "한 번이면 충분", stayTime: "1시간 미만" },
  ];

  it("전체 평균과 건수를 낸다", () => {
    const s = summarize(reviews);
    expect(s.count).toBe(3);
    expect(s.average).toBe(3.7);
  });

  it("나이대별로 갈라 준다 — 이게 전체 평균보다 쓸모 있다", () => {
    const s = summarize(reviews);
    expect(s.byAge).toEqual([{ band: "3~5세", count: 2, average: 4.5 }]);
  });

  it(`${MIN_AGE_BAND_COUNT}명이 안 되는 나이대는 평균이라고 부르지 않는다`, () => {
    // 0~2세는 한 명뿐이라 빠진다.
    expect(summarize(reviews).byAge.some((x) => x.band === "0~2세")).toBe(false);
  });

  it("또 갈래요 수를 센다", () => {
    expect(summarize(reviews).revisit).toBe(2);
  });

  it("아무도 안 고른 머문시간은 내보내지 않는다", () => {
    expect(summarize(reviews).stayTimes).toEqual([
      { name: "1시간 미만", count: 1 },
      { name: "반나절", count: 2 },
    ]);
  });

  it("빈 목록도 안전하다", () => {
    expect(summarize([])).toEqual({ count: 0, average: null, byAge: [], revisit: 0, stayTimes: [] });
  });
});

describe("readPublicReviews", () => {
  const kv = (value) => ({ RATE_LIMIT: { get: async () => value } });

  it("KV 에 있는 목록을 준다", async () => {
    expect(await readPublicReviews(kv('[{"placeId":"a"}]'))).toEqual([{ placeId: "a" }]);
  });

  it("비었거나 깨졌으면 빈 배열 — 후기 하나 때문에 상세가 깨지면 안 된다", async () => {
    expect(await readPublicReviews(kv(null))).toEqual([]);
    expect(await readPublicReviews(kv("{"))).toEqual([]);
    expect(await readPublicReviews({})).toEqual([]);
  });
});
