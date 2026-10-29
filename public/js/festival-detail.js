function formatPeriod(festival) {
  if (!festival.periodStart) return "";
  const start = festival.periodStart.slice(0, 10).replace(/-/g, ".");
  if (!festival.periodEnd || festival.periodEnd === festival.periodStart) return start;
  const end = festival.periodEnd.slice(0, 10).replace(/-/g, ".");
  return `${start} ~ ${end}`;
}

// 장소와 요금을 장소 상세와 같은 칸 모양으로 보여준다. 장소는 길어서 항상 한 줄 전체를 쓴다.
function cellsHtml(festival) {
  const where = [festival.placeName, festival.address].filter(Boolean).join(" · ");
  const items = [["장소", where, true], ["요금", festival.useFee, false]].filter(([, v]) => v);
  if (!items.length) return "";
  const cells = items
    .map(
      ([k, v, wide]) => `<div class="place-detail__cell${wide || v.length > 20 ? " place-detail__cell--wide" : ""}">
        <span class="place-detail__cell-k">${k}</span>
        <span class="place-detail__cell-v">${escapeHtml(v)}</span>
      </div>`
    )
    .join("");
  return `<div class="place-detail__cells">${cells}</div>`;
}

function render(festival) {
  const el = document.getElementById("festival-detail");
  document.title = `${festival.title} | 육진대`;

  // 축제 이미지는 /images/... 루트 상대경로다. 오리진이 다른 앱 껍데기에서도 뜨도록 safeImageSrc를 거친다.
  const hero = festival.image
    ? `<img class="place-detail__hero" src="${escapeHtml(safeImageSrc(festival.image))}" alt="${escapeHtml(festival.title)}" />`
    : "";

  const dday = festivalDday(festival);
  const tags = [
    dday ? `<span class="place-detail__tag place-detail__tag--dday">${escapeHtml(dday)}</span>` : "",
    ...[festival.region, formatPeriod(festival)].filter(Boolean).map((t) => `<span class="place-detail__tag">${escapeHtml(t)}</span>`),
  ]
    .filter(Boolean)
    .join("");

  const officialHref = safeHref(festival.link);

  el.innerHTML = `
    ${hero}
    <div class="place-detail__body">
      <div class="place-detail__name-row">
        <h1 class="place-detail__name">${escapeHtml(festival.title)}</h1>
      </div>
      <div class="place-detail__tags">${tags}</div>

      ${cellsHtml(festival)}
      ${festival.description ? `<p class="place-detail__intro">${escapeHtml(festival.description)}</p>` : ""}

      <div class="place-detail__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="${escapeHtml(naverDirectionsUrl({ name: festival.placeName || festival.title, address: festival.address }))}">네이버지도 길찾기</a>
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
