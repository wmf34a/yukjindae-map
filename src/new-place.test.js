import { describe, it, expect } from "vitest";
import {
  parseReportValue,
  pickPlaceCandidate,
  buildNewPlaceProperties,
  prepareUserPlace,
} from "./new-place.js";

describe("parseReportValue", () => {
  it("본문과 편의시설을 나눈다", () => {
    const out = parseReportValue("무료이고 유모차로 다니기 편해요\n[편의시설] 수유실:있음 / 주차:무료");
    expect(out.reason).toBe("무료이고 유모차로 다니기 편해요");
    expect(out.amenities).toEqual({ 수유실: "있음", 주차: "무료" });
  });

  it("편의시설이 없으면 본문만 남는다", () => {
    expect(parseReportValue("그냥 좋았어요")).toEqual({ reason: "그냥 좋았어요", amenities: {} });
  });

  // 노션에서 사람이 손으로 고칠 수 있으므로 값도 확인한다.
  it("허용되지 않은 항목과 값은 버린다", () => {
    const out = parseReportValue("좋아요\n[편의시설] 엘리베이터:있음 / 수유실:아마도 / 주차:있음");
    expect(out.amenities).toEqual({});
  });

  it("없음도 그대로 읽는다 — 다녀온 사람이 확인한 값이다", () => {
    expect(parseReportValue("좋아요\n[편의시설] 수유실:없음").amenities).toEqual({ 수유실: "없음" });
  });

  it("빈 값도 죽지 않는다", () => {
    expect(parseReportValue("")).toEqual({ reason: "", amenities: {} });
    expect(parseReportValue(null)).toEqual({ reason: "", amenities: {} });
  });
});

describe("pickPlaceCandidate", () => {
  const doc = (name, x, y) => ({ place_name: name, road_address_name: `${name} 도로명`, x: String(x), y: String(y) });

  it("이름이 정확히 같은 것을 고른다", () => {
    const out = pickPlaceCandidate([doc("서울숲 곤충식물원", 127, 37.5), doc("서울숲", 127.01, 37.51)], "서울숲");
    expect(out.name).toBe("서울숲");
  });

  it("정확히 같은 것이 없으면 첫 결과를 쓴다", () => {
    expect(pickPlaceCandidate([doc("서울숲 곤충식물원", 127, 37.5)], "서울숲").name).toBe("서울숲 곤충식물원");
  });

  // 좌표가 없으면 지도에 찍을 수 없다.
  it("좌표가 없는 결과는 버린다", () => {
    expect(pickPlaceCandidate([{ place_name: "가", x: "abc", y: "abc" }], "가")).toBeNull();
    expect(pickPlaceCandidate([], "가")).toBeNull();
  });
});

describe("buildNewPlaceProperties", () => {
  const candidate = { name: "서울숲 곤충식물원", address: "서울특별시 성동구 뚝섬로 273", lat: 37.54, lng: 127.03 };
  const nearby = { restaurants: [{ title: "밥집", dist: 300 }], cafes: [] };

  it("좌표·주소·근처 가게를 채운다", () => {
    const p = buildNewPlaceProperties({ candidate, reason: "좋아요", amenities: {}, nearby, today: "2026-08-28" });
    expect(p["장소명"].title[0].text.content).toBe("서울숲 곤충식물원");
    expect(p["위도"]).toEqual({ number: 37.54 });
    expect(p["근처맛집"].rich_text[0].text.content).toContain("밥집");
  });

  // 주소만으로 앱 지역을 정해야 한다. 잘못 넣으면 지역 필터에서 사라진다.
  it("주소에서 앱 지역을 정한다", () => {
    const p = buildNewPlaceProperties({ candidate, reason: "", amenities: {}, nearby });
    expect(p["지역"]).toEqual({ select: { name: "서울강북" } });
  });

  // 사람이 추천한 곳이라도 기계가 채운 값이 섞여 있어 한 번은 눈으로 봐야 한다.
  it("항상 비공개로 만든다", () => {
    expect(buildNewPlaceProperties({ candidate, reason: "", amenities: {}, nearby })["공개여부"])
      .toEqual({ checkbox: false });
  });

  it("제보자가 알려준 편의시설을 그대로 넣는다", () => {
    const p = buildNewPlaceProperties({
      candidate, reason: "", nearby,
      amenities: { 수유실: "있음", 유아의자: "없음", 주차: "유료" },
    });
    expect(p["수유실"]).toEqual({ checkbox: true });
    expect(p["유아의자"]).toEqual({ checkbox: false });
    expect(p["주차가능여부"]).toEqual({ select: { name: "유료" } });
  });

  it("알려주지 않은 편의시설은 손대지 않는다", () => {
    const p = buildNewPlaceProperties({ candidate, reason: "", amenities: {}, nearby });
    expect(p).not.toHaveProperty("수유실");
    expect(p["주차가능여부"]).toEqual({ select: { name: "확인 필요" } });
  });

  it("주차 없음은 불가로 옮긴다", () => {
    const p = buildNewPlaceProperties({ candidate, reason: "", amenities: { 주차: "없음" }, nearby });
    expect(p["주차가능여부"]).toEqual({ select: { name: "불가" } });
  });

  it("API가 찾은 운영시간·요금을 넣는다", () => {
    const p = buildNewPlaceProperties({
      candidate, reason: "", amenities: {}, nearby,
      detail: { hours: "10:00~18:00", fee: "무료", homepage: "https://x" },
    });
    expect(p["운영시간"].rich_text[0].text.content).toBe("10:00~18:00");
    expect(p["정보출처"]).toEqual({ url: "https://x" });
  });
});

describe("prepareUserPlace", () => {
  const deps = {
    searchPlace: async () => [{ place_name: "서울숲", road_address_name: "서울특별시 성동구 뚝섬로 273", x: "127.03", y: "37.54" }],
    findNearby: async () => [{ title: "밥집", dist: 300, kind: "food" }],
    fetchDetail: async () => ({ hours: "상시 개방" }),
    today: "2026-08-28",
  };

  it("추천을 등록 가능한 속성으로 만든다", async () => {
    const out = await prepareUserPlace({
      placeName: "서울숲",
      reportValue: "무료예요\n[편의시설] 수유실:있음",
      ...deps,
    });
    expect(out.ok).toBe(true);
    expect(out.properties["수유실"]).toEqual({ checkbox: true });
    expect(out.properties["운영시간"].rich_text[0].text.content).toBe("상시 개방");
    expect(out.properties["추천이유"].rich_text[0].text.content).toBe("무료예요");
  });

  // 못 찾은 것을 억지로 만들면 지도에 잘못된 핀이 생긴다.
  it("장소를 못 찾으면 만들지 않는다", async () => {
    const out = await prepareUserPlace({
      placeName: "없는곳", reportValue: "좋아요", ...deps, searchPlace: async () => [],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/찾지 못했/);
  });

  it("근처 검색이 실패해도 장소는 만든다", async () => {
    const out = await prepareUserPlace({
      placeName: "서울숲", reportValue: "좋아요", ...deps,
      findNearby: async () => { throw new Error("카카오 오류"); },
    });
    expect(out.ok).toBe(true);
    expect(out.properties["근처맛집"].rich_text).toEqual([]);
  });
});
