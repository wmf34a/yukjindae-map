import { describe, it, expect } from "vitest";
import {
  isInKorea,
  distanceKm,
  pickNearby,
  formatNearby,
  mentionsPlace,
  isRecent,
  collectAmenityHints,
  buildPlaceRecord,
  preparePlace,
  AMENITY_TARGETS,
  destinationScore,
  isRejected,
} from "./place-pipeline.js";

describe("isInKorea", () => {
  it("국내 좌표를 통과시킨다", () => {
    expect(isInKorea({ lat: 37.5665, lng: 126.978 })).toBe(true);
    expect(isInKorea({ lat: 33.4996, lng: 126.5312 })).toBe(true);
  });

  // 부평 굴포누리가 TourAPI에서 19.69, 117.99로 들어왔다. 그대로 두면 지도에서 사라진다.
  it("한국 밖 좌표를 걸러낸다", () => {
    expect(isInKorea({ lat: 19.69, lng: 117.99 })).toBe(false);
    expect(isInKorea({ lat: 0, lng: 0 })).toBe(false);
  });

  it("숫자가 아니면 걸러낸다", () => {
    expect(isInKorea({ lat: "abc", lng: 126 })).toBe(false);
    expect(isInKorea(null)).toBe(false);
    expect(isInKorea({})).toBe(false);
  });
});

describe("distanceKm", () => {
  it("두 지점 거리를 km로 잰다", () => {
    // 서울시청 ↔ 강남역, 실제 직선거리 약 8.5km
    const d = distanceKm({ lat: 37.5665, lng: 126.978 }, { lat: 37.4979, lng: 127.0276 });
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(10);
  });
});

describe("pickNearby", () => {
  const items = [
    { title: "고메돈까스", dist: 736, cat3: "A05020100" },
    { title: "동네호프집", dist: 300, cat3: "A05020100" },
    { title: "모모아트", dist: 2098, cat3: "A05020900" },
    { title: "수피아", dist: 2368, cat3: "A05020900" },
    { title: "어리버리소머리국밥", dist: 1422, cat3: "A05020100" },
    { title: "먼집", dist: 9000, cat3: "A05020100" },
  ];

  it("카페와 음식점을 나눈다", () => {
    const { restaurants, cafes } = pickNearby(items);
    expect(restaurants.map((r) => r.title)).toEqual(["고메돈까스", "어리버리소머리국밥"]);
    expect(cafes.map((c) => c.title)).toEqual(["모모아트", "수피아"]);
  });

  // 아이를 데리고 가는 곳이라 술집 성격은 뺀다.
  it("술집 성격 상호를 걸러낸다", () => {
    const { restaurants } = pickNearby(items);
    expect(restaurants.map((r) => r.title)).not.toContain("동네호프집");
  });

  it("너무 먼 곳은 뺀다", () => {
    const { restaurants } = pickNearby(items, { maxDistanceKm: 5 });
    expect(restaurants.map((r) => r.title)).not.toContain("먼집");
  });

  it("가까운 순으로 고른다", () => {
    const { restaurants } = pickNearby(items, { maxEach: 1 });
    expect(restaurants[0].title).toBe("고메돈까스");
  });

  it("빈 목록도 죽지 않는다", () => {
    expect(pickNearby([])).toEqual({ restaurants: [], cafes: [] });
    expect(pickNearby(null)).toEqual({ restaurants: [], cafes: [] });
  });
});

describe("formatNearby", () => {
  // 상세페이지가 괄호 앞부분을 상호로 읽어 지도 검색에 쓴다. 상호가 맨 앞이어야 한다.
  it("상호를 앞에 두고 거리를 괄호에 넣는다", () => {
    expect(formatNearby([{ title: "고메돈까스", dist: 736 }])).toBe("고메돈까스 (약 736m)");
  });

  it("1km 이상은 km로 쓴다", () => {
    expect(formatNearby([{ title: "국밥집", dist: 1422 }])).toBe("국밥집 (약 1.4km)");
  });

  it("여러 곳은 슬래시로 잇는다", () => {
    const out = formatNearby([{ title: "가", dist: 100 }, { title: "나", dist: 200 }]);
    expect(out).toBe("가 (약 100m) / 나 (약 200m)");
  });

  it("빈 목록은 빈 문자열", () => {
    expect(formatNearby([])).toBe("");
    expect(formatNearby(null)).toBe("");
  });
});

