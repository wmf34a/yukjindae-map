function row(label, value) {
  if (!value) return "";
  return `
    <div class="place-detail__section">
      <p class="place-detail__label">${label}</p>
      <p class="place-detail__value">${value}</p>
    </div>
  `;
}

// 1차 파일럿: 근처맛집/근처카페에 콤마 없이 업체명 하나만 명확히 적힌 경우
// 네이버 지역검색 API로 주소를 끌어와 작은 "길찾기" 버튼을 붙인다.
// 검증 후 대상을 넓힐 예정이라 지금은 특정 장소에만 켜둔다.
const NEARBY_NAV_PILOT_PLACES = new Set(["현대 모터스튜디오 고양"]);

function isSingleBusinessName(value) {
  return Boolean(value) && !value.includes(",") && !value.includes("·");
}

function nearbyRow(label, value, place) {
  if (!value) return "";
  const eligible = NEARBY_NAV_PILOT_PLACES.has(place.name) && isSingleBusinessName(value);
  const navSlot = eligible
    ? `<span class="place-detail__nav-btn" data-biz-query="${encodeURIComponent(value.trim())}"></span>`
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
    if (!data.found) return;
    const query = encodeURIComponent(data.address || data.name);
    slot.outerHTML = `<a class="place-detail__nav-btn" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">길찾기</a>`;
  } catch (err) {
    console.error(err);
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
      <h1 class="place-detail__name">${place.name}</h1>
      <div class="place-detail__tags">${tags}</div>

      ${row("📍 주소", place.address)}
      ${row("⏰ 운영시간", place.hours)}
      ${row("💰 입장료", place.fee)}
      ${row("✏️ 추천 이유", place.reason)}
      ${row("🅿️ 주차", parking)}
      ${amenitiesHtml}
      ${nearbyRow("🍴 근처 맛집", place.nearbyRestaurant, place)}
      ${nearbyRow("☕ 근처 카페", place.nearbyCafe, place)}
      ${row("등록자", place.registeredBy)}

      <div class="place-detail__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">네이버지도 길찾기</a>
        <a class="btn-secondary" target="_blank" rel="noopener" href="https://map.kakao.com/link/search/${query}">카카오맵</a>
      </div>
    </div>
  `;

  el.querySelectorAll(".place-detail__nav-btn[data-biz-query]").forEach(loadNearbyNav);
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
