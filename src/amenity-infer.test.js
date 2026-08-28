import { describe, it, expect } from "vitest";
import {
  pickAmenitySnippets,
  buildAmenityPrompt,
  parseAmenities,
  buildAmenityProperties,
  inferAmenities,
  AMENITY_FIELDS,
  MAX_SNIPPETS_PER_PLACE,
} from "./amenity-infer.js";

const now = new Date("2026-08-28").getTime();
const place = { name: "인천어린이과학관", regions: ["계양구", "인천"] };

describe("pickAmenitySnippets", () => {
  it("편의시설 이야기가 있는 최근 글만 고른다", () => {
    const out = pickAmenitySnippets([
      { title: "인천어린이과학관 후기", description: "2층에 수유실 있어요", date: "20260810" },
      { title: "인천어린이과학관 후기", description: "주차가 편해요", date: "20260810" },
    ], place, now);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("수유실");
  });

  // 리모델링으로 시설이 바뀐다.
  it("6개월 넘은 글은 뺀다", () => {
    expect(pickAmenitySnippets([
      { title: "인천어린이과학관", description: "수유실 있어요", date: "20240101" },
    ], place, now)).toHaveLength(0);
  });

  it("다른 장소 글은 뺀다", () => {
    expect(pickAmenitySnippets([
      { title: "근처 카페", description: "수유실 있어요", date: "20260810" },
    ], place, now)).toHaveLength(0);
  });

  // 같은 글이 블로그·카페 검색 양쪽에 걸린다.
  it("같은 내용은 한 번만 싣는다", () => {
    const same = { title: "인천어린이과학관", description: "수유실 있어요", date: "20260810" };
    expect(pickAmenitySnippets([same, { ...same }], place, now)).toHaveLength(1);
  });

  it("너무 많이 싣지 않는다", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: "인천어린이과학관", description: `수유실 있어요 ${i}`, date: "20260810",
    }));
    expect(pickAmenitySnippets(many, place, now)).toHaveLength(MAX_SNIPPETS_PER_PLACE);
  });
});

describe("buildAmenityPrompt", () => {
  const prompt = buildAmenityPrompt([
    { no: 1, name: "인천어린이과학관", region: "인천", snippets: [{ date: "20260810", text: "2층 수유실" }] },
  ]);

  it("장소와 근거를 싣는다", () => {
    expect(prompt).toContain("1. 인천어린이과학관");
    expect(prompt).toContain("2층 수유실");
  });

  // 이게 이 모듈의 핵심 규칙이다.
  it("언급 없음을 false로 쓰지 말라고 못박는다", () => {
    expect(prompt).toContain("false를 쓰지 마라");
    expect(prompt).toContain("아무도 적지 않았다");
  });

  it("표현이 다른 같은 시설을 알려준다", () => {
    expect(prompt).toContain("기저귀 갈이대");
    expect(prompt).toContain("하이체어");
  });
});

describe("parseAmenities", () => {
  const entries = [
    { no: 1, name: "가", region: "인천", snippets: [] },
    { no: 2, name: "나", region: "인천", snippets: [] },
  ];

  it("true를 읽는다", () => {
    const out = parseAmenities('{"places":[{"no":1,"수유실":true,"기저귀교환대":true,"유아의자":null,"basis":"x"}]}', entries);
    expect(out.ok).toBe(true);
    expect(out.results[0].fields).toEqual({ 수유실: true, 기저귀교환대: true, 유아의자: null });
  });

  // 모델이 false를 넣어도 우리는 켜지도 끄지도 않는다. 끄는 것은 "확인해 보니
  // 없더라"는 단언인데 블로그에는 그만큼의 근거가 없다.
  it("false는 판정 없음으로 취급한다", () => {
    const out = parseAmenities('{"places":[{"no":1,"수유실":false,"기저귀교환대":false,"유아의자":false}]}', entries);
    expect(out.results[0].fields).toEqual({ 수유실: null, 기저귀교환대: null, 유아의자: null });
  });

  it("이상한 값도 판정 없음으로 만든다", () => {
    const out = parseAmenities('{"places":[{"no":1,"수유실":"있음","기저귀교환대":1,"유아의자":"true"}]}', entries);
    expect(Object.values(out.results[0].fields).every((v) => v === null)).toBe(true);
  });

  it("없는 번호와 중복을 걸러낸다", () => {
    const out = parseAmenities('{"places":[{"no":1,"수유실":true},{"no":1,"수유실":true},{"no":99,"수유실":true}]}', entries);
    expect(out.results).toHaveLength(1);
  });

  it("파싱 실패는 실패로 돌려준다", () => {
    expect(parseAmenities("문장만 있음", entries).ok).toBe(false);
  });
});

describe("buildAmenityProperties", () => {
  it("true인 항목만 보낸다", () => {
    expect(buildAmenityProperties({ 수유실: true, 기저귀교환대: null, 유아의자: null }))
      .toEqual({ 수유실: { checkbox: true } });
  });

  // 판정이 없는 항목을 false로 보내면, 사람이 손으로 켜 둔 값을 지워 버린다.
  it("판정이 없으면 아무것도 보내지 않는다", () => {
    expect(buildAmenityProperties({ 수유실: null, 기저귀교환대: null, 유아의자: null })).toEqual({});
  });

  it("세 항목 이름이 노션 속성과 같다", () => {
    expect(AMENITY_FIELDS).toEqual(["수유실", "기저귀교환대", "유아의자"]);
  });
});

describe("inferAmenities", () => {
  const entries = [{ no: 1, name: "가", region: "인천", snippets: [] }];

  it("판정 결과를 돌려준다", async () => {
    const out = await inferAmenities(entries, async () => '{"places":[{"no":1,"수유실":true}]}');
    expect(out.results[0].fields["수유실"]).toBe(true);
  });

  it("호출 실패를 실패로 돌려준다", async () => {
    const out = await inferAmenities(entries, async () => { throw new Error("timeout"); });
    expect(out.ok).toBe(false);
  });

  it("대상이 없으면 호출하지 않는다", async () => {
    let called = false;
    await inferAmenities([], async () => { called = true; return ""; });
    expect(called).toBe(false);
  });
});
