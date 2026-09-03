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
  // 누른 지도가 발밑에서 움직이지 않도록 지도를 기준으로 잡는다.
  keepAnchor(document.getElementById("region-map"), () => {
    renderRegionMap();
    renderRegionLegend();
    renderPlaces();
    placeResults();
  });
  if (isSelecting) revealResults();
}

// 목록은 찾은 자리에서 나온다.
//
// 검색창과 지도는 화면 아래에 있는데 장소 목록은 맨 위에 있었다. 아래에서
// 지역을 고르면 화면이 저 위로 튀어 올라갔다 — 방금 누른 지도는 화면 밖으로
// 사라지고, 검색어를 쳐도 결과가 보이지 않는 곳에서 바뀌었다.
//
// 그래서 목록을 옮긴다. 검색하면 검색창 바로 밑, 지도에서 지역을 고르면 지도
// 바로 밑, 아무것도 안 고르면 원래 홈 자리로 돌아온다. 카테고리 칩은 목록에
// 붙어 있으니 어디에 있든 그 자리를 지킨다.
const RESULT_SLOTS = { home: "results-slot-home", search: "results-slot-search", region: "results-slot-region" };
let resultsAt = "home";

function resultsTarget() {
  if (state.query) return "search";
  if (state.region) return "region";
  return "home";
}

function placeResults() {
  const where = resultsTarget();
  if (where === resultsAt) return;
  const section = document.getElementById("place-section");
  const slot = document.getElementById(RESULT_SLOTS[where]);
  if (!section || !slot) return;
  slot.after(section);
  resultsAt = where;
  // 목록이 떠난 자리에 구분선만 남으면, 날씨 바로 밑에 이유 없는 줄이 그어진다.
  document.getElementById("place-section-break").hidden = where !== "home";
}

// 화면을 고쳐 그리는 동안 사용자가 보고 있는 것을 제자리에 붙들어 둔다.
//
// 목록을 위아래로 옮기거나 배너를 감추면 화면 위쪽 내용의 높이가 통째로
// 바뀐다. 스크롤 위치는 문서 맨 위에서 잰 거리라, 위쪽이 짧아지면 보던 지점이
// 그만큼 밀려 올라간다 — 누른 지도가 손끝에서 도망간다. 기준 요소가 화면에서
// 몇 픽셀에 있었는지 재 두었다가, 바뀐 만큼 스크롤을 되돌린다.
function keepAnchor(anchor, mutate) {
  const before = anchor ? anchor.getBoundingClientRect().top : 0;
  mutate();
  if (!anchor) return;
  const delta = anchor.getBoundingClientRect().top - before;
  if (delta) window.scrollBy(0, delta);
}

