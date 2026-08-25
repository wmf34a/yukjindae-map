import { describe, it, expect } from "vitest";
import { parseBusanItems, normalizeBusanItem, parseKorailItems, filterNursingStations } from "./nursing-rooms.js";

describe("parseBusanItems", () => {
  it("item이 배열이면 그대로 반환한다", () => {
    const data = { response: { body: { items: { item: [{ sj: "a" }, { sj: "b" }] } } } };
    expect(parseBusanItems(data)).toHaveLength(2);
  });

  it("item이 단일 객체면 배열로 감싼다", () => {
    const data = { response: { body: { items: { item: { sj: "a" } } } } };
    expect(parseBusanItems(data)).toEqual([{ sj: "a" }]);
  });

  it("결과가 없으면 빈 배열이다", () => {
    expect(parseBusanItems({ response: { body: { items: "" } } })).toEqual([]);
    expect(parseBusanItems(null)).toEqual([]);
  });
});

describe("normalizeBusanItem", () => {
  it("부산 API 응답 필드를 공통 형태로 변환한다", () => {
    const item = {
      sj: "영도구청",
      address: "부산 영도구 태종로 423",
      place: "구청 1층",
      tel: "051-419-4262",
      lat: "35.09121408",
      lng: "129.0679144",
      father: "가능",
    };
    expect(normalizeBusanItem(item)).toEqual({
      name: "영도구청",
      address: "부산 영도구 태종로 423",
      place: "구청 1층",
      tel: "051-419-4262",
      lat: 35.09121408,
      lng: 129.0679144,
      fatherAllowed: true,
      source: "부산광역시",
      sourceUrl: "https://www.data.go.kr/data/15034033/openapi.do",
    });
  });

  it("father가 '가능'이 아니면 false다", () => {
    expect(normalizeBusanItem({ sj: "a", lat: "1", lng: "1", father: "불가" }).fatherAllowed).toBe(false);
    expect(normalizeBusanItem({ sj: "a", lat: "1", lng: "1" }).fatherAllowed).toBe(false);
  });
});

describe("parseKorailItems", () => {
  it("item이 배열이면 그대로 반환한다", () => {
    const data = { response: { body: { items: { item: [{ stn_nm: "가남" }, { stn_nm: "강릉" }] } } } };
    expect(parseKorailItems(data)).toHaveLength(2);
  });

  it("item이 단일 객체면 배열로 감싼다", () => {
    const data = { response: { body: { items: { item: { stn_nm: "가남" } } } } };
    expect(parseKorailItems(data)).toEqual([{ stn_nm: "가남" }]);
  });

  it("결과가 없으면 빈 배열이다", () => {
    expect(parseKorailItems({ response: { body: { items: "" } } })).toEqual([]);
    expect(parseKorailItems(null)).toEqual([]);
  });
});

describe("filterNursingStations", () => {
  it("수유실유무가 Y인 역만 이름만 뽑아 남긴다", () => {
    const items = [
      { stn_nm: "강릉", nrsrm_estnc: "Y" },
      { stn_nm: "가수원", nrsrm_estnc: "N" },
      { stn_nm: "", nrsrm_estnc: "Y" },
    ];
    expect(filterNursingStations(items)).toEqual([{ name: "강릉" }]);
  });
});
