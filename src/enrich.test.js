import { describe, it, expect } from "vitest";
import {
  needsEnrichment,
  pendingFields,
  buildSearchQuery,
  extractBooleanHint,
  extractFreeAgeHint,
  buildPatchProperties,
  runEnrichment,
  isRelevantToPlace,
  filterRelevantItems,
} from "./enrich.js";

const basePlace = {
  id: "place-1",
  name: "전쟁기념관",
  diaperChange: false,
  nursingRoom: false,
  freeAgePolicy: "",
  verifiedStatus: "",
};

describe("needsEnrichment", () => {
  it("확인상태가 없으면 대상이다", () => {
    expect(needsEnrichment(basePlace)).toBe(true);
  });

  it("확인상태가 미확인이면 대상이다", () => {
    expect(needsEnrichment({ ...basePlace, verifiedStatus: "미확인" })).toBe(true);
  });

  it("확인됨/블로그힌트는 대상이 아니다", () => {
    expect(needsEnrichment({ ...basePlace, verifiedStatus: "확인됨" })).toBe(false);
    expect(needsEnrichment({ ...basePlace, verifiedStatus: "블로그힌트" })).toBe(false);
  });
});

describe("pendingFields", () => {
  it("아직 채워지지 않은 필드만 남긴다", () => {
    const fields = pendingFields(basePlace).map((f) => f.field);
    expect(fields).toEqual(["기저귀교환대", "수유실", "무료입장연령"]);
  });

  it("이미 값이 있는 필드는 제외한다", () => {
    const fields = pendingFields({ ...basePlace, diaperChange: true, freeAgePolicy: "36개월 미만" }).map(
      (f) => f.field
    );
    expect(fields).toEqual(["수유실"]);
  });
});

describe("buildSearchQuery", () => {
  it("불리언 필드는 장소명+키워드로 검색어를 만든다", () => {
    expect(buildSearchQuery(basePlace, { type: "boolean", keyword: "수유실" })).toBe("전쟁기념관 수유실");
  });
});

describe("extractBooleanHint", () => {
  const target = { field: "기저귀교환대", type: "boolean", keyword: "기저귀 교환대" };

  it("키워드가 긍정 문맥이면 해당 아이템을 반환한다", () => {
    const items = [{ title: "전쟁기념관 후기", description: "기저귀 교환대 깨끗해요", link: "https://blog/1" }];
    expect(extractBooleanHint(items, target)).toBe(items[0]);
  });

  it("부정어가 바로 뒤에 있으면 채택하지 않는다", () => {
    const items = [{ title: "전쟁기념관 후기", description: "기저귀 교환대 없어요 아쉬웠음", link: "https://blog/1" }];
    expect(extractBooleanHint(items, target)).toBeNull();
  });

  it("키워드가 없으면 null이다", () => {
    const items = [{ title: "전쟁기념관 후기", description: "주차 편해요", link: "https://blog/1" }];
    expect(extractBooleanHint(items, target)).toBeNull();
  });
});

describe("extractFreeAgeHint", () => {
  it("N개월 미만 무료 패턴을 찾는다", () => {
    const items = [{ title: "전쟁기념관", description: "36개월 미만 무료입장 가능해요", link: "https://blog/2" }];
    const result = extractFreeAgeHint(items);
    expect(result.value).toBe("36개월 미만 무료");
    expect(result.item).toBe(items[0]);
  });

  it("패턴이 없으면 null이다", () => {
    const items = [{ title: "전쟁기념관", description: "주차 편해요", link: "https://blog/2" }];
    expect(extractFreeAgeHint(items)).toBeNull();
  });
});

describe("buildPatchProperties", () => {
  it("불리언 힌트를 체크박스로, 텍스트 힌트를 리치텍스트로 변환한다", () => {
    const hints = [
      { target: { field: "기저귀교환대", type: "boolean" }, hint: { link: "https://blog/1" } },
      { target: { field: "무료입장연령", type: "text" }, hint: { link: "https://blog/2" }, value: "36개월 미만 무료" },
    ];
    const props = buildPatchProperties(hints, "2026-08-24");
    expect(props["기저귀교환대"]).toEqual({ checkbox: true });
    expect(props["무료입장연령"]).toEqual({ rich_text: [{ text: { content: "36개월 미만 무료" } }] });
    expect(props["확인상태"]).toEqual({ select: { name: "블로그힌트" } });
    expect(props["정보확인일"]).toEqual({ date: { start: "2026-08-24" } });
    expect(props["정보출처"]).toEqual({ url: "https://blog/1" });
  });
});

