import { describe, it, expect } from "vitest";
import { buildAgePrompt, parseAges } from "./free-age-infer.js";

const entries = [{ no: 1, name: "가나다박물관", addr: "경기 수원시" }, { no: 2, name: "라마바랜드", addr: "제주" }];

describe("parseAges", () => {
  it("연령 표기가 아닌 답은 보류로 떨군다", () => {
    // "홈페이지 참고" 같은 문장이 이 칸에 들어가면 상세페이지에 그대로 뜬다.
    const out = parseAges(`{"ages":[{"no":1,"age":"홈페이지 참고","source":""}]}`, entries);
    expect(out.results[0].age).toBeNull();
  });

  it("개월·세 표기를 모두 받는다", () => {
    const out = parseAges(
      `{"ages":[{"no":1,"age":"36개월 미만","source":"공식"},{"no":2,"age":"만 4세 이하","source":"공식"}]}`,
      entries
    );
    expect(out.results.map((r) => r.age)).toEqual(["36개월 미만", "만 4세 이하"]);
  });

  it("무료 연령이 없는 시설은 '없음'으로 받는다", () => {
    const out = parseAges(`{"ages":[{"no":1,"age":"없음","source":"공식"}]}`, entries);
    expect(out.results[0].age).toBe("없음");
  });

  it("같은 번호가 두 번 오면 한 번만 센다", () => {
    const out = parseAges(
      `{"ages":[{"no":1,"age":"36개월 미만","source":""},{"no":1,"age":"만 5세 이하","source":""}]}`,
      entries
    );
    expect(out.results).toHaveLength(1);
    expect(out.results[0].age).toBe("36개월 미만");
  });

  it("JSON이 아니면 실패로 알린다", () => {
    expect(parseAges("확인이 어렵습니다", entries).ok).toBe(false);
  });
});

describe("buildAgePrompt", () => {
  it("블로그를 근거로 쓰지 말라고 못박는다", () => {
    // 검수에서 틀린 5곳이 전부 블로그 글쓴이의 자기 아이 나이였다.
    const prompt = buildAgePrompt(entries);
    expect(prompt).toContain("블로그 후기는 근거로 쓰지 마라");
  });

  it("주소를 함께 실어 동명 시설을 가른다", () => {
    expect(buildAgePrompt(entries)).toContain("경기 수원시");
  });
});
