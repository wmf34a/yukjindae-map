import { describe, it, expect } from "vitest";
import {
  matchesQuery, validateReportPayload, validateNewPlacePayload,
  validateNewPlaceAmenities, buildNewPlaceValue, isFirstDayInKst,
} from "./worker.js";

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
  // 실제 노션 페이지 ID 형식(하이픈 포함 32자리 16진수)
  const valid = {
    placeId: "3afa4eba-1ccb-8119-9a6b-c82398028807",
    field: "기저귀교환대",
    value: "있음",
    turnstileToken: "token",
  };

  it("정상 요청은 통과한다(불리언 필드)", () => {
    expect(validateReportPayload(valid)).toBeNull();
  });

  it("정상 요청은 통과한다(자유서술 필드)", () => {
    expect(
      validateReportPayload({ ...valid, field: "무료입장연령", value: "36개월 미만" })
    ).toBeNull();
  });

  // 운영시간·입장료가 틀리면 헛걸음하거나 돈이 어긋난다. 편의시설 오차보다
  // 치명적인데 오래도록 제보 대상이 아니었다.
  it("운영시간·입장료·주차상세도 제보할 수 있다", () => {
    expect(validateReportPayload({ ...valid, field: "운영시간", value: "10:00~18:00" })).toBeNull();
    expect(validateReportPayload({ ...valid, field: "입장료", value: "성인 5,000원" })).toBeNull();
    expect(validateReportPayload({ ...valid, field: "주차상세", value: "무료 30분" })).toBeNull();
  });

  it("자유서술 필드는 있음/없음 제약을 받지 않는다", () => {
    expect(validateReportPayload({ ...valid, field: "운영시간", value: "연중무휴" })).toBeNull();
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

describe("validateNewPlacePayload", () => {
  const valid = { placeName: "인천대공원", value: "숲이 넓고 주차가 무료예요", turnstileToken: "token" };

  it("정상 제보는 통과한다", () => {
    expect(validateNewPlacePayload(valid)).toBeNull();
  });

  // 아직 DB에 없는 장소라 placeId가 없다 — 이걸 요구하면 신규 제보가 아예 불가능하다.
  it("placeId 없이도 통과한다", () => {
    expect(validateNewPlacePayload({ ...valid, placeId: undefined })).toBeNull();
  });

  it("장소 이름이 없으면 걸러낸다", () => {
    expect(validateNewPlacePayload({ ...valid, placeName: "" })).toMatch(/이름/);
    expect(validateNewPlacePayload({ ...valid, placeName: "   " })).toMatch(/이름/);
  });

  it("장소 이름이 너무 길면 걸러낸다", () => {
    expect(validateNewPlacePayload({ ...valid, placeName: "가".repeat(61) })).toMatch(/깁니다/);
  });

  it("추천 이유가 없으면 걸러낸다", () => {
    expect(validateNewPlacePayload({ ...valid, value: "" })).toMatch(/좋았는지/);
  });

  it("내용이 200자를 넘으면 걸러낸다", () => {
    expect(validateNewPlacePayload({ ...valid, value: "가".repeat(201) })).toMatch(/깁니다/);
  });

  it("사람 확인 토큰이 없으면 걸러낸다", () => {
    expect(validateNewPlacePayload({ ...valid, turnstileToken: "" })).toMatch(/사람/);
  });

  it("편의시설을 같이 보내도 통과한다", () => {
    expect(validateNewPlacePayload({ ...valid, amenities: { 수유실: "있음", 주차: "무료" } })).toBeNull();
  });

  it("편의시설 값이 이상하면 걸러낸다", () => {
    expect(validateNewPlacePayload({ ...valid, amenities: { 수유실: "아마도" } })).toMatch(/편의시설/);
  });
});

describe("validateNewPlaceAmenities", () => {
  // 안 고른 항목은 아예 안 보내는 게 정상이라 빈 값도 통과해야 한다.
  it("없거나 비어 있으면 통과한다", () => {
    expect(validateNewPlaceAmenities(undefined)).toBeNull();
    expect(validateNewPlaceAmenities(null)).toBeNull();
    expect(validateNewPlaceAmenities({})).toBeNull();
  });

  it("허용된 항목과 값만 통과시킨다", () => {
    expect(validateNewPlaceAmenities({ 수유실: "있음", 기저귀교환대: "없음", 유아의자: "있음" })).toBeNull();
    expect(validateNewPlaceAmenities({ 주차: "유료" })).toBeNull();
  });

  // 임의 필드에 임의 값을 넣지 못하게 막는다 — 제보는 승인 큐로 들어가는 입력이다.
  it("모르는 항목은 거절한다", () => {
    expect(validateNewPlaceAmenities({ 엘리베이터: "있음" })).toMatch(/항목/);
  });

  it("항목별 허용값이 아니면 거절한다", () => {
    expect(validateNewPlaceAmenities({ 수유실: "무료" })).toMatch(/값/);
    expect(validateNewPlaceAmenities({ 주차: "있음" })).toMatch(/값/);
    expect(validateNewPlaceAmenities({ 수유실: 1 })).toMatch(/값/);
  });

  it("객체가 아니면 거절한다", () => {
    expect(validateNewPlaceAmenities([])).toMatch(/형식/);
    expect(validateNewPlaceAmenities("있음")).toMatch(/형식/);
  });
});

describe("buildNewPlaceValue", () => {
  it("고른 편의시설을 정해진 형식으로 붙인다", () => {
    const out = buildNewPlaceValue({
      value: " 숲이 넓어요 ",
      amenities: { 수유실: "있음", 주차: "무료" },
    });
    expect(out).toBe("숲이 넓어요\n[편의시설] 수유실:있음 / 주차:무료");
  });

  it("고른 게 없으면 본문만 남긴다", () => {
    expect(buildNewPlaceValue({ value: "좋아요", amenities: {} })).toBe("좋아요");
    expect(buildNewPlaceValue({ value: "좋아요" })).toBe("좋아요");
  });

  // 검증을 통과한 값만 오지만, 형식 문자열을 만들 때도 화이트리스트를 다시 본다.
  it("모르는 항목은 붙이지 않는다", () => {
    expect(buildNewPlaceValue({ value: "좋아요", amenities: { 엘리베이터: "있음" } })).toBe("좋아요");
  });
});

describe("근처 맛집·카페 제보", () => {
  const base = { placeId: "3a5a4eba1ccb8184a779e148112599e7", turnstileToken: "token" };

  // 지도 API는 어떤 가게가 있는지는 알려줘도 아이랑 가도 되는지는 알려주지 않는다.
  it("근처맛집·근처카페를 제보할 수 있다", () => {
    expect(validateReportPayload({ ...base, field: "근처맛집", value: "고메돈까스 (유아의자 있어요)" })).toBeNull();
    expect(validateReportPayload({ ...base, field: "근처카페", value: "모모아트" })).toBeNull();
  });

  // 자유서술 필드라 있음/없음으로 제한하면 안 된다.
  it("자유서술로 받는다", () => {
    expect(validateReportPayload({ ...base, field: "근처맛집", value: "아무 상호나 (메모)" })).toBeNull();
  });

  it("200자를 넘으면 걸러낸다", () => {
    expect(validateReportPayload({ ...base, field: "근처맛집", value: "가".repeat(201) })).toMatch(/깁니다/);
  });

  it("여전히 화이트리스트 밖 필드는 막는다", () => {
    expect(validateReportPayload({ ...base, field: "공개여부", value: "true" })).toMatch(/지원하지 않는/);
  });
});

describe("isFirstDayInKst", () => {
  // 크론이 UTC 말일 15:00에 도는데, 그 시각의 KST는 다음 달 1일 00:00이다.
  it("UTC 말일 15시는 KST로 1일이다", () => {
    expect(isFirstDayInKst(Date.parse("2026-08-31T15:00:00Z"))).toBe(true);
    expect(isFirstDayInKst(Date.parse("2026-09-30T15:00:00Z"))).toBe(true);
    // 2월은 28일이 말일이다.
    expect(isFirstDayInKst(Date.parse("2027-02-28T15:00:00Z"))).toBe(true);
  });

  // 말일 후보 네 날짜에 모두 걸려 있어, 아닌 날은 걸러야 한다.
  it("말일이 아닌 날은 걸러낸다", () => {
    expect(isFirstDayInKst(Date.parse("2026-08-28T15:00:00Z"))).toBe(false);
    expect(isFirstDayInKst(Date.parse("2026-08-29T15:00:00Z"))).toBe(false);
    expect(isFirstDayInKst(Date.parse("2026-08-30T15:00:00Z"))).toBe(false);
  });

  it("31일이 없는 달의 30일 15시도 1일이다", () => {
    expect(isFirstDayInKst(Date.parse("2026-11-30T15:00:00Z"))).toBe(true);
    expect(isFirstDayInKst(Date.parse("2026-11-29T15:00:00Z"))).toBe(false);
  });
});

describe("사람 확인", () => {
  const base = { placeId: "3a5a4eba1ccb8184a779e148112599e7", field: "운영시간", value: "10시 오픈" };

  it("Turnstile 토큰이 없으면 막는다", () => {
    expect(validateReportPayload(base)).toMatch(/사람인지/);
    expect(validateNewPlacePayload({ placeName: "가", value: "나" })).toMatch(/사람인지/);
  });

  // 사람 확인은 사람 확인만 본다. 나머지 검증은 그대로 걸려야 한다.
  it("토큰이 있어도 다른 검증은 그대로 받는다", () => {
    const ok = { ...base, turnstileToken: "t" };
    expect(validateReportPayload({ ...ok, field: "공개여부" })).toMatch(/지원하지 않는/);
    expect(validateReportPayload({ ...ok, placeId: "잘못된id" })).toMatch(/잘못된 장소/);
    expect(validateReportPayload({ ...ok, value: "" })).toMatch(/제안값/);
    expect(validateNewPlacePayload(
      { placeName: "가", value: "나", turnstileToken: "t", amenities: { 수유실: "아마도" } }
    )).toMatch(/편의시설/);
  });

  it("제대로 채우면 통과한다", () => {
    expect(validateReportPayload({ ...base, turnstileToken: "t" })).toBeNull();
    expect(validateNewPlacePayload(
      { placeName: "가", value: "좋아요", turnstileToken: "t" }
    )).toBeNull();
  });
});
