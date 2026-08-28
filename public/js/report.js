// 운영시간·입장료가 틀리면 헛걸음하거나 돈이 어긋난다 — 편의시설 오차보다 훨씬
// 치명적인데 정작 제보할 방법이 없었다. 자유서술 필드로 함께 받는다.
const REPORT_FIELDS = [
  { value: "운영시간", type: "text" },
  { value: "입장료", type: "text" },
  { value: "무료입장연령", type: "text" },
  { value: "주차상세", type: "text" },
  { value: "기저귀교환대", type: "boolean" },
  { value: "수유실", type: "boolean" },
  { value: "유아의자", type: "boolean" },
  // 코스보기가 이 값에서 상호를 읽어 지도에 핀을 찍는다. 지도 API는 어떤 가게가
  // 있는지는 알려줘도 아이랑 가도 되는지는 알려주지 않아서, 다녀온 분께 받는다.
  { value: "근처맛집", type: "text" },
  { value: "근처카페", type: "text" },
];

let turnstileWidgetId = null;
let turnstileToken = "";
let selectedValue = "";
// 모달을 연 장소. 지금 값을 미리 채워 주려면 필요하다.
let reportPlace = null;
// 광고 차단 등으로 Turnstile을 끝내 못 불러온 상태. 그래도 제보는 보낼 수 있어야
// 한다 — 서버가 확인 없는 제보를 좁은 허용량으로 따로 받는다.
let turnstileUnavailable = false;

// 자유서술 필드는 무엇을 적어야 할지 감이 안 오면 빈 채로 닫힌다. 필드마다
// 실제 데이터에 가까운 예시를 보여준다.
const PLACEHOLDERS = {
  "운영시간": "예: 10:00~18:00, 월요일 휴관",
  "입장료": "예: 성인 5,000원 / 어린이 3,000원",
  "무료입장연령": "예: 36개월 미만 무료",
  "주차상세": "예: 2시간 무료, 이후 30분당 1,000원",
  // 상호를 맨 앞에 두어야 코스보기가 지도에서 찾는다.
  "근처맛집": "예: 고메돈까스 (유아의자 있어요)",
  "근처카페": "예: 모모아트 (기저귀갈이대 있음)",
};

function fieldType(field) {
  const found = REPORT_FIELDS.find((f) => f.value === field);
  return found ? found.type : "text";
}

/* oxlint-disable no-underscore-dangle -- window.__ENV__은 worker.js가 주입하는 전역 이름 */
function hasTurnstileSiteKey() {
  return Boolean(window.__ENV__ && window.__ENV__.TURNSTILE_SITE_KEY);
}

// 검수 모드에서는 토큰이 사람 확인을 대신하므로 Turnstile을 기다리지 않는다.
function isReviewMode() {
  return Boolean(window.reviewToken && window.reviewToken());
}

function updateSubmitState() {
  const btn = document.getElementById("report-submit-btn");
  if (!btn) return;
  const ready = isReviewMode() || hasTurnstileSiteKey();
  // 사람 확인이 끝났거나, 끝낼 방법이 없는 것이 확인된 경우 둘 다 보낼 수 있다.
  const canSend = isReviewMode() || Boolean(turnstileToken) || turnstileUnavailable;
  btn.disabled = !selectedValue || !ready || !canSend;
  btn.textContent = ready ? "제보하기" : "제보 기능을 준비 중이에요";
}

function showTurnstileLoadError() {
  const errorEl = document.getElementById("report-error");
  if (!errorEl) return;
  // 예전에는 여기서 제보가 통째로 막혔다. 홈 화면에 설치해 쓰는 사람은 브라우저
  // 설정을 바꾸기도 어려운데, 그 때문에 포기하게 만들 이유가 없다. 이제 그냥
  // 보낼 수 있고, 서버가 확인 없는 제보를 좁은 허용량으로 따로 받는다.
  turnstileUnavailable = true;
  updateSubmitState();
  errorEl.innerHTML =
    '<span class="report-modal__hint">보안 인증을 불러오지 못했지만 제보는 보내실 수 있어요. ' +
    '<a href="#" id="report-turnstile-retry">다시 시도</a></span>';
  errorEl.hidden = false;
  const retryLink = document.getElementById("report-turnstile-retry");
  if (retryLink) {
    // 재시도할 때마다 이 함수가 다시 실행되며 링크 엘리먼트도 innerHTML로 새로
    // 만들어지므로, addEventListener 대신 매번 덮어써도 되는 onclick을 쓴다.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- 위 주석 참고
    retryLink.onclick = (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      // 다시 불러보는 동안에는 확인이 될 수도 있으므로 포기 표시를 되돌린다.
      turnstileUnavailable = false;
      updateSubmitState();
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
  // 검수 모드는 토큰이 사람 확인을 대신하므로 위젯을 띄우지 않는다. 광고 차단으로
  // 스크립트가 안 실리는 브라우저에서도 제보가 막히지 않아야 한다.
  if (isReviewMode()) {
    container.hidden = true;
    updateSubmitState();
    return;
  }

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

// 노션 속성 이름 → 화면이 들고 있는 장소 객체의 키.
const PLACE_KEY = {
  "운영시간": "hours",
  "입장료": "fee",
  "무료입장연령": "freeAgePolicy",
  "주차상세": "parkingDetail",
  "근처맛집": "nearbyRestaurant",
  "근처카페": "nearbyCafe",
};

function currentValue(field) {
  const key = PLACE_KEY[field];
  return key && reportPlace ? String(reportPlace[key] || "") : "";
}

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
    // 제보는 그 칸을 통째로 덮어쓴다. 빈 칸에서 시작하면 "월요일 휴관"만 적어
    // 보내게 되고, 원래 있던 "09:30~17:30"이 사라진다. 지금 값을 채워 두면
    // 고칠 부분만 손보게 된다.
    textInput.value = currentValue(field);
    selectedValue = textInput.value;
    textInput.placeholder = PLACEHOLDERS[field] || "";
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
    // 검수 모드면 토큰을 함께 보낸다 — 광고 차단으로 Turnstile이 안 실려도
    // 검수자는 제보할 수 있어야 한다.
    const res = await fetch(window.apiUrl(window.withReview("/api/reports")), {
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
  reportPlace = place;

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
