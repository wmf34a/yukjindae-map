// 서울강북/서울강남은 노션 "지역" select에 새로 추가한 값이라, 기존에 "서울"로
// 등록된 장소는 강북/강남 중 하나로 재태깅하기 전까지 두 탭 모두에 노출되지 않는다.
const REGION_GROUPS = {
  "서울강북": ["서울강북"],
  "서울강남": ["서울강남"],
  "경기북부": ["경기북부"],
  "인천·부천": ["인천"],
  "경기남부": ["경기남부"],
  "강원도": ["강원도"],
  "충청도": ["충청도"],
  "전라도": ["전라도"],
  "경상도": ["경상도"],
  "제주": ["제주"],
};

const REGIONS = Object.keys(REGION_GROUPS);
const CATEGORIES = ["무료", "영유아 무료입장", "자연·공원", "실내놀이", "맛집", "카페", "체험·문화", "스포츠"];
// "영유아 무료입장"은 노션 카테고리 태그가 아니라 freeAgePolicy(무료입장연령) 값이
// 채워진 장소를 가리키는 가상 카테고리 — 입장료가 있는 곳이라도 어린 아이는
// 무료로 들어갈 수 있는 곳을 따로 찾을 수 있게 한다.
const VIRTUAL_CATEGORY_FREE_AGE = "영유아 무료입장";

// 지역별 지도상 중심 좌표(REGION_MAP_PATHS와 같은 0 0 100 130 좌표계) — 번호 핀을
// 찍는 위치. 서울강북/서울강남은 실제 중심점이 거의 붙어있어(약 1.6 단위 차이) 핀이
// 겹치므로, 핀 표시 위치만 남/북으로 좀 더 벌려서 손으로 조정했다(면 색칠 자체는
// 실제 경계를 그대로 씀 — 핀 위치만 보정).
function regionColor(region, alpha = 1, lightness = 60) {
  const i = REGIONS.indexOf(region);
  const hue = (i * 36) % 360;
  return `hsl(${hue} 55% ${lightness}% / ${alpha})`;
}

// 지도 채우기 전용 파스텔 톤. 범례/선택 강조에 쓰는 regionColor보다 채도는
// 낮추고 명도는 높여 "페이퍼컷" 느낌을 낸다.
function regionMapColor(region) {
  const i = REGIONS.indexOf(region);
  const hue = (i * 36) % 360;
  return `hsl(${hue} 48% 80%)`;
}

// 지역 지도는 시군구 단위 폴리곤을 이어붙인 데이터라, 폴리곤 경계마다 흰
// 잔선이 잔뜩 생겨 지저분해 보였다. 지도 배경색(흰색)으로 한 번, 그 위에
// 파스텔 색으로 한 번 더 겹쳐 그려서 내부 잔선은 지우고, 겹쳐 그린 색이
// 못 덮는 지역 사이 여백만 종이를 오려 붙인 듯 은은하게 남긴다.
const REGION_MAP_BG = "#FFFFFF";

function regionHaloPath(region) {
  return `<path d="${REGION_MAP_PATHS[region]}" fill="${REGION_MAP_BG}" stroke="${REGION_MAP_BG}" stroke-width="2" stroke-linejoin="round"/>`;
}

function regionBodyPath(region, active) {
  const color = regionMapColor(region);
  return `<path class="region-map__path${active ? " is-active" : ""}" data-region="${region}" d="${REGION_MAP_PATHS[region]}" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"><title>${region}</title></path>`;
}

const state = {
  places: [],
  banners: [],
  region: null,
  weather: null,
  // 위치를 알려준 경우에만 채운다. 서울 기본 좌표는 넣지 않는다 — 지방 사용자에게
  // 서울에서 가까운 순으로 보여주면 안 하느니만 못하다.
  coords: null,
  category: null,
  query: "",
  showAll: false,
};

const NOTICES_SEEN_KEY = "yukjindae_notices_seen_at";

// 지도 아래 큐레이션 카드. 테마 코스는 탭바로 옮겼으므로 축제만 남기고 전폭으로
// 키운다 — 카드 두 개를 반씩 나눠 놓으니 둘 다 눈에 안 들어왔다.
// 홈에 실을 축제 수. 가로로 넘겨 보는 형태라 서너 개면 "더 있다"는 것이 드러나고,
// 많이 실으면 아래 추천장소까지 내려가기 전에 지친다.
const HOME_FESTIVAL_COUNT = 4;

