// 노션 "지역" 셀렉트와 같은 순서. 칩을 지역 순서대로 세우기 위한 것이고,
// 목록에 없는 지역이 오면 뒤에 그대로 붙인다.
const FESTIVAL_REGIONS = [
  "서울강북", "서울강남", "경기북부", "인천·부천", "경기남부",
  "강원도", "충청도", "전라도", "경상도", "제주",
];

const state = { festivals: [], region: null };

function formatPeriod(festival) {
  if (!festival.periodStart) return "";
  const start = festival.periodStart.slice(0, 10).replace(/-/g, ".");
  if (!festival.periodEnd || festival.periodEnd === festival.periodStart) return start;
  const end = festival.periodEnd.slice(0, 10).replace(/-/g, ".");
  return `${start} ~ ${end}`;
}

// "무료 (일부 체험 유료)" 처럼 긴 문장이 카드에 다 들어가면 제목을 밀어낸다.
// 카드에서는 무료/유료만 가르고 자세한 조건은 상세페이지에서 본다.
function feeLabel(useFee) {
  const fee = String(useFee || "").trim();
  if (!fee) return "";
  return fee.startsWith("무료") ? "무료" : "유료";
}

function isOngoing(festival) {
  return festivalDday(festival) === "진행중";
}

function festivalCardHtml(festival) {
  const period = formatPeriod(festival);
  const dday = festivalDday(festival);
  const fee = feeLabel(festival.useFee);
  // 축제 이미지는 /images/... 루트 상대경로로 온다. safeImageSrc를 거치지 않으면
  // 미니앱에서 번들 자신을 가리켜 전부 깨진다 — 웹에서는 멀쩡해서 안 잡힌다.
  const thumb = festival.image
    ? `<img class="place-grid__thumb" src="${escapeHtml(safeImageSrc(festival.image))}" alt="${escapeHtml(festival.title)}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  const badge = dday ? `<span class="place-grid__dday">${escapeHtml(dday)}</span>` : "";
  const feeBadge = fee ? `<span class="festival-fee festival-fee--${fee === "무료" ? "free" : "paid"}">${fee}</span>` : "";
  const inner = `
    <div class="place-grid__thumb-wrap">${thumb}${badge}${feeBadge}</div>
    <div class="place-grid__body">
      <p class="place-grid__name">${escapeHtml(festival.title)}</p>
      <p class="place-grid__region">${escapeHtml([period, festival.placeName].filter(Boolean).join(" · "))}</p>
    </div>
  `;
  return `<a class="place-grid__card" href="festival-detail.html?id=${encodeURIComponent(festival.id)}">${inner}</a>`;
}

function regionsInUse() {
  const present = new Set(state.festivals.map((f) => f.region).filter(Boolean));
  const known = FESTIVAL_REGIONS.filter((r) => present.has(r));
  const unknown = [...present].filter((r) => !FESTIVAL_REGIONS.includes(r));
  return [...known, ...unknown];
}

function renderChips() {
  const wrap = document.getElementById("festival-regions");
  const regions = regionsInUse();
  // 지역이 하나뿐이면 고를 것이 없다 — 칩 줄을 통째로 숨긴다.
  if (regions.length < 2) {
    wrap.innerHTML = "";
    return;
  }
  const chip = (label, value) =>
    `<button type="button" class="region-chip${state.region === value ? " is-active" : ""}" data-region="${escapeHtml(value || "")}">${escapeHtml(label)}</button>`;
  wrap.innerHTML = [
    chip(`전체 ${state.festivals.length}`, ""),
    ...regions.map((r) => chip(`${r} ${state.festivals.filter((f) => f.region === r).length}`, r)),
  ].join("");
}

function renderList() {
  const list = document.getElementById("festival-list");
  const shown = state.region ? state.festivals.filter((f) => f.region === state.region) : state.festivals;

  if (!shown.length) {
    list.innerHTML = `<p class="place-list__empty">아이와 함께 가기 좋은 축제·행사를 모아서 곧 보여드릴게요.</p>`;
    return;
  }

  // 지금 열리고 있는 축제가 먼저다. 그다음이 곧 시작하는 것 — 같은 목록에 섞어두면
  // "이번 주말에 뭐 하지"를 찾는 사람이 끝난 뒤 시작할 축제부터 보게 된다.
  const ongoing = shown.filter(isOngoing);
  const upcoming = shown.filter((f) => !isOngoing(f));
  const section = (title, items) =>
    items.length
      ? `<h2 class="festival-section__title">${title} ${items.length}</h2><div class="place-grid">${items.map(festivalCardHtml).join("")}</div>`
      : "";

  list.innerHTML = section("진행 중", ongoing) + section("곧 시작", upcoming);
}

function render() {
  renderChips();
  renderList();
}

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".region-chip");
  if (!chip) return;
  const region = chip.dataset.region || null;
  state.region = state.region === region ? null : region;
  render();
});

async function loadFestivals() {
  const list = document.getElementById("festival-list");
  try {
    const data = await fetchJson("/api/festivals");
    state.festivals = data.festivals || [];
    render();
  } catch {
    list.innerHTML = `<p class="place-list__empty">축제·행사 정보를 불러오지 못했어요.</p>`;
  }
}

loadFestivals();
