// 장소 하나를 등록하는 데 필요한 조각들을 한 곳에 모은다.
//
// 지금까지는 장소를 추가할 때마다 좌표 확인·근처 맛집·편의시설·사진을 따로따로
// 챙겼고, 그러다 부평 굴포누리가 한국 밖 좌표로 등록되거나 근처 맛집이 비어
// 코스보기에 핀이 안 찍히는 일이 생겼다. 등록 절차를 한 줄기로 묶어 빠뜨릴 수
// 없게 만든다.
//
// 네트워크 호출은 전부 인자로 주입받아 이 파일은 순수 함수만 남긴다.

// ── 좌표 ────────────────────────────────────────────────
// TourAPI가 가끔 한국 밖 좌표를 준다(부평 굴포누리가 19.69, 117.99였다). 그대로
// 두면 지도에서 장소가 사라지므로 등록 전에 반드시 거른다.
export const KOREA_BOUNDS = { minLat: 33, maxLat: 39, minLng: 124, maxLng: 132 };

export function isInKorea(coords) {
  if (!coords) return false;
  const lat = Number(coords.lat);
  const lng = Number(coords.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= KOREA_BOUNDS.minLat && lat <= KOREA_BOUNDS.maxLat &&
    lng >= KOREA_BOUNDS.minLng && lng <= KOREA_BOUNDS.maxLng
  );
}

export function distanceKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── 근처 맛집·카페 ───────────────────────────────────────
// 아이를 데리고 갈 곳이라 술집 성격은 뺀다. 상호에 드러나는 것만 걸러도 대부분 잡힌다.
const EXCLUDE_NAME = /술집|호프|포차|주점|바비큐펍|와인|칵테일|맥주|소주|이자카야|룸|노래/;