function regionCount(region) {
  return state.places.filter((p) => REGION_GROUPS[region].includes(p.region)).length;
}

function selectRegion(region) {
  const isSelecting = state.region !== region;
  state.region = isSelecting ? region : null;
  state.showAll = false;
  renderRegionMap();
  renderRegionLegend();
  renderPlaces();
  if (isSelecting) {
    document.getElementById("place-list").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderRegionMap() {
  const mapEl = document.getElementById("region-map");
  mapEl.classList.toggle("has-selection", Boolean(state.region));
  const halos = REGIONS.map(regionHaloPath).join("");
  const bodies = REGIONS.map((region) => regionBodyPath(region, state.region === region)).join("");
  // 실제 컨텐츠(지역 폴리곤)가 원래 좌표계(0 0 100 130)의 왼쪽 절반/아래쪽에
  // 치우쳐 있어서 여백이 컸다 — 실제 쓰이는 영역(-3 15 93 104)으로 뷰박스를
  // 잘라서 지도가 카드를 꽉 채우도록 확대했다. halo를 모두 그린 뒤 body를
  // 전부 그려야, 옆 지역 halo에 이쪽 body가 가려지지 않는다.
  mapEl.innerHTML = `<svg class="region-map__svg" viewBox="-3 15 93 104"><g>${halos}</g><g>${bodies}</g></svg>`;

  mapEl.querySelectorAll("[data-region]").forEach((el) => {
    el.addEventListener("click", () => selectRegion(el.dataset.region));
  });

  const caption = document.getElementById("region-map-caption");
  caption.textContent = state.region
    ? `${state.region} · ${regionCount(state.region)}곳`
    : "지도 또는 아래 목록에서 지역을 선택해보세요";
}

function renderRegionLegend() {
  const legend = document.getElementById("region-legend");
  legend.innerHTML = REGIONS.map((region) => {
    const active = state.region === region;
    const style = active
      ? ` style="border-color:${regionColor(region)};background:${regionColor(region, 0.16)};color:${regionColor(region)}"`
      : "";
    return `<button class="region-legend__item${active ? " is-active" : ""}" data-region="${region}"${style}>
      <span class="region-legend__name">${region}</span>
      <span class="region-legend__count">${regionCount(region)}</span>
    </button>`;
  }).join("");

  legend.querySelectorAll("[data-region]").forEach((el) => {
    el.addEventListener("click", () => selectRegion(el.dataset.region));
  });
}

// 검수 모드로 들어왔다는 걸 화면에 드러낸다. 아직 공개하지 않은 장소가 섞여 있어
// 일반 화면과 다르다는 것을 모르면 "왜 이런 게 있지" 하게 된다.
// 헤더의 공유 버튼. 아빠들끼리 알려서 퍼지는 것이 이 앱이 늘어나는 방식이라
// 보내는 길이 눈에 보이는 자리에 있어야 한다.
function initShareButton() {
  const btn = document.getElementById("share-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    // 검수 링크에는 토큰이 붙어 있다. 그대로 공유되면 검수 전 정보가 그대로
    // 퍼지므로, 항상 깨끗한 주소만 내보낸다.
    const url = `${location.origin}${location.pathname}`;
    const share = {
      title: "아빠, 어디가?",
      text: "아빠들이 직접 다녀온, 아빠와 아이가 갈만한 곳",
      url,
    };

    try {
      if (navigator.share) {
        await navigator.share(share);
        return;
      }
      await navigator.clipboard.writeText(url);
      // 공유 시트가 없는 기기에서는 복사만 되고 화면이 그대로라 고장난 줄 안다.
      btn.classList.add("is-copied");
      btn.setAttribute("aria-label", "주소를 복사했어요");
      setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.setAttribute("aria-label", "친구에게 공유하기");
      }, 1600);
    } catch {
      // 사용자가 공유 시트를 닫은 경우가 대부분이라 조용히 넘어간다.
    }
  });
}

function renderReviewBanner() {
  if (!window.reviewToken()) return;
  const bar = document.createElement("div");
  bar.className = "review-bar";
  bar.textContent = "검수 모드 — 아직 공개하지 않은 장소가 함께 보입니다";
  document.body.prepend(bar);
}

