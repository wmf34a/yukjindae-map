import { describe, it, expect } from "vitest";
import {
  text,
  title,
  selectName,
  multiSelectNames,
  firstFileUrl,
  firstFileSource,
  urlValue,
  dateValue,
  toPlace,
  toBanner,
  toFestival,
} from "./notion.js";

describe("text", () => {
  it("rich_text 배열을 하나의 문자열로 합친다", () => {
    const prop = { rich_text: [{ plain_text: "안녕" }, { plain_text: "하세요" }] };
    expect(text(prop)).toBe("안녕하세요");
  });

  it("비어있으면 빈 문자열을 반환한다", () => {
    expect(text({ rich_text: [] })).toBe("");
    expect(text(undefined)).toBe("");
  });
});

describe("title", () => {
  it("title 배열을 문자열로 합친다", () => {
    expect(title({ title: [{ plain_text: "전쟁기념관" }] })).toBe("전쟁기념관");
  });

  it("비어있으면 빈 문자열을 반환한다", () => {
    expect(title({ title: [] })).toBe("");
  });
});

describe("selectName", () => {
  it("select 값의 name을 반환한다", () => {
    expect(selectName({ select: { name: "서울" } })).toBe("서울");
  });

  it("select가 없으면 빈 문자열을 반환한다", () => {
    expect(selectName({ select: null })).toBe("");
  });
});

describe("multiSelectNames", () => {
  it("multi_select 옵션들의 name 배열을 반환한다", () => {
    const prop = { multi_select: [{ name: "무료" }, { name: "자연·공원" }] };
    expect(multiSelectNames(prop)).toEqual(["무료", "자연·공원"]);
  });

  it("비어있으면 빈 배열을 반환한다", () => {
    expect(multiSelectNames({ multi_select: [] })).toEqual([]);
  });
});

describe("urlValue", () => {
  it("url 값을 반환한다", () => {
    expect(urlValue({ url: "https://blog.naver.com/a" })).toBe("https://blog.naver.com/a");
  });

  it("url이 없으면 빈 문자열을 반환한다", () => {
    expect(urlValue({ url: null })).toBe("");
    expect(urlValue(undefined)).toBe("");
  });
});

describe("dateValue", () => {
  it("date.start 값을 반환한다", () => {
    expect(dateValue({ date: { start: "2026-08-24" } })).toBe("2026-08-24");
  });

  it("date가 없으면 빈 문자열을 반환한다", () => {
    expect(dateValue({ date: null })).toBe("");
    expect(dateValue(undefined)).toBe("");
  });
});

describe("firstFileUrl", () => {
  it("external 타입 파일의 url을 반환한다", () => {
    const prop = { files: [{ type: "external", external: { url: "https://example.com/a.jpg" } }] };
    expect(firstFileUrl(prop)).toBe("https://example.com/a.jpg");
  });

  it("file 타입(노션 호스팅) 파일의 url도 반환한다", () => {
    const prop = { files: [{ type: "file", file: { url: "https://notion.so/a.jpg" } }] };
    expect(firstFileUrl(prop)).toBe("https://notion.so/a.jpg");
  });

  it("파일이 없으면 빈 문자열을 반환한다", () => {
    expect(firstFileUrl({ files: [] })).toBe("");
  });
});

describe("firstFileSource", () => {
  it("external 타입은 stable: true로 반환한다", () => {
    const prop = { files: [{ type: "external", external: { url: "https://example.com/a.jpg" } }] };
    expect(firstFileSource(prop)).toEqual({ url: "https://example.com/a.jpg", stable: true });
  });

  it("file 타입(노션 호스팅, 서명 URL)은 stable: false로 반환한다", () => {
    const prop = { files: [{ type: "file", file: { url: "https://notion.so/a.jpg?sig=1" } }] };
    expect(firstFileSource(prop)).toEqual({ url: "https://notion.so/a.jpg?sig=1", stable: false });
  });

  it("파일이 없으면 null을 반환한다", () => {
    expect(firstFileSource({ files: [] })).toBeNull();
  });
});

