// 서울강북/서울강남은 노션 "지역" select에 새로 추가한 값이라, 기존에 "서울"로
// 등록된 장소는 강북/강남 중 하나로 재태깅하기 전까지 두 탭 모두에 노출되지 않는다.
const REGION_GROUPS = {
  "서울강북": ["서울강북"],
  "서울강남": ["서울강남"],
  "경기북부": ["경기북부"],
  "인천·부천": ["인천"],
  "경기남부": ["경기남부"],
  "강원도": ["강원도"],
  "충청도": ["충청도"],
  "전라도": ["전라도"],
  "경상도": ["경상도"],
  "제주": ["제주"],
};

const REGIONS = Object.keys(REGION_GROUPS);
const CATEGORIES = ["무료", "영유아 무료입장", "자연·공원", "실내놀이", "맛집", "카페", "체험·문화", "스포츠"];
// "영유아 무료입장"은 노션 카테고리 태그가 아니라 freeAgePolicy(무료입장연령) 값이
// 채워진 장소를 가리키는 가상 카테고리 — 입장료가 있는 곳이라도 어린 아이는
// 무료로 들어갈 수 있는 곳을 따로 찾을 수 있게 한다.
const VIRTUAL_CATEGORY_FREE_AGE = "영유아 무료입장";

// 지역별 지도상 중심 좌표(REGION_MAP_PATHS와 같은 0 0 100 130 좌표계) — 번호 핀을
// 찍는 위치. 서울강북/서울강남은 실제 중심점이 거의 붙어있어(약 1.6 단위 차이) 핀이
// 겹치므로, 핀 표시 위치만 남/북으로 좀 더 벌려서 손으로 조정했다(면 색칠 자체는
// 실제 경계를 그대로 씀 — 핀 위치만 보정).
function regionColor(region, alpha = 1, lightness = 60) {
  const i = REGIONS.indexOf(region);
  const hue = (i * 36) % 360;
  return `hsl(${hue} 55% ${lightness}% / ${alpha})`;
}

// 지도 채우기 전용 파스텔 톤. 범례/선택 강조에 쓰는 regionColor보다 채도는
// 낮추고 명도는 높여 "페이퍼컷" 느낌을 낸다.
function regionMapColor(region) {
  const i = REGIONS.indexOf(region);
  const hue = (i * 36) % 360;
  return `hsl(${hue} 48% 80%)`;
}

// 지역 지도는 시군구 단위 폴리곤을 이어붙인 데이터라, 폴리곤 경계마다 흰
// 잔선이 잔뜩 생겨 지저분해 보였다. 지도 배경색(흰색)으로 한 번, 그 위에
// 파스텔 색으로 한 번 더 겹쳐 그려서 내부 잔선은 지우고, 겹쳐 그린 색이
// 못 덮는 지역 사이 여백만 종이를 오려 붙인 듯 은은하게 남긴다.
const REGION_MAP_BG = "#FFFFFF";

function regionHaloPath(region) {
  return `<path d="${REGION_MAP_PATHS[region]}" fill="${REGION_MAP_BG}" stroke="${REGION_MAP_BG}" stroke-width="2" stroke-linejoin="round"/>`;
}

function regionBodyPath(region, active) {
  const color = regionMapColor(region);
  return `<path class="region-map__path${active ? " is-active" : ""}" data-region="${region}" d="${REGION_MAP_PATHS[region]}" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"><title>${region}</title></path>`;
}

const state = {
  places: [],
  banners: [],
  region: null,
  weather: null,
  category: null,
  query: "",
};

const NOTICES_SEEN_KEY = "yukjindae_notices_seen_at";

// 지역 필터가 아니라 별도 페이지로 이동하는 큐레이션 카드. 지도 아래 가로형 카드
// 2개로 고정 배치한다(REGION_GROUPS/필터링 로직과는 무관).
const CURATED_LINKS = [
  {
    label: "축제·행사 TOP10",
    href: "festival.html",
    icon: `<svg width="22" height="22" viewBox="0 0 28 28">
      <path d="M6 24l3-11 9 4z" fill="#2563EB"/>
      <path d="M9 13l11-7-1 6z" fill="#4A90D9"/>
      <circle cx="8" cy="6" r="1.4" fill="#F7B84B"/>
      <circle cx="14" cy="4" r="1.1" fill="#F7B84B"/>
      <circle cx="20" cy="8" r="1.1" fill="#F7B84B"/>
    </svg>`,
  },
  {
    label: "테마 코스 모음",
    href: "courses.html",
    icon: `<svg width="22" height="22" viewBox="0 0 28 28">
      <path d="M6 22c4-8 4-12 0-16" stroke="#2563EB" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="1 4"/>
      <circle cx="6" cy="22" r="2.2" fill="#1A2F6B"/>
      <circle cx="6" cy="6" r="2.2" fill="#F7B84B"/>
      <circle cx="15" cy="13" r="2" fill="#4A90D9"/>
    </svg>`,
  },
];

