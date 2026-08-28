import { describe, it, expect } from "vitest";
import {
  isApplicableField,
  buildPlacePatch,
  buildPlaceProperties,
  buildReportProperties,
  applyApprovedReports,
  APPLIED,
} from "./report-apply.js";

describe("isApplicableField", () => {
  it("제보로 고칠 수 있는 필드를 안다", () => {
    expect(isApplicableField("수유실")).toBe(true);
    expect(isApplicableField("운영시간")).toBe(true);
    expect(isApplicableField("근처맛집")).toBe(true);
  });

  // 접수 때 걸렀더라도, 사람이 노션에서 필드명을 손으로 바꿔 넣을 수 있다.
  it("그 밖의 필드는 막는다", () => {
    expect(isApplicableField("공개여부")).toBe(false);
    expect(isApplicableField("신규장소")).toBe(false);
    expect(isApplicableField("위도")).toBe(false);
  });
});

describe("buildPlacePatch", () => {
  it("체크박스 필드는 있음/없음을 참거짓으로 바꾼다", () => {
    expect(buildPlacePatch("수유실", "있음")).toEqual({ "수유실": { checkbox: true } });
    expect(buildPlacePatch("수유실", "없음")).toEqual({ "수유실": { checkbox: false } });
  });

  it("체크박스에 엉뚱한 값이 오면 반영하지 않는다", () => {
    expect(buildPlacePatch("수유실", "아마도")).toBeNull();
    expect(buildPlacePatch("수유실", "")).toBeNull();
  });

  it("자유서술 필드는 글자로 넣는다", () => {
    expect(buildPlacePatch("운영시간", " 10:00~18:00 "))
      .toEqual({ "운영시간": { rich_text: [{ text: { content: "10:00~18:00" } }] } });
  });

  it("빈 값은 반영하지 않는다 — 지우는 것이 제보의 목적은 아니다", () => {
    expect(buildPlacePatch("운영시간", "   ")).toBeNull();
  });

  it("아주 긴 값은 잘라 넣는다", () => {
    const out = buildPlacePatch("운영시간", "가".repeat(3000));
    expect(out["운영시간"].rich_text[0].text.content).toHaveLength(2000);
  });

  it("허용되지 않은 필드는 null", () => {
    expect(buildPlacePatch("공개여부", "true")).toBeNull();
  });
});

describe("buildPlaceProperties", () => {
  // 다녀온 사람이 알려준 값은 블로그에서 추정한 값보다 낫다.
  it("확인상태를 확인됨으로 올린다", () => {
    const out = buildPlaceProperties("수유실", "있음", "2026-08-28");
    expect(out["확인상태"]).toEqual({ select: { name: "확인됨" } });
    expect(out["정보확인일"]).toEqual({ date: { start: "2026-08-28" } });
  });

  it("날짜를 안 주면 정보확인일은 건드리지 않는다", () => {
    expect(buildPlaceProperties("수유실", "있음")).not.toHaveProperty("정보확인일");
  });

  it("반영할 수 없으면 null", () => {
    expect(buildPlaceProperties("공개여부", "true", "2026-08-28")).toBeNull();
  });
});

describe("buildReportProperties", () => {
  it("제보 상태를 반영됨으로 바꾼다", () => {
    expect(buildReportProperties()).toEqual({ "상태": { select: { name: APPLIED } } });
  });
});

describe("applyApprovedReports", () => {
  const base = { id: "r1", placeId: "p1", field: "수유실", value: "있음", placeName: "가" };

  function spy() {
    const calls = [];
    return { calls, fn: async (...args) => { calls.push(args); } };
  }

  it("장소를 고치고 제보 상태를 바꾼다", async () => {
    const place = spy();
    const report = spy();
    const out = await applyApprovedReports({
      reports: [base], patchPlace: place.fn, patchReport: report.fn, today: "2026-08-28",
    });
    expect(out.applied).toHaveLength(1);
    expect(place.calls[0][0]).toBe("p1");
    expect(place.calls[0][1]["수유실"]).toEqual({ checkbox: true });
    expect(report.calls[0][1]).toEqual({ "상태": { select: { name: APPLIED } } });
  });

  // 신규 장소 제보는 장소를 새로 만들어야 해서 여기 몫이 아니다.
  it("연결된 장소가 없으면 건너뛴다", async () => {
    const place = spy();
    const out = await applyApprovedReports({
      reports: [{ ...base, placeId: "" }], patchPlace: place.fn, patchReport: spy().fn,
    });
    expect(out.applied).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/연결된 장소/);
    expect(place.calls).toHaveLength(0);
  });

  it("반영할 수 없는 필드는 건너뛰고 이유를 남긴다", async () => {
    const place = spy();
    const out = await applyApprovedReports({
      reports: [{ ...base, field: "공개여부", value: "true" }],
      patchPlace: place.fn, patchReport: spy().fn,
    });
    expect(out.skipped[0].reason).toMatch(/반영할 수 없는/);
    expect(place.calls).toHaveLength(0);
  });

  // 하나가 실패해도 나머지는 반영돼야 한다.
  it("실패한 건만 건너뛴다", async () => {
    const out = await applyApprovedReports({
      reports: [base, { ...base, id: "r2", placeId: "p2" }],
      patchPlace: async (id) => { if (id === "p1") throw new Error("노션 오류"); },
      patchReport: async () => {},
    });
    expect(out.applied.map((r) => r.id)).toEqual(["r2"]);
    expect(out.skipped[0].reason).toBe("노션 오류");
  });

  it("빈 목록도 죽지 않는다", async () => {
    expect(await applyApprovedReports({ reports: [], patchPlace: async () => {}, patchReport: async () => {} }))
      .toEqual({ applied: [], skipped: [] });
  });
});
