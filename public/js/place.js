function row(label, value) {
  if (!value) return "";
  return `
    <div class="place-detail__section">
      <p class="place-detail__label">${escapeHtml(label)}</p>
      <p class="place-detail__value">${escapeHtml(value)}</p>
    </div>
  `;
}

const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 180; // 6개월

function verifiedBadgeHtml(place) {
  if (!place.verifiedStatus) return "";
  const stale = place.verifiedAt && Date.now() - new Date(place.verifiedAt).getTime() > STALE_AFTER_MS;
  const label = stale ? "재확인 필요" : place.verifiedStatus;
  const tone = stale ? "stale" : place.verifiedStatus === "확인됨" ? "verified" : "hint";
  return `<span class="place-detail__status-badge place-detail__status-badge--${tone}">${escapeHtml(label)}</span>`;
}

// 응애여지도처럼 이모지+텍스트를 그냥 나열하던 것에서, 아이콘을 원형 배지로
// 분리해 한눈에 훑어보기 쉽게 바꾼다.
function amenityChipHtml(icon, label) {
  return `<span class="place-detail__amenity"><span class="place-detail__amenity-icon">${icon}</span>${escapeHtml(label)}</span>`;
}

// 공식 사이트로 나가는 줄. 정보출처와 다르다 — 정보출처는 우리가 값을 어디서
// 얻었는지(절반이 블로그 글)이고, 이건 그 장소가 직접 운영하는 곳이다.
// 요금·휴관은 수시로 바뀌므로 원본으로 가는 길을 열어 둔다.
function officialLinkHtml(place) {
  const href = safeHref(place.officialUrl);
  if (!href) return "";
  return `<a class="place-detail__official" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">🔗 공식 사이트에서 확인하기 ↗</a>`;
}

function sourceLinkHtml(place) {
  const href = safeHref(place.sourceUrl);
  if (!href) return "";
  return `<a class="place-detail__source-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">정보 출처 ↗</a>`;
}

// 괄호 부가설명(예: "(대형키즈룸완비)", "(주소, 아기 식사 무료)")은 검색어에서
// 제거한다 — 검색 매칭을 방해해서 정상 업체도 못 찾는 경우가 있었다.
function stripParenthetical(value) {
  return String(value ?? "").replace(/[(（][^)）]*[)）]/g, "").trim();
}

// course.js도 근처맛집/근처카페 텍스트에서 코스 핀용 검색어를 뽑아낼 때 이 정리
// 로직을 그대로 써야 해서 전역으로 노출해둔다.
window.stripParenthetical = stripParenthetical;

// 여러 곳이 적혀 있으면 맨 앞을 대표로 보여주고 나머지는 접는다. 예전에는 전체를
// 한 줄에 늘어놨는데, 길어서 읽기 나쁜 데다 길찾기 버튼도 안 붙었다 — 값에 쉼표가
// 있으면 통째로 검색 불가로 판정했기 때문이다. 이제 대표 한 곳을 정한 뒤 괄호
// 설명만 걷어내면 그게 곧 검색어라, 별도 판정 없이 항상 길찾기를 붙일 수 있다.
function nearbyRow(label, value, origin) {
  if (!value) return "";
  const items = window.splitNearbyList(value);
  const primary = items[0] || value;
  const rest = items.slice(1);

  const query = stripParenthetical(primary);
  // 장소 좌표를 함께 심어 두면, 같은 상호의 다른 지점이 아니라 이 근처가 잡힌다.
  const coords = origin && typeof origin.lat === "number" && typeof origin.lng === "number"
    ? ` data-origin-lat="${origin.lat}" data-origin-lng="${origin.lng}"`
    : "";
  const navSlot = query
    ? `<span class="place-detail__nav-slot" data-biz-query="${encodeURIComponent(query)}"${coords}></span>`
    : "";
  const more = rest.length
    ? `<details class="place-detail__nearby-more">
        <summary>다른 ${rest.length}곳 더보기</summary>
        <ul>${rest.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </details>`
    : "";
  return `
    <div class="place-detail__section">
      <p class="place-detail__label">${escapeHtml(label)}</p>
      <p class="place-detail__value place-detail__value--row">
        <span>${escapeHtml(primary)}</span>
        ${navSlot}
      </p>
      ${more}
    </div>
  `;
}

