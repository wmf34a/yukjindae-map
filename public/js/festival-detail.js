function formatPeriod(festival) {
  if (!festival.periodStart) return "";
  const start = festival.periodStart.slice(0, 10).replace(/-/g, ".");
  if (!festival.periodEnd || festival.periodEnd === festival.periodStart) return start;
  const end = festival.periodEnd.slice(0, 10).replace(/-/g, ".");
  return `${start} ~ ${end}`;
}

function row(label, value) {
  if (!value) return "";
  return `
    <div class="place-detail__section">
      <p class="place-detail__label">${escapeHtml(label)}</p>
      <p class="place-detail__value">${escapeHtml(value)}</p>
    </div>
  `;
}

function render(festival) {
  const el = document.getElementById("festival-detail");
  document.title = `${festival.title} | 육진대`;

  const hero = festival.image
    ? `<img class="place-detail__hero" src="${escapeHtml(festival.image)}" alt="${escapeHtml(festival.title)}" />`
    : "";

  const dday = festivalDday(festival);
  const tags = [
    dday ? `<span class="place-detail__tag place-detail__tag--dday">${escapeHtml(dday)}</span>` : "",
    ...[festival.region, formatPeriod(festival)].filter(Boolean).map((t) => `<span class="place-detail__tag">${escapeHtml(t)}</span>`),
  ]
    .filter(Boolean)
    .join("");

  const officialHref = safeHref(festival.link);
  const mapQuery = encodeURIComponent(festival.address || festival.placeName || festival.title);

  el.innerHTML = `
    ${hero}
    <div class="place-detail__body">
      <div class="place-detail__name-row">
        <h1 class="place-detail__name">${escapeHtml(festival.title)}</h1>
      </div>
      <div class="place-detail__tags">${tags}</div>

      ${row("📍 장소", [festival.placeName, festival.address].filter(Boolean).join(" · "))}
      ${row("✏️ 소개", festival.description)}

      <div class="place-detail__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${mapQuery}">네이버지도 길찾기</a>
        ${officialHref ? `<a class="btn-secondary" target="_blank" rel="noopener" href="${escapeHtml(officialHref)}">공식 사이트</a>` : ""}
      </div>
    </div>
  `;
}

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  const el = document.getElementById("festival-detail");
  if (!id) {
    el.innerHTML = `<p class="place-list__empty">축제 정보를 찾을 수 없어요.</p>`;
    return;
  }
  try {
    const data = await fetchJson(`/api/festivals/${encodeURIComponent(id)}`);
    render(data.festival);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="place-list__empty">축제 정보를 불러오지 못했어요.</p>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
