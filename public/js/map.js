const REGION_VIEW = {
  "서울강북": { lat: 37.60, lng: 126.98, zoom: 12 },
  "서울강남": { lat: 37.50, lng: 127.05, zoom: 12 },
  "경기북부": { lat: 37.85, lng: 127.05, zoom: 10 },
  "경기남부": { lat: 37.22, lng: 127.10, zoom: 10 },
  "인천": { lat: 37.4563, lng: 126.7052, zoom: 11 },
  "강원도": { lat: 37.80, lng: 128.40, zoom: 8 },
  "충청도": { lat: 36.55, lng: 127.30, zoom: 9 },
  "전라도": { lat: 35.35, lng: 127.05, zoom: 8 },
  "경상도": { lat: 35.80, lng: 128.50, zoom: 8 },
  "제주": { lat: 33.40, lng: 126.55, zoom: 10 },
};
const DEFAULT_VIEW = { lat: 36.4, lng: 127.9, zoom: 7 };

let map;
let markers = [];
let places = [];
let sheetHistoryPushed = false;
let myLocation = null;

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

// 내 위치를 알고 있고 장소 목록도 불러온 상태여야 렌더링한다 — 둘 다
// 비동기라 어느 쪽이 먼저 끝나든 이 함수가 호출되면 조건을 다시 확인한다.
function renderNearbyList() {
  const wrap = document.getElementById("map-nearby");
  if (!myLocation || !places.length) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }

  const nearest = places
    .map((p) => ({ ...p, distanceKm: haversineKm(myLocation, { lat: p.lat, lng: p.lng }) }))
    .toSorted((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);

  wrap.hidden = false;
  wrap.innerHTML = `
    <p class="map-nearby__title">내 위치에서 가까운 순</p>
    <div class="map-nearby__track">
      ${nearest
        .map(
          (p) => `
        <button class="map-nearby__card" data-id="${p.id}">
          <img class="map-nearby__thumb" src="${escapeHtml(safeImageSrc(p.image))}" alt="" />
          <span class="map-nearby__name">${escapeHtml(p.name)}</span>
          <span class="map-nearby__dist">${formatDistance(p.distanceKm)}</span>
        </button>`
        )
        .join("")}
    </div>
  `;

  wrap.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const place = nearest.find((p) => p.id === btn.dataset.id);
      if (!place) return;
      map.setCenter(new naver.maps.LatLng(place.lat, place.lng));
      map.setZoom(14);
      openSheet(place);
    });
  });
}

// openSheet(장소)와 openNursingSheet(수유실)가 시트를 여는 절차(히스토리 push 등)를
// 공유하기 위해 뺀 공통부. 내용만 다르고 여닫는 동작은 동일하기 때문.
function presentSheet(contentHtml) {
  const sheet = document.getElementById("map-sheet");
  const content = document.getElementById("map-sheet-content");
  content.innerHTML = contentHtml;
  bindFavoriteButtons(content);
  sheet.classList.add("is-open");

  // 시트를 히스토리에 한 단계로 쌓아둬서, 뒤로가기를 눌렀을 때 지도 페이지를
  // 벗어나 홈으로 가버리지 않고 시트만 닫히도록 한다.
  if (!sheetHistoryPushed) {
    history.pushState({ mapSheet: true }, "");
    sheetHistoryPushed = true;
  }
}

