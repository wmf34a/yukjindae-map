import { describe, it, expect } from "vitest";
import {
  isValidCoords,
  distanceKm,
  toNearbyResult,
  pickNearest,
  MAX_ACCEPT_KM,
  nameMatches,
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

describe("상호 이름 대조", () => {
  it("지점명이 붙어도 같은 가게로 본다", () => {
    expect(nameMatches("포레스트아웃팅스", "포레스트아웃팅스 일산본점")).toBe(true);
    expect(nameMatches("갈대의집 본점", "갈대의집본점")).toBe(true);
  });

  // 이름을 안 보고 가장 가까운 것을 집으면, 상세화면 글과 지도 핀이 서로 다른
  // 가게를 가리킨다. 일산호수공원에서 "일산칼국수본점"을 찾는데 1.2km 떨어진
  // "황치제국 일산본점"이 핀으로 찍히고 있었다.
  it("다른 가게는 걸러낸다", () => {
    expect(nameMatches("일산칼국수본점", "황치제국 일산본점")).toBe(false);
    expect(nameMatches("율곡식당", "율곡수목원 카페,디저트")).toBe(false);
  });

  const docs = [
    { place_name: "황치제국 일산본점", x: "126.749", y: "37.670", distance: "1233" },
    { place_name: "일산칼국수본점", x: "126.786", y: "37.670", distance: "3800" },
  ];
  const origin = { lat: 37.6644261, lng: 126.760568 };

  it("이름이 맞는 것을 고른다 — 더 멀어도", () => {
    expect(pickNearest(docs, origin, "일산칼국수본점").name).toBe("일산칼국수본점");
  });

  it("이름이 맞는 게 없으면 아무것도 안 준다", () => {
    expect(pickNearest(docs, origin, "없는가게")).toBeNull();
  });

  it("검색어를 안 주면 예전처럼 가장 가까운 것을 준다", () => {
    expect(pickNearest(docs, origin).name).toBe("황치제국 일산본점");
  });
});

describe("업종 가려내기", () => {
  // 국립어린이박물관 근처카페가 "플레저"인데 실제 카페는 "플레져"였다.
  // 한 글자 차이로 이름 대조를 통과 못 하고 "스마트안마플레저"라는
  // 의료기기 판매점이 걸려, 어린이박물관 코스에 안마기 가게 핀이 찍혔다.
  const docs = [
    { place_name: "스마트안마플레저", category_name: "의료,건강 > 의료기기판매", x: "127.38", y: "36.35", distance: "16804" },
    { place_name: "플레저", category_name: "음식점 > 카페", x: "127.27", y: "36.49", distance: "544" },
  ];
  const origin = { lat: 36.48876, lng: 127.27314 };

  it("먹고 마시는 곳을 먼저 고른다", () => {
    expect(pickNearest(docs, origin, "플레저").name).toBe("플레저");
  });

  it("먹는 곳이 없으면 그때만 나머지를 쓴다", () => {
    const only = [docs[0]];
    expect(pickNearest(only, origin, "플레저").name).toBe("스마트안마플레저");
  });

  it("응답에 내부 판단값을 내보내지 않는다", () => {
    expect(pickNearest(docs, origin, "플레저")).not.toHaveProperty("foodish");
  });
});
