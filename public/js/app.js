const REGIONS = ["서울", "서울근교", "경기북부", "경기남부", "인천", "강원도", "충청도", "전라도", "경상도", "제주"];
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
    const q = state.query.toLowerCase();
    const haystack = `${place.name} ${place.address} ${place.region}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function placeCard(place) {
  const thumb = place.image
    ? `<img class="place-card__thumb" src="${place.image}" alt="${place.name}" loading="lazy" />`
    : `<div class="place-card__thumb"></div>`;
  const tags = [place.region, ...place.categories].filter(Boolean).join(" · ");
  return `
    <a class="place-card" href="place.html?id=${encodeURIComponent(place.id)}">
      ${thumb}
      <div class="place-card__body">
        <div class="place-card__name">${place.name}</div>
        <div class="place-card__meta">${tags}</div>
        ${place.reason ? `<div class="place-card__reason">${place.reason}</div>` : ""}
      </div>
    </a>
  `;
}

function renderPlaces() {
  const list = document.getElementById("place-list");
  const countEl = document.getElementById("place-count");
  const filtered = state.places.filter(matchesFilters);

  countEl.textContent = state.places.length ? `(${filtered.length})` : "";

  if (!state.places.length) {
    list.innerHTML = `<p class="place-list__loading">불러오는 중...</p>`;
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<p class="place-list__empty">조건에 맞는 장소가 없어요.</p>`;
    return;
  }
  list.innerHTML = filtered.map(placeCard).join("");
}

function initHeroSlider() {
  const track = document.getElementById("hero-track");
  const dotsWrap = document.getElementById("hero-dots");
  if (!track || !dotsWrap) return;

  const count = track.children.length;
  let index = 0;

  dotsWrap.innerHTML = Array.from(
    { length: count },
    (_, i) => `<span class="hero__dot${i === 0 ? " is-active" : ""}"></span>`
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
    const list = document.getElementById("place-list");
    list.innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
    return;
  }
  renderRegions();
  renderPlaces();
}

document.addEventListener("DOMContentLoaded", () => {
  renderRegions();
  renderCategoryFilter();
  initHeroSlider();

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    renderPlaces();
  });

  loadPlaces();
});
