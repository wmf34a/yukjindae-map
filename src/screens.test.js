import { describe, it, expect } from "vitest";
import { normalizeScreen, SCREENS } from "./screens.js";

describe("normalizeScreen", () => {
  it("아는 화면은 그대로 둔다", () => {
    for (const name of SCREENS) expect(normalizeScreen(name)).toBe(name);
  });

  it("대소문자와 공백을 정리한다", () => {
    expect(normalizeScreen("  MAP ")).toBe("map");
  });

  // 화면을 안 보내는 옛 번들이 한동안 돌아다닌다. 그때까지는 홈으로 본다 —
  // 예전에도 홈에서만 셌으므로 지난 통계와 이어진다.
  it("안 보내면 홈으로 본다", () => {
    expect(normalizeScreen("")).toBe("home");
    expect(normalizeScreen(undefined)).toBe("home");
  });

  // 임의 문자열을 그대로 적으면 집계에 오타와 장난이 섞인다. 버리지는 않는다 —
  // 새 화면이 생겼다는 신호일 수 있다.
  it("모르는 이름은 other 로 뭉갠다", () => {
    expect(normalizeScreen("hacked")).toBe("other");
    expect(normalizeScreen("<script>")).toBe("other");
    expect(normalizeScreen("a".repeat(200))).toBe("other");
  });
});

// 화면 이름을 정하는 곳이 서버 하나가 되면서, 브라우저는 경로 조각을 그대로 보낸다.
describe("파일 이름 별칭", () => {
  it("경로 조각을 화면 이름으로 옮긴다", () => {
    expect(normalizeScreen("index")).toBe("home");
    expect(normalizeScreen("festival-detail")).toBe("festival");
  });
});