describe("runEnrichment", () => {
  it("힌트가 발견된 장소만 patchPlace를 호출한다", async () => {
    const places = [
      { ...basePlace, id: "p1", name: "전쟁기념관" },
      { ...basePlace, id: "p2", name: "확인된곳", verifiedStatus: "확인됨" },
    ];
    const patched = [];
    const result = await runEnrichment({
      places,
      today: "2026-08-24",
      // 실제 블로그 글이라면 장소명이 제목/본문에 들어 있다 — 관련성 필터를
      // 통과하려면 픽스처도 같은 조건이어야 한다.
      searchBlog: async (query) =>
        query.includes("기저귀")
          ? [{ title: "전쟁기념관 후기", description: "기저귀 교환대 있어요", link: "https://blog/x" }]
          : [],
      patchPlace: async (id, properties) => patched.push({ id, properties }),
    });

    expect(result.checked).toBe(1);
    expect(result.patched).toBe(1);
    expect(patched).toHaveLength(1);
    expect(patched[0].id).toBe("p1");
    expect(patched[0].properties["기저귀교환대"]).toEqual({ checkbox: true });
  });

  it("힌트가 없으면 patchPlace를 호출하지 않는다", async () => {
    const patched = [];
    const result = await runEnrichment({
      places: [{ ...basePlace, id: "p1" }],
      today: "2026-08-24",
      searchBlog: async () => [],
      patchPlace: async (...args) => patched.push(args),
    });
    expect(result.patched).toBe(0);
    expect(patched).toHaveLength(0);
  });

  it("maxPlaces로 처리 대상을 제한한다", async () => {
    const places = Array.from({ length: 15 }, (_, i) => ({ ...basePlace, id: `p${i}`, name: `장소${i}` }));
    const result = await runEnrichment({
      places,
      today: "2026-08-24",
      searchBlog: async () => [],
      patchPlace: async () => {},
      maxPlaces: 3,
    });
    expect(result.checked).toBe(3);
  });
});

const item = (title, description = "") => ({ title, description, link: "https://x" });

describe("isRelevantToPlace", () => {

  it("제목에 장소명이 있으면 관련 글로 본다", () => {
    expect(isRelevantToPlace(item("국립항공박물관 아기랑 후기"), "국립항공박물관")).toBe(true);
  });

  it("본문에 장소명이 있어도 관련 글로 본다", () => {
    expect(isRelevantToPlace(item("주말 나들이", "국립항공박물관 다녀왔어요"), "국립항공박물관")).toBe(true);
  });

  it("띄어쓰기가 달라도 매칭한다", () => {
    expect(isRelevantToPlace(item("서울 어린이 대공원 후기"), "서울어린이대공원")).toBe(true);
  });

  // 실제로 "서울어린이대공원 수유실" 검색에 섞여 나온 광고성 글 사례.
  it("장소와 무관한 글은 걸러낸다", () => {
    expect(isRelevantToPlace(item("CJ기프트카드 사용처 및 잔액 환불"), "서울어린이대공원")).toBe(false);
  });

  it("장소명이 너무 짧으면 매칭하지 않는다", () => {
    expect(isRelevantToPlace(item("아무 글"), "숲")).toBe(false);
  });
});

describe("filterRelevantItems", () => {
  it("관련 글만 남긴다", () => {
    const items = [
      { title: "국립항공박물관 수유실 있어요", description: "", link: "a" },
      { title: "전혀 다른 광고 글", description: "수유실 완비", link: "b" },
    ];
    const filtered = filterRelevantItems(items, "국립항공박물관");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].link).toBe("a");
  });
});

describe("runEnrichment 관련성 필터 연동", () => {
  it("무관한 글만 검색되면 노션에 쓰지 않는다", async () => {
    const patched = [];
    const result = await runEnrichment({
      places: [{ id: "p1", name: "국립항공박물관", verifiedStatus: "" }],
      today: "2026-08-26",
      // 키워드는 들어있지만 장소와 무관한 글만 돌려주는 상황
      searchBlog: async () => [{ title: "CJ기프트카드 사용처", description: "수유실 기저귀 교환대", link: "z" }],
      patchPlace: async (id, props) => patched.push([id, props]),
    });
    expect(patched).toEqual([]);
    expect(result.patched).toBe(0);
  });

  it("관련 글이면 정상적으로 힌트를 반영한다", async () => {
    const patched = [];
    await runEnrichment({
      places: [{ id: "p1", name: "국립항공박물관", verifiedStatus: "" }],
      today: "2026-08-26",
      searchBlog: async () => [
        { title: "국립항공박물관 후기", description: "수유실 기저귀 교환대 잘 되어있어요", link: "z" },
      ],
      patchPlace: async (id, props) => patched.push([id, props]),
    });
    expect(patched).toHaveLength(1);
    expect(patched[0][1]["확인상태"]).toEqual({ select: { name: "블로그힌트" } });
  });
});