// 고른 지역의 목록이 화면 밖에 있으면 그만큼만 내려 보여준다. 이미 보이면
// 건드리지 않는다 — 볼 수 있는 것을 다시 움직이면 그게 튀는 것처럼 느껴진다.
function revealResults() {
  const heading = document.getElementById("place-heading");
  if (!heading) return;
  const top = heading.getBoundingClientRect().top;
  if (top > window.innerHeight - 120 || top < 58) {
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
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

// 헤더의 공유 버튼. 아빠들끼리 알려서 퍼지는 것이 이 앱이 늘어나는 방식이라
// 보내는 길이 눈에 보이는 자리에 있어야 한다.
function initShareButton() {
  const btn = document.getElementById("share-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    // 주소창에 뭐가 붙어 있든 항상 깨끗한 주소만 내보낸다.
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
      <h2 class="section__title">🎪 지금 열리는 축제<button type="button" class="info-dot" aria-expanded="false" aria-label="축제 목록이 언제 바뀌는지 보기" data-info="매주 일요일 새벽에 새 축제를 모아 와요. 끝난 축제는 종료일이 지나면 자동으로 내려가요."><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="4.6" r="0.95" fill="currentColor"/><path d="M8 7.2v4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></h2>
      <a class="festival-strip__more" href="festival.html">전체 ${festivals.length}개 ›</a>
    </div>
    <div class="festival-strip__scroll">${cards}</div>
  `;
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
// 장소별 후기 요약. 홈에서 한 번 받아 두고 카드마다 꺼내 쓴다.
//
// 아직 후기가 없어 아무것도 안 보이지만, 쌓이기 시작하면 사진 위에 바로 뜬다.
// 카드에서 별점이 보이는 것과 상세까지 들어가야 보이는 것은 다르다.
const reviewStats = new Map();

async function loadReviewStats() {
  try {
    const data = await fetchJson("/api/reviews");
    const byPlace = new Map();
    for (const r of data.reviews || []) {
      if (!r.placeId || !r.rating) continue;
      const cur = byPlace.get(r.placeId) || { sum: 0, count: 0 };
      cur.sum += Number(r.rating);
      cur.count += 1;
      byPlace.set(r.placeId, cur);
    }
    reviewStats.clear();
    for (const [id, v] of byPlace) {
      reviewStats.set(id, { average: Math.round((v.sum / v.count) * 10) / 10, count: v.count });
    }
    if (reviewStats.size) renderPlaces();
  } catch {
    // 후기를 못 받아도 목록은 그대로 뜬다.
  }
}

function ratingBadgeHtml(place) {
  const stat = reviewStats.get(place.id);
  if (!stat) return "";
  return `<span class="place-grid__rating">★ ${stat.average} <em>${stat.count}</em></span>`;
}

function placeCard(place, showRank = false, { hideRankBadge = false } = {}) {
  const thumb = place.image
    ? `<img class="place-grid__thumb" src="${escapeHtml(safeImageSrc(place.image))}" alt="${escapeHtml(place.name)}" loading="lazy" />`
    : `<div class="place-grid__thumb place-grid__thumb--empty" aria-hidden="true"></div>`;
  const freeBadge = freeBadgeText(place);
  const badge = freeBadge ? `<span class="place-grid__free-badge">${escapeHtml(freeBadge)}</span>` : "";
  const rank = showRank ? monthlyRank(place) : null;
  const rankBadge = rank && !hideRankBadge ? `<span class="place-grid__rank">${rank}</span>` : "";
  const rankReason = rank && place.rankReason
    ? `<div class="place-grid__rank-reason">${escapeHtml(place.rankReason)}</div>`
    : "";
  const event = activeEvent(place);
  const eventBadge = event ? `<span class="place-grid__event-badge">🎟 할인</span>` : "";
  const rating = ratingBadgeHtml(place);
  return `
    <a class="place-grid__card" href="place.html?id=${encodeURIComponent(place.id)}">
      <div class="place-grid__thumb-wrap">
        ${thumb}
        ${rating}
        ${rankBadge}
        ${badge}
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

// 위치를 안 켠 사람에게 왜 먼 곳이 뜨는지 알려준다.
//
// 세 곳만 보여주게 되면서 이 안내가 중요해졌다. 열 곳일 때는 그중 하나쯤 내
// 근처였는데, 세 곳이면 전부 먼 곳일 수 있다 — 목포·증평·안성이 나란히 뜬다.
// 날씨 카드에도 "내 주변부터" 버튼이 있지만 그건 날씨를 바꾸는 버튼으로 읽힌다.
function renderLocationHint(regionDigest) {
  const list = document.getElementById("place-list");
  const existing = document.getElementById("place-location-hint");
  if (existing) existing.remove();
  if (!regionDigest || state.coords || !navigator.geolocation) return;

  const hint = document.createElement("button");
  hint.type = "button";
  hint.id = "place-location-hint";
  hint.className = "place-location-hint";
  hint.innerHTML = `📍 <b>가까운 곳부터 보시겠어요?</b> 지금은 전국에서 골라 보여드리고 있어요`;
  hint.addEventListener("click", () => {
    hint.textContent = "위치 확인 중...";
    hint.disabled = true;
    loadTodayWeather({ ask: true });
  });
  list.insertAdjacentElement("afterend", hint);
}

// 첫 렌더는 날씨를 잠깐 기다린다.
//
// 날씨는 제목만 바꾸는 것이 아니라 어느 곳을 고를지까지 바꾼다(비 오는 날엔
// 실내가 그 지역 1위를 밀어낸다). 그래서 장소만 먼저 그리면 카드가 통째로 다시
// 그려지는 것이 눈에 보인다.
//
// 날씨는 대개 0.5초 안에 온다. 그 정도는 기다렸다가 한 번에 그리고, 그보다
// 늦으면 기다리지 않고 먼저 보여준다 — 빈 화면을 오래 두는 것이 더 나쁘다.
const WEATHER_WAIT_MS = 900;
let firstPlaceRenderDone = false;

function renderPlacesWhenReady() {
  if (firstPlaceRenderDone || state.weather) {
    firstPlaceRenderDone = true;
    renderPlaces();
    return;
  }
  setTimeout(() => {
    if (firstPlaceRenderDone) return;
    firstPlaceRenderDone = true;
    renderPlaces();
  }, WEATHER_WAIT_MS);
}

// 홈에서 지역별 1위를 몇 곳까지 보여줄지. 리드 카드 하나 + 작은 카드 둘이다.
//
// 다섯 곳을 깔았더니 장소만 780px 이라 그 뒤의 축제가 첫 화면 밖으로 밀렸다.
// 세 곳이면 날씨·장소·축제가 한 화면에 들어온다. 나머지는 "더보기"로 이어진다.
const HOME_DIGEST_COUNT = 3;

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
    renderMoreButton(0, 0);
    return;
  }

  // 검색어나 카테고리를 고른 사람에게는 "지역별 한 곳씩"을 보여주면 안 된다.
  //
  // 찾는 것이 정해진 사람인데 지역마다 한 곳씩만 남기고 걸러 버렸다. "공원"으로
  // 검색하면 54곳이 맞는데 화면에는 세 곳만 떴다. 홈 목록을 열 곳에서 세 곳으로
  // 줄이면서 눈에 띄게 됐지만, 걸러내는 것 자체는 그 전부터 있던 문제다.
  const filtering = Boolean(state.query || state.category);
  const regionDigest = !showRank && !state.showAll && !filtering;
  let shown;
  let rest;

  if (showRank) {
    shown = sortByMonthlyRank(matched);
    rest = 0;
  } else if (regionDigest) {
    // 위치를 알려줬으면 내 지역 1위가 맨 앞에 오게 가까운 순으로 세운다.
    const tops = pickRegionTops(matched, state.weather);
    const ordered = state.coords ? sortByDistance(tops, state.coords) : sortByMonthlyRank(tops);
    // 홈 첫 화면에서는 다섯 곳만 보여준다.
    //
    // 열 곳을 다 깔면 장소 목록만 1,467px 이라 그 뒤의 축제가 1,657px 까지
    // 밀린다 — 시기성이 있어 위에 둬야 할 것이 두 화면 아래로 내려간다.
    // 나머지는 "더보기"로 이어진다.
    shown = ordered.slice(0, HOME_DIGEST_COUNT);
    rest = matched.length - shown.length;
  } else {
    const all = state.coords ? sortByDistance(matched, state.coords) : sortByWeather(matched, state.weather);
    shown = all;
    rest = 0;
  }

  setPlaceListTitle(showRank, regionDigest);
  // 첫 곳만 크게 그린다. 카드가 다 같은 크기면 눈이 어디에 멈춰야 할지 모른다.
  // 지역별 한 곳씩 모아 보여줄 때만이다 — 검색이나 전체 목록에서는 순위가 없다.
  renderLocationHint(regionDigest);
  renderMoreButton(rest, shown.length);
  list.classList.toggle("place-grid--lead", regionDigest && shown.length > 1);
  list.innerHTML = shown
    .map((place) => placeCard(place, showRank || regionDigest, { hideRankBadge: regionDigest }))
    .join("");
  bindFavoriteButtons(list);
}

// 무엇을 보고 있는지 제목으로 알려준다. 정렬 기준이 셋이라 제목이 같으면
// 왜 이 순서인지 알 수 없다.
//
// 지역별 요약은 날씨에 따라 고르는 곳이 달라진다. 비 오는 날에는 그 지역 1위가
// 야외면 순위를 양보하고 실내를 고르는데, 제목에 "1위"라고 써두면 사실과 다르다.
// 제목을 textContent 로 갈아치우면 옆에 붙여둔 안내 물음표가 같이 지워진다.
// 제목마다 갱신 주기가 다르므로 문구도 함께 갈아 끼운다.
function writePlaceListTitle(title, text, info, note) {
  title.textContent = text;
  // 무엇을 기준으로 고른 목록인지 제목 아래에 적는다. 제목 오른쪽은 "더보기"
  // 자리라, 셋을 한 줄에 넣으면 좁은 화면에서 서로를 밀어낸다.
  const oldNote = document.getElementById("place-note");
  if (oldNote) oldNote.remove();
  if (note) {
    const small = document.createElement("p");
    small.id = "place-note";
    small.className = "section__note";
    small.textContent = note;
    title.insertAdjacentElement("afterend", small);
  }
  if (!info) return;
  const dot = document.createElement("button");
  dot.type = "button";
  dot.className = "info-dot";
  dot.dataset.info = info;
  dot.setAttribute("aria-expanded", "false");
  dot.setAttribute("aria-label", "이 목록이 언제 바뀌는지 보기");
  dot.innerHTML = INFO_ICON;
  title.appendChild(dot);
}

const MONTHLY_INFO = "매달 1일에 그 달 계절에 맞춰 순위를 다시 매겨요. 한여름엔 물놀이와 실내가, 선선해지면 야외와 체험이 위로 올라와요.";
const WEATHER_INFO = "순위는 매달 1일에 계절에 맞춰 다시 매겨요. 여기에 더해 그날 날씨를 보고, 비 오는 날엔 실내를 앞으로 당겨 보여줘요. 위치를 허용하면 가까운 곳부터, 아니면 전국에서 이달의 1위를 지역마다 한 곳씩 보여드려요.";

// 언제 가는 이야기인지 요일을 보고 정한다.
//
// 사람들이 아침 8~10시에 들어온다. 출근길에 "이번 주말 어디 가지"를 찾는
// 것인데, 화요일에 "이번 주말"이라고 하면 아직 먼 이야기로 읽힌다. 반대로
// 토요일 아침에 "오늘"이라고 해야 바로 나설 수 있다.
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// 무엇을 기준으로 고른 목록인지 한마디로 적는다.
//
// 위치를 켠 사람에게는 가까운 순으로, 안 켠 사람에게는 이달의 순위로 보여주는데
// 그 차이를 말해주지 않으면 왜 목포와 증평이 뜨는지 알 길이 없다.
function digestBasis() {
  return state.coords ? `${dayName()} · 가까운 순` : `${dayName()} · 전국`;
}

function dayName(now = new Date()) {
  return `${DAY_NAMES[now.getDay()]}요일`;
}

function outingWhen(now = new Date()) {
  const day = now.getDay(); // 0=일
  if (day === 0 || day === 6) return "오늘";
  if (day >= 4) return "이번 주말"; // 목·금
  return "오늘";
}

function setPlaceListTitle(showRank, regionDigest) {
  const title = document.querySelector(".section__title--diary");
  if (!title) return;
  if (showRank) {
    writePlaceListTitle(title, `${state.region} 이달의 Top 10`, MONTHLY_INFO);
    return;
  }
  if (!regionDigest) {
    // 무엇을 찾고 있는지 제목에 되돌려 준다. "전체 장소"만 떠 있으면 방금 친
    // 검색어가 먹혔는지 알 수 없다.
    if (state.query) {
      writePlaceListTitle(title, `'${state.query}' 검색 결과`, "");
    } else if (state.category) {
      writePlaceListTitle(title, state.category, "");
    } else {
      writePlaceListTitle(title, "전체 장소", "");
    }
    return;
  }
  // 제목은 날씨가 오든 안 오든 같다.
  //
  // 예전에는 날씨가 도착하기 전 "이달의 지역별 1위"였다가 도착하면 "이번 주말
  // 여기 어때요"로 바뀌었다. 목록을 보려던 사람 눈앞에서 제목이 따닥 하고
  // 갈아끼워진다. 어느 쪽이든 지역별 1위를 보여주는 것은 같으니 제목이 바뀔
  // 이유가 없다.
  writePlaceListTitle(title, `${outingWhen()} 여기 어때요`, WEATHER_INFO, digestBasis());
}

// "더보기"는 목록 바로 아래에 둔다 — 카드 그리드 안에 넣으면 칸 하나를 차지해
// 장소 카드처럼 보인다.
// "더보기"는 섹션 제목 오른쪽에 둔다.
//
// 예전에는 목록 아래 큰 버튼이었는데, 축제 섹션은 제목 오른쪽에 "전체 24개 ›"가
// 있어서 같은 화면에 두 가지 방식이 섞여 있었다. 한쪽으로 맞춘다.
function renderMoreButton(rest, shownCount) {
  const old = document.getElementById("place-more");
  if (old) old.remove();
  const title = document.querySelector(".section__title--diary");
  if (!title || rest <= 0) return;

  // 보여준 개수는 인자로 받는다. 예전에는 화면에서 카드를 세었는데, 이 함수가
  // 목록을 다시 그리기 전에 불려서 직전 화면의 카드 수가 잡혔다 — "공원"을
  // 검색해 54곳을 본 뒤 검색어를 지우면 "전체 308곳"이 됐다. 254 + 직전 54다.
  const shown = shownCount;
  const link = document.createElement("button");
  link.type = "button";
  link.id = "place-more";
  link.className = "section__more";
  link.textContent = `전체 ${rest + shown}곳 ›`;
  link.addEventListener("click", () => {
    state.showAll = true;
    renderPlaces();
  });
  title.appendChild(link);
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

// 앱에 새 기능이 붙었을 때 알리는 자리.
//
// 지금까지 알림에는 노션 배너와 새로 등록된 장소만 떴다. 그러다 보니 기능을 붙여도
// 아무도 모르고 지나갔다 — 수유실 레이어는 지도에 있는데도 🍼 버튼을 못 찾은 사람은
// 그런 게 있는 줄도 몰랐다.
//
// 날짜를 손으로 적는다. 지나간 소식은 아래에서 지우면 된다.
const FEATURE_NOTICES = [
  {
    title: "이제 별점과 후기를 남길 수 있어요",
    subtitle: "다녀온 곳에 별점 · 아이 나이 · 사진까지 · 모든 후기는 확인 후 올라와요",
    link: "index.html",
    createdAt: "2026-09-02T14:10:00+09:00",
  },
  {
    title: "앱이 이상하면 바로 알려주세요",
    subtitle: "홈 화면 위쪽 🐞 를 누르면 화면 캡처까지 함께 보낼 수 있어요",
    link: "index.html",
    createdAt: "2026-09-02T13:40:00+09:00",
  },
  {
    title: "기저귀 갈 곳 9,600곳이 새로 들어왔어요",
    subtitle: "주변 탭에서 🚼 를 누르면 보여요 · 남자화장실에도 있는 곳을 따로 표시해요",
    link: "map.html",
    createdAt: "2026-09-02T11:50:00+09:00",
  },
  {
    title: "전국 수유실 2,900곳을 지도에 담았어요",
    subtitle: "주변 탭에서 🍼 를 누르면 보여요 · 아빠가 들어갈 수 있는 곳도 표시돼요",
    link: "map.html",
    createdAt: "2026-09-02T10:00:00+09:00",
  },
];

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

  const featureNotices = FEATURE_NOTICES.map((notice) => ({ ...notice, type: "feature" }));

  return [...featureNotices, ...eventNotices, ...newPlaceNotices]
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

// 언제 있었던 일인지 알려 준다.
//
// 소식이 다섯 줄 쌓이면 어느 것이 오늘 것이고 어느 것이 지난주 것인지 구분이 안 돼서,
// 이미 본 것을 또 눌러 보게 된다. 갓 올라온 것은 "방금"처럼 읽고, 오래된 것은 날짜로
// 보여준다 — "12일 전"보다 "8월 21일"이 머리에 남는다.
function noticeWhen(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const mins = Math.floor((Date.now() - at.getTime()) / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return `${at.getMonth() + 1}월 ${at.getDate()}일`;
}

function noticeItemHtml(notice) {
  // 기능 소식은 배지를 달아 장소 알림과 구분한다.
  const badge = notice.type === "feature"
    ? `<span class="notices-panel__badge">새 기능</span>`
    : "";
  const when = noticeWhen(notice.createdAt);
  const inner = `
    <p class="notices-panel__item-title">${badge}${escapeHtml(notice.title)}</p>
    ${notice.subtitle ? `<p class="notices-panel__item-sub">${escapeHtml(notice.subtitle)}</p>` : ""}
    ${when ? `<p class="notices-panel__item-when">${escapeHtml(when)}</p>` : ""}
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
    const data = await fetchJson("/api/places");
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
  renderPlacesWhenReady();
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
    // 기다리던 첫 렌더가 있으면 여기서 끝낸다 — 이제 날씨까지 반영해 한 번에 그린다.
    firstPlaceRenderDone = true;
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
  // 지도는 검색 중에도 남겨둔다. 결과가 검색창 바로 밑에 오면서 지도는 그
  // 아래로 밀려났고, 검색어를 지웠을 때 지도가 없다가 다시 생기면 보던 자리가
  // 그만큼 흔들린다. 검색으로 좁힌 뒤 지역으로 한 번 더 좁히기도 편하다.
  document.getElementById("region-section").hidden = false;
}

// 홈은 페이지가 뜰 때 한 번만 데이터를 부른다. 그래서 앱을 백그라운드에 두었다가
// 다시 열면 어제 배너와 어제 목록이 그대로 보였다 — 배너를 갈아끼우거나 장소를
// 공개해도 사용자가 직접 새로고침해야 반영됐다.
//
// 화면이 다시 보이는 순간 다시 부른다. 엣지 캐시가 60초라 서버 부담은 거의 없지만,
// 탭을 자주 오가는 사람이 매번 네 개를 부르지 않도록 최소 간격을 둔다.
const REFRESH_MIN_GAP_MS = 30000;
let lastLoadedAt = 0;

function loadHomeData() {
  lastLoadedAt = Date.now();
  Promise.all([loadBanners(), loadPlaces()]).then(renderBellBadge);
  // 장소 로딩과 독립적으로 돈다 — 날씨가 늦거나 실패해도 목록은 그대로 뜬다.
  loadTodayWeather();
  // 후기도 마찬가지다. 없으면 별점만 안 보일 뿐이다.
  loadReviewStats();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - lastLoadedAt < REFRESH_MIN_GAP_MS) return;
  loadHomeData();
});

document.addEventListener("DOMContentLoaded", () => {
  renderRegionMap();
  renderRegionLegend();
  renderFestivals();
  renderCategoryFilter();
  initNoticesBell();
  initShareButton();

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    state.showAll = false;
    // 치고 있는 검색창을 기준으로 잡는다 — 위의 배너가 사라지고 결과가 아래에
    // 붙는 동안에도 입력칸이 눈앞에 그대로 있어야 한다.
    keepAnchor(document.querySelector(".search"), () => {
      updateSearchModeUI();
      renderPlaces();
      placeResults();
    });
  });

  loadHomeData();
});
