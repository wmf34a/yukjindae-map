const COURSE_LEG_MS = 2000;
const COURSE_WALK_KMH = 4;
const COURSE_PIN_COLORS = ["#1A2F6B", "#F59E0B", "#10B981"];

let courseMap = null;
let courseMarkers = [];
let courseSegmentLabels = [];
let coursePolyline = null;
let courseCarMarker = null;
let courseCarRaf = null;
let courseHistoryPushed = false;

function coursePinIcon(color, label) {
  return {
    content: `
      <div style="position:relative;width:30px;height:40px;">
        <svg width="30" height="40" viewBox="0 0 30 40" style="position:absolute;top:0;left:0;">
          <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.716 23.284 0 15 0z" fill="${color}"/>
        </svg>
        <div style="position:absolute;top:0;left:0;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;">${label}</div>
      </div>
    `,
    anchor: new naver.maps.Point(15, 40),
  };
}

function courseCarIcon() {
  return {
    content: `<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35));">🚗</div>`,
    anchor: new naver.maps.Point(12, 12),
  };
}

// content 크기가 텍스트 길이에 따라 달라지므로, anchor를 (0,0)으로 고정해두고
// 내부 요소를 transform:translate(-50%,-50%)로 밀어서 실제 중심을 좌표에 맞춘다.
function segmentLabelIcon(text) {
  return {
    content: `
      <div style="transform:translate(-50%,-50%);white-space:nowrap;background:#fff;border:1px solid #2563EB;color:#1A2F6B;font-size:10px;font-weight:700;padding:3px 7px;border-radius:999px;box-shadow:0 1px 4px rgba(13,27,62,0.25);">${text}</div>
    `,
    anchor: new naver.maps.Point(0, 0),
  };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function walkMinutes(distanceM) {
  return Math.max(1, Math.round((distanceM / 1000 / COURSE_WALK_KMH) * 60));
}

function formatDistance(distanceM) {
  return distanceM < 1000 ? `${Math.round(distanceM)}m` : `${(distanceM / 1000).toFixed(1)}km`;
}

function formatSegmentLabel(segment) {
  const suffix = segment.estimated ? " (예상)" : "";
  return `약 ${formatDistance(segment.distanceM)} · 도보 ${walkMinutes(segment.distanceM)}분${suffix}`;
}

// 네이버 클라우드에는 도보 길찾기 API가 없어서 자동차 길찾기(Direction 5)의 도로
// 거리값을 대신 쓴다. 이 API가 실패하거나(구간이 너무 짧아 경로를 못 찾는 경우 등)
// 응답이 없으면 직선거리로 대체하고 "예상"으로 표시한다.
async function fetchRoadDistance(from, to) {
  try {
    const start = `${from.lng},${from.lat}`;
    const goal = `${to.lng},${to.lat}`;
    const res = await fetch(`/api/directions?start=${encodeURIComponent(start)}&goal=${encodeURIComponent(goal)}`);
    const data = await res.json();
    return data.found ? data.distance : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function resolveSegments(stops) {
  const pairs = [];
  for (let i = 1; i < stops.length; i++) pairs.push([stops[i - 1], stops[i]]);

  return Promise.all(
    pairs.map(async ([from, to]) => {
      const roadDistanceM = await fetchRoadDistance(from, to);
      if (roadDistanceM != null) return { from, to, distanceM: roadDistanceM, estimated: false };
      return { from, to, distanceM: haversineKm(from, to) * 1000, estimated: true };
    })
  );
}

async function geocodeAddress(address) {
  if (!address) return null;
  try {
    const res = await fetch(`/api/geocode?query=${encodeURIComponent(address)}`);
    const data = await res.json();
    return data.found ? { lat: data.lat, lng: data.lng } : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function resolvePlaceStop(place) {
  if (typeof place.lat === "number" && typeof place.lng === "number") {
    return { name: place.name, lat: place.lat, lng: place.lng };
  }
  const coords = await geocodeAddress(place.address);
  return coords ? { name: place.name, ...coords } : null;
}

// 근처맛집/근처카페는 노션에 주소가 아니라 상호 텍스트로 들어있어서, 우선 네이버
// 지역검색으로 실제 도로명주소를 찾은 뒤 그 주소를 지오코딩해서 좌표를 얻는다.
async function resolveNearbyStop(rawValue) {
  if (!rawValue || !window.isSingleBusinessName(rawValue)) return null;
  const query = window.stripParenthetical(rawValue) || rawValue;
  try {
    const res = await fetch(`/api/nearby-place?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!data.found) return null;
    const coords = await geocodeAddress(data.address);
    return coords ? { name: data.name || query, ...coords } : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function resolveCourseStops(place) {
  const [placeStop, restaurantStop, cafeStop] = await Promise.all([
    resolvePlaceStop(place),
    resolveNearbyStop(place.nearbyRestaurant),
    resolveNearbyStop(place.nearbyCafe),
  ]);

  // 색상은 역할(장소/맛집/카페) 고정이라, 맛집이 빠져서 카페가 두 번째 정차지가 되는
  // 경우에도 카페는 항상 초록이어야 한다 — 그래서 필터링 전 배열 위치가 아니라
  // 역할별로 미리 색을 붙여둔 뒤에 없는 정차지만 걸러낸다.
  const roled = [
    { stop: placeStop, color: COURSE_PIN_COLORS[0] },
    { stop: restaurantStop, color: COURSE_PIN_COLORS[1] },
    { stop: cafeStop, color: COURSE_PIN_COLORS[2] },
  ];

  return roled
    .filter((r) => r.stop)
    .map((r) => {
      r.stop.color = r.color;
      return r.stop;
    });
}

function fitBoundsToStops(stops) {
  const bounds = new naver.maps.LatLngBounds(
    new naver.maps.LatLng(stops[0].lat, stops[0].lng),
    new naver.maps.LatLng(stops[0].lat, stops[0].lng)
  );
  stops.forEach((s) => bounds.extend(new naver.maps.LatLng(s.lat, s.lng)));
  courseMap.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
}

// 정차 없이 코스를 계속 보여주기 위해, 마지막 핀에 닿으면 방향을 뒤집어 왕복시킨다
// (역방향으로 계속 진행하면 경로선 밖으로 벗어나는 순간이 생기기 때문).
function startCarAnimation(stops) {
  if (stops.length < 2) return;
  let index = 0;
  let direction = 1;
  let legStart = performance.now();

  function tick(now) {
    if (!courseCarMarker) return;
    const t = Math.min(1, (now - legStart) / COURSE_LEG_MS);
    const from = stops[index];
    const to = stops[index + direction];
    courseCarMarker.setPosition(
      new naver.maps.LatLng(from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t)
    );

    if (t >= 1) {
      index += direction;
      if (index === stops.length - 1) direction = -1;
      else if (index === 0) direction = 1;
      legStart = now;
    }
    courseCarRaf = requestAnimationFrame(tick);
  }
  courseCarRaf = requestAnimationFrame(tick);
}

function stopCarAnimation() {
  if (courseCarRaf) {
    cancelAnimationFrame(courseCarRaf);
    courseCarRaf = null;
  }
}

function initCourseMap(stops, segments) {
  courseMap = new naver.maps.Map("course-map", {
    center: new naver.maps.LatLng(stops[0].lat, stops[0].lng),
    zoom: 15,
    logoControlOptions: { position: naver.maps.Position.TOP_LEFT },
  });

  courseMarkers = stops.map((s, i) =>
    new naver.maps.Marker({
      position: new naver.maps.LatLng(s.lat, s.lng),
      map: courseMap,
      icon: coursePinIcon(s.color, String(i + 1)),
      zIndex: 10,
    })
  );

  if (stops.length > 1) {
    coursePolyline = new naver.maps.Polyline({
      map: courseMap,
      path: stops.map((s) => new naver.maps.LatLng(s.lat, s.lng)),
      strokeColor: "#2563EB",
      strokeOpacity: 0.85,
      strokeWeight: 3,
      strokeStyle: "shortdash",
    });

    courseSegmentLabels = segments.map((segment, i) => {
      const mid = midpoint(stops[i], stops[i + 1]);
      return new naver.maps.Marker({
        position: new naver.maps.LatLng(mid.lat, mid.lng),
        map: courseMap,
        icon: segmentLabelIcon(formatSegmentLabel(segment)),
        zIndex: 15,
      });
    });

    courseCarMarker = new naver.maps.Marker({
      position: new naver.maps.LatLng(stops[0].lat, stops[0].lng),
      map: courseMap,
      icon: courseCarIcon(),
      zIndex: 20,
    });
    startCarAnimation(stops);
  }

  fitBoundsToStops(stops);
}

function buildDirectionsUrl(stops) {
  const segments = stops.map((s) => `${s.lng},${s.lat},${encodeURIComponent(s.name)}`);
  return `https://map.naver.com/p/directions/${segments.join("/")}/-/walk`;
}

function renderCourseFooter(stops, segments) {
  document.getElementById("course-order").textContent = stops.map((s) => s.name).join(" → ");

  const segmentsEl = document.getElementById("course-segments");
  const directionsBtn = document.getElementById("course-directions-btn");

  if (stops.length < 2) {
    document.getElementById("course-meta").textContent = "";
    segmentsEl.innerHTML = "";
    directionsBtn.hidden = true;
    return;
  }

  const totalM = segments.reduce((sum, s) => sum + s.distanceM, 0);
  const anyEstimated = segments.some((s) => s.estimated);
  const estimatedNote = anyEstimated ? " (일부 구간 예상)" : "";
  document.getElementById("course-meta").textContent =
    `총 거리 ${formatDistance(totalM)} · 도보 약 ${walkMinutes(totalM)}분${estimatedNote}`;

  segmentsEl.innerHTML = segments
    .map((segment, i) => `<p class="course-segment">${stops[i].name} → ${stops[i + 1].name} · ${formatSegmentLabel(segment)}</p>`)
    .join("");

  directionsBtn.href = buildDirectionsUrl(stops);
  directionsBtn.hidden = false;
}

function destroyCourseMap() {
  stopCarAnimation();
  courseMarkers.forEach((m) => m.setMap(null));
  courseMarkers = [];
  courseSegmentLabels.forEach((m) => m.setMap(null));
  courseSegmentLabels = [];
  if (coursePolyline) {
    coursePolyline.setMap(null);
    coursePolyline = null;
  }
  if (courseCarMarker) {
    courseCarMarker.setMap(null);
    courseCarMarker = null;
  }
  courseMap = null;
}

function closeCourseModal() {
  document.getElementById("course-modal-overlay").classList.remove("is-open");
  destroyCourseMap();
  if (courseHistoryPushed) {
    courseHistoryPushed = false;
    history.back();
  }
}

window.addEventListener("popstate", () => {
  if (!courseHistoryPushed) return;
  courseHistoryPushed = false;
  document.getElementById("course-modal-overlay").classList.remove("is-open");
  destroyCourseMap();
});

async function openCourseModal(place) {
  if (!window.naver || !window.naver.maps) return;

  const overlay = document.getElementById("course-modal-overlay");
  const body = document.getElementById("course-map-body");
  overlay.classList.add("is-open");
  history.pushState({ courseModal: true }, "");
  courseHistoryPushed = true;

  body.innerHTML = `<p class="course-modal__loading">코스를 준비하는 중...</p>`;
  document.getElementById("course-order").textContent = "";
  document.getElementById("course-meta").textContent = "";
  document.getElementById("course-segments").innerHTML = "";
  document.getElementById("course-directions-btn").hidden = true;

  const stops = await resolveCourseStops(place);

  if (!overlay.classList.contains("is-open")) return;

  if (stops.length === 0) {
    body.innerHTML = `<p class="course-modal__loading">코스 정보를 준비하지 못했어요.</p>`;
    return;
  }

  const segments = await resolveSegments(stops);

  if (!overlay.classList.contains("is-open")) return;

  body.innerHTML = `<div id="course-map" class="course-modal__map"></div>`;
  initCourseMap(stops, segments);
  renderCourseFooter(stops, segments);
}

function initCourseModal() {
  const overlay = document.getElementById("course-modal-overlay");
  overlay.querySelector(".course-modal__close").addEventListener("click", closeCourseModal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeCourseModal();
  });
}

document.addEventListener("DOMContentLoaded", initCourseModal);

window.openCourseModal = openCourseModal;
