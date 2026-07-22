const REGION_VIEW = {
  "서울": { lat: 37.5665, lng: 126.9780, zoom: 11 },
  "서울근교": { lat: 37.45, lng: 127.35, zoom: 9 },
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

function openSheet(place) {
  const sheet = document.getElementById("map-sheet");
  const content = document.getElementById("map-sheet-content");
  const img = place.image
    ? `<img class="map-sheet__img" src="${place.image}" alt="${place.name}" />`
    : "";
  const query = encodeURIComponent(place.address || place.name);
  content.innerHTML = `
    <div class="map-sheet__card">
      ${img}
      <p class="map-sheet__name">${place.name}</p>
      <p class="map-sheet__meta">${[place.region, ...(place.categories || [])].filter(Boolean).join(" · ")}</p>
      ${place.address ? `<p class="map-sheet__row">📍 ${place.address}</p>` : ""}
      ${place.hours ? `<p class="map-sheet__row">⏰ ${place.hours}</p>` : ""}
      ${place.fee ? `<p class="map-sheet__row">💰 ${place.fee}</p>` : ""}
      ${place.reason ? `<p class="map-sheet__row">✏️ ${place.reason}</p>` : ""}
      <div class="map-sheet__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">네이버지도 길찾기</a>
        <a class="btn-secondary" target="_blank" rel="noopener" href="https://map.kakao.com/link/search/${query}">카카오맵</a>
      </div>
    </div>
  `;
  sheet.classList.add("is-open");
}

function closeSheet() {
  document.getElementById("map-sheet").classList.remove("is-open");
}

function clearMarkers() {
  markers.forEach((m) => m.setMap(null));
  markers = [];
}

const FLAG_ICON = {
  content: `
    <div style="position:relative;width:34px;height:44px;">
      <div style="position:absolute;left:2px;top:8px;width:2px;height:36px;background:#1A2F6B;border-radius:1px;"></div>
      <div style="position:absolute;left:3px;top:0;width:28px;height:22px;background:#fff;border:2px solid #1A2F6B;border-radius:2px 9px 9px 2px;box-shadow:0 2px 5px rgba(13,27,62,0.35);display:flex;align-items:center;justify-content:center;overflow:hidden;">
        <img src="/assets/logo/character-logo.svg" style="width:18px;height:18px;object-fit:contain;" alt="" />
      </div>
    </div>
  `,
  anchor: new naver.maps.Point(3, 44),
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
  const res = await fetch("/api/places");
  const data = await res.json();
  places = (data.places || []).filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  renderMarkers(places);
}

function initLocateButton() {
  document.getElementById("locate-btn").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      map.setCenter(new naver.maps.LatLng(latitude, longitude));
      map.setZoom(13);
      const myMarker = new naver.maps.Marker({
        position: new naver.maps.LatLng(latitude, longitude),
        map,
        icon: {
          content: '<div style="width:14px;height:14px;border-radius:50%;background:#2563EB;border:3px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>',
          anchor: new naver.maps.Point(7, 7),
        },
      });
      void myMarker;
    });
  });
}

function init() {
  map = new naver.maps.Map("map", {
    center: new naver.maps.LatLng(DEFAULT_VIEW.lat, DEFAULT_VIEW.lng),
    zoom: DEFAULT_VIEW.zoom,
  });
  naver.maps.Event.addListener(map, "click", closeSheet);

  renderRegionChips();
  initLocateButton();
  loadPlaces();
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