function regionCount(region) {
  return state.places.filter((p) => REGION_GROUPS[region].includes(p.region)).length;
}

function selectRegion(region) {
  const isSelecting = state.region !== region;
  state.region = isSelecting ? region : null;
  renderRegionMap();
  renderRegionLegend();
  renderPlaces();
  if (isSelecting) {
    document.getElementById("place-list").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderRegionMap() {
  const mapEl = document.getElementById("region-map");
  mapEl.classList.toggle("has-selection", Boolean(state.region));
  const halos = REGIONS.map(regionHaloPath).join("");
  const bodies = REGIONS.map((region) => regionBodyPath(region, state.region === region)).join("");
  // 실제 컨텐츠(지역 폴리곤)가 원래 좌표계(0 0 100 130)의 왼쪽 절반/아래쪽에
  // 치우쳐 있어서 여백이 컸다 — 실제 쓰이는 영역(-3 15 93 104)으로 뷰박스를
  // 잘라서 지도가 카드를 꽉 채우도록 확대했다. halo를 모두 그린 뒤 body를
  // 전부 그려야, 옆 지역 halo에 이쪽 body가 가려지지 않는다.
  mapEl.innerHTML = `<svg class="region-map__svg" viewBox="-3 15 93 104"><g>${halos}</g><g>${bodies}</g></svg>`;

  mapEl.querySelectorAll("[data-region]").forEach((el) => {
    el.addEventListener("click", () => selectRegion(el.dataset.region));
  });

  const caption = document.getElementById("region-map-caption");
  caption.textContent = state.region
    ? `${state.region} · ${regionCount(state.region)}곳`
    : "지도 또는 아래 목록에서 지역을 선택해보세요";
}

function renderRegionLegend() {
  const legend = document.getElementById("region-legend");
  legend.innerHTML = REGIONS.map((region) => {
    const active = state.region === region;
    const style = active
      ? ` style="border-color:${regionColor(region)};background:${regionColor(region, 0.16)};color:${regionColor(region)}"`
      : "";
    return `<button class="region-legend__item${active ? " is-active" : ""}" data-region="${region}"${style}>
      <span class="region-legend__name">${region}</span>
      <span class="region-legend__count">${regionCount(region)}</span>
    </button>`;
  }).join("");

  legend.querySelectorAll("[data-region]").forEach((el) => {
    el.addEventListener("click", () => selectRegion(el.dataset.region));
  });
}

function renderCuratedLinks() {
  const wrap = document.getElementById("curated-links");
  wrap.innerHTML = CURATED_LINKS.map(
    (link) => `<a class="curated-links__item" href="${link.href}">
      <span class="curated-links__icon">${link.icon}</span>
      <span class="curated-links__label">${link.label}</span>
    </a>`
  ).join("");
}

function renderCategoryFilter() {
  const filter = document.getElementById("tag-filter");
  filter.innerHTML = CATEGORIES.map((category) => {
    const active = state.category === category ? " is-active" : "";
    return `<button class="tag-filter__item${active}" data-category="${category}">${category}</button>`;
  }).join("");

  filter.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const category = btn.dataset.category;
      state.category = state.category === category ? null : category;
      renderCategoryFilter();
      renderPlaces();
    });
  });
}

