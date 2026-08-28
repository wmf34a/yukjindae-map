import { describe, it, expect } from "vitest";
import { parseNotifyEmails, resolveMentionTargets, buildReportComment } from "./notion-notify.js";

describe("parseNotifyEmails", () => {
  it("쉼표와 공백 어느 쪽으로 나눠도 읽는다", () => {
    expect(parseNotifyEmails("a@x.com, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseNotifyEmails("a@x.com b@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("대소문자를 맞춰 둔다 — 노션 응답과 대조해야 한다", () => {
    expect(parseNotifyEmails("A@X.com")).toEqual(["a@x.com"]);
  });

  it("이메일이 아닌 값과 빈 값은 버린다", () => {
    expect(parseNotifyEmails("최연승, a@x.com")).toEqual(["a@x.com"]);
    expect(parseNotifyEmails("")).toEqual([]);
    expect(parseNotifyEmails(undefined)).toEqual([]);
  });
});

describe("resolveMentionTargets", () => {
  const users = [
    { id: "u1", type: "person", name: "김경훈", person: { email: "kyounghun330@gmail.com" } },
    { id: "u2", type: "person", name: "최연승", person: { email: "YSEUNG777@gmail.com" } },
    { id: "b1", type: "bot", name: "yukjindae-map" },
    { id: "u3", type: "person", name: "이메일없음" },
  ];

  it("이메일로 노션 사용자를 찾는다", () => {
    const { targets } = resolveMentionTargets(users, ["kyounghun330@gmail.com"]);
    expect(targets).toEqual([{ id: "u1", name: "김경훈" }]);
  });

  // 노션이 대문자로 준 이메일도 맞춰야 한다.
  it("대소문자가 달라도 찾는다", () => {
    const { targets } = resolveMentionTargets(users, ["yseung777@gmail.com"]);
    expect(targets[0].id).toBe("u2");
  });

  // 아직 초대 안 된 사람은 멘션할 ID 자체가 없다.
  it("못 찾은 사람은 missing 으로 돌려준다", () => {
    const { targets, missing } = resolveMentionTargets(users, ["kyounghun330@gmail.com", "none@x.com"]);
    expect(targets).toHaveLength(1);
    expect(missing).toEqual(["none@x.com"]);
  });

  it("봇과 이메일 없는 사용자는 대상에서 뺀다", () => {
    const { targets, missing } = resolveMentionTargets(users, ["yukjindae-map", "이메일없음"]);
    expect(targets).toHaveLength(0);
    expect(missing).toHaveLength(2);
  });

  it("사용자 목록이 비어도 죽지 않는다", () => {
    expect(resolveMentionTargets(null, ["a@x.com"])).toEqual({ targets: [], missing: ["a@x.com"] });
  });
});

describe("buildReportComment", () => {
  const targets = [{ id: "u1", name: "김경훈" }, { id: "u2", name: "최연승" }];

  it("멘션을 앞에 두고 내용을 뒤에 붙인다", () => {
    const rich = buildReportComment({
      placeName: "서울숲", field: "신규장소", value: "무료예요", targets, missing: [],
    });
    expect(rich[0]).toEqual({ type: "mention", mention: { type: "user", user: { id: "u1" } } });
    expect(rich[2]).toEqual({ type: "mention", mention: { type: "user", user: { id: "u2" } } });
    expect(rich.at(-1).text.content).toContain("새 장소 추천");
    expect(rich.at(-1).text.content).toContain("무료예요");
  });

  // 멘션 객체가 붙어 나오면 이름이 서로 달라붙어 읽기 어렵다.
  it("멘션 사이에 공백을 넣는다", () => {
    const rich = buildReportComment({ placeName: "가", field: "신규장소", value: "나", targets, missing: [] });
    expect(rich[1]).toEqual({ type: "text", text: { content: " " } });
  });

  it("일반 제보는 필드명을 함께 쓴다", () => {
    const rich = buildReportComment({
      placeName: "서울숲", field: "운영시간", value: "10시 오픈", targets: [], missing: [],
    });
    expect(rich[0].text.content).toContain("서울숲 / 운영시간");
  });

  // 초대가 빠진 사람이 조용히 사라지면 아무도 눈치채지 못한다.
  it("초대 안 된 사람을 댓글에 남긴다", () => {
    const rich = buildReportComment({
      placeName: "가", field: "신규장소", value: "나", targets, missing: ["none@x.com"],
    });
    expect(rich.at(-1).text.content).toContain("none@x.com");
    expect(rich.at(-1).text.content).toContain("초대되지 않아");
  });

  it("멘션할 사람이 없어도 내용은 남긴다", () => {
    const rich = buildReportComment({
      placeName: "가", field: "신규장소", value: "나", targets: [], missing: [],
    });
    expect(rich).toHaveLength(1);
    expect(rich[0].text.content).toContain("가");
  });

  it("아주 긴 제보는 잘라 넣는다", () => {
    const rich = buildReportComment({
      placeName: "가", field: "신규장소", value: "나".repeat(3000), targets: [], missing: [],
    });
    expect(rich[0].text.content.length).toBeLessThan(1700);
  });
});
