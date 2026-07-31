function row(label, value) {
  if (!value) return "";
  return `
    <div class="place-detail__section">
      <p class="place-detail__label">${label}</p>
      <p class="place-detail__value">${value}</p>
    </div>
  `;
}

// 근처맛집/근처카페에 콤마 없이 업체명 하나만 명확히 적힌 경우, 네이버 지역검색
// API로 주소를 끌어와 작은 "길찾기" 버튼을 붙인다. 괄호 부가설명(예: "(대형키즈룸완비)")은
// 검색어에서는 제거한다 — 검색 매칭을 방해해서 정상 업체도 못 찾는 경우가 있었다.
function isSingleBusinessName(value) {
  return Boolean(value) && !value.includes(",") && !value.includes("·");
}

function stripParenthetical(value) {
  return value.replace(/[(（][^)）]*[)）]/g, "").trim();
}

// course.js도 근처맛집/근처카페 텍스트에서 코스 핀용 검색어를 뽑아낼 때 이 판별/정리
// 로직을 그대로 써야 해서 전역으로 노출해둔다.
window.isSingleBusinessName = isSingleBusinessName;
window.stripParenthetical = stripParenthetical;

function nearbyRow(label, value) {
  if (!value) return "";
  const eligible = isSingleBusinessName(value);
  const query = stripParenthetical(value) || value;
  const navSlot = eligible
    ? `<span class="place-detail__nav-slot" data-biz-query="${encodeURIComponent(query)}"></span>`
    : "";
  return `
    <div class="place-detail__section">
      <p class="place-detail__label">${label}</p>
      <p class="place-detail__value place-detail__value--row">
        <span>${value}</span>
        ${navSlot}
      </p>
    </div>
  `;
}

async function loadNearbyNav(slot) {
  const q = decodeURIComponent(slot.dataset.bizQuery);
  try {
    const res = await fetch(`/api/nearby-place?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.found) {
      slot.remove();
      return;
    }
    const query = encodeURIComponent(data.name || data.address);
    slot.outerHTML = `<a class="place-detail__nav-btn" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">길찾기</a>`;
  } catch (err) {
    console.error(err);
    slot.remove();
  }
}

function render(place) {
  const el = document.getElementById("place-detail");
  document.title = `${place.name} | 육진대 맵`;

  const hero = place.image
    ? `<img class="place-detail__hero" src="${place.image}" alt="${place.name}" />`
    : "";

  const tags = [place.region, ...(place.categories || [])]
    .filter(Boolean)
    .map((t) => `<span class="place-detail__tag">${t}</span>`)
    .join("");

  const amenities = [];
  if (place.strollerAccess) amenities.push(`🍼 유모차 동선 ${place.strollerAccess}`);
  if (place.diaperChange) amenities.push("🍼 기저귀교환대 O");
  if (place.nursingRoom) amenities.push("🍼 수유실 O");
  const amenitiesHtml = amenities.length
    ? `<div class="place-detail__section"><p class="place-detail__label">유아 편의시설</p><div class="place-detail__amenities">${amenities
        .map((a) => `<span class="place-detail__amenity">${a}</span>`)
        .join("")}</div></div>`
    : "";

  let parking = "";
  if (place.parkingAvailable || place.parkingDetail) {
    parking = [place.parkingAvailable, place.parkingDetail].filter(Boolean).join(" · ");
  }

  const query = encodeURIComponent(place.address || place.name);

  el.innerHTML = `
    ${hero}
    <div class="place-detail__body">
      <div class="place-detail__name-row">
        <h1 class="place-detail__name">${place.name}</h1>
        ${favoriteButtonHtml(place.id, "place-detail__favorite-btn")}
      </div>
      <div class="place-detail__tags">${tags}</div>

      ${row("📍 주소", place.address)}
      ${row("⏰ 운영시간", place.hours)}
      ${row("💰 입장료", place.fee)}
      ${row("✏️ 추천 이유", place.reason)}
      ${row("🅿️ 주차", parking)}
      ${amenitiesHtml}
      ${nearbyRow("🍴 근처 맛집", place.nearbyRestaurant)}
      ${nearbyRow("☕ 근처 카페", place.nearbyCafe)}
      ${row("등록자", place.registeredBy)}

      <div class="place-detail__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">네이버지도 길찾기</a>
        <button type="button" class="btn-secondary" id="course-btn">코스보기</button>
      </div>
    </div>
  `;

  el.querySelectorAll(".place-detail__nav-slot[data-biz-query]").forEach(loadNearbyNav);
  bindFavoriteButtons(el);

  document.getElementById("course-btn").addEventListener("click", () => {
    window.openCourseModal(place);
  });
}

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  const el = document.getElementById("place-detail");
  if (!id) {
    el.innerHTML = `<p class="place-list__empty">장소 정보를 찾을 수 없어요.</p>`;
    return;
  }
  try {
    const res = await fetch("/api/places");
    const data = await res.json();
    const place = (data.places || []).find((p) => p.id === id);
    if (!place) {
      el.innerHTML = `<p class="place-list__empty">장소 정보를 찾을 수 없어요.</p>`;
      return;
    }
    render(place);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="place-list__empty">장소 정보를 불러오지 못했어요.</p>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
