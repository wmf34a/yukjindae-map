import { describe, it, expect } from "vitest";
import { text, title, selectName, multiSelectNames, firstFileUrl, toPlace } from "./notion.js";

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

describe("toPlace", () => {
  it("Notion 페이지 객체를 장소 객체로 변환한다", () => {
    const page = {
      id: "page-1",
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
        "근처맛집": { rich_text: [{ plain_text: "진심" }] },
        "근처카페": { rich_text: [{ plain_text: "봉스디" }] },
        "등록자": { rich_text: [{ plain_text: "육진대" }] },
      },
    };

    const place = toPlace(page);

    expect(place).toMatchObject({
      id: "page-1",
      name: "전쟁기념관",
      region: "서울",
      categories: ["무료"],
      address: "서울 용산구 이태원로 29",
      lat: 37.5364643,
      lng: 126.9771484,
      image: "https://x.com/a.jpg",
      diaperChange: true,
      nursingRoom: false,
    });
  });
});