// 지금까지는 "축제·행사 TOP10 / 지금 열리는 행사 10개"라는 링크 한 줄이었다.
// 무엇이 열리는지 안 보여주니 눌러볼 이유가 없었다. 실제 축제를 카드로 깔고
// 전체 보기를 옆에 둔다.
async function renderFestivals() {
  const wrap = document.getElementById("curated-links");
  if (!wrap) return;

  let festivals = [];
  try {
    const data = await fetchJson("/api/festivals");
    festivals = data.festivals || [];
  } catch {
    // 축제를 못 가져와도 홈은 떠야 한다.
  }

  if (!festivals.length) {
    wrap.hidden = true;
    return;
  }

  const cards = festivals.slice(0, HOME_FESTIVAL_COUNT).map((f) => {
    const dday = festivalDday(f);
    const badge = dday ? `<span class="festival-strip__dday">${escapeHtml(dday)}</span>` : "";
    const thumb = f.image
      ? `<img class="festival-strip__thumb" src="${escapeHtml(safeImageSrc(f.image))}" alt="" loading="lazy" />`
      : `<div class="festival-strip__thumb"></div>`;
    const where = [f.region, f.placeName].filter(Boolean).join(" · ");
    return `
      <a class="festival-strip__card" href="festival-detail.html?id=${encodeURIComponent(f.id)}">
        <div class="festival-strip__thumb-wrap">${thumb}${badge}</div>
        <div class="festival-strip__name">${escapeHtml(f.title || "")}</div>
        ${where ? `<div class="festival-strip__where">${escapeHtml(where)}</div>` : ""}
      </a>`;
  }).join("");

  wrap.hidden = false;
  wrap.innerHTML = `
    <div class="festival-strip__head">
      <h2 class="section__title">🎪 지금 열리는 축제</h2>
      <a class="festival-strip__more" href="festival.html">전체 ${festivals.length}개 ›</a>
    </div>
    <div class="festival-strip__scroll">${cards}</div>
  `;
}

// 예약 오픈은 "언제 신청 버튼이 열리냐"를 알린다. 오픈 시각을 놓치면 그만이라
// 날짜를 카드 맨 위에 크게 두고, 아직 안 열린 것을 먼저 보여준다.
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function formatReservationWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // 보는 사람이 어느 시간대에 있든 한국 시각으로 읽혀야 한다.
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const mm = kst.getUTCMonth() + 1;
  const dd = kst.getUTCDate();
  const day = DAY_NAMES[kst.getUTCDay()];
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd}(${day}) ${hh}:${mi}`;
}

async function renderReservations() {
  const section = document.getElementById("reservation-section");
  const list = document.getElementById("reservation-list");
  if (!section || !list) return;

  let reservations = [];
  try {
    const data = await fetchJson("/api/reservations");
    reservations = data.reservations || [];
  } catch {
    // 예약 정보를 못 가져와도 홈은 떠야 한다.
  }

  if (!reservations.length) {
    section.hidden = true;
    return;
  }

  list.innerHTML = reservations.map((r) => {
    const soon = r.status === "오픈예정";
    const when = formatReservationWhen(soon ? r.openAt : r.closeAt);
    const label = soon ? "오픈" : "마감";
    const where = [r.area, r.place].filter(Boolean).join(" · ");
    const chips = [
      r.fee === "무료" ? `<span class="reservation-strip__chip reservation-strip__chip--free">무료</span>` : "",
      r.target ? `<span class="reservation-strip__chip">${escapeHtml(r.target)}</span>` : "",
    ].join("");
    // 신청은 서울시 예약 페이지에서 이뤄진다. 우리가 중간에 낄 이유가 없다.
    const href = r.url ? escapeHtml(r.url) : "#";
    return `
      <a class="reservation-strip__card reservation-strip__card--${soon ? "soon" : "open"}"
         href="${href}" target="_blank" rel="noopener noreferrer">
        <div class="reservation-strip__when">
          ${escapeHtml(when)}
          <span class="reservation-strip__status">${escapeHtml(label)}</span>
        </div>
        <div class="reservation-strip__name">${escapeHtml(r.title || "")}</div>
        ${where ? `<div class="reservation-strip__where">${escapeHtml(where)}</div>` : ""}
        ${chips ? `<div class="reservation-strip__chips">${chips}</div>` : ""}
      </a>`;
  }).join("");

  section.hidden = false;
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
      state.showAll = false;
      renderCategoryFilter();
      renderPlaces();
    });
  });
}

function matchesFilters(place) {
  if (state.region && !REGION_GROUPS[state.region].includes(place.region)) return false;
  if (state.category === VIRTUAL_CATEGORY_FREE_AGE && !place.freeAgePolicy) return false;
  if (
    state.category &&
    state.category !== VIRTUAL_CATEGORY_FREE_AGE &&
    !place.categories.includes(state.category)
  )
    return false;
  if (state.query) {
    const needle = state.query.toLowerCase();
    const haystack = `${place.name} ${place.address} ${place.region}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