describe("toPlace", () => {
  it("Notion 페이지 객체를 장소 객체로 변환한다", () => {
    const page = {
      id: "page-1",
      created_time: "2026-07-20T03:00:00.000Z",
      properties: {
        "장소명": { title: [{ plain_text: "전쟁기념관" }] },
        "지역": { select: { name: "서울" } },
        "카테고리": { multi_select: [{ name: "무료" }] },
        "주소": { rich_text: [{ plain_text: "서울 용산구 이태원로 29" }] },
        "위도": { number: 37.5364643 },
        "경도": { number: 126.9771484 },
        "사진": { files: [{ type: "external", external: { url: "https://x.com/a.jpg" } }] },
        "운영시간": { rich_text: [{ plain_text: "09:30~18:00" }] },
        "입장료": { rich_text: [{ plain_text: "무료" }] },
        "추천이유": { rich_text: [{ plain_text: "역사 체험하기 좋음" }] },
        "주차가능여부": { select: { name: "가능" } },
        "주차상세": { rich_text: [{ plain_text: "지하주차장" }] },
        "유모차동선": { select: { name: "가능" } },
        "기저귀교환대": { checkbox: true },
        "수유실": { checkbox: false },
        "유아의자": { checkbox: true },
        "무료입장연령": { rich_text: [{ plain_text: "36개월 미만" }] },
        "정보출처": { url: "https://blog.naver.com/example" },
        "정보확인일": { date: { start: "2026-08-24" } },
        "확인상태": { select: { name: "확인됨" } },
        "근처맛집": { rich_text: [{ plain_text: "진심" }] },
        "근처카페": { rich_text: [{ plain_text: "봉스디" }] },
        "등록자": { rich_text: [{ plain_text: "육진대" }] },
      },
    };

    const place = toPlace(page);

    expect(place).toMatchObject({
      id: "page-1",
      createdAt: "2026-07-20T03:00:00.000Z",
      name: "전쟁기념관",
      region: "서울",
      categories: ["무료"],
      address: "서울 용산구 이태원로 29",
      lat: 37.5364643,
      lng: 126.9771484,
      image: "https://x.com/a.jpg",
      diaperChange: true,
      nursingRoom: false,
      kidsChair: true,
      freeAgePolicy: "36개월 미만",
      sourceUrl: "https://blog.naver.com/example",
      verifiedAt: "2026-08-24",
      verifiedStatus: "확인됨",
    });
  });

  it("새 필드가 비어있으면 빈 값으로 변환한다", () => {
    const page = {
      id: "page-2",
      created_time: "2026-07-20T03:00:00.000Z",
      properties: {
        "장소명": { title: [{ plain_text: "빈필드테스트" }] },
      },
    };

    const place = toPlace(page);

    expect(place).toMatchObject({
      kidsChair: undefined,
      freeAgePolicy: "",
      sourceUrl: "",
      verifiedAt: "",
      verifiedStatus: "",
    });
  });

  it("월간 추천 순위 필드를 변환한다", () => {
    const page = {
      id: "page-3",
      created_time: "2026-07-20T03:00:00.000Z",
      properties: {
        "장소명": { title: [{ plain_text: "표선해수욕장" }] },
        "추천순위": { number: 1 },
        "추천월": { rich_text: [{ plain_text: "2026-08" }] },
        "추천사유": { rich_text: [{ plain_text: "수심이 얕아 한여름 아기 물놀이에 좋다" }] },
        "추천고정": { checkbox: true },
      },
    };

    expect(toPlace(page)).toMatchObject({
      rank: 1,
      rankMonth: "2026-08",
      rankReason: "수심이 얕아 한여름 아기 물놀이에 좋다",
      rankPinned: true,
    });
  });

  it("아직 순위가 없으면 rank는 null이고 고정은 false다", () => {
    const page = {
      id: "page-4",
      created_time: "2026-07-20T03:00:00.000Z",
      properties: { "장소명": { title: [{ plain_text: "순위없음" }] } },
    };

    expect(toPlace(page)).toMatchObject({
      rank: null,
      rankMonth: "",
      rankReason: "",
      rankPinned: false,
    });
  });

  // 0위는 존재하지 않지만, number 필드를 0으로 채워둔 페이지가 "순위 없음"으로
  // 뭉개지면 정렬이 조용히 틀어지므로 null과 구분되는지 확인한다.
  it("추천순위 0을 null로 뭉개지 않는다", () => {
    const page = {
      id: "page-5",
      created_time: "2026-07-20T03:00:00.000Z",
      properties: {
        "장소명": { title: [{ plain_text: "영순위" }] },
        "추천순위": { number: 0 },
      },
    };

    expect(toPlace(page).rank).toBe(0);
  });
});

describe("toBanner", () => {
  it("Notion 페이지 객체를 배너 객체로 변환한다", () => {
    const page = {
      id: "banner-1",
      created_time: "2026-07-25T01:00:00.000Z",
      properties: {
        "제목": { title: [{ plain_text: "여름 특집" }] },
        "문구": { rich_text: [{ plain_text: "아이와 함께 떠나는 여름 나들이" }] },
        "링크": { url: "https://example.com/summer" },
        "순서": { number: 1 },
        "이미지": { files: [{ type: "external", external: { url: "https://x.com/banner.jpg" } }] },
      },
    };

    expect(toBanner(page)).toEqual({
      id: "banner-1",
      createdAt: "2026-07-25T01:00:00.000Z",
      title: "여름 특집",
      tagline: "아이와 함께 떠나는 여름 나들이",
      link: "https://example.com/summer",
      order: 1,
      imageSource: { url: "https://x.com/banner.jpg", stable: true },
    });
  });

  it("링크/순서가 없으면 기본값을 사용한다", () => {
    const page = {
      id: "banner-2",
      created_time: "2026-07-26T01:00:00.000Z",
      properties: {
        "제목": { title: [{ plain_text: "제목만" }] },
        "문구": { rich_text: [] },
        "링크": { url: null },
        "순서": { number: null },
        "이미지": { files: [] },
      },
    };

    expect(toBanner(page)).toEqual({
      id: "banner-2",
      createdAt: "2026-07-26T01:00:00.000Z",
      title: "제목만",
      tagline: "",
      link: "",
      order: 0,
      imageSource: null,
    });
  });
});

