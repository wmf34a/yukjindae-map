if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("서비스워커 등록 실패:", err);
    });
  });
}

const DISMISS_KEY = "installPopupDismissedDate";

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.querySelector(".install-popup-overlay")?.remove();
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function buildAndroidContent() {
  const wrap = document.createElement("div");
  wrap.className = "install-popup__body";
  wrap.innerHTML = `
    <button class="install-popup__install" type="button">홈 화면에 설치하기</button>
    <p class="install-popup__note install-popup__note--hidden">
      이 브라우저에서는 자동 설치를 지원하지 않아요. 메뉴에서 '홈 화면에 추가'를 선택해주세요.
    </p>
  `;

  wrap.querySelector(".install-popup__install").addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      wrap.querySelector(".install-popup__note").classList.remove("install-popup__note--hidden");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    closePopup();
  });

  return wrap;
}

function buildIOSContent() {
  const wrap = document.createElement("div");
  wrap.className = "install-popup__body";
  wrap.innerHTML = `
    <ol class="install-popup__steps">
      <li class="install-popup__step">
        <span class="install-popup__step-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 16V4" />
            <path d="M7 8l5-5 5 5" />
            <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
          </svg>
        </span>
        <span class="install-popup__step-text">Safari 하단의 <b>공유 버튼</b>을 눌러주세요</span>
      </li>
      <li class="install-popup__step">
        <span class="install-popup__step-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="M12 8v8" />
            <path d="M8 12h8" />
          </svg>
        </span>
        <span class="install-popup__step-text">아래에서 <b>홈 화면에 추가</b>를 선택해주세요</span>
      </li>
    </ol>
  `;
  return wrap;
}

function closePopup() {
  document.querySelector(".install-popup-overlay")?.remove();
}

function showInstallPopup() {
  if (document.querySelector(".install-popup-overlay")) return;

  const overlay = document.createElement("div");
  overlay.className = "install-popup-overlay";
  overlay.innerHTML = `
    <div class="install-popup" role="dialog" aria-modal="true" aria-label="앱 설치 안내">
      <button class="install-popup__close" type="button" aria-label="닫기">✕</button>
      <img class="install-popup__logo" src="/assets/logo/character-logo.svg" alt="육진대" />
      <p class="install-popup__title">육진대 맵을 홈 화면에 추가해보세요</p>
      <p class="install-popup__desc">앱처럼 빠르게, 언제든 한 번에 접속할 수 있어요</p>
    </div>
  `;

  const card = overlay.querySelector(".install-popup");
  card.appendChild(isIOS() ? buildIOSContent() : buildAndroidContent());

  const footer = document.createElement("div");
  footer.className = "install-popup__footer";
  footer.innerHTML = `<button class="install-popup__dismiss-today" type="button">오늘 하루 보지 않기</button>`;
  card.appendChild(footer);

  document.body.appendChild(overlay);

  overlay.querySelector(".install-popup__close").addEventListener("click", closePopup);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closePopup();
  });
  overlay.querySelector(".install-popup__dismiss-today").addEventListener("click", () => {
    localStorage.setItem(DISMISS_KEY, todayString());
    closePopup();
  });
}

window.addEventListener("load", () => {
  if (isStandalone()) return;
  if (localStorage.getItem(DISMISS_KEY) === todayString()) return;
  setTimeout(showInstallPopup, 800);
});