async function loadNearbyNav(slot) {
  const q = decodeURIComponent(slot.dataset.bizQuery);
  try {
    // 좌표를 같이 넘겨야 같은 상호의 다른 지점이 아니라 이 장소 근처가 잡힌다.
    const lat = slot.dataset.originLat;
    const lng = slot.dataset.originLng;
    const near = lat && lng ? `&lat=${lat}&lng=${lng}` : "";
    const data = await fetchJson(`/api/nearby-place?q=${encodeURIComponent(q)}${near}`);
    if (!data.found) {
      slot.remove();
      return;
    }
    const href = naverDirectionsUrl({
      lat: data.lat, lng: data.lng, name: data.name, address: data.address,
    });
    slot.outerHTML = `<a class="place-detail__nav-btn" target="_blank" rel="noopener" href="${escapeHtml(href)}">길찾기</a>`;
  } catch (err) {
    console.error(err);
    slot.remove();
  }
}

function render(place) {
  const el = document.getElementById("place-detail");
  document.title = `${place.name} | 육진대`;

  // safeImageSrc를 거쳐야 미니앱(다른 오리진)에서도 이미지가 뜬다 — 여기만
  // 빠져 있었다.
  const hero = place.image
    ? `<figure class="place-detail__hero-wrap">
        <img class="place-detail__hero" src="${escapeHtml(safeImageSrc(place.image))}" alt="${escapeHtml(place.name)}" />
        ${place.photoCredit ? `<figcaption class="place-detail__photo-credit">사진 ${escapeHtml(place.photoCredit)}</figcaption>` : ""}
      </figure>`
    // 사진이 없다고 자리를 통째로 비우면 상단이 무너져 다른 장소와 다른 화면처럼
    // 보인다. 남의 시설 사진을 대신 넣지는 않는다 — 청주랜드 기후변화체험교육관에
    // 같은 부지의 어린이체험관 사진을 넣으면 다른 건물을 보여주는 것이 된다.
    : `<div class="place-detail__hero place-detail__hero--empty">
        <span>사진을 준비하고 있어요</span>
      </div>`;

  const tags = [place.region, ...(place.categories || [])]
    .filter(Boolean)
    .map((t) => `<span class="place-detail__tag">${escapeHtml(t)}</span>`)
    .join("");

  const amenities = [];
  if (place.diaperChange) amenities.push(amenityChipHtml("🚼", "기저귀교환대"));
  if (place.nursingRoom) amenities.push(amenityChipHtml("🤱", "수유실"));
  if (place.kidsChair) amenities.push(amenityChipHtml("🪑", "유아의자"));
  const amenitiesHtml = amenities.length
    ? `<div class="place-detail__section">
        <p class="place-detail__label">유아 편의시설 ${verifiedBadgeHtml(place)}</p>
        <div class="place-detail__amenities">${amenities.join("")}</div>
        ${sourceLinkHtml(place)}
      </div>`
    : "";

  // 진행 중인 할인·이벤트. 종료일이 지나면 activeEvent가 null을 주므로 자동으로 사라진다.
  const event = window.activeEvent(place);
  const eventHtml = event
    ? `<div class="place-detail__section place-detail__event">
        <p class="place-detail__label">🎟 진행 중인 혜택</p>
        <p class="place-detail__value">${escapeHtml(event.info)}</p>
        <p class="place-detail__event-meta">${escapeHtml(event.end)}까지${
          safeHref(event.source)
            ? ` · <a href="${escapeHtml(safeHref(event.source))}" target="_blank" rel="noopener">출처 ↗</a>`
            : ""
        }</p>
      </div>`
    : "";

  let parking = "";
  if (place.parkingAvailable || place.parkingDetail) {
    parking = [place.parkingAvailable, place.parkingDetail].filter(Boolean).join(" · ");
  }

  el.innerHTML = `
    ${hero}
    <div class="place-detail__body">
      <div class="place-detail__name-row">
        <h1 class="place-detail__name">${escapeHtml(place.name)}</h1>
        ${favoriteButtonHtml(place.id, "place-detail__favorite-btn")}
      </div>
      <div class="place-detail__tags">${tags}</div>
      ${officialLinkHtml(place)}

      ${row("📍 주소", place.address)}
      ${row("⏰ 운영시간", place.hours)}
      ${row("💰 입장료", place.fee)}
      ${row("👶 무료입장 연령", place.freeAgePolicy)}
      ${row("✏️ 추천 이유", place.reason)}
      ${row("🅿️ 주차", parking)}
      ${amenitiesHtml}
      <!-- 가까운 수유실이 뒤늦게 도착해 들어갈 자리. 자리를 미리 비워 두지 않으면
           편의시설 칸이 없는 장소(청주랜드 등)에서 갈 곳을 잃고 길찾기 버튼
           아래로 밀려나 화면이 깨졌다. -->
      <div id="nursing-slot"></div>
      <div id="toilet-slot"></div>
      <div id="review-slot"></div>
      ${eventHtml}
      ${nearbyRow("🍴 근처 맛집", place.nearbyRestaurant, place)}
      ${nearbyRow("☕ 근처 카페", place.nearbyCafe, place)}

      <div class="place-detail__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="${escapeHtml(naverDirectionsUrl(place))}">네이버지도 길찾기</a>
        <button type="button" class="btn-secondary" id="course-btn">코스보기</button>
      </div>
      <button type="button" class="place-detail__report-link" id="report-btn">잘못된 정보가 있나요? 제보하기</button>
    </div>
  `;

  el.querySelectorAll(".place-detail__nav-slot[data-biz-query]").forEach(loadNearbyNav);
  bindFavoriteButtons(el);

  document.getElementById("course-btn").addEventListener("click", () => {
    window.openCourseModal(place);
  });
  document.getElementById("report-btn").addEventListener("click", () => {
    window.openReportModal(place);
  });
}