// 완전 무료(카테고리 "무료")가 영유아만 무료보다 우선 표시된다 — 둘 다 해당하면
// 더 넓은 혜택(완전 무료)을 먼저 알려주는 게 유용하기 때문.
function freeBadgeText(place) {
  if (place.categories && place.categories.includes("무료")) return "무료입장";
  if (place.freeAgePolicy) return "영유아 무료";
  return "";
}

// 순위는 "지역별" Top 10이라 지역을 고르지 않은 목록에서는 1위가 여러 개 보인다
// (제주 1위·경상도 1위·서울강남 1위…). 지역을 선택했을 때만 순위를 노출한다.
// showRank: 순위를 근거로 사유를 함께 보여줄지.
// hideRankBadge: 사유는 두되 숫자 배지만 감춘다 — 지역별 1위 모음에서는 모든
// 카드가 "1"이라 번호 매긴 목록처럼 읽혀 오히려 방해가 된다.
function placeCard(place, showRank = false, { hideRankBadge = false } = {}) {
  const thumb = place.image
    ? `<img class="place-grid__thumb" src="${escapeHtml(safeImageSrc(place.image))}" alt="${escapeHtml(place.name)}" loading="lazy" />`
    : `<div class="place-grid__thumb"></div>`;
  const freeBadge = freeBadgeText(place);
  const badge = freeBadge ? `<span class="place-grid__free-badge">${escapeHtml(freeBadge)}</span>` : "";
  const rank = showRank ? monthlyRank(place) : null;
  const rankBadge = rank && !hideRankBadge ? `<span class="place-grid__rank">${rank}</span>` : "";
  const rankReason = rank && place.rankReason
    ? `<div class="place-grid__rank-reason">${escapeHtml(place.rankReason)}</div>`
    : "";
  const event = activeEvent(place);
  const eventBadge = event ? `<span class="place-grid__event-badge">🎟 할인</span>` : "";
  // 검수 모드에서만 비공개 장소가 섞여 온다. 표시가 없으면 이미 공개된 곳으로
  // 착각해 검수해야 할 곳을 지나친다.
  const pendingBadge = place.published === false
    ? `<span class="place-grid__pending">검수 대기</span>`
    : "";
  return `
    <a class="place-grid__card" href="place.html?id=${encodeURIComponent(place.id)}">
      <div class="place-grid__thumb-wrap">
        ${thumb}
        ${rankBadge}
        ${badge}
        ${pendingBadge}
        ${eventBadge}
        ${favoriteButtonHtml(place.id, "place-grid__favorite-btn")}
      </div>
      <div class="place-grid__body">
        <div class="place-grid__name">${escapeHtml(place.name)}</div>
        <div class="place-grid__region">${escapeHtml(place.region)}</div>
        ${rankReason}
      </div>
    </a>
  `;
}

function renderPlaces() {
  const list = document.getElementById("place-list");

  if (!state.places.length) {
    list.innerHTML = `<p class="place-list__loading">불러오는 중...</p>`;
    return;
  }

  // 지역을 고르면 그 지역 월간 Top 10이 주인공이고, 고르기 전 홈에서는 오늘
  // 날씨에 맞는 곳을 앞으로 당긴다. 둘을 겹치면 어느 기준으로 정렬됐는지
  // 알 수 없어져서 한 화면에는 하나만 적용한다.
  // 지역을 고르면 그 지역 월간 Top 10이 주인공이다.
  //
  // 고르기 전 홈에서는 지역마다 이달의 1위를 한 곳씩 모아 보여준다. 전국을
  // 날씨순으로 정렬해 앞에서 자르면 한 지역이 몰려 나온다 — 비 오는 날 실내가
  // 우대되면서 전라도 박물관 다섯 곳이 연달아 뜬 적이 있다.
  //
  // "더보기"를 누르면 그때부터는 전체를, 위치를 알려줬으면 가까운 순으로 본다.
  const showRank = Boolean(state.region);
  const matched = state.places.filter(matchesFilters);

  if (!matched.length) {
    list.innerHTML = `<p class="place-list__empty">조건에 맞는 장소가 없어요.</p>`;
    setPlaceListTitle(showRank);
    renderMoreButton(0);
    return;
  }

  const regionDigest = !showRank && !state.showAll;
  let shown;
  let rest;

  if (showRank) {
    shown = sortByMonthlyRank(matched);
    rest = 0;
  } else if (regionDigest) {
    // 위치를 알려줬으면 내 지역 1위가 맨 앞에 오게 가까운 순으로 세운다.
    const tops = pickRegionTops(matched, state.weather);
    shown = state.coords ? sortByDistance(tops, state.coords) : sortByMonthlyRank(tops);
    rest = matched.length - shown.length;
  } else {
    const all = state.coords ? sortByDistance(matched, state.coords) : sortByWeather(matched, state.weather);
    shown = all;
    rest = 0;
  }

  setPlaceListTitle(showRank, regionDigest);
  list.innerHTML = shown
    .map((place) => placeCard(place, showRank || regionDigest, { hideRankBadge: regionDigest }))
    .join("");
  bindFavoriteButtons(list);
  renderMoreButton(rest);
}

