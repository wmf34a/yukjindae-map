// 우리 장소 DB의 좌표와 공공 수유실 데이터의 좌표를 대조해서, 아주 가까운 곳이
// 있으면 그 장소의 "수유실" 체크박스를 자동으로 켜준다. 역 좌표는 보통 출입구
// 기준이라 실제 장소 정문까지 도보 5~7분(400~500m대) 정도 차이가 나는 경우가
// 흔해서(예: 전쟁기념관↔삼각지역 312m, 용산가족공원↔서빙고역 503m) 500m로
// 잡았다 — 700m+는 오탐 위험이 커져서 실측 후 제외함. 그래도 확신할 수 없는
// 매칭이라 확인상태는 항상 "공공데이터"(대기)로만 남기고, 사람이 검토해서
// "확인됨"으로 바꿔야 최종 확정된다.
const EARTH_RADIUS_M = 6371000;
const DEFAULT_MAX_DISTANCE_M = 500;

export function haversineMeters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function findNearestRoom(place, rooms, maxDistanceMeters = DEFAULT_MAX_DISTANCE_M) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const room of rooms) {
    const distance = haversineMeters(place, room);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = room;
    }
  }
  return nearest && nearestDistance <= maxDistanceMeters ? nearest : null;
}

// 확인됨/블로그힌트/공공데이터로 이미 표시된 장소는 재검사하지 않는다 — 사람이
// 검증했거나 이미 다른 힌트가 붙어 대기 중인 항목을 덮어쓸 이유가 없기 때문.
export function needsPublicDataMatch(place) {
  return (
    !place.nursingRoom &&
    typeof place.lat === "number" &&
    typeof place.lng === "number" &&
    (!place.verifiedStatus || place.verifiedStatus === "미확인")
  );
}

export function buildPublicDataPatchProperties(room, today) {
  return {
    "수유실": { checkbox: true },
    "확인상태": { select: { name: "공공데이터" } },
    "정보확인일": { date: { start: today } },
    "정보출처": { url: room.sourceUrl || "" },
  };
}
