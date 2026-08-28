import { describe, it, expect } from "vitest";
import {
  isValidCoords,
  distanceKm,
  toNearbyResult,
  pickNearest,
  MAX_ACCEPT_KM,
} from "./nearby-lookup.js";

const daejeon = { lat: 36.3757, lng: 127.3757 };

const doc = (name, lat, lng, distance) => ({
  place_name: name,
  road_address_name: `${name} 도로명`,
  address_name: `${name} 지번`,
  y: String(lat),
  x: String(lng),
  ...(distance === undefined ? {} : { distance: String(distance) }),
});

describe("isValidCoords", () => {
  it("숫자 좌표만 통과시킨다", () => {
    expect(isValidCoords({ lat: 36.3, lng: 127.3 })).toBe(true);
    expect(isValidCoords({ lat: "36.3", lng: "127.3" })).toBe(true);
  });

  it("없거나 숫자가 아니면 거절한다", () => {
    expect(isValidCoords(null)).toBe(false);
    expect(isValidCoords({})).toBe(false);
    expect(isValidCoords({ lat: "abc", lng: 127 })).toBe(false);
  });
});

describe("toNearbyResult", () => {
  it("카카오 응답을 우리 형태로 바꾼다", () => {
    const out = toNearbyResult(doc("성심당 DCC점", 36.3757, 127.3757, 850));
    expect(out).toMatchObject({ found: true, name: "성심당 DCC점", lat: 36.3757, distanceM: 850 });
  });

  // 좌표까지 함께 주므로 지오코딩을 한 번 더 할 필요가 없다.
  it("도로명주소를 우선 쓴다", () => {
    expect(toNearbyResult(doc("가", 36, 127)).address).toBe("가 도로명");
  });

  it("이름이나 좌표가 없으면 null", () => {
    expect(toNearbyResult(null)).toBeNull();
    expect(toNearbyResult({ place_name: "가" })).toBeNull();
    expect(toNearbyResult({ place_name: "가", x: "abc", y: "abc" })).toBeNull();
  });
});

describe("pickNearest", () => {
  // 이 버그 때문에 대전 국립중앙과학관 코스에 서울 강남점이 잡혀
  // 총 거리 306km, 이동 12시간짜리 코스가 나왔다.
  it("같은 상호 중 기준 좌표에 가까운 지점을 고른다", () => {
    const docs = [
      doc("신세계백화점 푸드코트 강남점", 37.5045, 127.0044),
      doc("신세계백화점 푸드코트 대전점", 36.3745, 127.3785),
    ];
    expect(pickNearest(docs, daejeon).name).toContain("대전점");
  });

  it("카카오가 준 distance를 그대로 쓴다", () => {
    const docs = [doc("가", 37.5, 127.0, 9000), doc("나", 36.3, 127.3, 500)];
    expect(pickNearest(docs, daejeon).name).toBe("나");
  });

  // 반경 검색이 비어 이름만으로 넓게 찾은 경우, 다른 도시 지점이 걸린다.
  it(`${MAX_ACCEPT_KM}km 밖은 다른 지점으로 보고 버린다`, () => {
    const seoulOnly = [doc("신세계백화점 푸드코트 강남점", 37.5045, 127.0044)];
    expect(pickNearest(seoulOnly, daejeon)).toBeNull();
  });

  it("기준 좌표가 없으면 첫 결과를 쓴다", () => {
    const docs = [doc("가", 37.5, 127.0), doc("나", 36.3, 127.3)];
    expect(pickNearest(docs, null).name).toBe("가");
  });

  it("결과가 없으면 null", () => {
    expect(pickNearest([], daejeon)).toBeNull();
    expect(pickNearest(null, daejeon)).toBeNull();
  });
});

describe("distanceKm", () => {
  it("두 지점 거리를 km로 잰다", () => {
    // 대전 ↔ 서울, 실제 직선거리 약 140km
    const d = distanceKm(daejeon, { lat: 37.5665, lng: 126.978 });
    expect(d).toBeGreaterThan(130);
    expect(d).toBeLessThan(160);
  });
});

describe("응답에 내부 값이 새지 않는다", () => {
  it("고르는 데 쓴 km는 빼고 돌려준다", () => {
    const out = pickNearest([doc("가", 36.3745, 127.3785, 500)], daejeon);
    expect(out).not.toHaveProperty("km");
    expect(out).toMatchObject({ found: true, name: "가", distanceM: 500 });
  });
});

describe("좌표 파라미터가 없을 때", () => {
  // Number(null)은 NaN이 아니라 0이다. 이걸 유효한 좌표로 통과시키면 아프리카
  // 앞바다 근처를 검색하고 아무것도 못 찾았다고 답한다.
  it("빈 값을 좌표로 인정하지 않는다", () => {
    expect(isValidCoords({ lat: null, lng: null })).toBe(false);
    expect(isValidCoords({ lat: undefined, lng: undefined })).toBe(false);
    expect(isValidCoords({ lat: "", lng: "" })).toBe(false);
  });

  it("0,0은 좌표로 인정하지 않는다", () => {
    expect(isValidCoords({ lat: 0, lng: 0 })).toBe(false);
  });

  it("실제 좌표는 그대로 통과시킨다", () => {
    expect(isValidCoords({ lat: 36.3757, lng: 127.3757 })).toBe(true);
  });
});
