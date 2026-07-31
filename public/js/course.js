const COURSE_LEG_MS = 2000;
const COURSE_WALK_KMH = 4;
const COURSE_PIN_COLORS = ["#1A2F6B", "#F59E0B", "#10B981"];

let courseMap = null;
let courseMarkers = [];
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

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDistanceKm(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += haversineKm(stops[i - 1], stops[i]);
  return total;
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

  return [placeStop, restaurantStop, cafeStop].filter(Boolean).map((stop, i) => {
    stop.color = COURSE_PIN_COLORS[i];
    return stop;
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

function initCourseMap(stops) {
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

function renderCourseFooter(stops) {
  document.getElementById("course-order").textContent = stops.map((s) => s.name).join(" → ");

  const directionsBtn = document.getElementById("course-directions-btn");
  if (stops.length < 2) {
    document.getElementById("course-meta").textContent = "";
    directionsBtn.hidden = true;
    return;
  }

  const distKm = totalDistanceKm(stops);
  const distText = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`;
  const walkMin = Math.max(1, Math.round((distKm / COURSE_WALK_KMH) * 60));
  document.getElementById("course-meta").textContent = `총 거리 ${distText} · 도보 약 ${walkMin}분`;

  directionsBtn.href = buildDirectionsUrl(stops);
  directionsBtn.hidden = false;
}

function destroyCourseMap() {
  stopCarAnimation();
  courseMarkers.forEach((m) => m.setMap(null));
  courseMarkers = [];
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
  document.getElementById("course-directions-btn").hidden = true;

  const stops = await resolveCourseStops(place);

  if (!overlay.classList.contains("is-open")) return;

  if (stops.length === 0) {
    body.innerHTML = `<p class="course-modal__loading">코스 정보를 준비하지 못했어요.</p>`;
    return;
  }

  body.innerHTML = `<div id="course-map" class="course-modal__map"></div>`;
  initCourseMap(stops);
  renderCourseFooter(stops);
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
