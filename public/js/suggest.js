// 홈에서 "아직 지도에 없는 좋은 곳"을 추천받는다.
//
// 기존 제보(place.js + report.js)는 이미 등록된 장소의 정보를 고치는 것이라 placeId가
// 필요하지만, 여기서는 아직 DB에 없는 곳을 받으므로 장소 이름과 이유만 받는다.
// 서버는 이 값을 장소 DB가 아니라 제보 DB에 남기고, 운영자가 읽고 판단해 직접 등록한다.

let widgetId = null;
let token = "";

// 고르지 않은 항목은 아예 보내지 않는다 — "모름"을 "없음"으로 저장하면
// 지도 API도 모르는 정보를 우리가 틀리게 아는 셈이 된다.
const amenities = {};

/* oxlint-disable no-underscore-dangle -- window.__ENV__은 worker.js가 주입하는 전역 이름 */
function hasSiteKey() {
  return Boolean(window.__ENV__ && window.__ENV__.TURNSTILE_SITE_KEY);
}

function siteKey() {
  return window.__ENV__.TURNSTILE_SITE_KEY;
}
/* oxlint-enable no-underscore-dangle */

function el(id) {
  return document.getElementById(id);
}

// 사람 확인 여부는 버튼을 잠그는 조건이 아니다.
//
// 예전에는 토큰이 있어야만 버튼이 켜졌다. 광고 차단이 challenges.cloudflare.com 을
// 막으면 토큰을 영영 못 받으므로, 그 사람에게는 버튼이 끝까지 회색이었고 이유도
// 보이지 않았다. "잠깐 기다렸다 안 되면 풀어 준다"는 식으로 고쳐 봤지만, 기다리는
// 동안 버튼이 잠겨 있는 것은 마찬가지고 타이밍에 따라 안 풀리기도 했다.
//
// 그래서 아예 조건에서 뺀다. 확인이 되면 토큰을 함께 보내고, 안 되면 없이 보낸다.
// 서버가 토큰 유무로 허용량을 나누고(확인 못 거친 제보는 시간당 2건) 알림에 표시하므로
// 남용은 그쪽에서 막는다.
function updateSubmitState() {
  const btn = el("suggest-submit");
  if (!btn) return;
  const filled = el("suggest-name").value.trim() && el("suggest-value").value.trim();
  btn.disabled = !filled;
  btn.textContent = "추천하기";
}

// 위젯은 뜨면 좋고 안 뜨면 그만이다. 못 띄웠다고 화면에 경고를 내밀면, 정작 할 수
// 있는 일(그냥 보내기)을 두고 사용자가 겁을 먹는다.
//
// 스크립트가 async라 모달을 열 때 아직 안 붙어 있을 수 있어 잠깐 다시 시도한다.
// 버튼은 이미 눌러지는 상태라, 이 재시도가 실패해도 사용자가 막히지는 않는다.
function renderTurnstile(retries = 20) {
  if (!hasSiteKey()) return;
  if (!window.turnstile) {
    if (retries > 0) setTimeout(() => renderTurnstile(retries - 1), 300);
    return;
  }
  if (widgetId !== null) {
    window.turnstile.reset(widgetId);
    token = "";
    return;
  }
  try {
    widgetId = window.turnstile.render("#suggest-turnstile", {
      sitekey: siteKey(),
      callback: (t) => {
        token = t;
      },
      "expired-callback": () => {
        token = "";
      },
      "error-callback": () => {
        widgetId = null;
      },
    });
  } catch {
    widgetId = null;
  }
}

function clearAmenities() {
  for (const key of Object.keys(amenities)) delete amenities[key];
  for (const btn of document.querySelectorAll(".suggest-amenity__opt")) {
    btn.classList.remove("is-picked");
    btn.setAttribute("aria-pressed", "false");
  }
}

// 같은 버튼을 다시 누르면 선택이 풀린다 — 잘못 눌렀을 때 "모름"으로 되돌릴
// 방법이 있어야 한다.
function pickAmenity(btn) {
  const row = btn.closest(".suggest-amenity__row");
  const key = row.dataset.key;
  const picked = btn.classList.contains("is-picked");

  for (const sibling of row.querySelectorAll(".suggest-amenity__opt")) {
    sibling.classList.remove("is-picked");
    sibling.setAttribute("aria-pressed", "false");
  }
  if (picked) {
    delete amenities[key];
    return;
  }
  btn.classList.add("is-picked");
  btn.setAttribute("aria-pressed", "true");
  amenities[key] = btn.dataset.value;
}

function openModal() {
  const overlay = el("suggest-modal-overlay");
  overlay.classList.add("is-open");
  el("suggest-success").hidden = true;
  el("suggest-name").value = "";
  el("suggest-value").value = "";
  clearAmenities();
  el("suggest-error").hidden = true;
  renderTurnstile();
  updateSubmitState();
  el("suggest-name").focus();
}

function closeModal() {
  el("suggest-modal-overlay").classList.remove("is-open");
}

async function submit() {
  const btn = el("suggest-submit");
  const error = el("suggest-error");
  error.hidden = true;
  btn.disabled = true;

  try {
    const res = await fetch(window.apiUrl("/api/reports"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        field: "신규장소",
        placeName: el("suggest-name").value.trim(),
        value: el("suggest-value").value.trim(),
        amenities,
        turnstileToken: token,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "잠시 후 다시 시도해주세요.");

    el("suggest-success").hidden = false;
    el("suggest-name").value = "";
    el("suggest-value").value = "";
    clearAmenities();
    setTimeout(closeModal, 1800);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    // 토큰은 한 번 쓰면 무효라 다시 받아야 재시도할 수 있다.
    renderTurnstile();
  } finally {
    updateSubmitState();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const openBtn = el("suggest-btn");
  if (!openBtn) return;

  openBtn.addEventListener("click", openModal);
  el("suggest-close").addEventListener("click", closeModal);
  el("suggest-modal-overlay").addEventListener("click", (e) => {
    if (e.target === el("suggest-modal-overlay")) closeModal();
  });
  el("suggest-submit").addEventListener("click", submit);
  el("suggest-amenities").addEventListener("click", (e) => {
    const btn = e.target.closest(".suggest-amenity__opt");
    if (btn) pickAmenity(btn);
  });
  el("suggest-name").addEventListener("input", updateSubmitState);
  el("suggest-value").addEventListener("input", updateSubmitState);
});