// 한 곳을 보려고 목록 전체(195곳·69KB)를 받던 자리다. 이제 그 장소만 읽는다.
//
// 목록으로 되돌아가는 길은 남겨 둔다 — 앱인토스 미니앱은 public/ 의 스냅샷을
// 올리는 구조라, 새 엔드포인트를 모르는 옛 번들이 한동안 돌아다닌다. 반대로
// 워커가 먼저 바뀌어도 옛 번들이 깨지면 안 되므로 양쪽을 다 살려 둔다.
async function loadPlace(id) {
  try {
    const data = await fetchJson(`/api/places/${encodeURIComponent(id)}`);
    if (data && data.place) return data.place;
  } catch {
    // 아래 목록 조회로 넘어간다.
  }
  const data = await fetchJson("/api/places");
  return (data.places || []).find((p) => p.id === id) || null;
}

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  const el = document.getElementById("place-detail");
  if (!id) {
    el.innerHTML = `<p class="place-list__empty">장소 정보를 찾을 수 없어요.</p>`;
    return;
  }
  try {
    const place = await loadPlace(id);
    if (!place) {
      el.innerHTML = `<p class="place-list__empty">장소 정보를 찾을 수 없어요.</p>`;
      return;
    }
    render(place);
    // 지도를 열지 않아도 이 장소의 수유실이 아빠도 들어갈 수 있는 곳인지 알 수
    // 있어야 한다. 상세를 먼저 그리고 뒤따라 붙인다 — 공공데이터를 기다리느라
    // 화면이 늦게 뜨면 안 된다.
    renderNearbyNursing(place).catch((err) => console.error(err));
    renderNearbyToilets(place).catch((err) => console.error(err));
    window.renderReviews(place).catch((err) => console.error(err));

    // 오류 신고 폼은 홈에 있는데 화면이 깨지는 곳은 대개 상세다. 마지막으로 본
    // 장소를 남겨 두면 신고에 저절로 따라붙어 되묻지 않아도 된다.
    try {
      sessionStorage.setItem("last-place", `${place.name} (${place.id})`);
    } catch { /* 저장소를 막아둔 브라우저 — 없어도 상세는 온전하다 */ }
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
  }
}

// 이 장소에 딸린 수유실을 찾아 붙인다.
//
// 우리 DB의 "수유실" 표시는 있다/없다뿐이라 아빠가 들어갈 수 있는지를 모른다.
// 그건 수유실 명부에만 있어서, 좌표로 근처를 뒤져 가져온다.
//
// 250m 로 잡는다. 같은 건물이나 같은 부지에 있는 것만 이 장소의 수유실이라고
// 말할 수 있고, 그보다 멀면 옆 건물 것을 이 장소 것처럼 보여주게 된다.
const NURSING_RADIUS_M = 250;

