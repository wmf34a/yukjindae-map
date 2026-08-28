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

export function isValidCoords(coords) {
  return Boolean(
    coords &&
    Number.isFinite(Number(coords.lat)) &&
    Number.isFinite(Number(coords.lng))
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

// 카카오 응답을 우리 형태로 바꾼다. 좌표까지 함께 주므로 지오코딩을 한 번 더
// 할 필요가 없다 — 네이버로 찾던 시절에는 주소를 받아 다시 지오코딩했다.
export function toNearbyResult(doc) {
  if (!doc || !doc.place_name) return null;
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    found: true,
    name: doc.place_name,
    address: doc.road_address_name || doc.address_name || "",
    lat,
    lng,
    distanceM: Number.isFinite(Number(doc.distance)) ? Number(doc.distance) : null,
  };
}

// 기준 좌표가 있으면 그 근처만, 없으면 첫 결과를 쓴다.
export function pickNearest(docs, origin) {
  const results = (docs || []).map(toNearbyResult).filter(Boolean);
  if (!results.length) return null;
  if (!isValidCoords(origin)) return results[0];

  const withDist = results.map((r) => ({
    ...r,
    km: r.distanceM === null ? distanceKm(origin, r) : r.distanceM / 1000,
  }));
  const nearest = withDist.reduce((a, b) => (a.km <= b.km ? a : b));
  // 반경 검색이 아무것도 못 찾아 이름만으로 넓게 찾은 경우를 대비한다.
  // 30km 밖이면 같은 이름의 다른 지점이라고 본다.
  if (nearest.km > MAX_ACCEPT_KM) return null;
  // km는 고르는 데만 쓰는 값이라 응답에 내보내지 않는다.
  const { km: _km, ...result } = nearest;
  return result;
}
