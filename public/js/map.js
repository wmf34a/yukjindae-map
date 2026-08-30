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

// 직선거리는 실제와 크게 어긋난다 — 대전 국립중앙과학관에서 팔선생까지 직선
// 511m인데 차로는 1,687m다. 근처 맛집 거리를 직선으로 적었다가 지역장이 지도
// 앱과 대조하고 바로 알아챘고, 여기도 같은 문제였다.
//
// 사용자 위치는 매번 달라서 미리 계산해 둘 수가 없다. 그래서 목록에 실제로
// 보여줄 10곳만 길찾기를 부른다. 정렬은 직선거리로 먼저 해도 된다 — 순서가
// 조금 바뀔 수는 있어도 "가까운 열 곳"이라는 묶음 자체는 거의 같다.
// 위치를 조금 움직였다고 같은 구간을 다시 묻지 않는다. 프록시가 IP당 분당 30건이라
// 지도를 몇 번 다시 그리면 금방 막힌다. 좌표는 소수점 세 자리(약 100m)로 뭉갠다 —
// 그만큼 움직여도 "여기서 몇 km"는 사실상 같은 답이다.
const roadCache = new Map();
const cacheKey = (from, to) =>
  `${from.lat.toFixed(3)},${from.lng.toFixed(3)}>${to.lat.toFixed(3)},${to.lng.toFixed(3)}`;

async function roadDistanceKm(from, to) {
  const key = cacheKey(from, to);
  if (roadCache.has(key)) return roadCache.get(key);
  const km = await requestRoadDistanceKm(from, to);
  // 실패도 기억한다. 안 그러면 못 찾는 구간을 다시 그릴 때마다 계속 두드린다.
  roadCache.set(key, km);
  return km;
}

