import { describe, it, expect } from "vitest";
import {
  decodeEntities, parseKst, isForKids, opensSoon, isOpenNow, regionOf,
  toEntry, pickReservations, formatOpenAt, audienceOf, seriesKey,
} from "./reservation-open.js";

const row = (over = {}) => ({
  SVCID: "S1",
  SVCNM: "테스트 프로그램",
  PLACENM: "서울역사박물관",
  USETGTINFO: "어린이",
  PAYATNM: "무료",
  MINCLASSNM: "교육체험",
  AREANM: "종로구",
  SVCSTATNM: "접수중",
  SVCURL: "https://yeyak.seoul.go.kr/x",
  IMGURL: "",
  X: "126.97", Y: "37.57",
  RCPTBGNDT: "2026-09-01 10:00:00.0",
  RCPTENDDT: "2026-09-30 18:00:00.0",
  ...over,
});

// 2026-08-31 09:00 KST
const NOW = new Date("2026-08-31T00:00:00Z").getTime();

describe("decodeEntities", () => {
  it("서울시가 그대로 넘겨주는 엔티티를 사람이 읽는 글자로 바꾼다", () => {
    expect(decodeEntities("상&middot;하반기 &#39;내 친구 박물관&#39;")).toBe("상·하반기 '내 친구 박물관'");
    expect(decodeEntities("&lt;중학생 인턴제&gt;")).toBe("<중학생 인턴제>");
  });

  it("줄바꿈과 겹친 공백을 한 칸으로 줄인다", () => {
    expect(decodeEntities("  어린이 \n 체험  ")).toBe("어린이 체험");
  });
});

describe("parseKst", () => {
  it("초 이하가 붙은 서울시 표기를 한국 시간으로 읽는다", () => {
    expect(parseKst("2026-09-01 10:00:00.0").toISOString()).toBe("2026-09-01T01:00:00.000Z");
  });

  it("읽을 수 없으면 null", () => {
    expect(parseKst("")).toBeNull();
    expect(parseKst("곧 오픈")).toBeNull();
  });
});

describe("isForKids", () => {
  it("대상에 아이 말이 있으면 통과", () => {
    expect(isForKids(row({ USETGTINFO: "유아(만5세이상), 초등학생" }))).toBe(true);
    expect(isForKids(row({ USETGTINFO: "가족(초등학교 1~6학년 자녀를 동반한 가족)" }))).toBe(true);
  });

  it("성인 대상은 뺀다", () => {
    expect(isForKids(row({ USETGTINFO: "성인(55세 이상 성인)" }))).toBe(false);
    expect(isForKids(row({ USETGTINFO: "성인" }))).toBe(false);
  });

  it("괄호 안 부연 때문에 양육자 강좌가 아이 프로그램으로 둔갑하지 않는다", () => {
    // 실제로 "뮤지엄휴휴 배냇저고리 만들기"가 이렇게 딸려 들어왔다.
    expect(isForKids(row({ USETGTINFO: "성인(유아ㆍ어린이 양육자 및 예비 양육자)" }))).toBe(false);
  });

  it("학급·단체 교육은 뺀다 — 아빠가 아이 데리고 갈 수 있는 자리가 아니다", () => {
    expect(isForKids(row({ USETGTINFO: "어린이(초등1~3학년 학급 단체)" }))).toBe(false);
    expect(isForKids(row({ SVCNM: "청소년 학급 단체 대상 교육" }))).toBe(false);
  });

  it("정기 수강 강좌와 동네 돌봄시설은 나들이가 아니다", () => {
    expect(isForKids(row({ SVCNM: "하반기 축구·풋살교실 어린이반 수강생 모집" }))).toBe(false);
    expect(isForKids(row({ PLACENM: "거점 5호 우리동네키움센터" }))).toBe(false);
  });

  it("이미 끝난 것이 접수중으로 남아 있으면 뺀다", () => {
    expect(isForKids(row({ SVCNM: "요리Day 재밌Day - 대기자(2명) 모집완료" }))).toBe(false);
  });

  it("복지·의료 신청과 교원 연수는 나들이가 아니다", () => {
    expect(isForKids(row({ SVCNM: "어린이 눈건강 지킴이 사업" }))).toBe(false);
    expect(isForKids(row({ SVCNM: "교원 및 학부모 문해력 강화 연수" }))).toBe(false);
  });

  it("서울형 키즈카페는 상설 시설이라 이 띠에 안 싣는다", () => {
    expect(isForKids(row({ SVCNM: "서울형 키즈카페 관악구 난곡동점" }))).toBe(false);
  });

  it("정기 등록반은 주말 나들이가 아니다", () => {
    expect(isForKids(row({ SVCNM: "대현산유아숲체험원 수시 모집(주중/평일/오후반)" }))).toBe(false);
  });

  it("자격이 있어야 신청하는 복지관 프로그램은 뺀다", () => {
    expect(isForKids(row({
      SVCNM: "노동자 가족들과 함께하는 문화프로그램", PLACENM: "서울시 노동자복지관", USETGTINFO: "제한없음",
    }))).toBe(false);
  });

  it("주말 유아 동반 가족 프로그램은 남는다", () => {
    expect(isForKids(row({
      SVCNM: "[주말/토 오전/유아 동반 가족] 모두 안녕하수?",
      PLACENM: "서울하수도과학관", USETGTINFO: "가족(만 5세 유아 동반 가족)",
    }))).toBe(true);
  });

  it("제한없음은 제목에 아이 말이 있을 때만 넣는다", () => {
    expect(isForKids(row({ USETGTINFO: "제한없음", SVCNM: "전시해설 예약" }))).toBe(false);
    expect(isForKids(row({ USETGTINFO: "제한없음", SVCNM: "어린이 전시해설" }))).toBe(true);
  });
});