function openSheet(place) {
  const thumb = place.image
    ? `<div class="map-sheet__thumb-wrap">
        <img class="map-sheet__img" src="${escapeHtml(safeImageSrc(place.image))}" alt="${escapeHtml(place.name)}" />
        ${favoriteButtonHtml(place.id, "map-sheet__favorite-btn")}
      </div>`
    : "";
  const query = encodeURIComponent(place.address || place.name);
  presentSheet(`
    <div class="map-sheet__card">
      ${thumb}
      <div class="map-sheet__name-row">
        <p class="map-sheet__name">${escapeHtml(place.name)}</p>
        ${place.image ? "" : favoriteButtonHtml(place.id, "map-sheet__favorite-btn map-sheet__favorite-btn--inline")}
      </div>
      <p class="map-sheet__meta">${escapeHtml([place.region, ...(place.categories || [])].filter(Boolean).join(" · "))}</p>
      ${place.address ? `<p class="map-sheet__row">📍 ${escapeHtml(place.address)}</p>` : ""}
      ${place.hours ? `<p class="map-sheet__row">⏰ ${escapeHtml(place.hours)}</p>` : ""}
      ${place.fee ? `<p class="map-sheet__row">💰 ${escapeHtml(place.fee)}</p>` : ""}
      ${place.reason ? `<p class="map-sheet__row">✏️ ${escapeHtml(place.reason)}</p>` : ""}
      <div class="map-sheet__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">네이버지도 길찾기</a>
        <a class="btn-secondary" target="_blank" rel="noopener" href="https://map.kakao.com/link/search/${query}">카카오맵</a>
      </div>
    </div>
  `);
}

// 공공데이터(정부기관 API)라 사용자 입력보다는 신뢰도가 높지만, 앱이 직접
// 관리하는 값이 아닌 외부 데이터라 다른 화면과 동일하게 이스케이프해서 넣는다.
function openNursingSheet(room) {
  const query = encodeURIComponent(room.address || room.name);
  presentSheet(`
    <div class="map-sheet__card">
      <div class="map-sheet__name-row">
        <p class="map-sheet__name">🍼 ${escapeHtml(room.name)}</p>
      </div>
      <p class="map-sheet__meta">${escapeHtml(room.source)} 공공데이터 · ${room.fatherAllowed ? "아빠도 이용 가능" : "이용 대상 확인 필요"}</p>
      ${room.place ? `<p class="map-sheet__row">📍 ${escapeHtml(room.place)}</p>` : ""}
      ${room.address ? `<p class="map-sheet__row">${escapeHtml(room.address)}</p>` : ""}
      ${room.tel ? `<p class="map-sheet__row">☎️ ${escapeHtml(room.tel)}</p>` : ""}
      <div class="map-sheet__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">네이버지도 길찾기</a>
        <a class="btn-secondary" target="_blank" rel="noopener" href="https://map.kakao.com/link/search/${query}">카카오맵</a>
      </div>
    </div>
  `);
}

function closeSheet() {
  document.getElementById("map-sheet").classList.remove("is-open");
  if (sheetHistoryPushed) {
    sheetHistoryPushed = false;
    history.back();
  }
}

window.addEventListener("popstate", () => {
  if (!sheetHistoryPushed) return;
  sheetHistoryPushed = false;
  document.getElementById("map-sheet").classList.remove("is-open");
});

// 시트가 맨 위까지 스크롤된 상태에서 아래로 60px 이상 드래그하면 닫는다.
// passive:true라 기존 세로 스크롤(overflow-y:auto)과는 충돌하지 않는다.
function initSheetDrag() {
  const sheet = document.getElementById("map-sheet");
  let startY = 0;
  let dragging = false;

  sheet.addEventListener(
    "touchstart",
    (e) => {
      startY = e.touches[0].clientY;
      dragging = true;
    },
    { passive: true },
  );

  sheet.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      if (sheet.scrollTop <= 0 && dy > 60) {
        dragging = false;
        closeSheet();
      }
    },
    { passive: true },
  );

  sheet.addEventListener("touchend", () => {
    dragging = false;
  }, { passive: true });
}

function clearMarkers() {
  markers.forEach((m) => m.setMap(null));
  markers = [];
}

