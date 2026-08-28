import { describe, it, expect } from "vitest";
import {
  pickFeeSnippets,
  buildFeePrompt,
  parseFees,
  inferFees,
  MAX_SNIPPETS_PER_PLACE,
  matchToken,
} from "./fee-infer.js";

const now = new Date("2026-08-28").getTime();

describe("pickFeeSnippets", () => {
  const place = { name: "미동산수목원", regions: ["청주시", "충북"] };

  it("요금 이야기가 있는 최근 글만 고른다", () => {
    const out = pickFeeSnippets([
      { title: "청주 미동산수목원 입장료 무료", description: "", date: "20260825" },
      { title: "청주 미동산수목원 산책", description: "날씨 좋아요", date: "20260825" },
    ], place, now);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("입장료");
  });

  // 오래된 글은 요금이 바뀌었을 수 있다.
  it("6개월 넘은 글은 뺀다", () => {
    expect(pickFeeSnippets([
      { title: "청주 미동산수목원 입장료 무료", date: "20240101" },
    ], place, now)).toHaveLength(0);
  });

  // "장미공원 입장료" 검색에 다른 지역 글이 걸린 적이 있다.
  it("장소를 언급하지 않는 글은 뺀다", () => {
    expect(pickFeeSnippets([
      { title: "근처 카페 후기", description: "입장료 무료", date: "20260825" },
    ], place, now)).toHaveLength(0);
  });

  it("너무 많이 싣지 않는다", () => {
    const many = Array.from({ length: 20 }, () => ({
      title: "청주 미동산수목원 입장료 무료", date: "20260825",
    }));
    expect(pickFeeSnippets(many, place, now)).toHaveLength(MAX_SNIPPETS_PER_PLACE);
  });

  it("빈 입력도 죽지 않는다", () => {
    expect(pickFeeSnippets(null, place, now)).toEqual([]);
  });
});

describe("pickFeeSnippets 지역 후보", () => {
  // "마포구"를 안 쓰고 "서울 난지한강공원"이라 적은 글이 대부분이다.
  it("시·도만 맞아도 통과시킨다", () => {
    const out = pickFeeSnippets(
      [{ title: "서울 난지한강공원 입장료 무료", date: "20260825" }],
      { name: "난지한강공원", regions: ["마포구", "서울"] }, now
    );
    expect(out).toHaveLength(1);
  });

  it("어느 쪽도 안 맞으면 뺀다", () => {
    const out = pickFeeSnippets(
      [{ title: "부산 난지한강공원 입장료", date: "20260825" }],
      { name: "난지한강공원", regions: ["마포구", "서울"] }, now
    );
    expect(out).toHaveLength(0);
  });
});

describe("matchToken", () => {
  // 블로그는 "청주시"가 아니라 "청주"라고 쓴다. 접미사를 두면 실제 후기가 다 걸러진다.
  it("행정구역 접미사를 뗀다", () => {
    expect(matchToken("청주시")).toBe("청주");
    expect(matchToken("합천군")).toBe("합천");
    expect(matchToken("계양구")).toBe("계양");
    expect(matchToken("")).toBe("");
  });
});

describe("buildFeePrompt", () => {
  const prompt = buildFeePrompt([
    { no: 1, name: "미동산수목원", region: "청주시", snippets: [{ date: "20260825", text: "입장료 무료" }] },
  ]);

  it("장소와 근거를 싣는다", () => {
    expect(prompt).toContain("1. 미동산수목원");
    expect(prompt).toContain("입장료 무료");
  });

  // 이 규칙이 없으면 한 글만 보고 금액을 확정한다.
  it("글 2개 이상 일치를 요구한다", () => {
    expect(prompt).toContain("2개 이상");
  });

  it("추측 금지와 주차료 혼동 금지를 못박는다", () => {
    expect(prompt).toContain("추측해서 적지 마라");
    expect(prompt).toContain("주차료");
  });
});

