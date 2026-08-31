import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// public/js/util.js는 <script>로 직접 읽히는 클래식 스크립트라 import할 수 없다.
// 화면 XSS 방어의 마지막 관문이라 테스트는 반드시 있어야 해서, 파일을 그대로
// 읽어 window를 흉내낸 컨텍스트에서 실행하고 노출된 함수를 꺼내 검증한다.
let escapeHtml, safeHref, safeImageSrc, festivalDday, monthlyRank, sortByMonthlyRank;
let splitNearbyList, primaryNearby, activeEvent, sortByDistance, distanceKm, HOME_PLACE_LIMIT, pickRegionTops, weatherScore;
let naverDirectionsUrl;
let readLastLocation, saveLastLocation, initialMapView;
let fakeStore;

beforeAll(() => {
  const source = fs.readFileSync(path.resolve("public/js/util.js"), "utf8");
  // localStorage 를 쓰는 함수가 생겨서 흉내 낸다. 사생활 보호 모드처럼 저장소를
  // 아예 못 쓰는 경우까지 같은 자리에서 검증한다.
  fakeStore = new Map();
  const localStorage = {
    getItem: (k) => (fakeStore.has(k) ? fakeStore.get(k) : null),
    setItem: (k, v) => { if (fakeStore.blocked) throw new Error("blocked"); fakeStore.set(k, String(v)); },
  };
  const sandbox = { window: {}, URL, AbortSignal, fetch: () => {}, Date, Math, JSON, String, Number, encodeURIComponent, localStorage };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  ({ escapeHtml, safeHref, safeImageSrc, festivalDday, monthlyRank, sortByMonthlyRank } = sandbox.window);
  ({ splitNearbyList, primaryNearby, activeEvent } = sandbox.window);
  ({ sortByDistance, distanceKm, HOME_PLACE_LIMIT, pickRegionTops, weatherScore } = sandbox.window);
  ({ naverDirectionsUrl } = sandbox.window);
  ({ readLastLocation, saveLastLocation, initialMapView } = sandbox.window);
});

// 지금이 KST로 몇 월인지에 따라 테스트가 갈리므로, 검증용으로도 같은 방식으로 계산한다.
const thisMonth = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);

