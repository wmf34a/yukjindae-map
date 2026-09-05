import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseBusanItems,
  normalizeBusanItem,
  parseKorailItems,
  filterNursingStations,
  parseSeoulMetroNursingItems,
  normalizeSooyusilRoom,
  dedupeByDistance,
  refreshSooyusilRooms,
  SOOYUSIL_USER_AGENT,
  SOOYUSIL_ZONES,
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

describe("normalizeSooyusilRoom", () => {
  const raw = {
    roomNo: "1117", roomName: "코스트코 대전점", address: "대전 중구 오류로 41",
    location: "3층 여자화장실 옆", managerTelNo: "042-000-0000",
    gpsLat: "36.32", gpsLong: "127.40", fatherUseCode: "1", fatherUseNm: "아빠이용가능",
  };

  it("지도가 쓰는 형태로 바꾼다", () => {
    expect(normalizeSooyusilRoom(raw)).toEqual({
      name: "코스트코 대전점",
      address: "대전 중구 오류로 41",
      place: "3층 여자화장실 옆",
      tel: "042-000-0000",
      lat: 36.32,
      lng: 127.4,
      fatherAllowed: true,
      source: "수유정보 알리미",
      sourceUrl: "https://sooyusil.com/home/39.htm",
    });
  });

  // 이 앱에서 가장 중요한 값이다. 아빠가 못 들어가는 곳을 갈 수 있다고 하면 안 된다.
  it("아빠 이용 여부를 코드와 이름 둘 다로 본다", () => {
    expect(normalizeSooyusilRoom({ ...raw, fatherUseCode: "0", fatherUseNm: "아빠이용불가" }).fatherAllowed).toBe(false);
    expect(normalizeSooyusilRoom({ ...raw, fatherUseCode: "", fatherUseNm: "아빠이용가능" }).fatherAllowed).toBe(true);
    expect(normalizeSooyusilRoom({ ...raw, fatherUseCode: "1", fatherUseNm: "" }).fatherAllowed).toBe(true);
  });

  it("좌표가 없으면 버린다", () => {
    expect(normalizeSooyusilRoom({ ...raw, gpsLat: "", gpsLong: "" })).toBeNull();
    expect(normalizeSooyusilRoom({ ...raw, gpsLat: "없음" })).toBeNull();
  });
});

describe("dedupeByDistance", () => {
  const at = (lat, lng, name) => ({ lat, lng, name });

  // 같은 수유실이 부산 데이터와 전국 명부에 따로 잡힌다. 핀이 두 개 찍히면
  // 사용자는 다른 곳인 줄 안다.
  it("120m 안이면 같은 곳으로 보고 앞의 것을 남긴다", () => {
    const out = dedupeByDistance([
      at(35.1000, 129.0000, "부산 데이터"),
      at(35.1005, 129.0000, "전국 명부"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("부산 데이터");
  });

  it("멀리 있으면 둘 다 남긴다", () => {
    expect(dedupeByDistance([at(35.1, 129.0, "가"), at(35.2, 129.1, "나")])).toHaveLength(2);
  });

  it("좌표가 없는 것은 버린다", () => {
    expect(dedupeByDistance([{ name: "좌표없음" }, at(35.1, 129.0, "정상")])).toHaveLength(1);
  });
});

// sooyusil.com 은 User-Agent 가 비면 403 을 준다. 인증이 아니라 UA 검사라서,
// 헤더가 빠지면 열일곱 시·도가 한꺼번에 막힌다 (2026-09-05 새벽에 실제로 그랬다).
describe("refreshSooyusilRooms", () => {
  afterEach(() => vi.restoreAllMocks());

  it("User-Agent 를 붙여서 부른다", async () => {
    const seen = [];
    vi.stubGlobal("fetch", async (url, options) => {
      seen.push({ url: String(url), ua: options?.headers?.["user-agent"] });
      return new Response(JSON.stringify({ roomList: [] }), { status: 200 });
    });
    const kv = { put: async () => {} };
    await refreshSooyusilRooms({ SOOYUSIL_API_KEY: "k", RATE_LIMIT: kv });

    expect(seen).toHaveLength(SOOYUSIL_ZONES.length);
    for (const call of seen) expect(call.ua).toBe(SOOYUSIL_USER_AGENT);
    expect(SOOYUSIL_USER_AGENT).not.toBe("");
  });
});
