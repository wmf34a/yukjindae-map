function row(label, value) {
  if (!value) return "";
  return `
    <div class="place-detail__section">
      <p class="place-detail__label">${label}</p>
      <p class="place-detail__value">${value}</p>
    </div>
  `;
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
      ${row("🍴 근처 맛집", place.nearbyRestaurant)}
      ${row("☕ 근처 카페", place.nearbyCafe)}
      ${row("등록자", place.registeredBy)}

      <div class="place-detail__actions">
        <a class="btn-primary" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${query}">네이버지도 길찾기</a>
        <a class="btn-secondary" target="_blank" rel="noopener" href="https://map.kakao.com/link/search/${query}">카카오맵</a>
      </div>
    </div>
  `;
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
