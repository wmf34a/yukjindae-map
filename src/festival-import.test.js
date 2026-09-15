import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  rankCandidates,
  mapAddressToRegion,
  toNotionProperties,
  selectNewCandidates,
  splitByUrgency,
  pendingExpiringSoon,
  buildFestivalSlackText,
  normalizeYmd,
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
  it("점수 높은 순, 동점이면 임박한 순으로 정렬한다", () => {
    const items = [
      baseItem({ contentId: "a", title: "지역 축제", eventStartDate: "20260901" }),
      baseItem({ contentId: "b", title: "가족 체험 축제", eventStartDate: "20260905" }),
      baseItem({ contentId: "c", title: "가족 체험 축제", eventStartDate: "20260902" }),
    ];
    // "임박한 순"은 오늘을 기준으로 재므로 today 를 고정하지 않으면 날짜가 바뀔 때
    // 순서가 뒤집힌다. 실제로 2026-09-04 에 이 테스트가 깨졌다.
    const ranked = rankCandidates(items, { limit: 10, today: new Date("2026-08-31T00:00:00Z") });
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

describe("승인 리마인드", () => {
  const TODAY = "2026-09-12"; // 토요일 새벽 수집 직후

  describe("normalizeYmd", () => {
    it("TourAPI 형식과 노션 형식을 같은 모양으로 맞춘다", () => {
      expect(normalizeYmd("20260912")).toBe("2026-09-12");
      expect(normalizeYmd("2026-09-12")).toBe("2026-09-12");
      expect(normalizeYmd("2026-09-12T00:00:00+09:00")).toBe("2026-09-12");
    });
    it("빈 값과 이상한 값은 빈 문자열", () => {
      for (const bad of ["", null, undefined, "언젠가", 123]) expect(normalizeYmd(bad)).toBe("");
    });
  });

  describe("splitByUrgency", () => {
    it("오늘·내일 시작하는 것을 따로 뽑는다", () => {
      const items = [
        { title: "오늘시작", eventStartDate: "20260912" },
        { title: "내일시작", eventStartDate: "20260913" },
        { title: "다음달", eventStartDate: "20261020" },
      ];
      const { urgent, later } = splitByUrgency(items, { today: TODAY });
      expect(urgent.map((u) => u.item.title)).toEqual(["오늘시작", "내일시작"]);
      expect(later.map((u) => u.item.title)).toEqual(["다음달"]);
    });

    it("급한 것은 가까운 순으로 정렬한다", () => {
      const items = [
        { title: "내일", eventStartDate: "20260913" },
        { title: "오늘", eventStartDate: "20260912" },
      ];
      const { urgent } = splitByUrgency(items, { today: TODAY });
      expect(urgent[0].item.title).toBe("오늘");
    });

    it("이미 시작한 축제도 급한 쪽이다 — 아직 안 끝났을 수 있다", () => {
      const { urgent } = splitByUrgency([{ title: "어제부터", eventStartDate: "20260911" }], { today: TODAY });
      expect(urgent).toHaveLength(1);
      expect(urgent[0].dday).toBe(-1);
    });

    it("날짜가 없으면 여유 쪽으로 둔다 — 급하다고 잘못 알리지 않는다", () => {
      const { urgent, later } = splitByUrgency([{ title: "날짜없음" }], { today: TODAY });
      expect(urgent).toHaveLength(0);
      expect(later).toHaveLength(1);
    });
  });

  describe("pendingExpiringSoon", () => {
    const page = (title, start, end, published = false) =>
      ({ title, periodStart: start, periodEnd: end, published });

    it("공개 안 했는데 곧 끝나는 것만 고른다", () => {
      const pages = [
        page("곧끝남", "2026-09-10", "2026-09-14"),
        page("여유있음", "2026-10-01", "2026-10-30"),
        page("이미공개", "2026-09-10", "2026-09-14", true),
      ];
      const out = pendingExpiringSoon(pages, { today: TODAY });
      expect(out.map((o) => o.page.title)).toEqual(["곧끝남"]);
    });

    it("이미 끝난 것은 뺀다 — 켜도 목록에 안 뜬다", () => {
      const out = pendingExpiringSoon([page("지남", "2026-09-01", "2026-09-05")], { today: TODAY });
      expect(out).toHaveLength(0);
    });

    it("종료일이 없으면 시작일을 종료일로 본다", () => {
      const out = pendingExpiringSoon([page("하루짜리", "2026-09-13", "")], { today: TODAY });
      expect(out).toHaveLength(1);
      expect(out[0].daysLeft).toBe(1);
    });

    it("남은 날이 적은 순으로 준다", () => {
      const pages = [page("3일", "2026-09-10", "2026-09-15"), page("오늘", "2026-09-10", "2026-09-12")];
      const out = pendingExpiringSoon(pages, { today: TODAY });
      expect(out.map((o) => o.daysLeft)).toEqual([0, 3]);
    });
  });

  describe("buildFestivalSlackText", () => {
    const dbUrl = "https://notion.so/db";

    it("급한 것을 맨 위에 두고 무엇부터 켤지 말한다", () => {
      const text = buildFestivalSlackText({
        fresh: [{ title: "주말축제", eventStartDate: "20260913" }],
        pending: [],
        today: TODAY,
        dbUrl,
      });
      expect(text.split("\n")[0]).toContain("놓칩니다");
      expect(text).toContain("[내일 시작] 주말축제");
    });

    it("지난 회차 대기 건도 함께 알린다 — 이게 없어서 8건을 놓쳤다", () => {
      const text = buildFestivalSlackText({
        fresh: [],
        pending: [{ page: { title: "지난주것" }, daysLeft: 1, end: "2026-09-13" }],
        today: TODAY,
        dbUrl,
      });
      expect(text).toContain("곧 끝납니다");
      expect(text).toContain("지난주것");
    });

    it("급한 것도 대기 건도 없으면 새 후보만 담백하게 적는다", () => {
      const text = buildFestivalSlackText({
        fresh: [{ title: "다음달축제", eventStartDate: "20261020" }],
        pending: [],
        today: TODAY,
        dbUrl,
      });
      expect(text).not.toContain("놓칩니다");
      expect(text).toContain("여유 있음");
    });

    it("알릴 게 하나도 없으면 빈 문자열 — 빈 알림을 보내지 않는다", () => {
      expect(buildFestivalSlackText({ fresh: [], pending: [], today: TODAY, dbUrl })).toBe("");
    });

    it("마지막 줄은 항상 노션 링크다", () => {
      const text = buildFestivalSlackText({
        fresh: [{ title: "축제", eventStartDate: "20261020" }],
        pending: [], today: TODAY, dbUrl,
      });
      expect(text.trim().split("\n").pop()).toBe(dbUrl);
    });
  });
});
