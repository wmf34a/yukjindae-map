if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("서비스워커 등록 실패:", err);
    });
  });
}

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (localStorage.getItem("installBannerDismissed") === "1") return;
  showInstallBanner();
});

function showInstallBanner() {
  if (document.querySelector(".install-banner")) return;

  const banner = document.createElement("div");
  banner.className = "install-banner";
  banner.innerHTML = `
    <img class="install-banner__logo" src="/assets/logo/character-logo.svg" alt="" />
    <div class="install-banner__text">
      <p class="install-banner__title">육진대 맵 앱으로 설치하기</p>
      <p class="install-banner__desc">홈 화면에 추가하고 더 빠르게 이용하세요</p>
    </div>
    <button class="install-banner__install" type="button">설치</button>
    <button class="install-banner__close" type="button" aria-label="닫기">✕</button>
  `;
  document.body.appendChild(banner);

  banner.querySelector(".install-banner__install").addEventListener("click", async () => {
    banner.remove();
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  banner.querySelector(".install-banner__close").addEventListener("click", () => {
    localStorage.setItem("installBannerDismissed", "1");
    banner.remove();
  });
}

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.querySelector(".install-banner")?.remove();
});