function matchesFilters(place) {
  if (state.region && !REGION_GROUPS[state.region].includes(place.region)) return false;
  if (state.category === VIRTUAL_CATEGORY_FREE_AGE && !place.freeAgePolicy) return false;
  if (
    state.category &&
    state.category !== VIRTUAL_CATEGORY_FREE_AGE &&
    !place.categories.includes(state.category)
  )
    return false;
  if (state.query) {
    const needle = state.query.toLowerCase();
    const haystack = `${place.name} ${place.address} ${place.region}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

// 완전 무료(카테고리 "무료")가 영유아만 무료보다 우선 표시된다 — 둘 다 해당하면
// 더 넓은 혜택(완전 무료)을 먼저 알려주는 게 유용하기 때문.
function freeBadgeText(place) {
  if (place.categories && place.categories.includes("무료")) return "무료입장";
  if (place.freeAgePolicy) return "영유아 무료";
  return "";
}

// 순위는 "지역별" Top 10이라 지역을 고르지 않은 목록에서는 1위가 여러 개 보인다
// (제주 1위·경상도 1위·서울강남 1위…). 지역을 선택했을 때만 순위를 노출한다.
function placeCard(place, showRank = false) {
  const thumb = place.image
    ? `<img class="place-grid__thumb" src="${escapeHtml(safeImageSrc(place.image))}" alt="${escapeHtml(place.name)}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  const freeBadge = freeBadgeText(place);
  const badge = freeBadge ? `<span class="place-grid__free-badge">${escapeHtml(freeBadge)}</span>` : "";
  const rank = showRank ? monthlyRank(place) : null;
  const rankBadge = rank ? `<span class="place-grid__rank">${rank}</span>` : "";
  const rankReason = rank && place.rankReason
    ? `<div class="place-grid__rank-reason">${escapeHtml(place.rankReason)}</div>`
    : "";
  const event = activeEvent(place);
  const eventBadge = event ? `<span class="place-grid__event-badge">🎟 할인</span>` : "";
  return `
    <a class="place-grid__card" href="place.html?id=${encodeURIComponent(place.id)}">
      <div class="place-grid__thumb-wrap">
        ${thumb}
        ${rankBadge}
        ${badge}
        ${eventBadge}
        ${favoriteButtonHtml(place.id, "place-grid__favorite-btn")}
      </div>
      <div class="place-grid__body">
        <div class="place-grid__name">${escapeHtml(place.name)}</div>
        <div class="place-grid__region">${escapeHtml(place.region)}</div>
        ${rankReason}
      </div>
    </a>
  `;
}

function renderPlaces() {
  const list = document.getElementById("place-list");

  if (!state.places.length) {
    list.innerHTML = `<p class="place-list__loading">불러오는 중...</p>`;
    return;
  }

  // 지역을 고르면 그 지역 월간 Top 10이 주인공이고, 고르기 전 홈에서는 오늘
  // 날씨에 맞는 곳을 앞으로 당긴다. 둘을 겹치면 어느 기준으로 정렬됐는지
  // 알 수 없어져서 한 화면에는 하나만 적용한다.
  const showRank = Boolean(state.region);
  const matched = state.places.filter(matchesFilters);
  const filtered = showRank ? sortByMonthlyRank(matched) : sortByWeather(matched, state.weather);
  list.innerHTML = filtered.length
    ? filtered.map((place) => placeCard(place, showRank)).join("")
    : `<p class="place-list__empty">조건에 맞는 장소가 없어요.</p>`;
  bindFavoriteButtons(list);
}

function initHeroSlider() {
  const track = document.getElementById("hero-track");
  const dotsWrap = document.getElementById("hero-dots");
  if (!track || !dotsWrap) return;

  const count = track.children.length;
  let index = 0;

  dotsWrap.innerHTML = Array.from(
    { length: count },
    (_, i) => `<span class="banner__dot${i === 0 ? " is-active" : ""}"></span>`
  ).join("");
  const dots = dotsWrap.children;

  function go(next) {
    index = (next + count) % count;
    track.style.transform = `translateX(-${index * 100}%)`;
    Array.from(dots).forEach((dot, i) => dot.classList.toggle("is-active", i === index));
  }

  let timer;
  function startAutoplay() {
    clearInterval(timer);
    timer = setInterval(() => go(index + 1), 3000);
  }
  startAutoplay();

  let startX = 0;
  let dragging = false;

  track.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
      dragging = true;
    },
    { passive: true }
  );

  track.addEventListener(
    "touchend",
    (e) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 40) return;
      go(dx < 0 ? index + 1 : index - 1);
      startAutoplay();
    },
    { passive: true }
  );
}

function bannerSlide(banner) {
  const caption =
    banner.title || banner.tagline
      ? `<div class="banner__caption">
          ${banner.title ? `<p class="banner__caption-title">${escapeHtml(banner.title)}</p>` : ""}
          ${banner.tagline ? `<p class="banner__caption-tagline">${escapeHtml(banner.tagline)}</p>` : ""}
        </div>`
      : "";
  const img = `<img class="banner__photo" src="${escapeHtml(safeImageSrc(banner.image))}" alt="${escapeHtml(banner.title || "배너")}" />`;
  const inner = `${img}${caption}`;

  // 배너 링크는 노션에서 수동 입력되는 값이라 safeHref로 스킴을 한 번 거른다.
  const href = safeHref(banner.link);
  return href
    ? `<a class="banner__slide banner__slide--photo" href="${escapeHtml(href)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="banner__slide banner__slide--photo">${inner}</div>`;
}