// 어댑터가 { title, dist(m), kind: "cafe" | "food" } 로 맞춰서 넘긴다.
// 지방은 반경 3km 안에 아무것도 없는 곳이 흔해 넉넉히 잡는다 — 차로 움직이는
// 코스라 10분 거리면 "근처"로 친다.
export function pickNearby(items, { maxEach = 2, maxDistanceKm = 10, placeName = "" } = {}) {
  // 관내 식당은 "근처"가 아니다. 해남공룡박물관 반경 검색에 "해남공룡박물관 식당"이
  // 0m로 잡혔는데, 코스보기에서 장소와 핀이 겹쳐 따로 들를 곳이 되지 못한다.
  const own = String(placeName).replace(/\s/g, "");
  const isInside = (title) => own.length >= 3 && title.replace(/\s/g, "").includes(own);

  const clean = (items || [])
    .filter((i) => i && i.title && !EXCLUDE_NAME.test(i.title) && !isInside(i.title))
    .filter((i) => !Number.isFinite(Number(i.dist)) || Number(i.dist) / 1000 <= maxDistanceKm)
    .toSorted((a, b) => Number(a.dist || 0) - Number(b.dist || 0));

  const seen = new Set();
  const unique = clean.filter((i) => {
    const key = i.title.replace(/\s/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    restaurants: unique.filter((i) => i.kind !== "cafe").slice(0, maxEach),
    cafes: unique.filter((i) => i.kind === "cafe").slice(0, maxEach),
  };
}

// 노션 "근처맛집"/"근처카페"는 자유 텍스트다. 상세페이지가 괄호 앞부분을 상호로
// 읽어 지도 검색에 쓰므로, 상호를 맨 앞에 두고 거리만 괄호에 넣는다.
export function formatNearby(list) {
  return (list || [])
    .map((i) => {
      const km = Number(i.dist) / 1000;
      const dist = Number.isFinite(km) ? ` (약 ${km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`})` : "";
      return `${i.title}${dist}`;
    })
    .join(" / ");
}

// 주소에서 시·군·구를 뽑는다. 장소 이름으로 검색해도 근처 카페가 안 나올 때
// "장흥군 카페" 처럼 넓혀 다시 찾기 위한 것이다. 거리 필터가 먼 곳을 걸러 준다.
export function districtOf(address) {
  const parts = String(address || "").split(/\s+/);
  // 광역시·특별시는 너무 넓어 건너뛴다 — "인천광역시 카페"로 찾으면 반대편 카페가 나온다.
  const hit = parts.find(
    (t) => /[시군구]$/.test(t) && t.length >= 3 && !/(광역시|특별시|특별자치시|특별자치도)$/.test(t)
  );
  return hit || "";
}

// 시·도를 블로그가 쓰는 짧은 이름으로 뽑는다. "마포구"만으로 찾으면 "서울 난지한강공원"
// 같은 흔한 표기를 놓친다.
const SIDO = [
  ["서울", /^서울/], ["부산", /^부산/], ["대구", /^대구/], ["인천", /^인천/],
  ["광주", /^광주광역/], ["대전", /^대전/], ["울산", /^울산/], ["세종", /^세종/],
  ["경기", /^경기/], ["강원", /^강원/], ["충북", /^충청북/], ["충남", /^충청남/],
  ["전북", /^전(라북|북)/], ["전남", /^전라남/], ["경북", /^경상북/], ["경남", /^경상남/],
  ["제주", /^제주/],
];

export function sidoOf(address) {
  const head = String(address || "").trim().split(/\s+/)[0] || "";
  const hit = SIDO.find(([, re]) => re.test(head));
  return hit ? hit[0] : "";
}

// ── 편의시설 ────────────────────────────────────────────
// 최근 글만 본다. 편의시설은 리모델링으로 바뀌는데 오래된 글을 근거로 삼으면
// 지금은 없는 시설을 있다고 표시하게 된다.
export const AMENITY_MAX_AGE_DAYS = 182;

export const AMENITY_TARGETS = [
  { field: "기저귀교환대", keys: ["기저귀교환대", "기저귀 교환대", "기저귀갈이대", "기저귀 갈이대"] },
  { field: "수유실", keys: ["수유실", "모유수유실", "수유 공간"] },
  { field: "유아의자", keys: ["유아의자", "아기의자", "아기 의자", "유아용 의자", "하이체어"] },
];

const NEGATION = /없어요|없습니다|없음|없고|따로 없|안 되|불가|미비/;

// 이름이 흔한 곳은 이 길이를 넘지 못한다. "장미공원"은 인천에도 중랑에도 있지만
// "인천어린이과학관"처럼 긴 이름은 다른 지역과 겹치지 않는다.
const DISTINCT_NAME_LENGTH = 7;

// 장소명이 글에 실제로 등장하는 것만 남긴다. 이 필터가 없으면 "표선해수욕장 수유실"
// 검색에 근처 카페 후기가 걸려 엉뚱한 시설 정보가 들어간다.
//
// 이름이 짧으면 그것만으로 부족하다 — "장미공원 수유실" 검색에 중랑 장미공원과
// 부산 카페 후기가 걸려 인천 장미공원의 시설로 들어갈 뻔했다. 그래서 흔한 이름은
// 글이 지역까지 함께 말하는 것만 인정한다.
export function mentionsPlace(item, placeName, region) {
  const token = String(placeName || "").replace(/\s/g, "");
  if (token.length < 2) return false;
  const hay = `${item.title || ""} ${item.description || ""}`.replace(/\s/g, "");

  const named = hay.includes(token) ||
    (token.length > DISTINCT_NAME_LENGTH - 1 && hay.includes(token.slice(0, 5)));
  if (!named) return false;
  if (!region || token.length >= DISTINCT_NAME_LENGTH) return true;
  return hay.includes(String(region).replace(/\s/g, ""));
}

export function isRecent(postdate, now = Date.now()) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(postdate || ""));
  if (!m) return true; // 날짜가 없으면 판단하지 않고 통과시킨다
  const posted = new Date(`${m[1]}-${m[2]}-${m[3]}`).getTime();
  return now - posted <= AMENITY_MAX_AGE_DAYS * 86400000;
}

// 근거 스니펫까지 함께 돌려준다 — 자동으로 체크하지 않고 사람이 읽고 판단하기 위함이다.
export function collectAmenityHints(items, placeName, target, now = Date.now(), region = "") {
  const hits = [];
  for (const item of items || []) {
    if (!mentionsPlace(item, placeName, region)) continue;
    if (!isRecent(item.date, now)) continue;
    const combined = `${item.title || ""} ${item.description || ""}`;
    for (const key of target.keys) {
      const idx = combined.indexOf(key);
      if (idx === -1) continue;
      if (NEGATION.test(combined.slice(idx, idx + key.length + 15))) break;
      hits.push({
        snippet: combined.slice(Math.max(0, idx - 25), idx + key.length + 30).trim(),
        link: item.link || "",
        date: item.date || "",
      });
      break;
    }
  }
  return hits;
}

// TourAPI는 공원의 입장료 필드를 비워 둔다. 74곳을 뽑아 보니 65곳이 그랬다.
// "공원이니 무료겠지"로 채우면 틀렸을 때 고객이 헛걸음하므로, 여기서도 근거만 모아
// 사람이 판단하게 한다. 편의시설과 달리 "입장료 없어요"는 유효한 정보라 부정문을
// 걸러내지 않는다.
export const FEE_KEYS = ["입장료", "이용료", "관람료", "요금", "무료"];

export function collectFeeHints(items, placeName, now = Date.now(), region = "") {
  const hits = [];
  for (const item of items || []) {
    if (!mentionsPlace(item, placeName, region)) continue;
    if (!isRecent(item.date, now)) continue;
    const combined = `${item.title || ""} ${item.description || ""}`;
    for (const key of FEE_KEYS) {
      const idx = combined.indexOf(key);
      if (idx === -1) continue;
      hits.push({
        snippet: combined.slice(Math.max(0, idx - 30), idx + key.length + 40).trim(),
        link: item.link || "",
        date: item.date || "",
      });
      break;
    }
  }
  return hits;
}

// ── 조립 ────────────────────────────────────────────────
export function buildPlaceRecord({ base, coords, nearby, photoUrl, photoCredit, today }) {
  const { restaurants, cafes } = nearby || { restaurants: [], cafes: [] };
  return {
    장소명: base.name,
    지역: base.region,
    카테고리: base.categories || [],
    주소: base.address || "",
    위도: coords.lat,
    경도: coords.lng,
    운영시간: base.hours || "",
    입장료: base.fee || "",
    무료입장연령: base.freeAgePolicy || "",
    주차가능여부: base.parking || "무료",
    추천이유: base.reason || "",
    근처맛집: formatNearby(restaurants),
    근처카페: formatNearby(cafes),
    정보출처: base.sourceUrl || "",
    확인상태: "공공데이터",
    정보확인일: today,
    사진: photoUrl || "",
    사진출처: photoCredit || "",
  };
}

/**
 * 장소 하나를 등록 가능한 형태로 만든다. 네트워크는 전부 주입받는다.
 *
 * @param {object} deps
 * @param {object} deps.base 장소 기본 정보(이름·지역·주소·운영시간 등)
 * @param {(address: string) => Promise<{lat:number,lng:number}|null>} deps.geocode
 * @param {(coords: {lat:number,lng:number}) => Promise<Array>} deps.findNearby
 * @param {(placeName: string, keyword: string) => Promise<Array>} deps.searchPosts
 */
export async function preparePlace({ base, geocode, findNearby, searchPosts, today }) {
  const warnings = [];

  // 1) 좌표 — 주어진 값이 한국 밖이면 주소로 다시 받는다.
  let coords = isInKorea(base) ? { lat: Number(base.lat), lng: Number(base.lng) } : null;
  if (!coords && base.address) {
    const fixed = await geocode(base.address);
    if (isInKorea(fixed)) {
      coords = fixed;
      warnings.push("좌표를 주소로 다시 받았습니다");
    }
  }
  if (!coords) {
    return { ok: false, error: "좌표를 확인할 수 없습니다", warnings };
  }

  // 2) 근처 맛집·카페 — 없으면 코스보기에 핀이 안 찍힌다.
  const nearbyRaw = await findNearby(coords).catch(() => []);
  const nearby = pickNearby(nearbyRaw, { placeName: base.name });
  if (!nearby.restaurants.length) warnings.push("근처 맛집을 찾지 못했습니다");
  if (!nearby.cafes.length) warnings.push("근처 카페를 찾지 못했습니다");

  // 3) 편의시설 — 자동으로 체크하지 않고 근거만 모은다.
  const amenityHints = {};
  for (const target of AMENITY_TARGETS) {
    /* oxlint-disable no-await-in-loop */
    const posts = await searchPosts(base.name, target.keys[0], base.region).catch(() => []);
    /* oxlint-enable no-await-in-loop */
    const hits = collectAmenityHints(posts, base.name, target, Date.now(), base.region);
    if (hits.length) amenityHints[target.field] = hits;
  }

  // 4) 입장료 — TourAPI가 비워 둔 곳만 근거를 찾는다.
  const feeHints = base.fee
    ? []
    : collectFeeHints(
        await searchPosts(base.name, "입장료", base.region).catch(() => []),
        base.name, Date.now(), base.region
      );

  return {
    ok: true,
    feeHints,
    record: buildPlaceRecord({
      base, coords, nearby,
      photoUrl: base.photoUrl, photoCredit: base.photoCredit, today,
    }),
    amenityHints,
    warnings,
  };
}

// ── 후보 걸러내기 ────────────────────────────────────────
// 이름만으로 거르면 "감중공원" 같은 동네 근린공원이 그대로 올라온다. 아빠가 아이를
// 데리고 일부러 찾아가는 곳인지는 사람들이 실제로 그곳을 다녀와 글을 쓰는지로 갈린다.
// 블로그 언급이 거의 없는 곳은 목적지가 아니라 동네 산책로다.
export const MIN_BLOG_MENTIONS = 5;

export function destinationScore(posts, placeName, region) {
  return (posts || []).filter((p) => mentionsPlace(p, placeName, region)).length;
}

// 검토 끝에 앱 취지에 안 맞는다고 판단해 뺀 곳. 발굴을 다시 돌려도 올라오지 않게 한다.
// 여기 있는 곳을 되살리려면 이 목록에서 지우고 이유를 함께 적을 것.
export const REJECTED = new Map([
  ["인천어린이천문대", "전면 예약제 + 회차당 가격이 높아 '아빠랑 가볍게' 취지와 안 맞음"],
  ["일산어린이천문대", "인천어린이천문대와 같은 이유"],
]);

export function isRejected(name) {
  return REJECTED.has(String(name || "").replace(/\s/g, ""));
}
