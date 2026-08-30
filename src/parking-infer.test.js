import { describe, it, expect } from "vitest";
import {
  nameVariants,
  pickParkingSnippets,
  isRecentEnough,
  parseParking,
  buildParkingPrompt,
} from "./parking-infer.js";

const NOW = new Date("2026-08-30").getTime();
const post = (over = {}) => ({
  title: "속초 국립산악박물관 다녀왔어요",
  description: "주차비 무료라 좋았어요",
  link: "https://blog.example/1",
  date: "20260501",
  ...over,
});

describe("nameVariants", () => {
  it("지역 접두어를 뗀 이름도 후보로 낸다", () => {
    // 블로그는 "나주 국립나주박물관"이 아니라 "국립나주박물관"이라고 쓴다.
    expect(nameVariants("나주 국립나주박물관")).toContain("국립나주박물관");
  });

  it("괄호 안의 실제 이름을 꺼낸다", () => {
    const v = nameVariants("김해 워터파크(롯데워터파크 기준)");
    expect(v).toContain("롯데워터파크");
    expect(v).toContain("김해 워터파크");
  });

  it("뒤 토막이 너무 짧으면 후보로 쓰지 않는다", () => {
    // "대전 오월드"에서 "오월드"만 남기면 엉뚱한 글이 잔뜩 걸린다.
    expect(nameVariants("대전 오월드")).toEqual(["대전 오월드"]);
  });

  it("공백 없는 이름은 그대로 하나만 낸다", () => {
    expect(nameVariants("보령석탄박물관")).toEqual(["보령석탄박물관"]);
  });
});

describe("isRecentEnough", () => {
  it("3년 안쪽 글은 통과시킨다", () => {
    // place-pipeline의 182일 창을 쓰면 주차 무료를 명시한 글이 전부 탈락한다.
    expect(isRecentEnough("20250207", NOW)).toBe(true);
  });

  it("3년보다 오래된 글은 버린다", () => {
    expect(isRecentEnough("20200101", NOW)).toBe(false);
  });

  it("날짜가 없으면 판단하지 않고 통과시킨다", () => {
    expect(isRecentEnough("", NOW)).toBe(true);
  });
});

describe("pickParkingSnippets", () => {
  const target = { name: "국립산악박물관", regions: ["속초시", "강원"] };

  it("주차 이야기가 없는 글은 뺀다", () => {
    const out = pickParkingSnippets([post({ description: "전시가 알찼어요" })], target, NOW);
    expect(out).toEqual([]);
  });

  it("같은 글이 두 번 들어오면 한 번만 싣는다", () => {
    // 지역을 붙인 검색과 안 붙인 검색이 같은 글을 물어 온다. 두 번 실으면
    // AI가 "서로 다른 글 2개"로 착각해 한 글만 보고 확정해 버린다.
    const out = pickParkingSnippets([post(), post()], target, NOW);
    expect(out).toHaveLength(1);
  });

  it("이름 변형으로도 걸린다", () => {
    const out = pickParkingSnippets(
      [post({ title: "국립나주박물관 주차 무료" })],
      { name: "나주 국립나주박물관", regions: ["나주시", "전남"] },
      NOW
    );
    expect(out).toHaveLength(1);
  });
});

describe("parseParking", () => {
  const entries = [{ no: 1, name: "가나다수목원" }, { no: 2, name: "라마바박물관" }];

  it("노션 select에 없는 값은 보류로 떨군다", () => {
    const out = parseParking(`{"parking":[{"no":1,"status":"가능","detail":"","basis":""}]}`, entries);
    expect(out.results[0].status).toBeNull();
  });

  it("판단 문구가 섞인 상세는 비운다", () => {
    // "확인 필요" 같은 말이 주차상세 칸에 들어가면 앱에 그대로 노출된다.
    const out = parseParking(
      `{"parking":[{"no":1,"status":"유료","detail":"2,000원 추정","basis":"글 2개"}]}`,
      entries
    );
    expect(out.results[0].status).toBe("유료");
    expect(out.results[0].detail).toBe("");
  });

  it("코드펜스로 감싼 응답도 읽는다", () => {
    const out = parseParking(
      "```json\n{\"parking\":[{\"no\":2,\"status\":\"무료\",\"detail\":\"전용 주차장\",\"basis\":\"\"}]}\n```",
      entries
    );
    expect(out.results[0]).toMatchObject({ name: "라마바박물관", status: "무료" });
  });

  it("JSON이 아니면 실패로 알린다", () => {
    expect(parseParking("모르겠습니다", entries).ok).toBe(false);
  });
});

describe("buildParkingPrompt", () => {
  it("입장료를 주차료로 읽지 말라고 못박는다", () => {
    // 후기는 "입장료 무료"와 "주차 무료"를 한 문장에 섞어 쓴다.
    const prompt = buildParkingPrompt([{ no: 1, name: "가나다", region: "강원", snippets: [] }]);
    expect(prompt).toContain("입장료·체험료는 주차료가 아니다");
  });
});