// 무엇을 보고 있는지 제목으로 알려준다. 정렬 기준이 셋이라 제목이 같으면
// 왜 이 순서인지 알 수 없다.
//
// 지역별 요약은 날씨에 따라 고르는 곳이 달라진다. 비 오는 날에는 그 지역 1위가
// 야외면 순위를 양보하고 실내를 고르는데, 제목에 "1위"라고 써두면 사실과 다르다.
function setPlaceListTitle(showRank, regionDigest) {
  const title = document.querySelector(".section__title--diary");
  if (!title) return;
  if (showRank) {
    title.textContent = `${state.region} 이달의 Top 10`;
    return;
  }
  if (!regionDigest) {
    title.textContent = "전체 장소";
    return;
  }
  const weatherApplied = Boolean(
    state.weather && ((state.weather.boost || []).length || (state.weather.avoid || []).length)
  );
  title.textContent = weatherApplied ? "오늘 가기 좋은 곳 · 지역별 한 곳씩" : "이달의 지역별 1위";
}

// "더보기"는 목록 바로 아래에 둔다 — 카드 그리드 안에 넣으면 칸 하나를 차지해
// 장소 카드처럼 보인다.
function renderMoreButton(rest) {
  const old = document.getElementById("place-more");
  if (old) old.remove();
  if (rest <= 0) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "place-more";
  btn.className = "place-more";
  btn.textContent = `전체 ${rest + document.querySelectorAll("#place-list .place-grid__card").length}곳 보기`;
  btn.addEventListener("click", () => {
    state.showAll = true;
    renderPlaces();
  });
  document.getElementById("place-list").after(btn);
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
    index = (next + count) % count;
    track.style.transform = `translateX(-${index * 100}%)`;
    Array.from(dots).forEach((dot, i) => dot.classList.toggle("is-active", i === index));
  }

  let timer;
  function startAutoplay() {
    clearInterval(timer);
    timer = setInterval(() => go(index + 1), 3000);
  }
  startAutoplay();

  let startX = 0;
  let dragging = false;

  track.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
      dragging = true;
    },
    { passive: true }
  );

  track.addEventListener(
    "touchend",
    (e) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 40) return;
      go(dx < 0 ? index + 1 : index - 1);
      startAutoplay();
    },
    { passive: true }
  );
}

function bannerSlide(banner) {
  const caption =
    banner.title || banner.tagline
      ? `<div class="banner__caption">
          ${banner.title ? `<p class="banner__caption-title">${escapeHtml(banner.title)}</p>` : ""}
          ${banner.tagline ? `<p class="banner__caption-tagline">${escapeHtml(banner.tagline)}</p>` : ""}
        </div>`
      : "";
  const img = `<img class="banner__photo" src="${escapeHtml(safeImageSrc(banner.image))}" alt="${escapeHtml(banner.title || "배너")}" />`;
  const inner = `${img}${caption}`;

  // 배너 링크는 노션에서 수동 입력되는 값이라 safeHref로 스킴을 한 번 거른다.
  const href = safeHref(banner.link);
  return href
    ? `<a class="banner__slide banner__slide--photo" href="${escapeHtml(href)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="banner__slide banner__slide--photo">${inner}</div>`;
}

