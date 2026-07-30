const REGIONS = ["서울", "경기북부", "경기남부", "강원도", "충청도", "전라도", "인천", "제주"];
const CATEGORIES = ["자연·공원", "실내놀이", "맛집", "카페", "체험·문화", "스포츠", "무료"];
const REGION_ICONS = {
  "서울": `<svg width="28" height="28" viewBox="0 0 28 28">
    <rect x="12" y="6" width="4" height="16" rx="1.5" fill="#2563EB"/>
    <circle cx="14" cy="9" r="3.4" fill="#4A90D9"/>
    <rect x="9" y="21" width="10" height="2.4" rx="1.2" fill="#1A2F6B"/>
  </svg>`,
  "경기북부": `<svg width="28" height="28" viewBox="0 0 28 28">
    <rect x="6" y="12" width="16" height="10" rx="1" fill="#2563EB"/>
    <path d="M9 12a5 5 0 0 1 10 0z" fill="#4A90D9"/>
    <rect x="12" y="16" width="4" height="6" rx="1" fill="#1A2F6B"/>
    <rect x="5" y="9" width="2.4" height="3" fill="#1A2F6B"/>
    <rect x="20.6" y="9" width="2.4" height="3" fill="#1A2F6B"/>
  </svg>`,
  "경기남부": `<svg width="28" height="28" viewBox="0 0 28 28">
    <circle cx="14" cy="13" r="8" fill="none" stroke="#2563EB" stroke-width="2"/>
    <circle cx="14" cy="13" r="1.6" fill="#1A2F6B"/>
    <circle cx="14" cy="5" r="1.4" fill="#F7B84B"/>
    <circle cx="21" cy="13" r="1.4" fill="#F7B84B"/>
    <circle cx="14" cy="21" r="1.4" fill="#F7B84B"/>
    <circle cx="7" cy="13" r="1.4" fill="#F7B84B"/>
    <rect x="12.5" y="21" width="3" height="3" rx="0.8" fill="#1A2F6B"/>
  </svg>`,
  "인천": `<svg width="28" height="28" viewBox="0 0 28 28">
    <path d="M3 19l22-7-2.5 3.5-9.5 3.5-4.5 4.5H5l2-3z" fill="#4A90D9"/>
    <circle cx="21" cy="9" r="1.6" fill="#F7B84B"/>
  </svg>`,
  "강원도": `<svg width="28" height="28" viewBox="0 0 28 28">
    <path d="M2 22l7-13 4 6 3-4.5 8 11.5z" fill="#2563EB"/>
    <path d="M17 15l2-3.5 2.5 3.5z" fill="#fff"/>
  </svg>`,
  "충청도": `<svg width="28" height="28" viewBox="0 0 28 28">
    <path d="M14 23V9" stroke="#8B5E34" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M14 9c-3 0-5-2-5-5 3 0 5 2 5 5z" fill="#F7B84B"/>
    <path d="M14 9c3 0 5-2 5-5-3 0-5 2-5 5z" fill="#EFA93A"/>
    <path d="M14 14c-2.6 0-4.4-1.7-4.4-4.3 2.6 0 4.4 1.7 4.4 4.3z" fill="#F7B84B"/>
    <path d="M14 14c2.6 0 4.4-1.7 4.4-4.3-2.6 0-4.4 1.7-4.4 4.3z" fill="#EFA93A"/>
  </svg>`,
  "전라도": `<svg width="28" height="28" viewBox="0 0 28 28">
    <path d="M3 11c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 5-2.5 7.5 0" stroke="#4A90D9" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M3 17c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 5-2.5 7.5 0" stroke="#2563EB" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="21" cy="6" r="2.6" fill="#F7B84B"/>
  </svg>`,
  "경상도": `<svg width="28" height="28" viewBox="0 0 28 28">
    <rect x="6" y="12" width="16" height="10" rx="1" fill="#2563EB"/>
    <path d="M9 12a5 5 0 0 1 10 0z" fill="#4A90D9"/>
    <rect x="12" y="16" width="4" height="6" rx="1" fill="#1A2F6B"/>
  </svg>`,
  "제주": `<svg width="28" height="28" viewBox="0 0 28 28">
    <rect x="13" y="14" width="2.4" height="10" rx="1" fill="#8B5E34"/>
    <path d="M14 14c0-5 2.5-7.5 6-8.5-1 5-2.5 7.5-6 8.5z" fill="#3FAE5C"/>
    <path d="M14 14c0-5-2.5-7.5-6-8.5 1 5 2.5 7.5 6 8.5z" fill="#4FBF6B"/>
    <circle cx="14" cy="15" r="1.6" fill="#F7B84B"/>
  </svg>`,
};

