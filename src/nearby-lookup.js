// 근처 맛집·카페 상호를 좌표로 찾아낸다.
//
// 노션에는 상호 텍스트만 들어 있어서("신세계백화점 푸드코트") 이름만으로 검색하면
// 엉뚱한 지점이 걸린다. 실제로 대전 국립중앙과학관 코스에 서울 강남점이 잡혀
// 총 거리 306km, 이동 12시간짜리 코스가 나왔다.
//
// 카카오 키워드 검색은 기준 좌표와 반경을 받아 가까운 순으로 준다. 장소 좌표를
// 함께 넘겨 같은 상호 중 가장 가까운 지점을 고른다.
//
// 순수 함수만 담고 네트워크는 인자로 주입받는다.

// 같은 상호의 다른 지점이 이 밖에 있으면 "근처"가 아니다. 코스는 차로 움직이므로
// 시내 반대편까지는 허용하되, 다른 도시는 걸러지도록 잡았다.
export const NEARBY_SEARCH_RADIUS_M = 20000;

// 좌표를 못 받아 이름만으로 찾았을 때, 결과가 이보다 멀면 다른 지점으로 본다.
export const MAX_ACCEPT_KM = 30;

// Number(null)은 NaN이 아니라 0이다. 쿼리에 lat/lng가 아예 없을 때 이걸 그냥
// Number()로 감싸면 (0, 0)이 유효한 좌표로 통과해, 아프리카 앞바다 근처를
// 검색하고는 아무것도 못 찾았다고 답한다.
export function isValidCoords(coords) {
  if (!coords) return false;
  for (const key of ["lat", "lng"]) {
    const raw = coords[key];
    if (raw === null || raw === undefined || raw === "") return false;
    if (!Number.isFinite(Number(raw))) return false;
  }
  // 위경도 0은 한국이 아니다. 파라미터를 안 넘겼을 때의 기본값과 구분되지 않으므로
  // 좌표로 인정하지 않는다.
  return Number(coords.lat) !== 0 || Number(coords.lng) !== 0;
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

// 카카오 응답을 우리 형태로 바꾼다. 좌표까지 함께 주므로 지오코딩을 한 번 더
// 할 필요가 없다 — 네이버로 찾던 시절에는 주소를 받아 다시 지오코딩했다.
// 근처 맛집·카페 자리에 올 수 있는 업종인지 본다.
//
// 국립어린이박물관의 근처카페가 "플레저"인데 실제 카페 이름은 "플레져"였다.
// 한 글자가 달라 이름 대조를 통과하지 못했고, 대신 "스마트안마플레저"라는
// 의료기기 판매점이 걸렸다 — 어린이박물관 코스에 안마기 가게 핀이 찍힌 것이다.
//
// 이름이 겹친다고 아무 업종이나 받으면 이런 일이 난다. 먹고 마시는 곳을
// 먼저 고르고, 그런 게 없을 때만 나머지를 쓴다.
const FOOD_CATEGORY = /음식점|카페|디저트|베이커리|제과|커피|음식/;

export function isFoodish(doc) {
  return FOOD_CATEGORY.test(String(doc?.category_name || ""));
}

export function toNearbyResult(doc) {
  if (!doc || !doc.place_name) return null;
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    found: true,
    foodish: isFoodish(doc),
    name: doc.place_name,
    address: doc.road_address_name || doc.address_name || "",
    lat,
    lng,
    distanceM: Number.isFinite(Number(doc.distance)) ? Number(doc.distance) : null,
  };
}

// 검색어와 상호가 실제로 겹치는지 본다.
//
// 이름을 안 보고 가장 가까운 것을 집으면 엉뚱한 가게가 걸린다. 일산호수공원의
// 근처맛집은 "일산칼국수본점"인데 코스보기 핀에는 1.2km 떨어진 "황치제국
// 일산본점"이 찍히고 있었다 — 카카오에 "일산칼국수본점"이 없어서, 그냥 제일
// 가까운 결과가 돌아온 것이다. 상세화면 글과 지도 핀이 서로 다른 가게를
// 가리키는 셈이라, 그 코스를 믿고 찾아간 사람은 다른 집 앞에 선다.
//
// 공백·쉼표·가운뎃점·괄호를 지우고 한쪽이 다른 쪽을 품는지 본다. "포레스트
// 아웃팅스"와 "포레스트아웃팅스 일산본점"처럼 지점명이 붙는 경우는 통과시켜야
// 하기 때문이다.
export function squashName(s) {
  return String(s || "").replace(/[\s,·()（）]/g, "").toLowerCase();
}

export function nameMatches(query, placeName) {
  const want = squashName(query);
  const got = squashName(placeName);
  if (!want || !got) return false;
  return got.includes(want) || want.includes(got);
}

// 기준 좌표가 있으면 그 근처만, 없으면 첫 결과를 쓴다.
// query를 주면 상호가 겹치는 결과만 인정한다.
export function pickNearest(docs, origin, query = "") {
  const all = (docs || []).map(toNearbyResult).filter(Boolean);
  // 이름이 겹치는 게 하나도 없으면 아무것도 안 준다. 엉뚱한 가게에 핀을
  // 찍느니 핀을 하나 덜 찍는 편이 낫다.
  const matched = query ? all.filter((r) => nameMatches(query, r.name)) : all;
  // 먹고 마시는 곳이 하나라도 있으면 그 안에서만 고른다.
  const foodish = matched.filter((r) => r.foodish);
  const results = foodish.length ? foodish : matched;
  if (!results.length) return null;
  if (!isValidCoords(origin)) {
    const { foodish: _f, ...first } = results[0];
    return first;
  }

  const withDist = results.map((r) => ({
    ...r,
    km: r.distanceM === null ? distanceKm(origin, r) : r.distanceM / 1000,
  }));
  const nearest = withDist.reduce((a, b) => (a.km <= b.km ? a : b));
  // 반경 검색이 아무것도 못 찾아 이름만으로 넓게 찾은 경우를 대비한다.
  // 30km 밖이면 같은 이름의 다른 지점이라고 본다.
  if (nearest.km > MAX_ACCEPT_KM) return null;
  // km는 고르는 데만 쓰는 값이라 응답에 내보내지 않는다.
  const { km: _km, foodish: _foodish, ...result } = nearest;
  return result;
}