async function loadBanners() {
  try {
    const data = await fetchJson("/api/banners");
    const banners = data.banners || [];
    // 내용이 그대로면 다시 그리지 않는다. 화면이 다시 보일 때마다 새로 그리면
    // 슬라이드가 첫 장으로 튀고 화면이 한 번 깜빡인다.
    if (JSON.stringify(banners) === JSON.stringify(state.banners)) return;
    state.banners = banners;
    if (banners.length) {
      document.getElementById("hero-track").innerHTML = banners.map(bannerSlide).join("");
    }
  } catch (err) {
    console.error(err);
  }
  // 노션 배너 유무가 판가름 난 뒤에야 배너 영역을 드러내서, 기본 배너가 잠깐
  // 보였다가 노션 배너로 바뀌는 깜빡임 없이 처음부터 최종 내용만 보이게 한다.
  document.getElementById("hero-banner").classList.remove("is-loading");
  initHeroSlider();
}

// 배너(이벤트 소식)와 최근 등록된 장소(신규 장소 소식)를 합쳐서 최신순으로 정리.
// 로그인/푸시 인프라 없이 Notion의 생성일(createdAt)만으로 가볍게 구현.
function buildNotices() {
  const eventNotices = state.banners.map((banner) => ({
    type: "event",
    title: banner.title || "새 소식이 있어요",
    subtitle: banner.tagline,
    link: banner.link,
    createdAt: banner.createdAt,
  }));

  const newPlaceNotices = state.places
    .toSorted((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3)
    .map((place) => ({
      type: "new-place",
      title: `새 장소 추가: ${place.name}`,
      subtitle: place.region,
      link: `place.html?id=${encodeURIComponent(place.id)}`,
      createdAt: place.createdAt,
    }));

  return [...eventNotices, ...newPlaceNotices]
    .toSorted((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
}

function hasUnreadNotices() {
  const notices = buildNotices();
  if (!notices.length) return false;
  const seenAt = localStorage.getItem(NOTICES_SEEN_KEY);
  if (!seenAt) return true;
  return new Date(notices[0].createdAt) > new Date(seenAt);
}

function renderBellBadge() {
  const bell = document.querySelector(".header__bell");
  if (!bell) return;
  bell.classList.toggle("has-unread", hasUnreadNotices());
}

function noticeItemHtml(notice) {
  const inner = `
    <p class="notices-panel__item-title">${escapeHtml(notice.title)}</p>
    ${notice.subtitle ? `<p class="notices-panel__item-sub">${escapeHtml(notice.subtitle)}</p>` : ""}
  `;
  // 이벤트 소식의 링크는 노션 배너에서 온 외부 URL이라 스킴 검사가 필요하고,
  // 신규 장소 소식은 우리가 만든 내부 상대경로(place.html?id=...)라 그대로 쓴다.
  const href = notice.type === "event" ? safeHref(notice.link) : notice.link;
  if (!href) return `<div class="notices-panel__item">${inner}</div>`;
  const externalAttrs = notice.type === "event" ? ` target="_blank" rel="noopener"` : "";
  return `<a class="notices-panel__item" href="${escapeHtml(href)}"${externalAttrs}>${inner}</a>`;
}

function renderNoticesPanel() {
  const panel = document.getElementById("notices-panel");
  if (!panel) return;
  const notices = buildNotices();
  const itemsHtml = notices.length
    ? notices.map(noticeItemHtml).join("")
    : `<p class="notices-panel__empty">아직 새 소식이 없어요</p>`;

  panel.innerHTML = `
    <p class="notices-panel__header">새 소식</p>
    ${itemsHtml}
    <a class="notices-panel__footer" href="about.html">육진대 채널 더보기 →</a>
  `;
}

function initNoticesBell() {
  const bell = document.querySelector(".header__bell");
  const panel = document.getElementById("notices-panel");
  if (!bell || !panel) return;

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", opening);
    if (opening) {
      renderNoticesPanel();
      localStorage.setItem(NOTICES_SEEN_KEY, new Date().toISOString());
      renderBellBadge();
    }
  });

  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("is-open")) return;
    if (panel.contains(e.target) || bell.contains(e.target)) return;
    panel.classList.remove("is-open");
  });
}

async function loadPlaces() {
  try {
    const data = await fetchJson(window.withReview("/api/places"));
    const places = data.places || [];
    // 바뀐 게 없으면 그대로 둔다 — 목록을 다시 그리면 보고 있던 자리가 흔들린다.
    if (state.places.length && JSON.stringify(places) === JSON.stringify(state.places)) return;
    state.places = places;
  } catch (err) {
    console.error(err);
    document.getElementById("place-list").innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
    return;
  }
  renderRegionMap();
  renderRegionLegend();
  renderPlaces();
}

