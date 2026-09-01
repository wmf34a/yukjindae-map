// 홈에서 "아직 지도에 없는 좋은 곳"을 추천받는다.
//
// 기존 제보(place.js + report.js)는 이미 등록된 장소의 정보를 고치는 것이라 placeId가
// 필요하지만, 여기서는 아직 DB에 없는 곳을 받으므로 장소 이름과 이유만 받는다.
// 서버는 이 값을 장소 DB가 아니라 제보 DB에 남기고, 운영자가 읽고 판단해 직접 등록한다.

let widgetId = null;
let token = "";
// 사람 확인을 끝낼 방법이 없다고 판단된 상태. 광고 차단이 challenges.cloudflare.com
// 을 막으면 Turnstile 스크립트가 아예 안 실려 토큰을 영영 못 받는데, 그때 버튼을
// 계속 잠가 두면 그 사람은 추천을 못 한다.
let turnstileUnavailable = false;

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

function updateSubmitState() {
  const btn = el("suggest-submit");
  if (!btn) return;
  const ready = hasSiteKey();
  const filled = el("suggest-name").value.trim() && el("suggest-value").value.trim();
  // 사람 확인이 끝났거나, 끝낼 방법이 없는 것이 확인된 경우 둘 다 보낼 수 있다.
  const canSend = Boolean(token) || turnstileUnavailable;
  btn.disabled = !filled || !ready || !canSend;
  btn.textContent = ready ? "추천하기" : "추천 기능을 준비 중이에요";
}

// 인증을 못 불러왔을 때. 버튼을 잠가 두는 대신 이유를 알려주고 보낼 수 있게 한다.
// 서버는 확인 없는 제보를 좁은 허용량으로 따로 받고 알림에 표시한다.
function showTurnstileLoadError() {
  const errorEl = el("suggest-error");
  if (!errorEl) return;
  turnstileUnavailable = true;
  updateSubmitState();
  errorEl.innerHTML =
    '<span class="report-modal__hint">보안 인증을 불러오지 못했지만 추천은 보내실 수 있어요. ' +
    '<a href="#" id="suggest-turnstile-retry">다시 시도</a></span>';
  errorEl.hidden = false;
  const retryLink = el("suggest-turnstile-retry");
  if (retryLink) {
    // 재시도할 때마다 innerHTML로 링크가 새로 만들어지므로 onclick으로 덮어쓴다.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- 위 주석 참고
    retryLink.onclick = (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      turnstileUnavailable = false;
      updateSubmitState();
      renderTurnstile();
    };
  }
}

// Turnstile 스크립트가 async라 모달을 열 때 아직 안 붙어 있을 수 있다. 느린 회선까지
// 감안해 15초쯤 기다렸다가, 그래도 없으면 안내를 띄우고 보낼 수 있게 풀어 준다.
function renderTurnstile(retries = 50) {
  if (!hasSiteKey()) return updateSubmitState();
  if (!window.turnstile) {
    if (retries > 0) {
      setTimeout(() => renderTurnstile(retries - 1), 300);
      return;
    }
    showTurnstileLoadError();
    return;
  }
  if (widgetId !== null) {
    window.turnstile.reset(widgetId);
    token = "";
    return updateSubmitState();
  }
  widgetId = window.turnstile.render("#suggest-turnstile", {
    sitekey: siteKey(),
    callback: (t) => {
      token = t;
      updateSubmitState();
    },
    "expired-callback": () => {
      token = "";
      updateSubmitState();
    },
    "error-callback": () => {
      widgetId = null;
      showTurnstileLoadError();
    },
  });
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
  if (turnstileUnavailable) {
    // 이미 인증을 못 불러온다고 판단된 상태다. 안내를 지우면 인증 위젯이 없는
    // 이유를 알 수 없으므로 그대로 두고 다시 띄운다.
    showTurnstileLoadError();
  } else {
    el("suggest-error").hidden = true;
    renderTurnstile();
  }
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