async function renderNearbyNursing(place) {
  if (!place.lat || !place.lng) return;
  const pad = 0.004; // 위도 기준 약 440m — 반경보다 넉넉히 받아 거리로 다시 거른다
  const query = new URLSearchParams({
    minLat: place.lat - pad, maxLat: place.lat + pad,
    minLng: place.lng - pad, maxLng: place.lng + pad,
  });

  let rooms = [];
  try {
    const data = await fetchJson(`/api/nursing-rooms?${query}`);
    rooms = data.rooms || [];
  } catch {
    return; // 못 불러오면 조용히 넘어간다. 없어도 상세는 온전하다.
  }

  const near = rooms
    .map((room) => ({ room, m: Math.round(window.distanceKm(place, room) * 1000) }))
    .filter((x) => x.m <= NURSING_RADIUS_M)
    .toSorted((a, b) => a.m - b.m)
    .slice(0, 3);
  if (near.length === 0) {
    document.getElementById("nursing-slot")?.remove();
    return;
  }

  const rowsHtml = near.map(({ room, m }) => `
    <div class="nursing-near__item">
      <p class="nursing-near__name">
        ${escapeHtml(room.name)}
        <span class="nursing-near__dist">${m}m</span>
      </p>
      <p class="nursing-father nursing-father--${room.fatherAllowed ? "yes" : "no"}">
        ${room.fatherAllowed ? "👨‍👧 아빠도 들어갈 수 있어요" : "🚻 여성 전용일 수 있어요"}
      </p>
      ${room.place ? `<p class="nursing-near__where">📍 ${escapeHtml(room.place)}</p>` : ""}
      ${room.tel ? `<p class="nursing-near__where">☎️ <a href="tel:${escapeHtml(window.formatTel(room.tel).replace(/-/g, ""))}">${escapeHtml(window.formatTel(room.tel))}</a></p>` : ""}
    </div>
  `).join("");

  const section = document.createElement("div");
  section.className = "place-detail__section";
  section.innerHTML = `
    <p class="place-detail__label">🍼 가까운 수유실</p>
    <div class="nursing-near">${rowsHtml}</div>
    <p class="place-detail__source">수유정보 알리미 등 공공데이터 · 실제와 다를 수 있어요</p>
  `;

  // 편의시설 칸 바로 뒤 — 기저귀교환대·수유실을 보고 나서 자연스럽게 읽힌다.
  // 편의시설이 없는 장소에도 같은 자리가 비어 있어서 순서가 흔들리지 않는다.
  const slot = document.getElementById("nursing-slot");
  if (slot) slot.replaceWith(section);
}

// 기저귀교환대가 있는 공중화장실.
//
// 수유실과 따로 그린다. 젖을 먹일 곳과 기저귀를 갈 곳은 같은 자리가 아니고,
// 아이를 데리고 나오면 대개 둘 다 필요하다. 여기서도 아빠가 갈 수 있는지를
// 먼저 말해 준다 — 전국 기저귀교환대의 절반 이상이 여자화장실에만 있다.
async function renderNearbyToilets(place) {
  if (!place.lat || !place.lng) return;
  const pad = 0.004;
  const query = new URLSearchParams({
    minLat: place.lat - pad, maxLat: place.lat + pad,
    minLng: place.lng - pad, maxLng: place.lng + pad,
  });

  let rooms = [];
  try {
    const data = await fetchJson(`/api/toilets?${query}`);
    rooms = data.rooms || [];
  } catch {
    return;
  }

  const near = rooms
    .map((room) => ({ room, m: Math.round(window.distanceKm(place, room) * 1000) }))
    .filter((x) => x.m <= NURSING_RADIUS_M)
    .toSorted((a, b) => a.m - b.m)
    .slice(0, 3);
  const slot = document.getElementById("toilet-slot");
  if (near.length === 0) {
    if (slot) slot.remove();
    return;
  }

  const rowsHtml = near.map(({ room, m }) => `
    <div class="nursing-near__item">
      <p class="nursing-near__name">
        ${escapeHtml(room.name)}
        <span class="nursing-near__dist">${m}m</span>
      </p>
      <p class="nursing-father nursing-father--${room.dad ? "yes" : "no"}">
        ${room.dad ? "👨‍👧 남자화장실에도 있어요" : "🚻 여자화장실에만 있어요"}
      </p>
      ${room.hours ? `<p class="nursing-near__where">⏰ ${escapeHtml(room.hours)}</p>` : ""}
      ${room.tel ? `<p class="nursing-near__where">☎️ <a href="tel:${escapeHtml(window.formatTel(room.tel).replace(/-/g, ""))}">${escapeHtml(window.formatTel(room.tel))}</a></p>` : ""}
    </div>
  `).join("");

  const section = document.createElement("div");
  section.className = "place-detail__section";
  section.innerHTML = `
    <p class="place-detail__label">🚼 가까운 기저귀교환대</p>
    <div class="nursing-near">${rowsHtml}</div>
    <p class="place-detail__source">공중화장실 표준데이터 · 실제와 다를 수 있어요</p>
  `;
  if (slot) slot.replaceWith(section);
}

document.addEventListener("DOMContentLoaded", init);