// 월간 Top 10은 한 달 내내 같은 목록이라 "오늘 뭐하지"에 답하지 못한다. 오늘 날씨로
// 실내·야외를 바꿔 보여줘서 매일 다른 화면이 되게 한다.
//
// 위치 권한은 물어보지 않는다 — 홈에 들어오자마자 권한 팝업이 뜨면 거슬리고, 이미
// 주변 탭에서 한 번 묻는다. 권한이 이미 허용된 경우에만 현재 위치를 쓰고, 아니면
// 서울을 기준으로 한다.
const DEFAULT_WEATHER_COORDS = { lat: 37.5665, lng: 126.978 };

// 이미 허용된 경우에만 조용히 현재 위치를 쓴다. 권한을 물어야 하는 상태면
// 여기서 팝업을 띄우지 않고 서울 기준으로 보여준 뒤, 배너의 버튼을 눌렀을 때만
// 요청한다 — 페이지를 열자마자 권한 팝업이 뜨면 거부율이 크게 올라간다.
function geolocationState() {
  if (!navigator.permissions || !navigator.geolocation) return Promise.resolve("unsupported");
  return navigator.permissions
    .query({ name: "geolocation" })
    .then((s) => s.state)
    .catch(() => "unsupported");
}

function readPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { timeout: 8000, maximumAge: 600000 }
    );
  });
}

async function currentCoords({ ask = false } = {}) {
  if (!navigator.geolocation) return DEFAULT_WEATHER_COORDS;

  const permission = await geolocationState();
  // 거부한 사람에게 다시 묻지 않는다.
  if (permission === "denied") return DEFAULT_WEATHER_COORDS;
  // 아직 안 물어본 상태라면 사용자가 직접 요청했을 때만 묻는다. 들어오자마자
  // 위치 권한창을 띄우면 대부분 거부하고, 그러면 영영 못 쓴다.
  if (permission !== "granted" && !ask) return DEFAULT_WEATHER_COORDS;

  try {
    return await readPosition();
  } catch {
    return DEFAULT_WEATHER_COORDS;
  }
}

async function loadTodayWeather({ ask = false } = {}) {
  const box = document.getElementById("today-weather");
  if (!box) return;

  try {
    const coords = await currentCoords({ ask });
    const usingDefault = coords === DEFAULT_WEATHER_COORDS;
    // 실제 내 위치를 받았을 때만 기억한다. 기본 좌표(서울)로 거리순 정렬을 하면
    // 지방 사용자에게 서울 근처를 추천하게 된다.
    state.coords = usingDefault ? null : coords;

    const data = await fetchJson(`/api/today?lat=${coords.lat}&lng=${coords.lng}`);
    if (!data.weather || !data.recommendation) return;

    state.weather = data.recommendation;
    const temp = typeof data.weather.maxTemp === "number" ? `${Math.round(data.weather.maxTemp)}°` : "";

    // 어디 기준인지 밝힌다. "비 소식이 있어요"만 떠 있으면, 위치를 허용하지 않아
    // 서울 날씨를 보고 있는 사람이 자기 동네 얘기인 줄 안다 — 의정부에 비 소식이
    // 없는데 왜 비라고 하냐는 물음이 실제로 나왔다.
    //
    // 서버가 역지오코딩으로 "의정부시"를 준다. 못 가져오면 이름 없이 기준만 밝힌다.
    const area = String(data.area || "").trim();
    const basis = area
      ? (usingDefault ? `${area} 기준` : area)
      : (usingDefault ? "서울 기준" : "내 위치 기준");

    // 강수확률을 함께 보여준다. 하루 중 최대값이라 낮에는 맑을 수도 있어서,
    // 숫자를 보여주면 사람이 스스로 판단할 수 있다.
    const rain = Number(data.weather.rainProbability);
    const rainText = data.recommendation.tone === "rain" && Number.isFinite(rain)
      ? ` · 강수 ${rain}%`
      : "";

    // 서울 기준으로 보여주는 중이면 내 위치로 바꿀 버튼을 늘 띄운다. 지방
    // 사용자에게 서울 날씨만 보여주고 목록도 서울 기준으로 정렬하면 안 맞는다.
    //
    // 권한 상태로 버튼을 숨기지 않는다. 사파리(iOS)는 permissions.query에
    // geolocation을 지원하지 않아 "unsupported"가 오고, 한 번 거부한 사람은
    // "denied"로 굳는다. 둘 다 버튼이 사라져 되돌릴 방법이 없었다 — 거부한
    // 사람에게는 눌렀을 때 어떻게 푸는지 알려주는 편이 낫다.
    const canAsk = usingDefault && Boolean(navigator.geolocation);

    box.innerHTML = `
      <span class="today-weather__icon">${weatherIcon(data.recommendation.tone, data.weather.kind)}</span>
      <span class="today-weather__text">${escapeHtml(data.recommendation.headline)}</span>
      <span class="today-weather__basis">${escapeHtml(basis)}${escapeHtml(rainText)}</span>
      ${temp ? `<span class="today-weather__temp">${escapeHtml(temp)}</span>` : ""}
      ${canAsk ? `<button type="button" class="today-weather__locate" id="weather-locate">📍 내 주변부터</button>` : ""}
    `;
    box.hidden = false;

    const locate = document.getElementById("weather-locate");
    if (locate) {
      locate.addEventListener("click", async () => {
        if ((await geolocationState()) === "denied") {
          // 브라우저가 이미 막아둔 상태라 다시 물어볼 수 없다. 어디서 푸는지
          // 알려주지 않으면 사용자는 버튼이 고장난 줄 안다.
          locate.textContent = "브라우저 설정에서 위치 허용 필요";
          locate.disabled = true;
          return;
        }
        locate.disabled = true;
        locate.textContent = "확인 중...";
        loadTodayWeather({ ask: true });
      });
    }
    renderPlaces();
  } catch (err) {
    console.error(err);
  }
}

