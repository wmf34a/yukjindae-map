const COURSE_LEG_MS = 2000;
const COURSE_WALK_KMH = 4;
// 자동차 구간(1km 초과)의 fallback 추정 속도 — 도심 평균 주행 속도(신호 대기 포함) 가정.
const COURSE_CAR_KMH = 25;
const COURSE_CAR_THRESHOLD_M = 1000;
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

function courseWalkIcon() {
  return {
    content: `<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35));">🚶</div>`,
    anchor: new naver.maps.Point(12, 12),
  };
}

function courseTravelIcon(mode) {
  return mode === "car" ? courseCarIcon() : courseWalkIcon();
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

// 카페/맛집이 장소 건물 내부에 있는 경우처럼 좌표가 완전히 겹치면, 나중에 그려진
// 핀이 먼저 그려진 핀을 그대로 덮어버려 화면에서 사라져 보인다. 실제 거리 계산·
// 하단 텍스트·길찾기 링크는 원래 좌표를 그대로 쓰고, 지도 위 핀 위치만 살짝
// 부채꼴로 벌려서 전부 보이고 클릭 가능하게 만든다.
const PIN_OVERLAP_EPSILON_DEG = 0.00005; // 대략 5m
// 핀 아이콘 자체가 30x40px라서, 코스가 넓게 퍼져 있어 지도가 줌아웃될 때도 핀끼리
// 서로 가리지 않게 넉넉히 떨어뜨린다(실제 좌표/거리 계산과는 무관한 화면 표시 전용값).
const PIN_OVERLAP_OFFSET_M = 70;

function offsetLatLng(lat, lng, bearingDeg, distanceM) {
  const R = 6371000;
  const bearing = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angularDist = distanceM / R;
  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDist) + Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearing)
  );
  const newLngRad =
    lngRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDist) * Math.cos(latRad),
      Math.cos(angularDist) - Math.sin(latRad) * Math.sin(newLatRad)
    );
  return { lat: (newLatRad * 180) / Math.PI, lng: (newLngRad * 180) / Math.PI };
}

function pinDisplayPositions(stops) {
  const placed = [];
  return stops.map((s, i) => {
    const overlaps = placed.some(
      (p) => Math.abs(p.lat - s.lat) < PIN_OVERLAP_EPSILON_DEG && Math.abs(p.lng - s.lng) < PIN_OVERLAP_EPSILON_DEG
    );
    placed.push({ lat: s.lat, lng: s.lng });
    if (!overlaps) return { lat: s.lat, lng: s.lng };
    return offsetLatLng(s.lat, s.lng, i * 120, PIN_OVERLAP_OFFSET_M);
  });
}

function formatDistance(distanceM) {
  return distanceM < 1000 ? `${Math.round(distanceM)}m` : `${(distanceM / 1000).toFixed(1)}km`;
}

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

function travelMode(distanceM) {
  return distanceM > COURSE_CAR_THRESHOLD_M ? "car" : "walk";
}

function travelMinutes(distanceM) {
  const kmh = travelMode(distanceM) === "car" ? COURSE_CAR_KMH : COURSE_WALK_KMH;
  return Math.max(1, Math.round((distanceM / 1000 / kmh) * 60));
}

function formatSegmentLabel(segment) {
  const minutes = travelMinutes(segment.distanceM);
  const timeText = travelMode(segment.distanceM) === "car" ? `자차 약 ${formatMinutes(minutes)}` : `도보 ${formatMinutes(minutes)}`;
  const suffix = segment.estimated ? " (예상)" : "";
  return `약 ${formatDistance(segment.distanceM)} · ${timeText}${suffix}`;
}

// 네이버 클라우드에는 도보 길찾기 API가 없어서 자동차 길찾기(Direction 5)의 도로
// 거리값만 쓸 수 있다. 1km 이내 도보 구간은 차량 도로 경로가 실제 보행 동선(골목,
// 인도, 지름길)과 달라 의미가 없으므로 API 호출 없이 바로 직선거리 추정치를 쓰고,
// 1km 초과(자차 기준) 구간만 Direction 5로 실제 도로 거리를 가져온다. 이 API가
// 실패하면(구간이 너무 짧아 경로를 못 찾는 경우, 상품 미활성화 등) 직선거리로
// 대체하고 "예상"으로 표시한다.
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

async function resolveSegment(from, to) {
  const straightM = haversineKm(from, to) * 1000;
  if (straightM <= COURSE_CAR_THRESHOLD_M) {
    return { from, to, distanceM: straightM, estimated: true };
  }
  const roadDistanceM = await fetchRoadDistance(from, to);
  if (roadDistanceM != null) return { from, to, distanceM: roadDistanceM, estimated: false };
  return { from, to, distanceM: straightM, estimated: true };
}