// 각지고 딱딱한 깃발-핀 대신, 둥근 물방울(마커) 모양 안에 캐릭터 로고를 담은
// 좀 더 친근한 느낌의 핀으로 변경. border-radius 트릭(세 모서리만 둥글게 +
// 45도 회전)으로 물방울 실루엣을 만들고, 안쪽 내용물은 반대로 회전시켜
// 로고가 똑바로 보이게 한다.
const FLAG_ICON = {
  content: `
    <div style="position:relative;width:36px;height:36px;">
      <div style="position:absolute;inset:0;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
           background:linear-gradient(135deg, var(--color-primary, #5B6B95), var(--color-primary-dark, #3C4972));
           box-shadow:0 3px 8px rgba(58,67,99,0.4);"></div>
      <div style="position:absolute;top:3px;left:3px;width:30px;height:30px;border-radius:50%;
           background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;
           box-shadow:0 1px 3px rgba(58,67,99,0.25);">
        <img src="/assets/logo/character-logo.svg" style="width:22px;height:22px;object-fit:contain;" alt="" />
      </div>
    </div>
  `,
  anchor: new naver.maps.Point(18, 36),
};

function renderMarkers(list) {
  clearMarkers();
  list.forEach((place) => {
    if (typeof place.lat !== "number" || typeof place.lng !== "number") return;
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(place.lat, place.lng),
      map,
      title: place.name,
      icon: FLAG_ICON,
    });
    naver.maps.Event.addListener(marker, "click", () => openSheet(place));
    markers.push(marker);
  });
}

const NURSING_ICON = {
  content: `<div style="width:26px;height:26px;border-radius:50%;background:#2563EB;border:2px solid #fff;box-shadow:0 2px 5px rgba(13,27,62,0.35);display:flex;align-items:center;justify-content:center;font-size:13px;">🍼</div>`,
  anchor: new naver.maps.Point(13, 13),
};

let nursingMarkers = [];
let nursingRooms = [];
let nursingLoaded = false;
let nursingVisible = false;

function clearNursingMarkers() {
  nursingMarkers.forEach((m) => m.setMap(null));
  nursingMarkers = [];
}

function renderNursingMarkers() {
  clearNursingMarkers();
  nursingRooms.forEach((room) => {
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(room.lat, room.lng),
      map,
      title: room.name,
      icon: NURSING_ICON,
      zIndex: 50,
    });
    naver.maps.Event.addListener(marker, "click", () => openNursingSheet(room));
    nursingMarkers.push(marker);
  });
}

// 큐레이션된 장소 목록과 달리 자주 안 바뀌는 공공데이터라, 토글을 처음 켤 때만
// 불러오고 이후에는 다시 요청하지 않는다.
async function loadNursingRooms() {
  if (nursingLoaded) return;
  try {
    const data = await fetchJson("/api/nursing-rooms");
    nursingRooms = data.rooms || [];
    nursingLoaded = true;
  } catch (err) {
    console.error(err);
    showToast("수유실 정보를 불러오지 못했어요.");
  }
}

async function toggleNursingLayer() {
  const btn = document.getElementById("nursing-layer-btn");
  nursingVisible = !nursingVisible;
  btn.classList.toggle("is-active", nursingVisible);

  if (!nursingVisible) {
    clearNursingMarkers();
    return;
  }
  if (!nursingLoaded) await loadNursingRooms();
  renderNursingMarkers();
}

function initNursingLayerButton() {
  document.getElementById("nursing-layer-btn").addEventListener("click", toggleNursingLayer);
}

function renderRegionChips() {
  const wrap = document.getElementById("map-region-chips");
  const regions = ["전체", ...Object.keys(REGION_VIEW)];
  wrap.innerHTML = regions
    .map((r) => `<button class="map-chip${r === "전체" ? " is-active" : ""}" data-region="${r}">${r}</button>`)
    .join("");

  wrap.querySelectorAll("[data-region]").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".map-chip").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const region = btn.dataset.region;
      closeSheet();

      if (region === "전체") {
        map.setCenter(new naver.maps.LatLng(DEFAULT_VIEW.lat, DEFAULT_VIEW.lng));
        map.setZoom(DEFAULT_VIEW.zoom);
        renderMarkers(places);
        return;
      }
      const view = REGION_VIEW[region];
      map.setCenter(new naver.maps.LatLng(view.lat, view.lng));
      map.setZoom(view.zoom);
      renderMarkers(places.filter((p) => p.region === region));
    });
  });
}

async function loadPlaces() {
  const data = await fetchJson("/api/places");
  places = (data.places || []).filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  renderMarkers(places);
  renderNearbyList();
}