describe("parseFees", () => {
  const entries = [
    { no: 1, name: "미동산수목원", region: "청주시", snippets: [] },
    { no: 2, name: "청주동물원", region: "청주시", snippets: [] },
  ];

  it("무료와 금액을 읽는다", () => {
    const out = parseFees('{"fees":[{"no":1,"fee":"무료","basis":"여러 글이 무료"},{"no":2,"fee":"어른 1,000원","basis":"천원"}]}', entries);
    expect(out.ok).toBe(true);
    expect(out.results[0]).toMatchObject({ name: "미동산수목원", fee: "무료" });
    expect(out.results[1].fee).toBe("어른 1,000원");
  });

  // 확신이 없으면 null이어야 하고, 그게 정상 동작이다.
  it("null은 그대로 비워 둔다", () => {
    const out = parseFees('{"fees":[{"no":1,"fee":null},{"no":2,"fee":null}]}', entries);
    expect(out.results.every((r) => r.fee === null)).toBe(true);
  });

  // "확인 필요" 같은 문장이 입장료 칸에 들어가면 앱에 그대로 노출된다.
  it("금액 형태가 아닌 답은 버린다", () => {
    const out = parseFees('{"fees":[{"no":1,"fee":"확인 필요"},{"no":2,"fee":"블로그 참고"}]}', entries);
    expect(out.results.every((r) => r.fee === null)).toBe(true);
  });

  it("없는 번호와 중복을 걸러낸다", () => {
    const out = parseFees('{"fees":[{"no":1,"fee":"무료"},{"no":1,"fee":"유료"},{"no":99,"fee":"무료"}]}', entries);
    expect(out.results).toHaveLength(1);
  });

  it("지나치게 긴 답은 버린다", () => {
    const out = parseFees(`{"fees":[{"no":1,"fee":"${"원 ".repeat(80)}"}]}`, entries);
    expect(out.results[0].fee).toBeNull();
  });

  it("파싱 실패는 실패로 돌려준다", () => {
    expect(parseFees("문장만 있음", entries).ok).toBe(false);
  });
});

describe("inferFees", () => {
  const entries = [{ no: 1, name: "미동산수목원", region: "청주시", snippets: [] }];

  it("판정 결과를 돌려준다", async () => {
    const out = await inferFees(entries, async () => '{"fees":[{"no":1,"fee":"무료","basis":"x"}]}');
    expect(out.results[0].fee).toBe("무료");
  });

  // 호출이 실패했다고 값을 채우면 안 된다.
  it("호출 실패를 실패로 돌려준다", async () => {
    const out = await inferFees(entries, async () => { throw new Error("timeout"); });
    expect(out.ok).toBe(false);
    expect(out.results).toEqual([]);
  });

  it("대상이 없으면 호출하지 않는다", async () => {
    let called = false;
    await inferFees([], async () => { called = true; return ""; });
    expect(called).toBe(false);
  });
});

describe("유료 시설이 안에 있는 무료 공원", () => {
  // 서대문독립공원은 무료지만 정작 가는 이유인 형무소역사관은 유료다.
  // "무료"라고만 적으면 현장에서 예상 못 한 요금을 만난다.
  it("함께 적으라고 프롬프트에 못박는다", () => {
    const prompt = buildFeePrompt([{ no: 1, name: "가", region: "서울", snippets: [] }]);
    expect(prompt).toContain("안의 주요 시설");
    expect(prompt).toContain("별도 유료");
  });

  it("괄호가 붙은 값도 통과시킨다", () => {
    const out = parseFees(
      '{"fees":[{"no":1,"fee":"무료 (서대문형무소역사관 별도 유료)","basis":"x"}]}',
      [{ no: 1, name: "가", region: "서울", snippets: [] }]
    );
    expect(out.results[0].fee).toBe("무료 (서대문형무소역사관 별도 유료)");
  });
});

describe("FEE_SHAPE 경계", () => {
  const one = [{ no: 1, name: "가", region: "서울", snippets: [] }];
  const feeOf = (v) => parseFees(`{"fees":[{"no":1,"fee":${JSON.stringify(v)}}]}`, one).results[0].fee;

  it("숫자 없는 '원'만 있는 문장은 버린다", () => {
    expect(feeOf("현장에서 원하는 만큼")).toBeNull();
  });

  it("실제 금액은 통과시킨다", () => {
    expect(feeOf("어른 1,000원")).toBe("어른 1,000원");
  });
});