async function resolveSegments(stops) {
  const pairs = [];
  for (let i = 1; i < stops.length; i++) pairs.push([stops[i - 1], stops[i]]);
  return Promise.all(pairs.map(([from, to]) => resolveSegment(from, to)));
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
// segments[i]는 stops[i] → stops[i+1] 구간이라, 역방향으로 도는 동안에도
// 같은 물리 구간이면 같은 이동수단(도보/자차) 아이콘을 써야 한다.
function startCarAnimation(stops, segments) {
  if (stops.length < 2) return;
  let index = 0;
  let direction = 1;
  let legStart = performance.now();
  let currentMode = null;

  function tick(now) {
    if (!courseCarMarker) return;
    const t = Math.min(1, (now - legStart) / COURSE_LEG_MS);
    const from = stops[index];
    const to = stops[index + direction];

    const legIndex = direction === 1 ? index : index - 1;
    const mode = travelMode(segments[legIndex].distanceM);
    if (mode !== currentMode) {
      currentMode = mode;
      courseCarMarker.setIcon(courseTravelIcon(mode));
    }

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

// 지도 위에는 핀/경로선/자동차 애니메이션만 남기고, 구간별 거리·시간은 가독성
// 문제로 하단 텍스트 설명에서만 보여준다(renderCourseFooter 참고).
function initCourseMap(stops, segments) {
  const displayPositions = pinDisplayPositions(stops);

  courseMap = new naver.maps.Map("course-map", {
    center: new naver.maps.LatLng(displayPositions[0].lat, displayPositions[0].lng),
    zoom: 15,
    logoControlOptions: { position: naver.maps.Position.TOP_LEFT },
  });

  courseMarkers = stops.map((s, i) =>
    new naver.maps.Marker({
      position: new naver.maps.LatLng(displayPositions[i].lat, displayPositions[i].lng),
      map: courseMap,
      icon: coursePinIcon(s.color, String(i + 1)),
      zIndex: 10,
    })
  );

  if (stops.length > 1) {
    coursePolyline = new naver.maps.Polyline({
      map: courseMap,
      path: displayPositions.map((p) => new naver.maps.LatLng(p.lat, p.lng)),
      strokeColor: "#2563EB",
      strokeOpacity: 0.85,
      strokeWeight: 3,
      strokeStyle: "shortdash",
    });

    courseCarMarker = new naver.maps.Marker({
      position: new naver.maps.LatLng(displayPositions[0].lat, displayPositions[0].lng),
      map: courseMap,
      icon: courseTravelIcon(travelMode(segments[0].distanceM)),
      zIndex: 20,
    });
    startCarAnimation(displayPositions, segments);
  }

  fitBoundsToStops(displayPositions);
}

function isMobileUA() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// map.naver.com/p/directions(새 지도)는 좌표를 WGS84 위경도가 아니라 Web Mercator
// (EPSG:3857) 투영 좌표로 받는다 — 이걸 놓치면 지점을 못 알아듣고 이름 텍스트로
// 재검색하며 모드도 기본값(대중교통)으로 떨어진다.
function toWebMercator(lat, lng) {
  const R = 20037508.34;
  const x = (lng * R) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (R / 180);
  return { x, y };
}

// 좌표 뒤에 이름을 붙인 지점을 순서대로 이어 붙이면 그대로 경유지가 되고,
// 끝의 모드값을 car로 주면 자동차 탭이 기본으로 열린다.
function buildWebDirectionsUrl(stops) {
  const points = stops.map((s) => {
    const { x, y } = toWebMercator(s.lat, s.lng);
    return `${x},${y},${encodeURIComponent(s.name)}`;
  });
  return `https://map.naver.com/p/directions/${points.join("/")}/-/car`;
}

// 네이버 지도 앱 URL 스킴(nmap://route/car) — 출발/도착 외 경유지는 v1lat/v1lng/v1name,
// v2lat.. 순으로 늘어난다. appname은 호출 앱을 식별하는 필수 파라미터라 이 사이트의
// origin을 넘긴다.
function buildNmapCarUrl(stops) {
  const start = stops[0];
  const goal = stops[stops.length - 1];
  const vias = stops.slice(1, -1);

  const params = new URLSearchParams();
  params.set("slat", start.lat);
  params.set("slng", start.lng);
  params.set("sname", start.name);
  vias.forEach((via, i) => {
    params.set(`v${i + 1}lat`, via.lat);
    params.set(`v${i + 1}lng`, via.lng);
    params.set(`v${i + 1}name`, via.name);
  });
  params.set("dlat", goal.lat);
  params.set("dlng", goal.lng);
  params.set("dname", goal.name);
  params.set("appname", location.origin);

  return `nmap://route/car?${params.toString()}`;
}

// 모바일에서는 네이버 지도 앱을 자동차 모드로 먼저 열어보고, 앱이 없어서 반응이
// 없으면(페이지가 그대로 남아있으면) 일정 시간 뒤 웹 길찾기로 대체한다. 데스크톱은
// 앱 스킴이 의미 없으니 그냥 href(자동차 모드 웹 링크)를 그대로 새 탭으로 연다.
// 모달을 열 때마다 같은 버튼 엘리먼트에 다시 바인딩되므로, addEventListener 대신
// onclick 단일 슬롯을 써서 이전 핸들러가 겹겹이 쌓이는 걸 막는다.
/* oxlint-disable unicorn/prefer-add-event-listener */
function bindDirectionsButton(stops) {
  const btn = document.getElementById("course-directions-btn");
  const webUrl = buildWebDirectionsUrl(stops);
  btn.href = webUrl;
  btn.hidden = false;

  if (!isMobileUA()) {
    btn.onclick = null;
    return;
  }

  btn.onclick = (event) => {
    event.preventDefault();
    const fallback = setTimeout(() => window.open(webUrl, "_blank", "noopener"), 1200);
    window.addEventListener("pagehide", () => clearTimeout(fallback), { once: true });
    location.href = buildNmapCarUrl(stops);
  };
}
/* oxlint-enable unicorn/prefer-add-event-listener */

// 지도 위 핀(coursePinIcon)과 색상·번호를 그대로 맞춰서, 아래 장소명 목록만 보고도
// 어떤 핀인지 바로 알아볼 수 있게 한다.
function renderCourseFooter(stops, segments) {
  document.getElementById("course-order").innerHTML = stops
    .map(
      (s, i) =>
        `<span class="course-order__stop"><span class="course-order__badge" style="background:${s.color}">${i + 1}</span>${s.name}</span>`
    )
    .join(`<span class="course-order__arrow">→</span>`);

  const segmentsEl = document.getElementById("course-segments");
  const directionsBtn = document.getElementById("course-directions-btn");

  if (stops.length < 2) {
    document.getElementById("course-meta").textContent = "";
    segmentsEl.innerHTML = "";
    directionsBtn.hidden = true;
    /* oxlint-disable-next-line unicorn/prefer-add-event-listener -- bindDirectionsButton과 동일한 이유(단일 슬롯) */
    directionsBtn.onclick = null;
    return;
  }

  const totalM = segments.reduce((sum, s) => sum + s.distanceM, 0);
  // 총 소요시간은 구간별로 도보/자차 기준이 다를 수 있어, 합쳐진 총 거리에
  // 하나의 속도를 적용하지 않고 각 구간이 이미 계산한 시간을 그대로 더한다.
  const totalMinutes = segments.reduce((sum, s) => sum + travelMinutes(s.distanceM), 0);
  const modes = new Set(segments.map((s) => travelMode(s.distanceM)));
  const modeNote = modes.size > 1 ? " (도보+자차 혼합)" : modes.has("car") ? " (자차)" : " (도보)";
  const estimatedNote = segments.some((s) => s.estimated) ? " (일부 구간 예상)" : "";
  document.getElementById("course-meta").textContent =
    `총 거리 ${formatDistance(totalM)} · 이동 약 ${formatMinutes(totalMinutes)}${modeNote}${estimatedNote}`;

  segmentsEl.innerHTML = segments
    .map((segment, i) => `<p class="course-segment">${stops[i].name} → ${stops[i + 1].name} · ${formatSegmentLabel(segment)}</p>`)
    .join("");

  bindDirectionsButton(stops);
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

// place.html의 "코스보기"(장소+근처맛집+근처카페 자동 추천)와 테마 코스 모음의
// "경로 보기"(이미 좌표를 아는 정류장 목록)가 정류장을 구하는 방식만 다르고
// 그 이후(거리 계산/지도 렌더링/길찾기 버튼)는 완전히 같아서 공통 함수로 뺐다.
async function runCourseModal(title, stopsPromise) {
  if (!window.naver || !window.naver.maps) return;

  const overlay = document.getElementById("course-modal-overlay");
  const body = document.getElementById("course-map-body");
  const titleEl = document.getElementById("course-modal-title");
  if (titleEl) titleEl.textContent = title;
  overlay.classList.add("is-open");
  history.pushState({ courseModal: true }, "");
  courseHistoryPushed = true;

  body.innerHTML = `<p class="course-modal__loading">코스를 준비하는 중...</p>`;
  document.getElementById("course-order").textContent = "";
  document.getElementById("course-meta").textContent = "";
  document.getElementById("course-segments").innerHTML = "";
  document.getElementById("course-directions-btn").hidden = true;

  const stops = await stopsPromise;

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

async function openCourseModal(place) {
  await runCourseModal("추천 코스", resolveCourseStops(place));
}

const THEME_COURSE_PIN_COLORS = ["#5B6B95", "#E08E45", "#4E9F6E", "#B5548E", "#3C4972"];

// 테마 코스는 정류장이 전부 우리 장소 DB에 연결돼 있어 좌표를 이미 알고 있으므로,
// resolveCourseStops처럼 지오코딩할 필요 없이 바로 stops를 만들 수 있다.
function openThemeCourseModal(course, places) {
  const stops = course.placeIds
    .map((id, i) => {
      const place = places.find((p) => p.id === id);
      if (!place || typeof place.lat !== "number" || typeof place.lng !== "number") return null;
      return { name: place.name, lat: place.lat, lng: place.lng, color: THEME_COURSE_PIN_COLORS[i % THEME_COURSE_PIN_COLORS.length] };
    })
    .filter(Boolean);
  runCourseModal(course.name, Promise.resolve(stops));
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
window.openThemeCourseModal = openThemeCourseModal;