let myLocationMarker = null;

function showMyLocation(latitude, longitude, { recenter = true, zoom = 13 } = {}) {
  if (recenter) {
    map.setCenter(new naver.maps.LatLng(latitude, longitude));
    map.setZoom(zoom);
  }
  if (myLocationMarker) myLocationMarker.setMap(null);
  myLocationMarker = new naver.maps.Marker({
    position: new naver.maps.LatLng(latitude, longitude),
    map,
    icon: {
      content:
        '<div class="map-my-location"><div class="map-my-location__halo"></div><div class="map-my-location__dot"></div></div>',
      anchor: new naver.maps.Point(20, 20),
    },
  });
  myLocation = { lat: latitude, lng: longitude };
  renderNearbyList();
}

let toastTimer = null;

function showToast(message) {
  const toast = document.getElementById("map-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
}

// getCurrentPosition 실패 시(권한 거부/타임아웃 등) 예전에는 아무 반응이 없어서
// "내 위치" 관련 기능이 통째로 사라진 것처럼 보였다 — 이유를 토스트로 알려준다.
function geolocationErrorMessage(err) {
  if (err.code === err.PERMISSION_DENIED) return "위치 권한이 꺼져있어요. 브라우저 설정에서 허용해주세요.";
  if (err.code === err.POSITION_UNAVAILABLE) return "현재 위치를 확인할 수 없어요.";
  if (err.code === err.TIMEOUT) return "위치 확인이 너무 오래 걸려요. 다시 시도해주세요.";
  return "위치를 가져오지 못했어요.";
}

function locateMe(options) {
  if (!navigator.geolocation) {
    showToast("이 브라우저는 위치 확인을 지원하지 않아요.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => showMyLocation(pos.coords.latitude, pos.coords.longitude, options),
    (err) => showToast(geolocationErrorMessage(err)),
  );
}

let trackingWatchId = null;

// track-btn 하나로 "현재 위치로 이동"과 "실시간 추적"을 겸한다 — 켜면 즉시
// 한 번 이동하고, 이후 이동할 때마다 계속 내 위치 마커+지도 중심을 갱신한다
// (네이버지도의 실시간 추적 모드 참고).
function stopTracking() {
  if (trackingWatchId === null) return;
  navigator.geolocation.clearWatch(trackingWatchId);
  trackingWatchId = null;
  document.getElementById("track-btn").classList.remove("is-active");
}

function startTracking() {
  if (!navigator.geolocation) {
    showToast("이 브라우저는 위치 확인을 지원하지 않아요.");
    return;
  }
  trackingWatchId = navigator.geolocation.watchPosition(
    (pos) => showMyLocation(pos.coords.latitude, pos.coords.longitude, { recenter: true, zoom: map.getZoom() }),
    (err) => {
      showToast(geolocationErrorMessage(err));
      stopTracking();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
  );
  document.getElementById("track-btn").classList.add("is-active");
  showToast("실시간 위치 추적을 켰어요.");
}

function initTrackButton() {
  document.getElementById("track-btn").addEventListener("click", () => {
    if (trackingWatchId === null) startTracking();
    else stopTracking();
  });
}

function init() {
  map = new naver.maps.Map("map", {
    center: new naver.maps.LatLng(DEFAULT_VIEW.lat, DEFAULT_VIEW.lng),
    zoom: DEFAULT_VIEW.zoom,
    logoControlOptions: { position: naver.maps.Position.TOP_LEFT },
  });
  naver.maps.Event.addListener(map, "click", closeSheet);

  renderRegionChips();
  initTrackButton();
  initNursingLayerButton();
  initSheetDrag();
  loadPlaces();
  locateMe();
}

if (window.naver && window.naver.maps) {
  init();
} else {
  window.addEventListener("load", () => {
    if (window.naver && window.naver.maps) init();
    else {
      document.getElementById("map").innerHTML =
        '<p style="padding:16px;color:#8b96b8;font-size:13px;">네이버 지도를 불러오지 못했습니다.</p>';
    }
  });
}
