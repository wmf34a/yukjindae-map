const REGIONS = ["서울", "경기북부", "인천", "강원도", "충청도", "전라도", "경상도", "제주"];
const CATEGORIES = ["자연·공원", "실내놀이", "맛집", "카페", "체험·문화", "스포츠", "무료"];

function renderRegions() {
  const grid = document.getElementById("region-grid");
  grid.innerHTML = REGIONS.map(
    (region) => `<button class="region-grid__item" data-region="${region}">${region}</button>`
  ).join("");
}

function renderCategoryFilter() {
  const filter = document.getElementById("tag-filter");
  filter.innerHTML = CATEGORIES.map(
    (category, i) =>
      `<button class="tag-filter__item${i === 0 ? " is-active" : ""}" data-category="${category}">${category}</button>`
  ).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  renderRegions();
  renderCategoryFilter();
  // TODO: Notion API 연동 후 장소 리스트 fetch
});
