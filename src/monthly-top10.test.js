import { describe, it, expect } from "vitest";
import {
  TOP_N,
  seasonHint,
  parseMonthKey,
  groupByRegion,
  buildCandidates,
  buildPrompt,
  extractJson,
  parseRanking,
  applyPinned,
  buildPatchProperties,
  buildClearProperties,
  pickPlacesToClear,
  runMonthlyTop10,
} from "./monthly-top10.js";

const place = (over = {}) => ({
  id: `id-${over.name || "x"}`,
  name: "장소",
  region: "제주",
  categories: [],
  fee: "",
  freeAgePolicy: "",
  hours: "",
  reason: "",
  rank: null,
  rankMonth: "",
  rankReason: "",
  rankPinned: false,
  ...over,
});

describe("parseMonthKey", () => {
  it("YYYY-MM을 연/월로 나눈다", () => {
    expect(parseMonthKey("2026-09")).toEqual({ year: 2026, month: 9 });
  });

  it("형식이 다르거나 월이 범위를 벗어나면 null", () => {
    expect(parseMonthKey("2026-9")).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-00")).toBeNull();
    expect(parseMonthKey("")).toBeNull();
    expect(parseMonthKey(undefined)).toBeNull();
  });
});

describe("seasonHint", () => {
  it("한여름은 물놀이와 실내를 우대하라고 안내한다", () => {
    expect(seasonHint(8)).toContain("물놀이");
    expect(seasonHint(8)).toContain("실내");
  });

  it("한겨울은 실내를 우대하라고 안내한다", () => {
    expect(seasonHint(1)).toContain("실내");
  });

  it("모든 달에 힌트가 있다", () => {
    for (let m = 1; m <= 12; m += 1) {
      expect(seasonHint(m).length).toBeGreaterThan(0);
    }
  });

  it("월이 아닌 값은 빈 문자열", () => {
    expect(seasonHint(0)).toBe("");
    expect(seasonHint(13)).toBe("");
  });
});

describe("groupByRegion", () => {
  it("지역별로 묶는다", () => {
    const groups = groupByRegion([
      place({ name: "a", region: "제주" }),
      place({ name: "b", region: "제주" }),
      place({ name: "c", region: "강원도" }),
    ]);
    expect(groups.get("제주")).toHaveLength(2);
    expect(groups.get("강원도")).toHaveLength(1);
  });

  it("지역이 비어있는 장소는 버린다", () => {
    const groups = groupByRegion([place({ name: "a", region: "" })]);
    expect(groups.size).toBe(0);
  });
});

describe("buildCandidates", () => {
  it("1부터 번호를 매긴다", () => {
    const candidates = buildCandidates([place({ name: "a" }), place({ name: "b" })]);
    expect(candidates.map((c) => c.no)).toEqual([1, 2]);
    expect(candidates[0].id).toBe("id-a");
  });

  it("상한을 넘으면 잘라낸다", () => {
    const many = Array.from({ length: 60 }, (_, i) => place({ name: `p${i}` }));
    expect(buildCandidates(many)).toHaveLength(40);
  });
});

describe("buildPrompt", () => {
  const candidates = buildCandidates([
    place({ name: "표선해수욕장", categories: ["자연·공원", "무료"], fee: "무료" }),
    place({ name: "아르떼 키즈파크", categories: ["실내놀이"], freeAgePolicy: "12개월 미만 무료" }),
  ]);

  it("지역명과 대상 월을 담는다", () => {
    const prompt = buildPrompt({ monthKey: "2026-08", region: "제주", candidates });
    expect(prompt).toContain("제주");
    expect(prompt).toContain("2026-08");
  });

  it("그 달의 계절 힌트를 넣는다", () => {
    expect(buildPrompt({ monthKey: "2026-08", region: "제주", candidates })).toContain("폭염");
    expect(buildPrompt({ monthKey: "2026-01", region: "제주", candidates })).toContain("한겨울");
  });

  it("후보를 번호와 함께 나열한다", () => {
    const prompt = buildPrompt({ monthKey: "2026-08", region: "제주", candidates });
    expect(prompt).toContain("1. 표선해수욕장");
    expect(prompt).toContain("2. 아르떼 키즈파크");
  });

  // 후보가 10곳도 안 되는 지역(인천 3곳 등)에 10개를 요구하면 모델이 없는 곳을
  // 지어내기 쉽다. 요청 개수를 후보 수로 낮춰야 한다.
  it("후보가 10곳 미만이면 그만큼만 요구한다", () => {
    const few = buildCandidates([place({ name: "a" }), place({ name: "b" })]);
    const prompt = buildPrompt({ monthKey: "2026-08", region: "인천", candidates: few });
    expect(prompt).toContain("상위 2곳");
    expect(prompt).toContain("정확히 2개");
  });
});

