import { describe, it, expect } from "vitest";
import { haversineMeters, findNearestRoom, needsPublicDataMatch, buildPublicDataPatchProperties } from "./nursing-match.js";

describe("haversineMeters", () => {
  it("같은 좌표는 0m다", () => {
    expect(haversineMeters({ lat: 37.5, lng: 127.0 }, { lat: 37.5, lng: 127.0 })).toBe(0);
  });

  it("위도 0.001도 차이는 대략 111m다", () => {
    const d = haversineMeters({ lat: 37.5, lng: 127.0 }, { lat: 37.501, lng: 127.0 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe("findNearestRoom", () => {
  const place = { lat: 37.5, lng: 127.0 };

  it("반경 안에 있으면 가장 가까운 곳을 반환한다", () => {
    const rooms = [
      { name: "먼곳", lat: 37.6, lng: 127.0 },
      { name: "가까운곳", lat: 37.5005, lng: 127.0 },
    ];
    expect(findNearestRoom(place, rooms, 150).name).toBe("가까운곳");
  });

  it("반경 밖이면 null이다", () => {
    const rooms = [{ name: "먼곳", lat: 37.51, lng: 127.0 }];
    expect(findNearestRoom(place, rooms, 150)).toBeNull();
  });

  it("후보가 없으면 null이다", () => {
    expect(findNearestRoom(place, [], 150)).toBeNull();
  });
});

describe("needsPublicDataMatch", () => {
  const base = { lat: 37.5, lng: 127.0, nursingRoom: false, verifiedStatus: "" };

  it("좌표 있고 수유실 미확인이면 대상이다", () => {
    expect(needsPublicDataMatch(base)).toBe(true);
    expect(needsPublicDataMatch({ ...base, verifiedStatus: "미확인" })).toBe(true);
  });

  it("이미 수유실=true면 대상이 아니다", () => {
    expect(needsPublicDataMatch({ ...base, nursingRoom: true })).toBe(false);
  });

  it("사람이 확정한 확인됨과 이미 붙인 공공데이터는 대상이 아니다", () => {
    expect(needsPublicDataMatch({ ...base, verifiedStatus: "확인됨" })).toBe(false);
    expect(needsPublicDataMatch({ ...base, verifiedStatus: "공공데이터" })).toBe(false);
  });

  // 매일 도는 블로그 enrichment가 먼저 대부분을 "블로그힌트"로 바꿔버려서, 이걸
  // 제외하면 주간 매칭 크론이 검사할 대상이 거의 남지 않는다(실측 108곳 중 3곳).
  // 블로그 글 추측보다 공공데이터 좌표가 근거가 확실하므로 덮어쓸 수 있어야 한다.
  it("블로그힌트는 공공데이터로 덮어쓸 수 있어야 한다", () => {
    expect(needsPublicDataMatch({ ...base, verifiedStatus: "블로그힌트" })).toBe(true);
  });

  it("좌표가 없으면 대상이 아니다", () => {
    expect(needsPublicDataMatch({ ...base, lat: undefined })).toBe(false);
  });
});

describe("buildPublicDataPatchProperties", () => {
  it("수유실 체크 + 확인상태=공공데이터 + 정보출처를 채운다", () => {
    const room = { sourceUrl: "https://www.data.go.kr/data/15034033/openapi.do" };
    expect(buildPublicDataPatchProperties(room, "2026-08-25")).toEqual({
      "수유실": { checkbox: true },
      "확인상태": { select: { name: "공공데이터" } },
      "정보확인일": { date: { start: "2026-08-25" } },
      "정보출처": { url: "https://www.data.go.kr/data/15034033/openapi.do" },
    });
  });
});