describe("mentionsPlace", () => {
  it("장소명이 등장하는 글만 통과시킨다", () => {
    expect(mentionsPlace({ title: "인천어린이과학관 후기", description: "" }, "인천어린이과학관")).toBe(true);
  });

  // "표선해수욕장 수유실" 검색에 근처 카페 후기가 걸려 엉뚱한 정보가 들어갔었다.
  it("장소명이 없으면 거른다", () => {
    expect(mentionsPlace({ title: "제주 카페 젠타일스", description: "수유실 있어요" }, "표선해수욕장")).toBe(false);
  });

  it("긴 이름은 앞 5자만 맞아도 통과시킨다", () => {
    expect(mentionsPlace({ title: "부평 굴포누리 다녀옴", description: "" }, "부평 굴포누리 기후변화체험관")).toBe(true);
  });
});

describe("isRecent", () => {
  const now = new Date("2026-08-27").getTime();

  it("6개월 이내 글은 통과", () => {
    expect(isRecent("20260801", now)).toBe(true);
  });

  // 리모델링으로 시설이 바뀐다. 오래된 글은 지금 없는 시설을 있다고 말할 수 있다.
  it("6개월 넘은 글은 거른다", () => {
    expect(isRecent("20250101", now)).toBe(false);
  });

  it("날짜가 없으면 판단하지 않고 통과시킨다", () => {
    expect(isRecent("", now)).toBe(true);
    expect(isRecent(undefined, now)).toBe(true);
  });
});

