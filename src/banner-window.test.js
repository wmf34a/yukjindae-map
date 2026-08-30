import { describe, it, expect } from "vitest";
import { isWithinWindow, filterByWindow, todayInKst } from "./banner-window.js";

describe("배너 노출기간", () => {
  const today = "2026-09-12";

  it("기간이 없으면 항상 보여준다", () => {
    expect(isWithinWindow({}, today)).toBe(true);
    expect(isWithinWindow({ startDate: "", endDate: "" }, today)).toBe(true);
  });

  it("시작 전에는 감춘다", () => {
    expect(isWithinWindow({ startDate: "2026-09-13" }, today)).toBe(false);
    expect(isWithinWindow({ startDate: "2026-09-12" }, today)).toBe(true);
  });

  // 9월 12일 행사 배너는 그날 하루 종일 떠 있어야 한다.
  it("종료일 당일까지는 보여준다", () => {
    expect(isWithinWindow({ endDate: "2026-09-12" }, today)).toBe(true);
    expect(isWithinWindow({ endDate: "2026-09-11" }, today)).toBe(false);
  });

  it("시작과 끝을 함께 본다", () => {
    const b = { startDate: "2026-09-01", endDate: "2026-09-30" };
    expect(isWithinWindow(b, "2026-08-31")).toBe(false);
    expect(isWithinWindow(b, "2026-09-01")).toBe(true);
    expect(isWithinWindow(b, "2026-09-30")).toBe(true);
    expect(isWithinWindow(b, "2026-10-01")).toBe(false);
  });

  it("노션이 시각까지 주어도 날짜만 본다", () => {
    expect(isWithinWindow({ endDate: "2026-09-12T23:00:00+09:00" }, today)).toBe(true);
  });

  it("목록에서 지난 것만 걸러낸다", () => {
    const list = [
      { id: "a" },
      { id: "b", endDate: "2026-09-11" },
      { id: "c", startDate: "2026-09-01", endDate: "2026-09-30" },
    ];
    expect(filterByWindow(list, today).map((x) => x.id)).toEqual(["a", "c"]);
  });

  // 서버가 UTC라 그냥 today를 쓰면 자정 무렵 아홉 시간 동안 어제로 판단한다.
  it("한국 시간 기준으로 오늘을 센다", () => {
    expect(todayInKst(new Date("2026-09-11T16:00:00Z"))).toBe("2026-09-12");
    expect(todayInKst(new Date("2026-09-11T14:00:00Z"))).toBe("2026-09-11");
  });
});
