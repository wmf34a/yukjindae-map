import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// public/js/util.js는 <script>로 직접 읽히는 클래식 스크립트라 import할 수 없다.
// 화면 XSS 방어의 마지막 관문이라 테스트는 반드시 있어야 해서, 파일을 그대로
// 읽어 window를 흉내낸 컨텍스트에서 실행하고 노출된 함수를 꺼내 검증한다.
let escapeHtml, safeHref, safeImageSrc, festivalDday;

beforeAll(() => {
  const source = fs.readFileSync(path.resolve("public/js/util.js"), "utf8");
  const sandbox = { window: {}, URL, AbortSignal, fetch: () => {}, Date, Math, JSON, String };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  ({ escapeHtml, safeHref, safeImageSrc, festivalDday } = sandbox.window);
});

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
