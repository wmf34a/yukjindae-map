import { describe, it, expect } from "vitest";
import { normalizeScreen, SCREENS, normalizeTargetId} from "./screens.js";

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

// 화면 종류만 세면 "상세를 31명이 열었다"까지만 안다. 어느 곳을 열었는지 알아야
// 사진 없는 곳을 감이 아니라 조회수 순으로 채울 수 있다.
describe("normalizeTargetId", () => {
  it("노션 id 를 받는다", () => {
    expect(normalizeTargetId("3a5a4eba-1ccb-81cd-adac-d5e0ba5c8d9c")).toBe("3a5a4eba1ccb81cdadacd5e0ba5c8d9c");
  });

  it("하이픈이 없어도 같은 값이 된다 — 같은 페이지가 두 줄로 갈리면 안 된다", () => {
    const withDash = normalizeTargetId("3a5a4eba-1ccb-81cd-adac-d5e0ba5c8d9c");
    const without = normalizeTargetId("3a5a4eba1ccb81cdadacd5e0ba5c8d9c");
    expect(withDash).toBe(without);
  });

  it("대문자도 같은 값이 된다", () => {
    expect(normalizeTargetId("3A5A4EBA-1CCB-81CD-ADAC-D5E0BA5C8D9C")).toBe("3a5a4eba1ccb81cdadacd5e0ba5c8d9c");
  });

  it("id 모양이 아니면 버린다 — 주소창에 아무거나 넣어 통계를 더럽힐 수 없다", () => {
    expect(normalizeTargetId("../../etc/passwd")).toBe("");
    expect(normalizeTargetId("<script>")).toBe("");
    expect(normalizeTargetId("a".repeat(500))).toBe("");
    expect(normalizeTargetId("3a5a4eba")).toBe("");
  });

  it("없으면 빈 값이다 — 목록 화면에는 붙지 않는다", () => {
    expect(normalizeTargetId("")).toBe("");
    expect(normalizeTargetId(null)).toBe("");
    expect(normalizeTargetId(undefined)).toBe("");
  });
});