describe("collectAmenityHints", () => {
  const now = new Date("2026-08-27").getTime();
  const target = AMENITY_TARGETS.find((t) => t.field === "수유실");

  it("근거 스니펫과 링크를 모은다", () => {
    const hits = collectAmenityHints(
      [{ title: "인천어린이과학관", description: "1층 로비에 가족수유실 있어요", link: "https://x", date: "20260801" }],
      "인천어린이과학관", target, now
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain("수유실");
    expect(hits[0].link).toBe("https://x");
  });

  // "수유실은 없어요" 같은 문장을 있음으로 오판하면 안 된다.
  it("부정문은 채택하지 않는다", () => {
    const hits = collectAmenityHints(
      [{ title: "인천어린이과학관", description: "수유실은 따로 없어요", date: "20260801" }],
      "인천어린이과학관", target, now
    );
    expect(hits).toHaveLength(0);
  });

  it("다른 장소 글은 채택하지 않는다", () => {
    const hits = collectAmenityHints(
      [{ title: "근처 카페 후기", description: "수유실 좋아요", date: "20260801" }],
      "인천어린이과학관", target, now
    );
    expect(hits).toHaveLength(0);
  });
});

describe("preparePlace", () => {
  const base = {
    name: "테스트과학관", region: "인천", categories: ["실내놀이"],
    address: "인천광역시 계양구 방축로 21",
    lat: 37.5516, lng: 126.74, hours: "09:00~18:00", fee: "무료",
  };
  const deps = {
    geocode: async () => ({ lat: 37.5516, lng: 126.74 }),
    findNearby: async () => [
      { title: "고메돈까스", dist: 736, cat3: "A05020100" },
      { title: "모모아트", dist: 2098, cat3: "A05020900" },
    ],
    searchPosts: async () => [],
    today: "2026-08-27",
  };

  it("좌표·근처맛집·카페를 채운 레코드를 만든다", async () => {
    const out = await preparePlace({ base, ...deps });
    expect(out.ok).toBe(true);
    expect(out.record["위도"]).toBe(37.5516);
    expect(out.record["근처맛집"]).toContain("고메돈까스");
    expect(out.record["근처카페"]).toContain("모모아트");
  });

  // 한국 밖 좌표가 들어오면 주소로 다시 받아야 한다.
  it("좌표가 한국 밖이면 주소로 다시 받는다", async () => {
    const out = await preparePlace({ base: { ...base, lat: 19.69, lng: 117.99 }, ...deps });
    expect(out.ok).toBe(true);
    expect(out.record["위도"]).toBe(37.5516);
    expect(out.warnings).toContain("좌표를 주소로 다시 받았습니다");
  });

  it("좌표를 끝내 못 구하면 실패로 돌려준다", async () => {
    const out = await preparePlace({
      base: { ...base, lat: 0, lng: 0, address: "" },
      ...deps, geocode: async () => null,
    });
    expect(out.ok).toBe(false);
  });

  // 근처 맛집이 비면 코스보기에 핀이 안 찍힌다 — 조용히 넘어가지 않고 알린다.
  it("근처 맛집이 없으면 경고를 남긴다", async () => {
    const out = await preparePlace({ base, ...deps, findNearby: async () => [] });
    expect(out.warnings).toContain("근처 맛집을 찾지 못했습니다");
    expect(out.warnings).toContain("근처 카페를 찾지 못했습니다");
  });

  it("편의시설 근거를 함께 돌려준다", async () => {
    const out = await preparePlace({
      base, ...deps,
      searchPosts: async () => [
        // 이름이 짧아 지역까지 맞아야 통과한다.
        { title: "인천 테스트과학관 후기", description: "1층에 수유실 있어요", date: "20260810", link: "https://x" },
      ],
    });
    expect(out.amenityHints["수유실"]).toHaveLength(1);
  });
});

describe("buildPlaceRecord", () => {
  it("노션 속성 이름에 맞춰 조립한다", () => {
    const r = buildPlaceRecord({
      base: { name: "가", region: "인천", categories: ["무료"], address: "주소" },
      coords: { lat: 37, lng: 127 },
      nearby: { restaurants: [{ title: "밥집", dist: 500 }], cafes: [] },
      photoUrl: "https://x/a.jpg", photoCredit: "한국관광공사", today: "2026-08-27",
    });
    expect(r["장소명"]).toBe("가");
    expect(r["근처맛집"]).toBe("밥집 (약 500m)");
    expect(r["근처카페"]).toBe("");
    expect(r["사진출처"]).toBe("한국관광공사");
    expect(r["확인상태"]).toBe("공공데이터");
  });
});

describe("destinationScore", () => {
  // "감중공원" 같은 동네 근린공원은 블로그 언급이 거의 없다 — 목적지가 아니라 산책로다.
  it("장소를 실제로 언급한 글만 센다", () => {
    const posts = [
      { title: "인천어린이과학관 다녀옴", description: "" },
      { title: "인천어린이과학관 후기", description: "" },
      { title: "다른 곳 이야기", description: "" },
    ];
    expect(destinationScore(posts, "인천어린이과학관")).toBe(2);
  });

  it("빈 목록은 0", () => {
    expect(destinationScore([], "가")).toBe(0);
    expect(destinationScore(null, "가")).toBe(0);
  });
});

describe("isRejected", () => {
  // 사용자가 취지에 안 맞는다고 판단해 뺀 곳이 발굴에 다시 올라오면 안 된다.
  it("검토 끝에 제외한 곳을 막는다", () => {
    expect(isRejected("인천어린이천문대")).toBe(true);
    expect(isRejected("인천 어린이 천문대")).toBe(true);
  });

  it("그 외에는 통과시킨다", () => {
    expect(isRejected("인천어린이과학관")).toBe(false);
  });
});

describe("지역 검증", () => {
  const now = new Date("2026-08-28").getTime();
  const target = AMENITY_TARGETS.find((t) => t.field === "수유실");

  // 인천 장미공원을 찾는데 중랑 장미공원 글이 걸려 엉뚱한 시설이 들어갈 뻔했다.
  it("이름이 흔하면 지역까지 맞아야 통과한다", () => {
    const post = { title: "중랑 장미공원 수유실 위치", description: "" };
    expect(mentionsPlace(post, "장미공원", "인천")).toBe(false);
    expect(mentionsPlace(post, "장미공원", "서울")).toBe(false);
    expect(mentionsPlace({ title: "인천 장미공원 다녀옴" }, "장미공원", "인천")).toBe(true);
  });

  it("이름이 길면 지역 없이도 통과한다", () => {
    expect(mentionsPlace({ title: "인천어린이과학관 후기" }, "인천어린이과학관", "인천")).toBe(true);
  });

  it("지역을 안 주면 예전처럼 이름만 본다", () => {
    expect(mentionsPlace({ title: "중랑 장미공원" }, "장미공원")).toBe(true);
  });

  it("편의시설 근거도 지역으로 거른다", () => {
    const posts = [
      { title: "중랑 장미공원", description: "수유실 있어요", date: "20260801" },
      { title: "인천 장미공원", description: "수유실 있어요", date: "20260801" },
    ];
    const hits = collectAmenityHints(posts, "장미공원", target, now, "인천");
    expect(hits).toHaveLength(1);
  });

  it("목적지 점수도 지역으로 거른다", () => {
    const posts = [{ title: "중랑 장미공원 아이랑" }, { title: "인천 장미공원 아이랑" }];
    expect(destinationScore(posts, "장미공원", "인천")).toBe(1);
  });
});
