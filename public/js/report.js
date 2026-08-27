const REPORT_FIELDS = [
  { value: "기저귀교환대", type: "boolean" },
  { value: "수유실", type: "boolean" },
  { value: "유아의자", type: "boolean" },
  { value: "무료입장연령", type: "text" },
];

let turnstileWidgetId = null;
let turnstileToken = "";
let selectedValue = "";

function fieldType(field) {
  const found = REPORT_FIELDS.find((f) => f.value === field);
  return found ? found.type : "text";
}

/* oxlint-disable no-underscore-dangle -- window.__ENV__은 worker.js가 주입하는 전역 이름 */
function hasTurnstileSiteKey() {
  return Boolean(window.__ENV__ && window.__ENV__.TURNSTILE_SITE_KEY);
}

function updateSubmitState() {
  const btn = document.getElementById("report-submit-btn");
  if (!btn) return;
  const ready = hasTurnstileSiteKey();
  btn.disabled = !selectedValue || !ready || !turnstileToken;
  btn.textContent = ready ? "제보하기" : "제보 기능을 준비 중이에요";
}

function showTurnstileLoadError() {
  const errorEl = document.getElementById("report-error");
  if (!errorEl) return;
  errorEl.innerHTML = '보안 인증을 불러오지 못했어요. <a href="#" id="report-turnstile-retry">다시 시도</a>';
  errorEl.hidden = false;
  const retryLink = document.getElementById("report-turnstile-retry");
  if (retryLink) {
    // 재시도할 때마다 이 함수가 다시 실행되며 링크 엘리먼트도 innerHTML로 새로
    // 만들어지므로, addEventListener 대신 매번 덮어써도 되는 onclick을 쓴다.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- 위 주석 참고
    retryLink.onclick = (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      renderTurnstile();
    };
  }
}

// Turnstile 스크립트는 place.html에서 async로 로드되므로, 모달을 여는 시점에
// 아직 window.turnstile이 없을 수 있다 — 느린 회선이나 확장프로그램 차단으로
// 스크립트 로딩이 오래 걸리는 경우까지 감안해 15초 정도 재시도한 뒤, 그래도
// 안 되면 버튼만 계속 비활성 상태로 두지 않고 이유와 재시도 링크를 보여준다.
function renderTurnstile(retriesLeft = 50) {
  const container = document.getElementById("report-turnstile");
  if (!container || turnstileWidgetId !== null || !hasTurnstileSiteKey()) return;

  if (!window.turnstile) {
    if (retriesLeft <= 0) {
      showTurnstileLoadError();
      return;
    }
    setTimeout(() => renderTurnstile(retriesLeft - 1), 300);
    return;
  }

  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: window.__ENV__.TURNSTILE_SITE_KEY,
    callback: (token) => {
      turnstileToken = token;
      updateSubmitState();
    },
    "expired-callback": () => {
      turnstileToken = "";
      updateSubmitState();
    },
    "error-callback": () => {
      turnstileWidgetId = null;
      showTurnstileLoadError();
    },
  });
}
/* oxlint-enable no-underscore-dangle */

function setField(field) {
  const boolGroup = document.getElementById("report-value-boolean");
  const textInput = document.getElementById("report-value-text");
  selectedValue = "";

  if (fieldType(field) === "boolean") {
    boolGroup.hidden = false;
    textInput.hidden = true;
    boolGroup.querySelectorAll(".report-modal__value-btn").forEach((b) => b.classList.remove("is-selected"));
  } else {
    boolGroup.hidden = true;
    textInput.hidden = false;
    textInput.value = "";
  }
  updateSubmitState();
}

async function submitReport(placeId) {
  const errorEl = document.getElementById("report-error");
  const btn = document.getElementById("report-submit-btn");
  const field = document.getElementById("report-field").value;
  errorEl.hidden = true;
  btn.disabled = true;

  try {
    const res = await fetch(window.apiUrl("/api/reports"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ placeId, field, value: selectedValue, turnstileToken }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorEl.textContent = data.error || "제보에 실패했어요. 잠시 후 다시 시도해주세요.";
      errorEl.hidden = false;
      updateSubmitState();
      return;
    }

    document.querySelector(".report-modal__body").hidden = true;
    document.querySelector(".report-modal__footer").hidden = true;
    document.getElementById("report-success").hidden = false;
  } catch (err) {
    console.error(err);
    errorEl.textContent = "네트워크 오류가 발생했어요.";
    errorEl.hidden = false;
    updateSubmitState();
  }
}

function closeReportModal() {
  const overlay = document.getElementById("report-modal-overlay");
  if (overlay) overlay.classList.remove("is-open");
}

// 모달은 정적 마크업이라 재오픈될 때마다 이 함수가 다시 실행된다. addEventListener를
// 쓰면 재오픈마다 핸들러가 누적되어 제출이 중복 실행되므로, 덮어쓰기가 되는
// onX 할당을 의도적으로 쓴다.
/* oxlint-disable unicorn/prefer-add-event-listener */
window.openReportModal = function openReportModal(place) {
  const overlay = document.getElementById("report-modal-overlay");
  if (!overlay) return;

  document.querySelector(".report-modal__body").hidden = false;
  document.querySelector(".report-modal__footer").hidden = false;
  document.getElementById("report-success").hidden = true;
  document.getElementById("report-error").hidden = true;
  turnstileToken = "";

  const select = document.getElementById("report-field");
  select.onchange = () => setField(select.value);
  setField(select.value);

  document.querySelectorAll(".report-modal__value-btn").forEach((b) => {
    b.onclick = () => {
      selectedValue = b.dataset.value;
      document.querySelectorAll(".report-modal__value-btn").forEach((x) => x.classList.remove("is-selected"));
      b.classList.add("is-selected");
      updateSubmitState();
    };
  });
  document.getElementById("report-value-text").oninput = (e) => {
    selectedValue = e.target.value.trim();
    updateSubmitState();
  };

  document.getElementById("report-submit-btn").onclick = () => submitReport(place.id);
  overlay.querySelector(".report-modal__close").onclick = closeReportModal;

  overlay.classList.add("is-open");
  renderTurnstile();
  updateSubmitState();
};
/* oxlint-enable unicorn/prefer-add-event-listener */