async function loadBanners() {
  try {
    const data = await fetchJson("/api/banners");
    const banners = data.banners || [];
    state.banners = banners;
    if (banners.length) {
      document.getElementById("hero-track").innerHTML = banners.map(bannerSlide).join("");
    }
  } catch (err) {
    console.error(err);
  }
  // 노션 배너 유무가 판가름 난 뒤에야 배너 영역을 드러내서, 기본 배너가 잠깐
  // 보였다가 노션 배너로 바뀌는 깜빡임 없이 처음부터 최종 내용만 보이게 한다.
  document.getElementById("hero-banner").classList.remove("is-loading");
  initHeroSlider();
}

// 배너(이벤트 소식)와 최근 등록된 장소(신규 장소 소식)를 합쳐서 최신순으로 정리.
// 로그인/푸시 인프라 없이 Notion의 생성일(createdAt)만으로 가볍게 구현.
function buildNotices() {
  const eventNotices = state.banners.map((banner) => ({
    type: "event",
    title: banner.title || "새 소식이 있어요",
    subtitle: banner.tagline,
    link: banner.link,
    createdAt: banner.createdAt,
  }));

  const newPlaceNotices = state.places
    .toSorted((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3)
    .map((place) => ({
      type: "new-place",
      title: `새 장소 추가: ${place.name}`,
      subtitle: place.region,
      link: `place.html?id=${encodeURIComponent(place.id)}`,
      createdAt: place.createdAt,
    }));

  return [...eventNotices, ...newPlaceNotices]
    .toSorted((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
}

function hasUnreadNotices() {
  const notices = buildNotices();
  if (!notices.length) return false;
  const seenAt = localStorage.getItem(NOTICES_SEEN_KEY);
  if (!seenAt) return true;
  return new Date(notices[0].createdAt) > new Date(seenAt);
}

function renderBellBadge() {
  const bell = document.querySelector(".header__bell");
  if (!bell) return;
  bell.classList.toggle("has-unread", hasUnreadNotices());
}

function noticeItemHtml(notice) {
  const inner = `
    <p class="notices-panel__item-title">${escapeHtml(notice.title)}</p>
    ${notice.subtitle ? `<p class="notices-panel__item-sub">${escapeHtml(notice.subtitle)}</p>` : ""}
  `;
  // 이벤트 소식의 링크는 노션 배너에서 온 외부 URL이라 스킴 검사가 필요하고,
  // 신규 장소 소식은 우리가 만든 내부 상대경로(place.html?id=...)라 그대로 쓴다.
  const href = notice.type === "event" ? safeHref(notice.link) : notice.link;
  if (!href) return `<div class="notices-panel__item">${inner}</div>`;
  const externalAttrs = notice.type === "event" ? ` target="_blank" rel="noopener"` : "";
  return `<a class="notices-panel__item" href="${escapeHtml(href)}"${externalAttrs}>${inner}</a>`;
}

function renderNoticesPanel() {
  const panel = document.getElementById("notices-panel");
  if (!panel) return;
  const notices = buildNotices();
  const itemsHtml = notices.length
    ? notices.map(noticeItemHtml).join("")
    : `<p class="notices-panel__empty">아직 새 소식이 없어요</p>`;

  panel.innerHTML = `
    <p class="notices-panel__header">새 소식</p>
    ${itemsHtml}
    <a class="notices-panel__footer" href="about.html">육진대 채널 더보기 →</a>
  `;
}

function initNoticesBell() {
  const bell = document.querySelector(".header__bell");
  const panel = document.getElementById("notices-panel");
  if (!bell || !panel) return;

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", opening);
    if (opening) {
      renderNoticesPanel();
      localStorage.setItem(NOTICES_SEEN_KEY, new Date().toISOString());
      renderBellBadge();
    }
  });

  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("is-open")) return;
    if (panel.contains(e.target) || bell.contains(e.target)) return;
    panel.classList.remove("is-open");
  });
}

async function loadPlaces() {
  try {
    const data = await fetchJson("/api/places");
    state.places = data.places || [];
  } catch (err) {
    console.error(err);
    document.getElementById("place-list").innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
    return;
  }
  renderRegionMap();
  renderRegionLegend();
  renderPlaces();
}

// 월간 Top 10은 한 달 내내 같은 목록이라 "오늘 뭐하지"에 답하지 못한다. 오늘 날씨로
// 실내·야외를 바꿔 보여줘서 매일 다른 화면이 되게 한다.
//
// 위치 권한은 물어보지 않는다 — 홈에 들어오자마자 권한 팝업이 뜨면 거슬리고, 이미
// 주변 탭에서 한 번 묻는다. 권한이 이미 허용된 경우에만 현재 위치를 쓰고, 아니면
// 서울을 기준으로 한다.
const DEFAULT_WEATHER_COORDS = { lat: 37.5665, lng: 126.978 };

