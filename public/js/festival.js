function formatPeriod(festival) {
  if (!festival.periodStart) return "";
  const start = festival.periodStart.slice(0, 10).replace(/-/g, ".");
  if (!festival.periodEnd || festival.periodEnd === festival.periodStart) return start;
  const end = festival.periodEnd.slice(0, 10).replace(/-/g, ".");
  return `${start} ~ ${end}`;
}

function festivalCardHtml(festival) {
  const period = formatPeriod(festival);
  const dday = festivalDday(festival);
  const thumb = festival.image
    ? `<img class="place-grid__thumb" src="${escapeHtml(festival.image)}" alt="${escapeHtml(festival.title)}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  const badge = dday ? `<span class="place-grid__dday">${escapeHtml(dday)}</span>` : "";
  const inner = `
    <div class="place-grid__thumb-wrap">${thumb}${badge}</div>
    <div class="place-grid__body">
      <p class="place-grid__name">${escapeHtml(festival.title)}</p>
      <p class="place-grid__region">${escapeHtml([period, festival.placeName].filter(Boolean).join(" · "))}</p>
    </div>
  `;
  return `<a class="place-grid__card" href="festival-detail.html?id=${encodeURIComponent(festival.id)}">${inner}</a>`;
}

async function loadFestivals() {
  const list = document.getElementById("festival-list");
  try {
    const data = await fetchJson("/api/festivals");
    const festivals = data.festivals || [];

    list.innerHTML = festivals.length
      ? festivals.map(festivalCardHtml).join("")
      : `<p class="place-list__empty">아이와 함께 가기 좋은 축제·행사를 모아서 곧 보여드릴게요.</p>`;
  } catch {
    list.innerHTML = `<p class="place-list__empty">축제·행사 정보를 불러오지 못했어요.</p>`;
  }
}

loadFestivals();