describe("opensSoon", () => {
  it("앞으로 2주 안에 열리면 참", () => {
    expect(opensSoon(row({ RCPTBGNDT: "2026-09-01 10:00:00.0" }), NOW)).toBe(true);
  });

  it("이미 열렸으면 거짓 — 지나간 오픈은 알려 봐야 늦었다", () => {
    expect(opensSoon(row({ RCPTBGNDT: "2026-08-20 10:00:00.0" }), NOW)).toBe(false);
  });

  it("두 달 뒤면 거짓", () => {
    expect(opensSoon(row({ RCPTBGNDT: "2026-11-01 10:00:00.0" }), NOW)).toBe(false);
  });
});

describe("isOpenNow", () => {
  it("접수 기간 안이면 참", () => {
    expect(isOpenNow(row({ RCPTBGNDT: "2026-08-01 10:00:00.0", RCPTENDDT: "2026-09-30 18:00:00.0" }), NOW)).toBe(true);
  });

  it("상태가 예약마감이면 기간이 남아도 거짓", () => {
    expect(isOpenNow(row({
      RCPTBGNDT: "2026-08-01 10:00:00.0", RCPTENDDT: "2026-09-30 18:00:00.0", SVCSTATNM: "예약마감",
    }), NOW)).toBe(false);
  });
});

describe("audienceOf", () => {
  it("괄호 앞이 진짜 대상이다", () => {
    expect(audienceOf("성인(유아ㆍ어린이 양육자)")).toEqual(["성인"]);
    expect(audienceOf("어린이, 유아, 청소년")).toEqual(["어린이", "유아", "청소년"]);
  });

  it("빈 값은 빈 배열", () => {
    expect(audienceOf("")).toEqual([]);
  });
});

describe("seriesKey", () => {
  it("앞머리 대괄호와 괄호를 떼고 프로그램 이름만 남긴다", () => {
    expect(seriesKey("[은평구] 목공체험 프로그램-우리가족문패(9월)(토)")).toBe("목공체험프로그램-우");
  });
});

describe("regionOf", () => {
  it("한강 위 자치구는 서울강북", () => {
    expect(regionOf("종로구")).toBe("서울강북");
    expect(regionOf("마포구")).toBe("서울강북");
  });

  it("그 밖은 서울강남", () => {
    expect(regionOf("서초구")).toBe("서울강남");
  });

  it("빈 값은 빈 값", () => {
    expect(regionOf("")).toBe("");
  });
});

describe("toEntry", () => {
  it("유료 뒤에 붙는 괄호 설명을 떼어 칩에 쓸 말만 남긴다", () => {
    expect(toEntry(row({ PAYATNM: "유료(요금안내문의)" })).fee).toBe("유료");
  });

  it("좌표를 숫자로 바꾼다", () => {
    const e = toEntry(row());
    expect(e.lat).toBeCloseTo(37.57);
    expect(e.lng).toBeCloseTo(126.97);
  });
});