const WEATHER_ICONS = {
  rain: "🌧",
  storm: "⛈",
  snow: "❄️",
  hot: "🥵",
  cold: "🧣",
  fog: "🌫",
  clear: "☀️",
};

// tone은 "무엇을 추천할지"라 맑음과 흐림이 같은 clear로 묶인다. 아이콘까지 같으면
// 흐린 날에 해가 뜨므로, 하늘 상태(kind)로 한 번 더 갈라준다.
function weatherIcon(tone, kind) {
  if (tone === "clear" && kind === "cloudy") return "⛅";
  return WEATHER_ICONS[tone] || "🌤";
}

// 검색어를 입력하면 배너·지역 지도 섹션을 접어서, 스크롤 없이 검색 결과가 바로
// 보이도록 한다. 검색어를 지우면 원래대로 되돌아온다.
function updateSearchModeUI() {
  const searching = Boolean(state.query);
  document.getElementById("hero-banner").hidden = searching;
  document.getElementById("region-section").hidden = searching;
}

// 홈은 페이지가 뜰 때 한 번만 데이터를 부른다. 그래서 앱을 백그라운드에 두었다가
// 다시 열면 어제 배너와 어제 목록이 그대로 보였다 — 배너를 갈아끼우거나 장소를
// 공개해도 사용자가 직접 새로고침해야 반영됐다.
//
// 화면이 다시 보이는 순간 다시 부른다. 엣지 캐시가 60초라 서버 부담은 거의 없지만,
// 탭을 자주 오가는 사람이 매번 네 개를 부르지 않도록 최소 간격을 둔다.
const REFRESH_MIN_GAP_MS = 30000;
let lastLoadedAt = 0;

// 방문자 집계. 화면에 보이는 것은 없고, 소개 페이지에서 숫자를 읽어 보여준다.
// 실패해도 아무 일도 일어나지 않아야 하므로 결과를 기다리지 않는다.
function countVisit() {
  const id = window.deviceId();
  fetchJson(`/api/visit?d=${encodeURIComponent(id)}`, { method: "POST" })
    .catch(() => {});
}

function loadHomeData() {
  lastLoadedAt = Date.now();
  Promise.all([loadBanners(), loadPlaces()]).then(renderBellBadge);
  // 장소 로딩과 독립적으로 돈다 — 날씨가 늦거나 실패해도 목록은 그대로 뜬다.
  loadTodayWeather();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - lastLoadedAt < REFRESH_MIN_GAP_MS) return;
  loadHomeData();
});

document.addEventListener("DOMContentLoaded", () => {
  countVisit();
  renderRegionMap();
  renderRegionLegend();
  renderReviewBanner();
  renderFestivals();
  renderReservations();
  renderCategoryFilter();
  initNoticesBell();
  initShareButton();

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    state.showAll = false;
    updateSearchModeUI();
    renderPlaces();
  });

  loadHomeData();
});