describe("toFestival", () => {
  it("Notion 페이지 객체를 축제 객체로 변환한다", () => {
    const page = {
      id: "festival-1",
      created_time: "2026-08-01T00:00:00.000Z",
      properties: {
        "제목": { title: [{ plain_text: "강릉 경포벚꽃축제" }] },
        "기간": { date: { start: "2026-04-01", end: "2026-04-10" } },
        "장소명": { rich_text: [{ plain_text: "경포 습지광장" }] },
        "이미지": { files: [{ type: "external", external: { url: "https://x.com/f.jpg" } }] },
        "링크": { url: "https://visitgangneung.net" },
        "지역": { select: { name: "강원도" } },
        "순서": { number: 2 },
        "설명": { rich_text: [{ plain_text: "벚꽃길 축제" }] },
        "주소": { rich_text: [{ plain_text: "강원특별자치도 강릉시 경포로 365" }] },
        "공개여부": { checkbox: true },
        "TourAPI_ID": { rich_text: [{ plain_text: "695592" }] },
      },
    };

    expect(toFestival(page)).toEqual({
      id: "festival-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      title: "강릉 경포벚꽃축제",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-10",
      placeName: "경포 습지광장",
      imageSource: { url: "https://x.com/f.jpg", stable: true },
      link: "https://visitgangneung.net",
      region: "강원도",
      order: 2,
      description: "벚꽃길 축제",
      address: "강원특별자치도 강릉시 경포로 365",
      published: true,
      tourApiId: "695592",
    });
  });

  it("설명/주소/공개여부가 없으면 각각 빈 문자열/false다", () => {
    const page = {
      id: "festival-2",
      created_time: "2026-08-02T00:00:00.000Z",
      properties: {
        "제목": { title: [{ plain_text: "제목만" }] },
      },
    };

    expect(toFestival(page)).toMatchObject({ description: "", address: "", published: false, tourApiId: "" });
  });
});

describe("장소 사진 원본 식별자", () => {
  // 노션에 직접 올린 사진은 한 시간쯤 지나면 만료되는 서명 URL이다. R2로
  // 미러링하려면 쿼리스트링을 뺀 안정적인 식별자가 필요하다.
  it("노션이 호스팅한 사진은 미러링 대상으로 표시한다", () => {
    const place = toPlace({
      id: "p1",
      properties: {
        "장소명": { title: [{ plain_text: "가" }] },
        "사진": { files: [{ type: "file", file: { url: "https://notion.so/a.jpg?sig=xxx" } }] },
      },
    });
    expect(place.imageSource).toEqual({ url: "https://notion.so/a.jpg?sig=xxx", stable: false });
  });

  // 우리가 올린 사진은 이미 R2 외부 URL이라 손댈 게 없다.
  it("외부 URL은 그대로 안정적으로 본다", () => {
    const place = toPlace({
      id: "p2",
      properties: {
        "장소명": { title: [{ plain_text: "나" }] },
        "사진": { files: [{ type: "external", external: { url: "https://x/images/places/a.jpg" } }] },
      },
    });
    expect(place.imageSource.stable).toBe(true);
  });

  it("사진이 없으면 null", () => {
    const place = toPlace({ id: "p3", properties: { "장소명": { title: [{ plain_text: "다" }] } } });
    expect(place.imageSource).toBeNull();
  });
});

describe("공개 여부", () => {
  // 검수 모드에서는 비공개 장소가 섞여 오므로 화면이 구분할 수 있어야 한다.
  it("공개 여부를 함께 넘긴다", () => {
    const on = toPlace({ id: "a", properties: { "장소명": { title: [{ plain_text: "가" }] }, "공개여부": { checkbox: true } } });
    const off = toPlace({ id: "b", properties: { "장소명": { title: [{ plain_text: "나" }] }, "공개여부": { checkbox: false } } });
    expect(on.published).toBe(true);
    expect(off.published).toBe(false);
  });

  it("속성이 없으면 비공개로 본다", () => {
    expect(toPlace({ id: "c", properties: { "장소명": { title: [{ plain_text: "다" }] } } }).published).toBe(false);
  });
});