// 이미 허용된 경우에만 조용히 현재 위치를 쓴다. 권한을 물어야 하는 상태면
// 여기서 팝업을 띄우지 않고 서울 기준으로 보여준 뒤, 배너의 버튼을 눌렀을 때만
// 요청한다 — 페이지를 열자마자 권한 팝업이 뜨면 거부율이 크게 올라간다.
function geolocationState() {
  if (!navigator.permissions || !navigator.geolocation) return Promise.resolve("unsupported");
  return navigator.permissions
    .query({ name: "geolocation" })
    .then((s) => s.state)
    .catch(() => "unsupported");
}

function readPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { timeout: 8000, maximumAge: 600000 }
    );
  });
}

async function currentCoords({ ask = false } = {}) {
  const permission = await geolocationState();
  if (permission === "unsupported" || permission === "denied") return DEFAULT_WEATHER_COORDS;
  if (permission === "prompt" && !ask) return DEFAULT_WEATHER_COORDS;
  try {
    return await readPosition();
  } catch {
    return DEFAULT_WEATHER_COORDS;
  }
}

async function loadTodayWeather({ ask = false } = {}) {
  const box = document.getElementById("today-weather");
  if (!box) return;

  try {
    const coords = await currentCoords({ ask });
    const usingDefault = coords === DEFAULT_WEATHER_COORDS;
    const data = await fetchJson(`/api/today?lat=${coords.lat}&lng=${coords.lng}`);
    if (!data.weather || !data.recommendation) return;

    state.weather = data.recommendation;
    const temp = typeof data.weather.maxTemp === "number" ? `${Math.round(data.weather.maxTemp)}°` : "";

    // 서울 기준으로 보여주는 중이고 아직 물어볼 여지가 있으면, 내 위치로 바꿀
    // 버튼을 같이 띄운다. 지방 사용자에게 서울 날씨만 보여주면 안 맞는다.
    const canAsk = usingDefault && (await geolocationState()) === "prompt";

    box.innerHTML = `
      <span class="today-weather__icon">${weatherIcon(data.recommendation.tone, data.weather.kind)}</span>
      <span class="today-weather__text">${escapeHtml(data.recommendation.headline)}</span>
      ${temp ? `<span class="today-weather__temp">${escapeHtml(temp)}</span>` : ""}
      ${canAsk ? `<button type="button" class="today-weather__locate" id="weather-locate">📍 내 위치</button>` : ""}
    `;
    box.hidden = false;

    const locate = document.getElementById("weather-locate");
    if (locate) {
      locate.addEventListener("click", () => {
        locate.disabled = true;
        locate.textContent = "확인 중...";
        loadTodayWeather({ ask: true });
      });
    }
    renderPlaces();
  } catch (err) {
    console.error(err);
  }
}

const WEATHER_ICONS = {
  rain: "🌧",
  storm: "⛈",
  snow: "❄️",
  hot: "🥵",
  cold: "🧣",
  fog: "🌫",
  clear: "☀️",
};

// tone은 "무엇을 추천할지"라 맑음과 흐림이 같은 clear로 묶인다. 아이콘까지 같으면
// 흐린 날에 해가 뜨므로, 하늘 상태(kind)로 한 번 더 갈라준다.
function weatherIcon(tone, kind) {
  if (tone === "clear" && kind === "cloudy") return "⛅";
  return WEATHER_ICONS[tone] || "🌤";
}

// 검색어를 입력하면 배너·지역 지도 섹션을 접어서, 스크롤 없이 검색 결과가 바로
// 보이도록 한다. 검색어를 지우면 원래대로 되돌아온다.
function updateSearchModeUI() {
  const searching = Boolean(state.query);
  document.getElementById("hero-banner").hidden = searching;
  document.getElementById("region-section").hidden = searching;
}

document.addEventListener("DOMContentLoaded", () => {
  renderRegionMap();
  renderRegionLegend();
  renderCuratedLinks();
  renderCategoryFilter();
  initNoticesBell();

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    updateSearchModeUI();
    renderPlaces();
  });

  Promise.all([loadBanners(), loadPlaces()]).then(renderBellBadge);
  // 장소 로딩과 독립적으로 돈다 — 날씨가 늦거나 실패해도 목록은 그대로 뜬다.
  loadTodayWeather();
});
