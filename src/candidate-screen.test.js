import { describe, it, expect } from "vitest";
import {
  buildScreenCandidates,
  buildScreenPrompt,
  extractJson,
  parseVerdicts,
  screenCandidates,
  MAX_SCREEN_CANDIDATES,
  PASS_SCORE,
} from "./candidate-screen.js";

const places = [
  { name: "청주동물원", address: "충북 청주시", hours: "09:00~18:00", fee: "1000원", reason: "동물 관람" },
  { name: "감중공원", address: "인천 서구", reason: "" },
];

describe("buildScreenCandidates", () => {
  it("1부터 번호를 매긴다", () => {
    const out = buildScreenCandidates(places);
    expect(out.map((c) => c.no)).toEqual([1, 2]);
    expect(out[0].name).toBe("청주동물원");
  });

  // 지역당 한 번 부르므로 프롬프트가 감당할 만큼만 싣는다.
  it("상한을 넘기지 않는다", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `장소${i}` }));
    expect(buildScreenCandidates(many)).toHaveLength(MAX_SCREEN_CANDIDATES);
  });

  it("빈 목록도 죽지 않는다", () => {
    expect(buildScreenCandidates([])).toEqual([]);
  });
});

describe("buildScreenPrompt", () => {
  const prompt = buildScreenPrompt({ region: "인천", candidates: buildScreenCandidates(places) });

  it("지역과 후보를 싣는다", () => {
    expect(prompt).toContain("인천");
    expect(prompt).toContain("1. 청주동물원");
    expect(prompt).toContain("2. 감중공원");
  });

  // 이 문장이 판정의 핵심이다 — 언급량으로는 못 가르는 부분.
  it("일부러 갈 곳인지를 핵심 질문으로 세운다", () => {
    expect(prompt).toContain("일부러 찾아갈");
  });

  // 목록 밖 장소를 지어내는 것이 실제로 일어난다.
  it("장소를 만들어내지 말라고 못박는다", () => {
    expect(prompt).toContain("만들어내지 않는다");
  });
});

describe("extractJson", () => {
  it("그냥 JSON을 읽는다", () => {
    expect(extractJson('{"verdicts":[]}')).toEqual({ verdicts: [] });
  });

  it("코드펜스로 감싸도 읽는다", () => {
    expect(extractJson('```json\n{"verdicts":[]}\n```')).toEqual({ verdicts: [] });
  });

  it("앞뒤에 말을 붙여도 읽는다", () => {
    expect(extractJson('판정입니다.\n{"verdicts":[]}\n감사합니다')).toEqual({ verdicts: [] });
  });

  it("못 읽으면 null", () => {
    expect(extractJson("그냥 문장")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("parseVerdicts", () => {
  const candidates = buildScreenCandidates(places);

  it("점수와 통과 여부를 매긴다", () => {
    const out = parseVerdicts('{"verdicts":[{"no":1,"score":5,"reason":"동물원"},{"no":2,"score":2,"reason":"근린공원"}]}', candidates);
    expect(out.ok).toBe(true);
    expect(out.verdicts[0]).toMatchObject({ name: "청주동물원", score: 5, pass: true });
    expect(out.verdicts[1]).toMatchObject({ name: "감중공원", score: 2, pass: false });
  });

  // 2점은 "동네 사람에겐 좋다" 수준이라 통과시키면 앱이 동네 공원 목록이 된다.
  it(`${PASS_SCORE}점부터 통과시킨다`, () => {
    const out = parseVerdicts('{"verdicts":[{"no":1,"score":3,"reason":"x"},{"no":2,"score":2,"reason":"y"}]}', candidates);
    expect(out.verdicts[0].pass).toBe(true);
    expect(out.verdicts[1].pass).toBe(false);
  });

  it("없는 번호와 중복을 걸러낸다", () => {
    const out = parseVerdicts('{"verdicts":[{"no":1,"score":5},{"no":1,"score":4},{"no":99,"score":5}]}', candidates);
    expect(out.verdicts).toHaveLength(1);
  });

  it("범위 밖 점수를 걸러낸다", () => {
    const out = parseVerdicts('{"verdicts":[{"no":1,"score":9},{"no":2,"score":3}]}', candidates);
    expect(out.verdicts.map((v) => v.name)).toEqual(["감중공원"]);
  });

  // 판정이 빠진 후보를 조용히 통과시키면 근거 없이 등록된다.
  it("판정이 빠진 후보를 알려준다", () => {
    const out = parseVerdicts('{"verdicts":[{"no":1,"score":5}]}', candidates);
    expect(out.missing).toEqual(["감중공원"]);
  });

  it("파싱 실패와 빈 결과를 실패로 돌려준다", () => {
    expect(parseVerdicts("그냥 문장", candidates).ok).toBe(false);
    expect(parseVerdicts('{"verdicts":[{"no":99,"score":5}]}', candidates).ok).toBe(false);
  });
});

describe("screenCandidates", () => {
  it("판정 결과를 돌려준다", async () => {
    const out = await screenCandidates({
      region: "충북", places,
      askClaude: async () => '{"verdicts":[{"no":1,"score":5,"reason":"동물원"},{"no":2,"score":2,"reason":"근린공원"}]}',
    });
    expect(out.ok).toBe(true);
    expect(out.verdicts.filter((v) => v.pass).map((v) => v.name)).toEqual(["청주동물원"]);
  });

  // 호출이 실패했다고 후보를 통과시키면 안 된다.
  it("호출 실패를 실패로 돌려준다", async () => {
    const out = await screenCandidates({
      region: "충북", places,
      askClaude: async () => { throw new Error("timeout"); },
    });
    expect(out.ok).toBe(false);
    expect(out.verdicts).toEqual([]);
  });

  it("후보가 없으면 호출하지 않는다", async () => {
    let called = false;
    const out = await screenCandidates({
      region: "충북", places: [],
      askClaude: async () => { called = true; return ""; },
    });
    expect(called).toBe(false);
    expect(out.ok).toBe(true);
  });
});
