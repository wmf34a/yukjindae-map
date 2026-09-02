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

  it("성인 전용 키워드가 있으면 null(제외)이다", () => {
    expect(scoreCandidate(baseItem({ title: "19세 이상 클럽 파티" }))).toBeNull();
  });

  it("사람이 뺀 축제(REJECTED)는 null이다 — 노션에서 지워도 다시 안 만든다", () => {
    expect(scoreCandidate(baseItem({ contentId: "3486887", title: "왜관 홀리 페스티벌" }))).toBeNull();
  });

  it("술이 나오지만 성인 전용은 아닌 축제는 제외하지 않는다", () => {
    expect(scoreCandidate(baseItem({ title: "강북 백맥축제" }))).toBe(0);
    expect(scoreCandidate(baseItem({ title: "거제맥주축제" }))).toBe(0);
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

  it("성인 전용 후보는 결과에서 빠진다", () => {
    const items = [baseItem({ contentId: "a", title: "클럽 헌팅 파티" })];
    expect(rankCandidates(items)).toEqual([]);
  });

  it("limit은 가점 후보에만 적용된다", () => {
    const items = Array.from({ length: 5 }, (_, i) => baseItem({ contentId: `${i}` }));
    expect(rankCandidates(items, { limit: 2, zeroScoreLimit: 0 })).toHaveLength(2);
  });

  it("0점 후보도 임박한 순으로 zeroScoreLimit개까지 뒤에 붙는다", () => {
    const items = [
      baseItem({ contentId: "z2", title: "홍성남당항 대하축제", eventStartDate: "20260910" }),
      baseItem({ contentId: "p", title: "가족 체험 축제", eventStartDate: "20261001" }),
      baseItem({ contentId: "z1", title: "지역 문화 페스티벌", eventStartDate: "20260905" }),
      baseItem({ contentId: "z3", title: "군민의 날 축전", eventStartDate: "20260920" }),
    ];
    const ranked = rankCandidates(items, {
      limit: 10,
      zeroScoreLimit: 2,
      today: new Date("2026-09-02T00:00:00Z"),
    });
    expect(ranked.map((i) => i.contentId)).toEqual(["p", "z1", "z2"]);
  });

  it("0점 몫은 축제다운 제목만 받는다 — 전시·공연은 뺀다", () => {
    const items = [
      baseItem({ contentId: "전시", title: "섬유기획전 《안식의 결》" }),
      baseItem({ contentId: "야행", title: "공주 국가유산야행" }),
      baseItem({ contentId: "대하", title: "홍성남당항 대하축제" }),
    ];
    expect(rankCandidates(items).map((i) => i.contentId)).toEqual(["대하"]);
  });

  it("연중 상설(180일 이상) 축제는 시작일이 일러도 뒤로 밀린다", () => {
    const items = [
      baseItem({
        contentId: "상설",
        title: "서울 왕궁수문장 축제",
        eventStartDate: "20260101",
        eventEndDate: "20261231",
      }),
      baseItem({
        contentId: "대하",
        title: "홍성남당항 대하축제",
        eventStartDate: "20260904",
        eventEndDate: "20261108",
      }),
    ];
    expect(rankCandidates(items).map((i) => i.contentId)).toEqual(["대하", "상설"]);
  });

  it("이미 시작했어도 진행 중인 장기 축제는 후보로 남는다", () => {
    const items = [
      baseItem({
        contentId: "대하",
        title: "홍성남당항 대하축제",
        eventStartDate: "20260904",
        eventEndDate: "20261108",
      }),
    ];
    expect(rankCandidates(items).map((i) => i.contentId)).toEqual(["대하"]);
  });

  it("zeroScoreLimit이 0이면 0점 후보는 빠진다", () => {
    const items = [baseItem({ contentId: "z", title: "지역 문화 페스티벌" })];
    expect(rankCandidates(items, { zeroScoreLimit: 0 })).toEqual([]);
  });
});

describe("toNotionProperties 요금", () => {
  it("useFee가 있으면 요금 속성을 채운다", () => {
    const props = toNotionProperties(baseItem({ useFee: "유료 (대인 19,000원)" }), 1);
    expect(props["요금"].rich_text[0].text.content).toBe("유료 (대인 19,000원)");
  });

  it("useFee가 없으면 요금 속성을 넣지 않는다", () => {
    expect(toNotionProperties(baseItem(), 1)["요금"]).toBeUndefined();
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

  it("limit이 없으면 전부 남긴다", () => {
    const items = Array.from({ length: 30 }, (_, i) => baseItem({ contentId: `${i}` }));
    expect(selectNewCandidates(items, [])).toHaveLength(30);
  });
});
