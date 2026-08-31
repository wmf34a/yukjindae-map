import { describe, it, expect } from "vitest";
import {
  isApplicableField,
  isClearRequest,
  buildPlacePatch,
  buildPlaceProperties,
  buildReportProperties,
  applyApprovedReports,
  APPLIED,
  mergeList,
  splitList,
  MODE_REPLACE,
  MODE_ADD,
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

describe("값을 지워 달라는 제보", () => {
  // 폼에 빈칸을 내면 접수가 안 되니 지역장은 "(삭제요망)"이라고 적어 보낸다.
  // 예전에는 그 말을 그대로 값에 써넣어서, 승인하면 화면에
  // "무료입장 연령: (삭제요망)" 이 떴을 것이다.
  it("삭제 요청을 알아본다", () => {
    for (const v of ["(삭제요망)", "삭제요망", "삭제", "삭제 요청", "(빈칸)", " 공백 "]) {
      expect(isClearRequest(v)).toBe(true);
    }
  });

  it("보통 값은 삭제 요청이 아니다", () => {
    for (const v of ["36개월 미만 무료", "무료", "", "삭제된 시설 있음"]) {
      expect(isClearRequest(v)).toBe(false);
    }
  });

  it("삭제 요청이면 빈 값으로 덮는다", () => {
    expect(buildPlacePatch("무료입장연령", "(삭제요망)")).toEqual({
      "무료입장연령": { rich_text: [] },
    });
  });

  it("보통 값은 그대로 쓴다", () => {
    expect(buildPlacePatch("무료입장연령", "24개월 미만 무료")).toEqual({
      "무료입장연령": { rich_text: [{ text: { content: "24개월 미만 무료" } }] },
    });
  });
});

describe("목록 필드 병합", () => {
  it("제보에 빠진 가게를 지우지 않는다", async () => {
    // 검수자는 자기가 확인한 가게만 적어 보낸다. 통째로 덮어쓰면 나머지가 사라진다.
    const merged = mergeList(
      "비금도 (약 2.2km) / 메이플라운지 (약 2.3km) / 속초항찜 (약 4.2km)",
      "비금도 (약 2.2km) / 속초항찜 (약 4.2km)"
    );
    expect(merged).toContain("메이플라운지");
  });

  it("같은 가게의 거리를 고쳐 주면 중복 없이 갈아 낀다", () => {
    const merged = mergeList("토담숯불닭갈비 (약 5.7km)", "토담숯불닭갈비 (약 5.5km)");
    expect(merged).toBe("토담숯불닭갈비 (약 5.5km)");
  });

  it("띄어쓰기만 다른 상호를 같은 가게로 본다", () => {
    const merged = mergeList("스테이오롯이 (약 3.0km)", "스테이 오롯이 (약 3km)");
    expect(merged).toBe("스테이 오롯이 (약 3km)");
  });

  it("우리가 짧게 잡아 둔 상호를 정확한 이름으로 고쳐 준다", () => {
    // "미륵산돌담"으로 검색해 3.3km를 적었는데 실제 가게는 "미륵산돌담 한정식"이다.
    const merged = mergeList("미륵산돌담 (약 3.3km)", "미륵산돌담 한정식 (약 2.2km)");
    expect(merged).toBe("미륵산돌담 한정식 (약 2.2km)");
  });

  it("새 가게는 뒤에 붙인다", () => {
    const merged = mergeList("등촌샤브칼국수 (약 830m)", "한식레스토랑 여믐 (약 1.3km)");
    expect(merged).toBe("등촌샤브칼국수 (약 830m) / 한식레스토랑 여믐 (약 1.3km)");
  });

  it("쉼표로 이어 적은 목록도 가른다", () => {
    // 프론트는 "/"와 "," 를 모두 구분자로 쓴다.
    expect(splitList("가게 하나, 가게 둘 / 가게 셋")).toHaveLength(3);
  });

  it("교체를 고르면 지금 값을 버린다", () => {
    const patch = buildPlacePatch("근처맛집", "새 가게", { mode: MODE_REPLACE, current: "옛 가게" });
    expect(patch["근처맛집"].rich_text[0].text.content).toBe("새 가게");
  });

  it("기본은 더하기다 — 방식을 안 보내도 지금 값이 살아 있다", () => {
    const patch = buildPlacePatch("근처맛집", "새 가게", { current: "옛 가게" });
    expect(patch["근처맛집"].rich_text[0].text.content).toBe("옛 가게 / 새 가게");
  });

  it("목록이 아닌 칸은 그대로 덮어쓴다", () => {
    const patch = buildPlacePatch("운영시간", "10:00~18:00", { current: "09:00~17:00" });
    expect(patch["운영시간"].rich_text[0].text.content).toBe("10:00~18:00");
  });
});

describe("applyApprovedReports 목록 반영", () => {
  const base = { id: "r1", placeId: "p1", field: "근처맛집", placeName: "가나다" };

  it("지금 값을 읽어 더한다", async () => {
    const patched = [];
    const out = await applyApprovedReports({
      reports: [{ ...base, value: "새 가게", mode: MODE_ADD }],
      readPlaceField: async () => "옛 가게 (약 100m)",
      patchPlace: (id, props) => { patched.push(props); },
      patchReport: () => {},
      today: "2026-08-31",
    });
    expect(out.applied).toHaveLength(1);
    expect(patched[0]["근처맛집"].rich_text[0].text.content).toBe("옛 가게 (약 100m) / 새 가게");
  });

  it("지금 값을 못 읽으면 덮어쓰지 않고 건너뛴다", async () => {
    // 못 읽었는데 그대로 쓰면 이 칸이 통째로 날아간다.
    const out = await applyApprovedReports({
      reports: [{ ...base, value: "새 가게", mode: MODE_ADD }],
      readPlaceField: async () => { throw new Error("노션 오류"); },
      patchPlace: () => { throw new Error("여기 오면 안 된다"); },
      patchReport: () => {},
      today: "2026-08-31",
    });
    expect(out.applied).toHaveLength(0);
    expect(out.skipped[0].reason).toContain("지금 값을 읽지 못했습니다");
  });

  it("읽을 방법 자체가 없으면 건너뛴다", async () => {
    const out = await applyApprovedReports({
      reports: [{ ...base, value: "새 가게" }],
      patchPlace: () => { throw new Error("여기 오면 안 된다"); },
      patchReport: () => {},
      today: "2026-08-31",
    });
    expect(out.skipped[0].reason).toContain("읽을 수 없어");
  });
});

describe("splitList — 상호 안의 쉼표", () => {
  it("슬래시가 있으면 상호 안의 쉼표를 구분자로 보지 않는다", () => {
    // 평창 "쉴, 바위길"은 쉼표까지가 상호다. 쪼개면 없는 가게 둘이 된다.
    expect(splitList("쉴, 바위길 (약 14.7km) / 파인리프 (약 19.2km)"))
      .toEqual(["쉴, 바위길 (약 14.7km)", "파인리프 (약 19.2km)"]);
  });

  it("슬래시가 없는 옛 값은 쉼표로 가른다", () => {
    expect(splitList("디프랑, 카페 두촌리")).toEqual(["디프랑", "카페 두촌리"]);
  });

  it("구분자 없이 이어 적은 제보는 그대로 갈린다", () => {
    expect(splitList("사니다 (약 6.8km) 목수의 진달래 (약 5.8km)"))
      .toEqual(["사니다 (약 6.8km)", "목수의 진달래 (약 5.8km)"]);
  });
});
