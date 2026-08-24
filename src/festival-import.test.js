import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  rankCandidates,
  mapAddressToRegion,
  toNotionProperties,
  selectNewCandidates,
} from "./festival-import.js";

const baseItem = (overrides = {}) => ({
  contentId: "1",
  title: "가족과 함께하는 딸기 체험 축제",
  eventStartDate: "20260901",
  eventEndDate: "20260910",
  addr1: "경기도 수원시 팔달구",
  addr2: "행사장",
  image: "https://x.com/a.jpg",
  ...overrides,
});

describe("scoreCandidate", () => {
  it("가족 키워드가 많을수록 점수가 높다", () => {
    expect(scoreCandidate(baseItem())).toBeGreaterThan(0);
  });

  it("성인 지향 키워드가 있으면 null(제외)이다", () => {
    expect(scoreCandidate(baseItem({ title: "심야 나이트 마켓" }))).toBeNull();
  });

  it("아무 키워드도 없으면 0점이다", () => {
    expect(scoreCandidate(baseItem({ title: "지역 문화 페스티벌" }))).toBe(0);
  });
});

describe("rankCandidates", () => {
  it("점수 높은 순, 동점이면 시작일이 이른 순으로 정렬한다", () => {
    const items = [
      baseItem({ contentId: "a", title: "지역 축제", eventStartDate: "20260901" }),
      baseItem({ contentId: "b", title: "가족 체험 축제", eventStartDate: "20260905" }),
      baseItem({ contentId: "c", title: "가족 체험 축제", eventStartDate: "20260902" }),
    ];
    const ranked = rankCandidates(items, { limit: 10 });
    expect(ranked.map((i) => i.contentId)).toEqual(["c", "b", "a"]);
  });

  it("성인 지향 후보는 결과에서 빠진다", () => {
    const items = [baseItem({ contentId: "a", title: "클럽 나이트 파티" })];
    expect(rankCandidates(items)).toEqual([]);
  });

  it("limit만큼만 반환한다", () => {
    const items = Array.from({ length: 5 }, (_, i) => baseItem({ contentId: `${i}` }));
    expect(rankCandidates(items, { limit: 2 })).toHaveLength(2);
  });
});

describe("mapAddressToRegion", () => {
  it("서울 강북 자치구를 매핑한다", () => {
    expect(mapAddressToRegion("서울특별시 마포구 어딘가")).toBe("서울강북");
  });

  it("서울 강남 자치구를 매핑한다", () => {
    expect(mapAddressToRegion("서울특별시 강남구 어딘가")).toBe("서울강남");
  });

  it("경기 북부 시/군을 매핑한다", () => {
    expect(mapAddressToRegion("경기도 고양시 일산동구")).toBe("경기북부");
  });

  it("경기 남부는 경기남부로 매핑한다", () => {
    expect(mapAddressToRegion("경기도 수원시 팔달구")).toBe("경기남부");
  });

  it("경기 부천시는 인천·부천으로 매핑한다", () => {
    expect(mapAddressToRegion("경기도 부천시 원미구")).toBe("인천·부천");
  });

  it("인천은 인천·부천으로 매핑한다", () => {
    expect(mapAddressToRegion("인천광역시 연수구")).toBe("인천·부천");
  });

  it("강원/충청/전라/경상/제주를 매핑한다", () => {
    expect(mapAddressToRegion("강원특별자치도 강릉시")).toBe("강원도");
    expect(mapAddressToRegion("충청남도 천안시")).toBe("충청도");
    expect(mapAddressToRegion("전라북도 전주시")).toBe("전라도");
    expect(mapAddressToRegion("경상북도 경주시")).toBe("경상도");
    expect(mapAddressToRegion("제주특별자치도 제주시")).toBe("제주");
  });

  it("빈 값/매칭 안 되는 주소는 빈 문자열이다", () => {
    expect(mapAddressToRegion("")).toBe("");
    expect(mapAddressToRegion(undefined)).toBe("");
  });
});

describe("toNotionProperties", () => {
  it("기본 필드를 노션 속성으로 변환한다", () => {
    const props = toNotionProperties(baseItem(), 3);
    expect(props["제목"]).toEqual({ title: [{ text: { content: "가족과 함께하는 딸기 체험 축제" } }] });
    expect(props["기간"]).toEqual({ date: { start: "2026-09-01", end: "2026-09-10" } });
    expect(props["장소명"]).toEqual({ rich_text: [{ text: { content: "행사장" } }] });
    expect(props["주소"]).toEqual({ rich_text: [{ text: { content: "경기도 수원시 팔달구" } }] });
    expect(props["순서"]).toEqual({ number: 3 });
    expect(props["공개여부"]).toEqual({ checkbox: false });
    expect(props["TourAPI_ID"]).toEqual({ rich_text: [{ text: { content: "1" } }] });
    expect(props["이미지"]).toEqual({ files: [{ type: "external", name: "festival", external: { url: "https://x.com/a.jpg" } }] });
    expect(props["지역"]).toEqual({ select: { name: "경기남부" } });
  });

  it("시작일=종료일이면 end는 null이다", () => {
    const props = toNotionProperties(baseItem({ eventEndDate: "20260901" }), 1);
    expect(props["기간"]).toEqual({ date: { start: "2026-09-01", end: null } });
  });

  it("이미지/지역 매핑이 없으면 해당 속성을 만들지 않는다", () => {
    const props = toNotionProperties(baseItem({ image: "", addr1: "" }), 1);
    expect(props["이미지"]).toBeUndefined();
    expect(props["지역"]).toBeUndefined();
  });
});

describe("selectNewCandidates", () => {
  it("이미 존재하는 TourAPI_ID는 제외한다", () => {
    const items = [baseItem({ contentId: "a" }), baseItem({ contentId: "b" })];
    expect(selectNewCandidates(items, ["a"]).map((i) => i.contentId)).toEqual(["b"]);
  });

  it("limit만큼만 반환한다", () => {
    const items = Array.from({ length: 5 }, (_, i) => baseItem({ contentId: `${i}` }));
    expect(selectNewCandidates(items, [], { limit: 2 })).toHaveLength(2);
  });
});
