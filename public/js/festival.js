function formatPeriod(festival) {
  if (!festival.periodStart) return "";
  const start = festival.periodStart.slice(0, 10).replace(/-/g, ".");
  if (!festival.periodEnd || festival.periodEnd === festival.periodStart) return start;
  const end = festival.periodEnd.slice(0, 10).replace(/-/g, ".");
  return `${start} ~ ${end}`;
}

function festivalCardHtml(festival) {
  const period = formatPeriod(festival);
  const thumb = festival.image
    ? `<img class="place-grid__thumb" src="${festival.image}" alt="${festival.title}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  const inner = `
    <div class="place-grid__thumb-wrap">${thumb}</div>
    <div class="place-grid__body">
      <p class="place-grid__name">${festival.title}</p>
      <p class="place-grid__region">${[period, festival.placeName].filter(Boolean).join(" · ")}</p>
    </div>
  `;
  return festival.link
    ? `<a class="place-grid__card" href="${festival.link}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="place-grid__card">${inner}</div>`;
}

async function loadFestivals() {
  const list = document.getElementById("festival-list");
  try {
    const res = await fetch("/api/festivals");
    const data = await res.json();
    const festivals = data.festivals || [];

    list.innerHTML = festivals.length
      ? festivals.map(festivalCardHtml).join("")
      : `<p class="place-list__empty">아이와 함께 가기 좋은 축제·행사를 모아서 곧 보여드릴게요.</p>`;
  } catch {
    list.innerHTML = `<p class="place-list__empty">축제·행사 정보를 불러오지 못했어요.</p>`;
  }
}

loadFestivals();