const state = {
  places: [],
  region: null,
  category: null,
  query: "",
};

function renderRegions() {
  const grid = document.getElementById("region-grid");
  grid.innerHTML = REGIONS.map((region) => {
    const count = state.places.filter((p) => p.region === region).length;
    const active = state.region === region ? " is-active" : "";
    return `<button class="region-grid__item${active}" data-region="${region}">
      <span class="region-grid__icon">${REGION_ICONS[region] || REGION_ICONS["서울"]}</span>
      <span class="region-grid__label">${region}</span>
      ${count ? `<small>${count}</small>` : ""}
    </button>`;
  }).join("");

  grid.querySelectorAll("[data-region]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const region = btn.dataset.region;
      state.region = state.region === region ? null : region;
      renderRegions();
      renderPlaces();
    });
  });
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
  if (state.region && place.region !== state.region) return false;
  if (state.category && !place.categories.includes(state.category)) return false;
  if (state.query) {
    const needle = state.query.toLowerCase();
    const haystack = `${place.name} ${place.address} ${place.region}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function placeCard(place) {
  const thumb = place.image
    ? `<img class="place-grid__thumb" src="${place.image}" alt="${place.name}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  return `
    <a class="place-grid__card" href="place.html?id=${encodeURIComponent(place.id)}">
      <div class="place-grid__thumb-wrap">
        ${thumb}
        ${favoriteButtonHtml(place.id, "place-grid__favorite-btn")}
      </div>
      <div class="place-grid__body">
        <div class="place-grid__name">${place.name}</div>
        <div class="place-grid__region">${place.region}</div>
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

  const filtered = state.places.filter(matchesFilters);
  list.innerHTML = filtered.length
    ? filtered.map(placeCard).join("")
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
          ${banner.title ? `<p class="banner__caption-title">${banner.title}</p>` : ""}
          ${banner.tagline ? `<p class="banner__caption-tagline">${banner.tagline}</p>` : ""}
        </div>`
      : "";
  const img = `<img class="banner__photo" src="${banner.image}" alt="${banner.title || "배너"}" />`;
  const inner = `${img}${caption}`;

  return banner.link
    ? `<a class="banner__slide banner__slide--photo" href="${banner.link}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="banner__slide banner__slide--photo">${inner}</div>`;
}

async function loadBanners() {
  try {
    const res = await fetch("/api/banners");
    const data = await res.json();
    const banners = data.banners || [];
    if (banners.length) {
      document.getElementById("hero-track").innerHTML = banners.map(bannerSlide).join("");
    }
  } catch (err) {
    console.error(err);
  }
  initHeroSlider();
}

async function loadPlaces() {
  try {
    const res = await fetch("/api/places");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "places fetch failed");
    state.places = data.places || [];
  } catch (err) {
    console.error(err);
    document.getElementById("place-list").innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
    return;
  }
  renderRegions();
  renderPlaces();
}

document.addEventListener("DOMContentLoaded", () => {
  renderRegions();
  renderCategoryFilter();
  loadBanners();

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    renderPlaces();
  });

  loadPlaces();
});