describe("extractJson", () => {
  it("순수 JSON을 파싱한다", () => {
    expect(extractJson('{"picks":[{"no":1}]}')).toEqual({ picks: [{ no: 1 }] });
  });

  it("코드펜스로 감싼 JSON을 파싱한다", () => {
    expect(extractJson('```json\n{"picks":[{"no":2}]}\n```')).toEqual({ picks: [{ no: 2 }] });
  });

  it("앞뒤에 말이 붙어도 중괄호 블록을 꺼낸다", () => {
    expect(extractJson('네, 골랐습니다.\n{"picks":[{"no":3}]}\n이상입니다.')).toEqual({
      picks: [{ no: 3 }],
    });
  });

  it("JSON이 없으면 null", () => {
    expect(extractJson("고를 수 없습니다")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("parseRanking", () => {
  const candidates = buildCandidates([
    place({ name: "a" }),
    place({ name: "b" }),
    place({ name: "c" }),
  ]);

  it("번호를 장소 ID로 되돌린다", () => {
    const result = parseRanking('{"picks":[{"no":2,"reason":"시원함"},{"no":1,"reason":"무료"}]}', candidates);
    expect(result.ok).toBe(true);
    expect(result.ranking.map((r) => r.id)).toEqual(["id-b", "id-a"]);
    expect(result.ranking[0].reason).toBe("시원함");
  });

  // 모델이 존재하지 않는 번호를 부르는 일이 실제로 있다. 통과시키면 Notion PATCH가
  // 엉뚱한 페이지를 건드리거나 404가 난다.
  it("목록에 없는 번호는 버린다", () => {
    const result = parseRanking('{"picks":[{"no":99},{"no":1}]}', candidates);
    expect(result.ranking.map((r) => r.id)).toEqual(["id-a"]);
  });

  it("같은 번호가 두 번 나오면 한 번만 쓴다", () => {
    const result = parseRanking('{"picks":[{"no":1},{"no":1},{"no":2}]}', candidates);
    expect(result.ranking.map((r) => r.id)).toEqual(["id-a", "id-b"]);
  });

  it("후보 수보다 많이 골라도 후보 수까지만 남긴다", () => {
    const picks = Array.from({ length: 20 }, (_, i) => ({ no: (i % 3) + 1 }));
    const result = parseRanking(JSON.stringify({ picks }), candidates);
    expect(result.ranking).toHaveLength(3);
  });

  it("10곳을 넘기지 않는다", () => {
    const many = buildCandidates(Array.from({ length: 30 }, (_, i) => place({ name: `p${i}` })));
    const picks = Array.from({ length: 30 }, (_, i) => ({ no: i + 1 }));
    const result = parseRanking(JSON.stringify({ picks }), many);
    expect(result.ranking).toHaveLength(TOP_N);
  });

  it("JSON이 아니면 실패로 표시한다", () => {
    const result = parseRanking("못 고르겠습니다", candidates);
    expect(result.ok).toBe(false);
    expect(result.ranking).toEqual([]);
  });

  it("유효한 번호가 하나도 없으면 실패로 표시한다", () => {
    const result = parseRanking('{"picks":[{"no":99}]}', candidates);
    expect(result.ok).toBe(false);
  });
});

describe("applyPinned", () => {
  it("고정된 장소를 맨 앞으로 올린다", () => {
    const candidates = buildCandidates([
      place({ name: "a" }),
      place({ name: "b", rankPinned: true }),
      place({ name: "c" }),
    ]);
    const ranking = [
      { id: "id-a", name: "a", reason: "" },
      { id: "id-c", name: "c", reason: "" },
      { id: "id-b", name: "b", reason: "고정" },
    ];
    expect(applyPinned(ranking, candidates).map((r) => r.id)).toEqual(["id-b", "id-a", "id-c"]);
  });

  // AI가 고정된 장소를 아예 안 뽑는 경우에도 사람 의사가 이겨야 한다.
  it("AI가 빠뜨린 고정 장소도 앞에 넣는다", () => {
    const candidates = buildCandidates([
      place({ name: "a" }),
      place({ name: "b", rankPinned: true }),
    ]);
    const ranking = [{ id: "id-a", name: "a", reason: "" }];
    const result = applyPinned(ranking, candidates);
    expect(result.map((r) => r.id)).toEqual(["id-b", "id-a"]);
  });

  it("고정이 없으면 그대로 둔다", () => {
    const candidates = buildCandidates([place({ name: "a" })]);
    const ranking = [{ id: "id-a", name: "a", reason: "" }];
    expect(applyPinned(ranking, candidates)).toEqual(ranking);
  });
});

describe("buildPatchProperties", () => {
  it("순위·월·사유를 Notion 형식으로 만든다", () => {
    const props = buildPatchProperties({ rank: 1, monthKey: "2026-09", reason: "선선하다" });
    expect(props["추천순위"].number).toBe(1);
    expect(props["추천월"].rich_text[0].text.content).toBe("2026-09");
    expect(props["추천사유"].rich_text[0].text.content).toBe("선선하다");
  });

  it("사유가 비면 빈 rich_text", () => {
    expect(buildPatchProperties({ rank: 2, monthKey: "2026-09", reason: "" })["추천사유"].rich_text).toEqual([]);
  });
});

describe("pickPlacesToClear", () => {
  it("이번 달에 안 뽑혔는데 지난 순위가 남은 곳을 고른다", () => {
    const places = [
      place({ name: "a", rank: 1, rankMonth: "2026-08" }),
      place({ name: "b", rank: 2, rankMonth: "2026-08" }),
      place({ name: "c" }),
    ];
    const ranked = [{ id: "id-a" }];
    expect(pickPlacesToClear(places, ranked, "2026-09").map((p) => p.name)).toEqual(["b"]);
  });

  it("순위를 지우는 PATCH는 세 필드를 비운다", () => {
    const props = buildClearProperties();
    expect(props["추천순위"].number).toBeNull();
    expect(props["추천월"].rich_text).toEqual([]);
    expect(props["추천사유"].rich_text).toEqual([]);
  });
});

describe("runMonthlyTop10", () => {
  const places = [
    place({ name: "a", region: "제주" }),
    place({ name: "b", region: "제주" }),
    place({ name: "c", region: "강원도" }),
  ];

  it("지역마다 한 번씩 호출하고 순위를 되쓴다", async () => {
    const prompts = [];
    const patches = [];
    const result = await runMonthlyTop10({
      places,
      monthKey: "2026-09",
      askClaude: async (prompt) => {
        prompts.push(prompt);
        return '{"picks":[{"no":1,"reason":"좋음"}]}';
      },
      patchPlace: async (id, props) => {
        patches.push({ id, rank: props["추천순위"].number });
      },
    });

    expect(prompts).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.regions.map((r) => r.region).toSorted()).toEqual(["강원도", "제주"]);
    expect(patches.find((p) => p.id === "id-a").rank).toBe(1);
  });

  it("뽑히지 않은 장소의 지난 순위를 지운다", async () => {
    const cleared = [];
    await runMonthlyTop10({
      places: [
        place({ name: "a", region: "제주" }),
        place({ name: "b", region: "제주", rank: 3, rankMonth: "2026-08" }),
      ],
      monthKey: "2026-09",
      askClaude: async () => '{"picks":[{"no":1,"reason":"좋음"}]}',
      patchPlace: async (id, props) => {
        if (props["추천순위"].number === null) cleared.push(id);
      },
    });
    expect(cleared).toEqual(["id-b"]);
  });

  // 한 지역 호출이 실패해도 나머지 지역은 갱신되어야 한다.
  it("한 지역이 실패해도 다른 지역은 계속 처리한다", async () => {
    const patched = [];
    const result = await runMonthlyTop10({
      places,
      monthKey: "2026-09",
      askClaude: async (prompt) => {
        if (prompt.includes("강원도")) throw new Error("timeout");
        return '{"picks":[{"no":1,"reason":"좋음"}]}';
      },
      patchPlace: async (id) => patched.push(id),
    });

    expect(result.ok).toBe(false);
    expect(result.regions.find((r) => r.region === "강원도").ok).toBe(false);
    expect(result.regions.find((r) => r.region === "제주").ranked).toBe(1);
    expect(patched).toContain("id-a");
  });

  // 파싱 실패 시 순위를 지워버리면 그 지역이 통째로 빈다. 지난달 것을 남긴다.
  it("응답 파싱에 실패하면 그 지역은 건드리지 않는다", async () => {
    const patched = [];
    const result = await runMonthlyTop10({
      places: [place({ name: "a", region: "제주", rank: 1, rankMonth: "2026-08" })],
      monthKey: "2026-09",
      askClaude: async () => "못 고르겠습니다",
      patchPlace: async (id) => patched.push(id),
    });

    expect(result.ok).toBe(false);
    expect(patched).toEqual([]);
  });

  it("monthKey 형식이 잘못되면 아무것도 하지 않는다", async () => {
    let called = false;
    const result = await runMonthlyTop10({
      places,
      monthKey: "2026-9",
      askClaude: async () => {
        called = true;
        return "";
      },
      patchPlace: async () => {},
    });

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
