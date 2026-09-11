const FAVORITES_KEY = "yukjindae_favorites";

function getFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isFavorite(id) {
  return getFavorites().includes(id);
}

// 브라우저 저장소가 정본이다. 로그인했으면 서버에도 같은 목록을 밀어 넣지만,
// 그 호출이 실패해도 화면은 이미 바뀐 뒤다 — 찜은 실패했다고 되돌릴 만한 일이 아니고,
// 다음 로그인 때 합치기가 다시 맞춰 준다.
function setFavorites(list, { push = true } = {}) {
  const favorites = Array.isArray(list) ? list : [];
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  window.dispatchEvent(new CustomEvent("favoritesChanged", { detail: { favorites } }));
  if (push) window.yukAuth?.pushFavorites?.(favorites);
  return favorites;
}

// 새로 찜한 항목을 배열 맨 앞에 둬서 저장 순서 자체가 "최근 찜한 순"이 되게 한다.
function toggleFavorite(id) {
  const favorites = getFavorites();
  const index = favorites.indexOf(id);
  if (index === -1) {
    favorites.unshift(id);
  } else {
    favorites.splice(index, 1);
  }
  return setFavorites(favorites);
}

function onFavoritesChange(callback) {
  window.addEventListener("favoritesChanged", (event) => callback(event.detail.favorites));
}

function favoriteButtonHtml(id, className) {
  const active = isFavorite(id);
  return `<button type="button" class="${className}${active ? " is-active" : ""}" data-favorite-id="${id}" aria-label="찜하기" aria-pressed="${active}">${active ? "❤️" : "🤍"}</button>`;
}

// 카드/시트/상세페이지에 렌더링된 하트 버튼들에 클릭 핸들러를 일괄로 붙인다.
// 카드 전체가 링크(<a>)인 경우가 많아 preventDefault+stopPropagation으로 그 클릭을 막는다.
function bindFavoriteButtons(root) {
  root.querySelectorAll("[data-favorite-id]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.dataset.favoriteId;
      toggleFavorite(id);
      const active = isFavorite(id);
      btn.classList.toggle("is-active", active);
      btn.textContent = active ? "❤️" : "🤍";
      btn.setAttribute("aria-pressed", String(active));
    });
  });
}

// 이 파일은 app.js/map.js/place.js/favorite-page.js가 <script> 태그로 공유해서 쓰는
// 전역 유틸이라, 이 파일 안에서는 안 불리는 함수도 window에 명시적으로 붙여둔다.
window.getFavorites = getFavorites;
window.setFavorites = setFavorites;
window.isFavorite = isFavorite;
window.toggleFavorite = toggleFavorite;
window.onFavoritesChange = onFavoritesChange;
window.favoriteButtonHtml = favoriteButtonHtml;
window.bindFavoriteButtons = bindFavoriteButtons;
