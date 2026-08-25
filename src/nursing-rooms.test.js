import { describe, it, expect } from "vitest";
import {
  parseBusanItems,
  normalizeBusanItem,
  parseKorailItems,
  filterNursingStations,
  parseSeoulMetroNursingItems,
} from "./nursing-rooms.js";

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

describe("parseSeoulMetroNursingItems", () => {
  it("<item> 블록들을 파싱해 필요한 필드만 뽑아낸다", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8'?><response><body><items>` +
      `<item><stnNm>종로3가</stnNm><lineNm>1호선</lineNm><stnFlr>B1</stnFlr><exitNo>12</exitNo>` +
      `<dtlPstn>B1 고객안전실 인접</dtlPstn><operInstTelno>0261101301</operInstTelno><utztnHr>영업시간내</utztnHr></item>` +
      `<item><stnNm>왕십리</stnNm><lineNm>2호선</lineNm><stnFlr>1</stnFlr><exitNo>3</exitNo>` +
      `<dtlPstn></dtlPstn><operInstTelno></operInstTelno><utztnHr>24시간</utztnHr></item>` +
      `</items></body></response>`;
    expect(parseSeoulMetroNursingItems(xml)).toEqual([
      {
        stnNm: "종로3가",
        lineNm: "1호선",
        stnFlr: "B1",
        exitNo: "12",
        dtlPstn: "B1 고객안전실 인접",
        tel: "0261101301",
        utztnHr: "영업시간내",
      },
      {
        stnNm: "왕십리",
        lineNm: "2호선",
        stnFlr: "1",
        exitNo: "3",
        dtlPstn: "",
        tel: "",
        utztnHr: "24시간",
      },
    ]);
  });

  it("stnNm이 없는 블록은 제외한다", () => {
    const xml = `<item><lineNm>1호선</lineNm></item>`;
    expect(parseSeoulMetroNursingItems(xml)).toEqual([]);
  });

  it("빈 값/잘못된 값은 빈 배열이다", () => {
    expect(parseSeoulMetroNursingItems("")).toEqual([]);
    expect(parseSeoulMetroNursingItems(null)).toEqual([]);
  });
});
