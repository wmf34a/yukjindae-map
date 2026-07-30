const REGIONS = ["서울", "경기북부", "경기남부", "강원도", "충청도", "전라도", "인천", "제주"];
const CATEGORIES = ["자연·공원", "실내놀이", "맛집", "카페", "체험·문화", "스포츠", "무료"];
const REGION_EMOJI = {
  "서울": "🗼",
  "경기북부": "🏙️",
  "경기남부": "🌆",
  "인천": "✈️",
  "강원도": "🏔️",
  "충청도": "🌾",
  "전라도": "🌊",
  "경상도": "🏯",
  "제주": "🌴",
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
      <span class="region-grid__icon">${REGION_EMOJI[region] || "📍"}</span>
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
    index = next;
    track.style.transform = `translateX(-${index * 100}%)`;
    Array.from(dots).forEach((dot, i) => dot.classList.toggle("is-active", i === index));
  }

  setInterval(() => go((index + 1) % count), 3000);
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
