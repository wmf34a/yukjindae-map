import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// public/js/util.js는 <script>로 직접 읽히는 클래식 스크립트라 import할 수 없다.
// 화면 XSS 방어의 마지막 관문이라 테스트는 반드시 있어야 해서, 파일을 그대로
// 읽어 window를 흉내낸 컨텍스트에서 실행하고 노출된 함수를 꺼내 검증한다.
let escapeHtml, safeHref, safeImageSrc, festivalDday, monthlyRank, sortByMonthlyRank;
let splitNearbyList, primaryNearby;

beforeAll(() => {
  const source = fs.readFileSync(path.resolve("public/js/util.js"), "utf8");
  const sandbox = { window: {}, URL, AbortSignal, fetch: () => {}, Date, Math, JSON, String };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  ({ escapeHtml, safeHref, safeImageSrc, festivalDday, monthlyRank, sortByMonthlyRank } = sandbox.window);
  ({ splitNearbyList, primaryNearby } = sandbox.window);
});

// 지금이 KST로 몇 월인지에 따라 테스트가 갈리므로, 검증용으로도 같은 방식으로 계산한다.
const thisMonth = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);

describe("escapeHtml", () => {
  it("HTML 특수문자를 모두 엔티티로 바꾼다", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("스크립트 태그를 무력화한다", () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain("<script>");
  });

  it("속성 탈출을 막는다", () => {
    // alt="${...}" 안에 들어갔을 때 따옴표를 닫고 이벤트 핸들러를 붙이는 공격
    const payload = '" onerror="alert(1)';
    expect(escapeHtml(payload)).not.toContain('"');
  });

  it("null/undefined는 빈 문자열이 된다", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("일반 한글 텍스트는 그대로 둔다", () => {
    expect(escapeHtml("전쟁기념관 · 서울강북")).toBe("전쟁기념관 · 서울강북");
  });
});

describe("safeHref", () => {
  it("http(s) URL을 통과시킨다", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
  });

  it("javascript: 스킴을 막는다", () => {
    expect(safeHref("javascript:alert(1)")).toBe("");
    // 대소문자를 섞거나 앞에 공백을 넣는 우회도 막혀야 한다
    expect(safeHref("JaVaScRiPt:alert(1)")).toBe("");
    expect(safeHref("  javascript:alert(1)")).toBe("");
  });

  it("data: 스킴을 막는다", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("라벨이 앞에 붙은 값에서 URL만 뽑아낸다", () => {
    expect(safeHref("공식 홈페이지 https://example.com/x")).toBe("https://example.com/x");
  });

  it("빈 값은 빈 문자열이 된다", () => {
    expect(safeHref("")).toBe("");
    expect(safeHref(null)).toBe("");
  });
});

describe("safeImageSrc", () => {
  it("우리 R2 미러링 상대경로를 통과시킨다", () => {
    expect(safeImageSrc("/images/places/abc.jpg")).toBe("/images/places/abc.jpg");
  });

  it("외부 https 이미지도 통과시킨다", () => {
    expect(safeImageSrc("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
  });

  it("javascript: 스킴을 막는다", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBe("");
  });

  // 프로토콜 상대 URL(//evil.com/x.jpg)은 외부 출처를 우리 경로처럼 위장할 수 있다.
  it("프로토콜 상대 URL을 상대경로로 오인하지 않는다", () => {
    expect(safeImageSrc("//evil.com/x.jpg")).toBe("");
  });

  it("빈 값은 빈 문자열이 된다", () => {
    expect(safeImageSrc("")).toBe("");
    expect(safeImageSrc(null)).toBe("");
    expect(safeImageSrc(undefined)).toBe("");
  });
});

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("festivalDday", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("시작 전이면 D-n을 반환한다", () => {
    expect(festivalDday({ periodStart: plusDays(3) })).toBe("D-3");
  });

  it("기간 중이면 진행중을 반환한다", () => {
    expect(festivalDday({ periodStart: plusDays(-1), periodEnd: plusDays(1) })).toBe("진행중");
  });

  it("오늘 시작하면 진행중이다", () => {
    expect(festivalDday({ periodStart: today, periodEnd: today })).toBe("진행중");
  });

  it("이미 끝났으면 빈 문자열이다", () => {
    expect(festivalDday({ periodStart: plusDays(-10), periodEnd: plusDays(-5) })).toBe("");
  });

  it("시작일이 없으면 빈 문자열이다", () => {
    expect(festivalDday({})).toBe("");
  });
});

describe("monthlyRank", () => {
  it("이번 달 순위면 그대로 돌려준다", () => {
    expect(monthlyRank({ rank: 3, rankMonth: thisMonth() })).toBe(3);
  });

  // 갱신이 실패하면 지난달 순위가 노션에 남는다. 그걸 이번 달 순위로 쓰면
  // 계절이 안 맞는 곳이 맨 위에 서게 된다.
  it("지난달 순위는 인정하지 않는다", () => {
    expect(monthlyRank({ rank: 1, rankMonth: "2020-01" })).toBeNull();
  });

  it("순위가 없으면 null", () => {
    expect(monthlyRank({ rankMonth: thisMonth() })).toBeNull();
    expect(monthlyRank({ rank: null, rankMonth: thisMonth() })).toBeNull();
    expect(monthlyRank(undefined)).toBeNull();
  });
});

describe("sortByMonthlyRank", () => {
  const month = thisMonth();

  it("순위 순으로 앞에 세운다", () => {
    const sorted = sortByMonthlyRank([
      { name: "c", rank: 2, rankMonth: month },
      { name: "a", rank: 1, rankMonth: month },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(["a", "c"]);
  });

  it("순위 없는 장소는 뒤로 민다", () => {
    const sorted = sortByMonthlyRank([
      { name: "x" },
      { name: "a", rank: 1, rankMonth: month },
      { name: "y" },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(["a", "x", "y"]);
  });

  // 목록 순서가 새로고침마다 바뀌면 아까 본 곳을 다시 못 찾는다.
  it("순위 없는 장소끼리는 원래 순서를 유지한다", () => {
    const sorted = sortByMonthlyRank([{ name: "x" }, { name: "y" }, { name: "z" }]);
    expect(sorted.map((p) => p.name)).toEqual(["x", "y", "z"]);
  });

  it("지난달 순위는 순위 없음으로 취급한다", () => {
    const sorted = sortByMonthlyRank([
      { name: "old", rank: 1, rankMonth: "2020-01" },
      { name: "now", rank: 5, rankMonth: month },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(["now", "old"]);
  });

  it("원본 배열을 바꾸지 않는다", () => {
    const input = [{ name: "b", rank: 2, rankMonth: month }, { name: "a", rank: 1, rankMonth: month }];
    sortByMonthlyRank(input);
    expect(input.map((p) => p.name)).toEqual(["b", "a"]);
  });
});

describe("splitNearbyList", () => {
  it("쉼표로 구분된 기존 형식을 나눈다", () => {
    expect(splitNearbyList("사생활 영도점, 올바릇식당 영도점")).toEqual([
      "사생활 영도점",
      "올바릇식당 영도점",
    ]);
  });

  it("슬래시로 구분된 제주 형식을 나눈다", () => {
    expect(splitNearbyList("무호소반(제주시 수목원길 23) / 밥촐림(제주시 구남로 26)")).toEqual([
      "무호소반(제주시 수목원길 23)",
      "밥촐림(제주시 구남로 26)",
    ]);
  });

  // 괄호 안 쉼표에서 잘리면 "포도호텔 레스토랑(서귀포시 안덕면 산록남로 863"처럼
  // 반토막 난 상호가 지도 검색어로 나가서 핀을 못 찾는다.
  it("괄호 안 쉼표에서는 자르지 않는다", () => {
    expect(splitNearbyList("포도호텔 레스토랑(서귀포시 안덕면 산록남로 863, 일식)")).toEqual([
      "포도호텔 레스토랑(서귀포시 안덕면 산록남로 863, 일식)",
    ]);
  });

  it("괄호가 섞인 여러 건도 정확히 나눈다", () => {
    expect(
      splitNearbyList("별돈별 중문 본점(구산봉로 61, 아기 식사 무료·고기 구워줌) / 달페이지(색달로64번길 51, 브런치)")
    ).toEqual([
      "별돈별 중문 본점(구산봉로 61, 아기 식사 무료·고기 구워줌)",
      "달페이지(색달로64번길 51, 브런치)",
    ]);
  });

  it("한 곳만 있으면 그대로 한 건", () => {
    expect(splitNearbyList("오색막국수")).toEqual(["오색막국수"]);
  });

  it("빈 값은 빈 배열", () => {
    expect(splitNearbyList("")).toEqual([]);
    expect(splitNearbyList(null)).toEqual([]);
    expect(splitNearbyList(undefined)).toEqual([]);
  });

  it("구분자만 연달아 있어도 빈 항목을 만들지 않는다", () => {
    expect(splitNearbyList("A, , B")).toEqual(["A", "B"]);
  });
});

describe("primaryNearby", () => {
  it("맨 앞을 대표로 고른다", () => {
    expect(primaryNearby("사생활 영도점, 올바릇식당 영도점")).toBe("사생활 영도점");
  });

  it("괄호 메모가 붙어도 첫 건을 통째로 준다", () => {
    expect(primaryNearby("포도호텔 레스토랑(산록남로 863, 일식) / 두도 레스토랑")).toBe(
      "포도호텔 레스토랑(산록남로 863, 일식)"
    );
  });

  it("빈 값은 빈 문자열", () => {
    expect(primaryNearby("")).toBe("");
    expect(primaryNearby(undefined)).toBe("");
  });
});