async function requestRoadDistanceKm(from, to) {
  try {
    const data = await fetchJson(
      `/api/directions?start=${encodeURIComponent(`${from.lng},${from.lat}`)}`
      + `&goal=${encodeURIComponent(`${to.lng},${to.lat}`)}`
    );
    return data.found && Number.isFinite(data.distance) ? data.distance / 1000 : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// 길찾기가 실패하거나 아직 안 왔으면 직선거리라고 밝히고 보여준다.
// 숫자를 감추는 것보다, 무슨 숫자인지 말해 주는 편이 낫다.
function distanceLabel(place) {
  if (Number.isFinite(place.roadKm)) return `차로 ${formatDistance(place.roadKm)}`;
  return `직선 ${formatDistance(place.distanceKm)}`;
}

// 위치가 바뀌면 이 함수가 다시 불린다. 앞선 길찾기 응답이 늦게 도착해 새 목록을
// 덮어쓰지 않도록 요청마다 번호를 매긴다.
let nearbyRequestId = 0;

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

  // 직선거리로 먼저 그려 두고, 도로 거리가 오는 대로 그 칸만 바꾼다. 열 번의
  // 길찾기를 기다리느라 목록이 빈 채로 있는 것보다 낫다.
  const requestId = (nearbyRequestId += 1);
  Promise.all(
    nearest.map(async (p) => {
      p.roadKm = await roadDistanceKm(myLocation, { lat: p.lat, lng: p.lng });
    })
  ).then(() => {
    // 그 사이 위치가 바뀌어 다시 그렸으면 지난 응답은 버린다.
    if (requestId !== nearbyRequestId) return;
    nearest.forEach((p) => {
      const cell = wrap.querySelector(`[data-id="${CSS.escape(p.id)}"] .map-nearby__dist`);
      if (cell) cell.textContent = distanceLabel(p);
    });
  });

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
          <span class="map-nearby__dist">${distanceLabel(p)}</span>
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
        <a class="btn-primary" target="_blank" rel="noopener" href="${escapeHtml(naverDirectionsUrl(place))}">네이버지도 길찾기</a>
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
        <a class="btn-primary" target="_blank" rel="noopener" href="${escapeHtml(naverDirectionsUrl(room))}">네이버지도 길찾기</a>
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

// 전국을 한 화면에 놓고 보면 핀이 서로 겹쳐 덩어리로 뭉개져서, 어디에 몇 곳이
// 있는지 전혀 안 보였다(수유실 레이어를 켜면 특히 심함). 네이버 지도 공식
// MarkerClustering으로 묶어서, 축소하면 숫자 원으로 합치고 확대하면 개별 핀으로
// 풀리게 한다. 라이브러리는 CSP상 외부 CDN 스크립트를 막아둬서 js/vendor에
// 직접 넣어 'self'로 로드한다.
//
// 클러스터 아이콘: 개수 구간별로 크기/색을 다르게 준다. 장소(남색)와 수유실
// (파랑)은 성격이 달라 각각 별도 클러스터러로 운영한다 — 섞어서 묶으면
// "이 동네에 5곳"이 장소인지 수유실인지 알 수 없어진다.
function clusterIcon(size, background, ring) {
  return {
    content:
      `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${background};` +
      `border:3px solid ${ring};box-shadow:0 3px 10px rgba(13,27,62,0.35);color:#fff;` +
      `font-size:${size >= 52 ? 15 : 13}px;font-weight:700;line-height:${size - 6}px;` +
      `text-align:center;font-family:inherit;"></div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size / 2),
  };
}

// 클러스터 원 안에 실제 개수를 써넣는다(라이브러리가 내용은 안 채워줌).
function clusterCountRenderer(clusterMarker, count) {
  const el = clusterMarker.getElement().querySelector("div");
  if (el) el.textContent = String(count);
}

function createClusterer(markerList, palette) {
  if (typeof MarkerClustering === "undefined") return null;
  return new MarkerClustering({
    map,
    markers: markerList,
    minClusterSize: 2,
    // 이 줌 이상으로 확대하면 클러스터를 풀고 개별 핀을 보여준다.
    maxZoom: 12,
    gridSize: 110,
    averageCenter: true,
    disableClickZoom: false,
    indexGenerator: [5, 20, 60],
    icons: palette,
    stylingFunction: clusterCountRenderer,
  });
}

const PLACE_CLUSTER_ICONS = [
  clusterIcon(38, "linear-gradient(135deg,#5B6B95,#3C4972)", "#fff"),
  clusterIcon(46, "linear-gradient(135deg,#48588A,#2E3A61)", "#fff"),
  clusterIcon(54, "linear-gradient(135deg,#3A4A7C,#232D4F)", "#fff"),
];
const NURSING_CLUSTER_ICONS = [
  clusterIcon(38, "linear-gradient(135deg,#4D9AFF,#2563EB)", "#fff"),
  clusterIcon(46, "linear-gradient(135deg,#3B86F0,#1D4FD8)", "#fff"),
  clusterIcon(54, "linear-gradient(135deg,#2A73E0,#1740B8)", "#fff"),
];

let placeClusterer = null;
let nursingClusterer = null;

function clearMarkers() {
  if (placeClusterer) {
    placeClusterer.setMap(null);
    placeClusterer = null;
  }
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
    // map은 넘기지 않는다 — 클러스터러가 줌 레벨에 따라 직접 붙였다 뗐다 한다.
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(place.lat, place.lng),
      title: place.name,
      icon: FLAG_ICON,
    });
    naver.maps.Event.addListener(marker, "click", () => openSheet(place));
    markers.push(marker);
  });
  placeClusterer = createClusterer(markers, PLACE_CLUSTER_ICONS);
  // 라이브러리 로딩이 실패해도 지도가 비어버리진 않게, 클러스터 없이 그대로 띄운다.
  if (!placeClusterer) markers.forEach((m) => m.setMap(map));
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
  if (nursingClusterer) {
    nursingClusterer.setMap(null);
    nursingClusterer = null;
  }
  nursingMarkers.forEach((m) => m.setMap(null));
  nursingMarkers = [];
}

function renderNursingMarkers() {
  clearNursingMarkers();
  nursingRooms.forEach((room) => {
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(room.lat, room.lng),
      title: room.name,
      icon: NURSING_ICON,
      zIndex: 50,
    });
    naver.maps.Event.addListener(marker, "click", () => openNursingSheet(room));
    nursingMarkers.push(marker);
  });
  nursingClusterer = createClusterer(nursingMarkers, NURSING_CLUSTER_ICONS);
  if (!nursingClusterer) nursingMarkers.forEach((m) => m.setMap(map));
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
  const data = await fetchJson(window.withReview("/api/places"));
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
