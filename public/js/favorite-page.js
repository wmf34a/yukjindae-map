const favoriteState = {
  places: [],
  region: null,
};

function favoriteCard(place) {
  const thumb = place.image
    ? `<img class="place-grid__thumb" src="${escapeHtml(safeImageSrc(place.image))}" alt="${escapeHtml(place.name)}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  return `
    <a class="place-grid__card" href="place.html?id=${encodeURIComponent(place.id)}">
      <div class="place-grid__thumb-wrap">
        ${thumb}
        ${favoriteButtonHtml(place.id, "place-grid__favorite-btn")}
      </div>
      <div class="place-grid__body">
        <div class="place-grid__name">${escapeHtml(place.name)}</div>
        <div class="place-grid__region">${escapeHtml(place.region)}</div>
      </div>
    </a>
  `;
}

function emptyStateHtml() {
  return `
    <div class="favorite-empty">
      <p class="favorite-empty__text">아직 찜한 장소가 없어요</p>
      <a class="favorite-empty__btn" href="index.html">홈으로 가서 둘러보기</a>
    </div>
  `;
}

// 찜한 장소가 걸쳐있는 지역이 2개 이상일 때만 필터를 보여준다 (1개면 필터 의미 없음)
function renderRegionFilter(favorited) {
  const wrap = document.getElementById("favorite-region-filter");
  const regions = [...new Set(favorited.map((p) => p.region))];

  if (regions.length < 2) {
    wrap.innerHTML = "";
    return;
  }

  const items = ["전체", ...regions];
  wrap.innerHTML = items
    .map((region) => {
      const active = region === "전체" ? !favoriteState.region : favoriteState.region === region;
      return `<button class="tag-filter__item${active ? " is-active" : ""}" data-region="${escapeHtml(region)}">${escapeHtml(region)}</button>`;
    })
    .join("");

  wrap.querySelectorAll("[data-region]").forEach((btn) => {
    btn.addEventListener("click", () => {
      favoriteState.region = btn.dataset.region === "전체" ? null : btn.dataset.region;
      renderFavorites();
    });
  });
}

// 찜 배열은 항상 "최근 찜한 순"으로 저장돼 있으므로(favorites.js의 unshift), 그 순서를 그대로 따른다.
function renderFavorites() {
  const favoriteIds = getFavorites();
  const favorited = favoriteIds
    .map((id) => favoriteState.places.find((p) => p.id === id))
    .filter(Boolean);

  document.getElementById("favorite-count").textContent = `찜한 장소 ${favorited.length}곳`;
  renderRegionFilter(favorited);

  const listEl = document.getElementById("favorite-list");

  if (favorited.length === 0) {
    listEl.innerHTML = emptyStateHtml();
    return;
  }

  const filtered = favoriteState.region
    ? favorited.filter((p) => p.region === favoriteState.region)
    : favorited;

  listEl.innerHTML = filtered.length
    ? filtered.map(favoriteCard).join("")
    : `<p class="place-list__empty">해당 지역에 찜한 장소가 없어요.</p>`;

  bindFavoriteButtons(listEl);
}

async function init() {
  try {
    const data = await fetchJson("/api/places");
    favoriteState.places = data.places || [];
  } catch (err) {
    console.error(err);
    document.getElementById("favorite-list").innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
    return;
  }
  renderFavorites();
  onFavoritesChange(renderFavorites);
}

document.addEventListener("DOMContentLoaded", init);
