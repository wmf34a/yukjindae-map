const REGIONS = ["서울", "경기북부", "경기남부", "강원도", "충청도", "전라도", "인천", "제주"];
const CATEGORIES = ["자연·공원", "실내놀이", "맛집", "카페", "체험·문화", "스포츠", "무료"];
const REGION_EMOJI = {
  "서울": "🗼",
  "서울근교": "🌳",
  "경기북부": "🏙️",
  "경기남부": "🌆",
  "인천": "✈️",
  "강원도": "🏔️",
  "충청도": "🌾",
  "전라도": "🌊",
  "경상도": "🏯",
  "제주": "🌴",
};
const PLACE_PAGE_SIZE = 6;

const state = {
  places: [],
  region: null,
  category: null,
  query: "",
  gridOffset: 0,
  gridHasMore: true,
  gridLoading: false,
  gridRequestId: 0,
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
      loadPlaceGrid(true);
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
      loadPlaceGrid(true);
    });
  });
}

function placeCard(place) {
  const thumb = place.image
    ? `<img class="place-grid__thumb" src="${place.image}" alt="${place.name}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  return `
    <a class="place-grid__card" href="place.html?id=${encodeURIComponent(place.id)}">
      ${thumb}
      <div class="place-grid__body">
        <div class="place-grid__name">${place.name}</div>
        <div class="place-grid__region">${place.region}</div>
      </div>
    </a>
  `;
}

function buildGridUrl(offset) {
  const params = new URLSearchParams({ limit: String(PLACE_PAGE_SIZE), offset: String(offset) });
  if (state.region) params.set("region", state.region);
  if (state.category) params.set("category", state.category);
  if (state.query) params.set("q", state.query);
  return `/api/places?${params.toString()}`;
}

async function loadPlaceGrid(reset) {
  const list = document.getElementById("place-list");

  if (reset) {
    state.gridOffset = 0;
    state.gridHasMore = true;
    list.innerHTML = `<p class="place-list__loading">불러오는 중...</p>`;
  } else if (state.gridLoading || !state.gridHasMore) {
    return;
  }

  const requestId = ++state.gridRequestId;
  state.gridLoading = true;

  try {
    const res = await fetch(buildGridUrl(state.gridOffset));
    const data = await res.json();
    if (requestId !== state.gridRequestId) return;
    if (!res.ok) throw new Error(data.error || "places fetch failed");

    const items = data.places || [];
    if (reset) {
      list.innerHTML = items.length
        ? items.map(placeCard).join("")
        : `<p class="place-list__empty">조건에 맞는 장소가 없어요.</p>`;
    } else if (items.length) {
      list.insertAdjacentHTML("beforeend", items.map(placeCard).join(""));
    }

    state.gridOffset += items.length;
    state.gridHasMore = Boolean(data.hasMore);
  } catch (err) {
    if (requestId !== state.gridRequestId) return;
    console.error(err);
    if (reset) {
      list.innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
    }
  } finally {
    if (requestId === state.gridRequestId) state.gridLoading = false;
  }
}

function initInfiniteScroll() {
  const sentinel = document.getElementById("place-sentinel");
  if (!sentinel) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) loadPlaceGrid(false);
    },
    { rootMargin: "200px" }
  );
  observer.observe(sentinel);
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

async function loadPlaces() {
  try {
    const res = await fetch("/api/places");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "places fetch failed");
    state.places = data.places || [];
  } catch (err) {
    console.error(err);
    return;
  }
  renderRegions();
}

document.addEventListener("DOMContentLoaded", () => {
  renderRegions();
  renderCategoryFilter();
  initHeroSlider();
  initInfiniteScroll();

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    loadPlaceGrid(true);
  });

  loadPlaces();
  loadPlaceGrid(true);
});