describe("pickReservations", () => {
  it("오픈 예정을 먼저, 빨리 열리는 순으로 준다", () => {
    const out = pickReservations([
      row({ SVCID: "A", SVCNM: "숲속 산책 체험", PLACENM: "서울숲", RCPTBGNDT: "2026-09-05 10:00:00.0" }),
      row({ SVCID: "B", SVCNM: "목공 만들기 체험", PLACENM: "천왕산 목공 체험장", RCPTBGNDT: "2026-09-02 10:00:00.0" }),
    ], { now: NOW });
    expect(out.map((x) => x.id)).toEqual(["B", "A"]);
    expect(out[0].status).toBe("오픈예정");
  });

  it("이미 열린 것은 오픈 예정 뒤에 붙는다", () => {
    const out = pickReservations([
      row({ SVCID: "OPEN", SVCNM: "숲속 산책 체험", PLACENM: "서울숲", RCPTBGNDT: "2026-08-01 10:00:00.0", RCPTENDDT: "2026-09-10 18:00:00.0" }),
      row({ SVCID: "SOON", SVCNM: "목공 만들기 체험", PLACENM: "천왕산 목공 체험장", RCPTBGNDT: "2026-09-05 10:00:00.0" }),
    ], { now: NOW });
    expect(out.map((x) => x.id)).toEqual(["SOON", "OPEN"]);
    expect(out[1].status).toBe("접수중");
  });

  it("같은 SVCID가 두 번 오면 한 번만 남긴다", () => {
    const out = pickReservations([row({ SVCID: "A" }), row({ SVCID: "A" })], { now: NOW });
    expect(out).toHaveLength(1);
  });

  it("같은 프로그램의 회차·지점 중복은 하나만 남긴다", () => {
    const out = pickReservations([
      row({ SVCID: "A", SVCNM: "[구로구] 목공체험 달려라자동차 (9월4일)", RCPTBGNDT: "2026-09-02 10:00:00.0" }),
      row({ SVCID: "B", SVCNM: "[구로구] 목공체험 달려라자동차 (9월5일)", RCPTBGNDT: "2026-09-03 10:00:00.0" }),
    ], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("A");
  });

  it("한 시설이 목록을 먹지 않게 한 곳당 하나만 싣는다", () => {
    const out = pickReservations([
      row({ SVCID: "A", SVCNM: "목공체험 우리가족문패", PLACENM: "은평목재문화체험장", RCPTBGNDT: "2026-09-02 10:00:00.0" }),
      row({ SVCID: "B", SVCNM: "목공체험 냄비쉼터", PLACENM: "은평목재문화체험장", RCPTBGNDT: "2026-09-03 10:00:00.0" }),
      row({ SVCID: "C", SVCNM: "숲속 산책", PLACENM: "서울숲", RCPTBGNDT: "2026-09-04 10:00:00.0" }),
    ], { now: NOW });
    expect(out.map((x) => x.id)).toEqual(["A", "C"]);
  });

  it("상위 시설이 앞에 붙어도 실제 가는 곳으로 센다", () => {
    const out = pickReservations([
      row({ SVCID: "A", SVCNM: "허브야 놀자", PLACENM: "서울특별시 산악문화체험센터>노을여가센터", RCPTBGNDT: "2026-09-02 10:00:00.0" }),
      row({ SVCID: "B", SVCNM: "꽃물 들이기", PLACENM: "노을여가센터", RCPTBGNDT: "2026-09-03 10:00:00.0" }),
    ], { now: NOW });
    expect(out).toHaveLength(1);
  });

  it("성인 강좌는 아예 안 들어온다", () => {
    const out = pickReservations([row({ USETGTINFO: "성인", RCPTBGNDT: "2026-09-02 10:00:00.0" })], { now: NOW });
    expect(out).toEqual([]);
  });
});

describe("formatOpenAt", () => {
  it("인스타 카드와 같은 표기로 적는다", () => {
    expect(formatOpenAt("2026-09-01T01:00:00.000Z")).toBe("9/1(화) 10:00");
  });

  it("읽을 수 없으면 빈 문자열", () => {
    expect(formatOpenAt("")).toBe("");
  });
});