describe("escapeHtml", () => {
  it("HTML 특수문자를 모두 엔티티로 바꾼다", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("스크립트 태그를 무력화한다", () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain("<script>");
  });

  it("속성 탈출을 막는다", () => {
    // alt="${...}" 안에 들어갔을 때 따옴표를 닫고 이벤트 핸들러를 붙이는 공격
    const payload = '" onerror="alert(1)';
    expect(escapeHtml(payload)).not.toContain('"');
  });

  it("null/undefined는 빈 문자열이 된다", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("일반 한글 텍스트는 그대로 둔다", () => {
    expect(escapeHtml("전쟁기념관 · 서울강북")).toBe("전쟁기념관 · 서울강북");
  });
});

describe("safeHref", () => {
  it("http(s) URL을 통과시킨다", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
  });

  it("javascript: 스킴을 막는다", () => {
    expect(safeHref("javascript:alert(1)")).toBe("");
    // 대소문자를 섞거나 앞에 공백을 넣는 우회도 막혀야 한다
    expect(safeHref("JaVaScRiPt:alert(1)")).toBe("");
    expect(safeHref("  javascript:alert(1)")).toBe("");
  });

  it("data: 스킴을 막는다", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("라벨이 앞에 붙은 값에서 URL만 뽑아낸다", () => {
    expect(safeHref("공식 홈페이지 https://example.com/x")).toBe("https://example.com/x");
  });

  it("빈 값은 빈 문자열이 된다", () => {
    expect(safeHref("")).toBe("");
    expect(safeHref(null)).toBe("");
  });
});

describe("safeImageSrc", () => {
  it("우리 R2 미러링 상대경로를 통과시킨다", () => {
    expect(safeImageSrc("/images/places/abc.jpg")).toBe("/images/places/abc.jpg");
  });

  it("외부 https 이미지도 통과시킨다", () => {
    expect(safeImageSrc("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
  });

  it("javascript: 스킴을 막는다", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBe("");
  });

  // 프로토콜 상대 URL(//evil.com/x.jpg)은 외부 출처를 우리 경로처럼 위장할 수 있다.
  it("프로토콜 상대 URL을 상대경로로 오인하지 않는다", () => {
    expect(safeImageSrc("//evil.com/x.jpg")).toBe("");
  });

  it("빈 값은 빈 문자열이 된다", () => {
    expect(safeImageSrc("")).toBe("");
    expect(safeImageSrc(null)).toBe("");
    expect(safeImageSrc(undefined)).toBe("");
  });
});

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("festivalDday", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("시작 전이면 D-n을 반환한다", () => {
    expect(festivalDday({ periodStart: plusDays(3) })).toBe("D-3");
  });

  it("기간 중이면 진행중을 반환한다", () => {
    expect(festivalDday({ periodStart: plusDays(-1), periodEnd: plusDays(1) })).toBe("진행중");
  });

  it("오늘 시작하면 진행중이다", () => {
    expect(festivalDday({ periodStart: today, periodEnd: today })).toBe("진행중");
  });

  it("이미 끝났으면 빈 문자열이다", () => {
    expect(festivalDday({ periodStart: plusDays(-10), periodEnd: plusDays(-5) })).toBe("");
  });

  it("시작일이 없으면 빈 문자열이다", () => {
    expect(festivalDday({})).toBe("");
  });
});

describe("monthlyRank", () => {
  it("이번 달 순위면 그대로 돌려준다", () => {
    expect(monthlyRank({ rank: 3, rankMonth: thisMonth() })).toBe(3);
  });

  // 갱신이 실패하면 지난달 순위가 노션에 남는다. 그걸 이번 달 순위로 쓰면
  // 계절이 안 맞는 곳이 맨 위에 서게 된다.
  it("지난달 순위는 인정하지 않는다", () => {
    expect(monthlyRank({ rank: 1, rankMonth: "2020-01" })).toBeNull();
  });

  it("순위가 없으면 null", () => {
    expect(monthlyRank({ rankMonth: thisMonth() })).toBeNull();
    expect(monthlyRank({ rank: null, rankMonth: thisMonth() })).toBeNull();
    expect(monthlyRank(undefined)).toBeNull();
  });
});

describe("sortByMonthlyRank", () => {
  const month = thisMonth();

  it("순위 순으로 앞에 세운다", () => {
    const sorted = sortByMonthlyRank([
      { name: "c", rank: 2, rankMonth: month },
      { name: "a", rank: 1, rankMonth: month },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(["a", "c"]);
  });

  it("순위 없는 장소는 뒤로 민다", () => {
    const sorted = sortByMonthlyRank([
      { name: "x" },
      { name: "a", rank: 1, rankMonth: month },
      { name: "y" },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(["a", "x", "y"]);
  });

  // 목록 순서가 새로고침마다 바뀌면 아까 본 곳을 다시 못 찾는다.
  it("순위 없는 장소끼리는 원래 순서를 유지한다", () => {
    const sorted = sortByMonthlyRank([{ name: "x" }, { name: "y" }, { name: "z" }]);
    expect(sorted.map((p) => p.name)).toEqual(["x", "y", "z"]);
  });

  it("지난달 순위는 순위 없음으로 취급한다", () => {
    const sorted = sortByMonthlyRank([
      { name: "old", rank: 1, rankMonth: "2020-01" },
      { name: "now", rank: 5, rankMonth: month },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(["now", "old"]);
  });

  it("원본 배열을 바꾸지 않는다", () => {
    const input = [{ name: "b", rank: 2, rankMonth: month }, { name: "a", rank: 1, rankMonth: month }];
    sortByMonthlyRank(input);
    expect(input.map((p) => p.name)).toEqual(["b", "a"]);
  });
});

describe("splitNearbyList", () => {
  it("쉼표로 구분된 기존 형식을 나눈다", () => {
    expect(splitNearbyList("사생활 영도점, 올바릇식당 영도점")).toEqual([
      "사생활 영도점",
      "올바릇식당 영도점",
    ]);
  });

  it("슬래시로 구분된 제주 형식을 나눈다", () => {
    expect(splitNearbyList("무호소반(제주시 수목원길 23) / 밥촐림(제주시 구남로 26)")).toEqual([
      "무호소반(제주시 수목원길 23)",
      "밥촐림(제주시 구남로 26)",
    ]);
  });

  // 괄호 안 쉼표에서 잘리면 "포도호텔 레스토랑(서귀포시 안덕면 산록남로 863"처럼
  // 반토막 난 상호가 지도 검색어로 나가서 핀을 못 찾는다.
  it("괄호 안 쉼표에서는 자르지 않는다", () => {
    expect(splitNearbyList("포도호텔 레스토랑(서귀포시 안덕면 산록남로 863, 일식)")).toEqual([
      "포도호텔 레스토랑(서귀포시 안덕면 산록남로 863, 일식)",
    ]);
  });

  it("괄호가 섞인 여러 건도 정확히 나눈다", () => {
    expect(
      splitNearbyList("별돈별 중문 본점(구산봉로 61, 아기 식사 무료·고기 구워줌) / 달페이지(색달로64번길 51, 브런치)")
    ).toEqual([
      "별돈별 중문 본점(구산봉로 61, 아기 식사 무료·고기 구워줌)",
      "달페이지(색달로64번길 51, 브런치)",
    ]);
  });

  it("한 곳만 있으면 그대로 한 건", () => {
    expect(splitNearbyList("오색막국수")).toEqual(["오색막국수"]);
  });

  it("빈 값은 빈 배열", () => {
    expect(splitNearbyList("")).toEqual([]);
    expect(splitNearbyList(null)).toEqual([]);
    expect(splitNearbyList(undefined)).toEqual([]);
  });

  it("구분자만 연달아 있어도 빈 항목을 만들지 않는다", () => {
    expect(splitNearbyList("A, , B")).toEqual(["A", "B"]);
  });
});

describe("primaryNearby", () => {
  it("맨 앞을 대표로 고른다", () => {
    expect(primaryNearby("사생활 영도점, 올바릇식당 영도점")).toBe("사생활 영도점");
  });

  it("괄호 메모가 붙어도 첫 건을 통째로 준다", () => {
    expect(primaryNearby("포도호텔 레스토랑(산록남로 863, 일식) / 두도 레스토랑")).toBe(
      "포도호텔 레스토랑(산록남로 863, 일식)"
    );
  });

  it("빈 값은 빈 문자열", () => {
    expect(primaryNearby("")).toBe("");
    expect(primaryNearby(undefined)).toBe("");
  });
});

const kstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const shiftKst = (days) =>
  new Date(Date.now() + 9 * 60 * 60 * 1000 + days * 86400000).toISOString().slice(0, 10);

describe("activeEvent", () => {
  it("진행 중인 이벤트를 통과시킨다", () => {
    const e = activeEvent({ eventInfo: "현장 결제 25% 할인", eventEndDate: shiftKst(3) });
    expect(e.info).toBe("현장 결제 25% 할인");
  });

  // 끝난 행사가 계속 붙어 있는 쪽이, 정보가 없는 것보다 나쁘다.
  it("종료일이 지나면 노출하지 않는다", () => {
    expect(activeEvent({ eventInfo: "할인", eventEndDate: shiftKst(-1) })).toBeNull();
  });

  it("종료일 당일까지는 유효하다", () => {
    expect(activeEvent({ eventInfo: "할인", eventEndDate: kstToday() })).not.toBeNull();
  });

  // "상시 할인"처럼 종료일이 없으면 언제 내려야 할지 알 수 없다.
  it("종료일이 없으면 노출하지 않는다", () => {
    expect(activeEvent({ eventInfo: "상시 할인" })).toBeNull();
    expect(activeEvent({ eventInfo: "상시 할인", eventEndDate: "" })).toBeNull();
  });

  it("내용이 비면 노출하지 않는다", () => {
    expect(activeEvent({ eventInfo: "   ", eventEndDate: shiftKst(3) })).toBeNull();
    expect(activeEvent({ eventEndDate: shiftKst(3) })).toBeNull();
  });

  it("장소가 없어도 죽지 않는다", () => {
    expect(activeEvent(undefined)).toBeNull();
    expect(activeEvent(null)).toBeNull();
  });

  it("출처가 있으면 함께 준다", () => {
    const e = activeEvent({ eventInfo: "할인", eventEndDate: shiftKst(1), eventSourceUrl: "https://x.com/a" });
    expect(e.source).toBe("https://x.com/a");
  });
});

describe("sortByDistance", () => {
  const seoul = { lat: 37.5665, lng: 126.978 };
  const places = [
    { name: "부산", lat: 35.1796, lng: 129.0756 },
    { name: "광화문", lat: 37.5759, lng: 126.9769 },
    { name: "수원", lat: 37.2636, lng: 127.0286 },
  ];

  it("가까운 순으로 정렬한다", () => {
    expect(sortByDistance(places, seoul).map((p) => p.name)).toEqual(["광화문", "수원", "부산"]);
  });

  // 좌표가 없으면 거리를 알 수 없다. 앞에 두면 가까운 곳을 밀어낸다.
  it("좌표 없는 장소는 뒤로 보낸다", () => {
    const out = sortByDistance([{ name: "좌표없음" }, ...places], seoul);
    expect(out.at(-1).name).toBe("좌표없음");
  });

  it("위치를 모르면 순서를 바꾸지 않는다", () => {
    expect(sortByDistance(places, null).map((p) => p.name)).toEqual(["부산", "광화문", "수원"]);
    expect(sortByDistance(places, {}).map((p) => p.name)).toEqual(["부산", "광화문", "수원"]);
  });

  // 정렬 때문에 원본이 바뀌면 다른 화면이 영향을 받는다.
  it("원본 배열을 건드리지 않는다", () => {
    const original = places.map((p) => p.name);
    sortByDistance(places, seoul);
    expect(places.map((p) => p.name)).toEqual(original);
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

describe("HOME_PLACE_LIMIT", () => {
  // 224곳을 다 그리면 제보 버튼이 스크롤 맨 끝에 묻힌다.
  it("첫 화면 노출 개수를 정해 둔다", () => {
    expect(HOME_PLACE_LIMIT).toBeGreaterThan(0);
    expect(HOME_PLACE_LIMIT).toBeLessThan(30);
  });
});

describe("monthlyRank 기간 판정", () => {
  const thisMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const shift = (n) => {
    const d = new Date(`${thisMonth}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 7);
  };

  it("이번 달 순위는 보여준다", () => {
    expect(monthlyRank({ rank: 3, rankMonth: thisMonth })).toBe(3);
  });

  // 8월에 뽑은 물놀이장이 9월에도 1위로 서 있으면 추천이 아니라 방해가 된다.
  it("지난달 순위는 숨긴다", () => {
    expect(monthlyRank({ rank: 1, rankMonth: shift(-1) })).toBeNull();
  });

  // 오픈 전에 다음 달 순위를 미리 돌려 두는 일이 있다. 낡은 게 아니라 앞선 것이다.
  it("다음 달 순위는 보여준다", () => {
    expect(monthlyRank({ rank: 1, rankMonth: shift(1) })).toBe(1);
  });

  it("순위나 추천월이 없으면 null", () => {
    expect(monthlyRank({ rankMonth: thisMonth })).toBeNull();
    expect(monthlyRank({ rank: 1 })).toBeNull();
    expect(monthlyRank(null)).toBeNull();
  });
});

describe("pickRegionTops", () => {
  const thisMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const p = (name, region, rank) => ({ name, region, rank, rankMonth: rank ? thisMonth : undefined });

  it("지역마다 한 곳씩만 고른다", () => {
    const out = pickRegionTops([
      p("가", "서울강북", 1), p("나", "서울강북", 2),
      p("다", "제주", 1), p("라", "제주", 3),
    ]);
    expect(out.map((x) => x.name).toSorted()).toEqual(["가", "다"]);
  });

  it("순위가 높은 쪽을 고른다", () => {
    const out = pickRegionTops([p("나", "인천", 5), p("가", "인천", 1)]);
    expect(out[0].name).toBe("가");
  });

  // 새로 공개한 장소는 아직 순위가 없다. 그 지역이 통째로 빠지면 안 된다.
  it("순위 있는 곳을 순위 없는 곳보다 앞세운다", () => {
    expect(pickRegionTops([p("무순위", "강원도"), p("일위", "강원도", 1)])[0].name).toBe("일위");
  });

  it("순위가 아무 곳에도 없으면 그 지역의 첫 장소를 쓴다", () => {
    const out = pickRegionTops([p("가", "경상도"), p("나", "경상도")]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("가");
  });

  // 지역이 비어 있는 장소가 섞이면 "undefined 지역" 카드가 생긴다.
  it("지역이 없는 장소는 뺀다", () => {
    expect(pickRegionTops([{ name: "가" }, p("나", "제주", 1)]).map((x) => x.name)).toEqual(["나"]);
  });

  it("빈 목록도 죽지 않는다", () => {
    expect(pickRegionTops([])).toEqual([]);
  });
});

describe("pickRegionTops 날씨 반영", () => {
  const thisMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const p = (name, region, rank, categories) => ({
    name, region, rank, rankMonth: thisMonth, categories,
  });
  const rainy = { boost: ["실내놀이"], avoid: ["자연·공원"] };

  // 화면 위에서 "실내에서 놀기 좋은 곳"이라 해놓고 아래에 야외만 늘어놓으면 안 된다.
  it("비 오는 날에는 순위를 양보하고 실내를 고른다", () => {
    const out = pickRegionTops([
      p("야외1위", "인천", 1, ["자연·공원"]),
      p("실내3위", "인천", 3, ["실내놀이"]),
    ], rainy);
    expect(out[0].name).toBe("실내3위");
  });

  it("같은 날씨 조건이면 순위가 높은 쪽을 고른다", () => {
    const out = pickRegionTops([
      p("실내5위", "인천", 5, ["실내놀이"]),
      p("실내2위", "인천", 2, ["실내놀이"]),
    ], rainy);
    expect(out[0].name).toBe("실내2위");
  });

  it("날씨 정보가 없으면 순위만 본다", () => {
    const out = pickRegionTops([
      p("야외1위", "인천", 1, ["자연·공원"]),
      p("실내3위", "인천", 3, ["실내놀이"]),
    ]);
    expect(out[0].name).toBe("야외1위");
  });

  it("맑은 날에는 야외가 앞선다", () => {
    const sunny = { boost: ["자연·공원"], avoid: [] };
    const out = pickRegionTops([
      p("실내1위", "제주", 1, ["실내놀이"]),
      p("야외4위", "제주", 4, ["자연·공원"]),
    ], sunny);
    expect(out[0].name).toBe("야외4위");
  });
});

describe("weatherScore 우선순위", () => {
  const rainy = { boost: ["실내놀이", "체험·문화"], avoid: ["자연·공원"] };

  // 목장·수목원은 "자연·공원"과 "체험·문화"를 둘 다 달고 있다. boost를 먼저 보면
  // 비 오는 날에도 체험이라는 이유로 통과해, 홈에 야외만 늘어섰다.
  it("야외 태그가 있으면 체험 태그가 있어도 비 오는 날엔 뒤로 보낸다", () => {
    expect(weatherScore({ categories: ["자연·공원", "체험·문화"] }, rainy)).toBe(2);
  });

  it("실내 전용은 앞으로 당긴다", () => {
    expect(weatherScore({ categories: ["체험·문화", "무료"] }, rainy)).toBe(0);
  });

  it("해당 없는 곳은 가운데", () => {
    expect(weatherScore({ categories: ["맛집"] }, rainy)).toBe(1);
  });

  it("날씨 정보가 없으면 모두 같게 본다", () => {
    expect(weatherScore({ categories: ["자연·공원"] }, null)).toBe(1);
  });
});

describe("naverDirectionsUrl", () => {
  // 주소로 검색하면 그 주소에 있는 업소가 줄줄이 나오고 목적지가 뒤로 밀린다.
  // 한성백제박물관을 눌렀는데 같은 건물 비샵 레스토랑이 먼저 떴다.
  it("좌표가 있으면 자동차 길찾기로 바로 보낸다", () => {
    const url = naverDirectionsUrl({
      lat: 37.5154988428, lng: 127.1206650789, name: "한성백제박물관",
      address: "서울특별시 송파구 위례성대로 71",
    });
    expect(url.startsWith("https://map.naver.com/p/directions/-/")).toBe(true);
    expect(url.endsWith("/-/car")).toBe(true);
    expect(url).toContain(encodeURIComponent("한성백제박물관"));
    // 주소는 길찾기 주소에 들어가지 않는다 — 좌표가 대신한다.
    expect(url).not.toContain("%EC%9C%84%EB%A1%80%EC%84%B1");
  });

  it("좌표가 없으면 주소가 아니라 이름으로 검색한다", () => {
    const url = naverDirectionsUrl({ name: "전주한옥마을", address: "전북 전주시 태조로 44" });
    expect(url).toBe(`https://map.naver.com/p/search/${encodeURIComponent("전주한옥마을")}`);
  });

  // Number(null)이 0이라 (0, 0)이 좌표로 통과하면 기니만으로 길을 안내한다.
  it("0,0은 좌표로 보지 않는다", () => {
    const url = naverDirectionsUrl({ lat: 0, lng: 0, name: "어딘가" });
    expect(url).toContain("/p/search/");
  });
});

describe("주변 탭 첫 화면", () => {
  const NATION = { lat: 36.4, lng: 127.9, zoom: 7 };
  const NOW = Date.parse("2026-09-01T12:00:00Z");

  it("기억한 위치가 없으면 전국 뷰에서 연다", () => {
    fakeStore.clear();
    expect(initialMapView(NATION, NOW)).toEqual({ ...NATION, fromMemory: false });
  });

  it("기억한 위치가 있으면 거기서 연다 — 전국 뷰를 거치지 않는다", () => {
    fakeStore.clear();
    saveLastLocation(37.5, 127.0, NOW);
    const view = initialMapView(NATION, NOW);
    expect(view.fromMemory).toBe(true);
    expect(view.lat).toBeCloseTo(37.5);
    expect(view.zoom).toBe(13);
  });

  it("2주가 지난 위치는 믿지 않는다 — 여행 중이거나 이사했을 수 있다", () => {
    fakeStore.clear();
    saveLastLocation(37.5, 127.0, NOW - 15 * 24 * 60 * 60 * 1000);
    expect(initialMapView(NATION, NOW).fromMemory).toBe(false);
  });

  it("저장소를 못 쓰는 브라우저에서도 지도는 뜬다", () => {
    fakeStore.clear();
    fakeStore.blocked = true;
    expect(() => saveLastLocation(37.5, 127.0, NOW)).not.toThrow();
    expect(initialMapView(NATION, NOW).fromMemory).toBe(false);
    fakeStore.blocked = false;
  });

  it("깨진 값이 저장돼 있어도 전국 뷰로 떨어진다", () => {
    fakeStore.clear();
    fakeStore.set("yukjindae:lastLocation", "{망가진 값");
    expect(readLastLocation(NOW)).toBeNull();
    expect(initialMapView(NATION, NOW).fromMemory).toBe(false);
  });

  it("좌표가 숫자가 아니면 믿지 않는다", () => {
    fakeStore.clear();
    fakeStore.set("yukjindae:lastLocation", JSON.stringify({ lat: "37.5", lng: 127, at: NOW }));
    expect(readLastLocation(NOW)).toBeNull();
  });

  it("저장한 값을 그대로 읽어 온다", () => {
    fakeStore.clear();
    saveLastLocation(35.1796, 129.0756, NOW);
    expect(readLastLocation(NOW)).toEqual({ lat: 35.1796, lng: 129.0756, at: NOW });
  });
});
