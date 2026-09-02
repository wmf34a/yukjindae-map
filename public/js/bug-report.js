// 앱 오류 신고.
//
// 장소 제보는 "데이터가 틀렸다"는 말이고, 이건 "앱이 고장났다"는 말이다. 지금까지
// 후자를 받을 곳이 없어서 인스타 댓글로 흘러들었고, 어느 화면인지 되묻느라
// 왕복이 길었다. 화면 주소·브라우저를 자동으로 붙여 한 번에 받는다.
(function () {
  const overlay = () => document.getElementById("bug-modal-overlay");
  const input = () => document.getElementById("bug-value");
  const submitBtn = () => document.getElementById("bug-submit");
  const errorEl = () => document.getElementById("bug-error");
  const successEl = () => document.getElementById("bug-success");

  // 붙인 화면 캡처(줄여 놓은 data URL). 한 장만 받는다.
  let shot = null;

  // 브라우저에서 줄여 보낸다.
  //
  // 서버에서 다시 그리면 변환 비용이 붙는다(클라우드플레어 Images 는 월 5,000건까지만
  // 무료다). 여기서 줄이면 그 비용이 0이고, 캔버스로 다시 그리는 과정에서 EXIF 가
  // 통째로 사라진다 — 사진에 GPS 와 촬영시각이 남아 있는 것을 그대로 올리지 않게 된다.
  const MAX_EDGE = 1600;

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("사진을 읽지 못했어요."));
      };
      img.src = url;
    });
  }

  function showShot(dataUrl) {
    shot = dataUrl;
    const box = document.getElementById("bug-shot-preview");
    const img = document.getElementById("bug-shot-img");
    const btn = document.getElementById("bug-shot-btn");
    if (dataUrl) {
      img.src = dataUrl;
      box.hidden = false;
      btn.hidden = true;
    } else {
      img.removeAttribute("src");
      box.hidden = true;
      btn.hidden = false;
      const input = document.getElementById("bug-image");
      if (input) input.value = "";
    }
  }

  // 신고할 때 보고 있던 화면. 신고 폼은 홈에 있지만 오류를 만난 화면은 다를 수
  // 있어서, 마지막으로 열었던 상세 화면도 같이 남긴다.
  function context() {
    const parts = [`화면: ${location.pathname}${location.search}`];
    try {
      const last = sessionStorage.getItem("last-place");
      if (last) parts.push(`직전 장소: ${last}`);
    } catch { /* 저장소를 막아둔 브라우저 — 없어도 신고는 받는다 */ }
    parts.push(`브라우저: ${navigator.userAgent.slice(0, 160)}`);
    parts.push(`화면크기: ${window.innerWidth}x${window.innerHeight}`);
    return parts.join("\n");
  }

  function updateState() {
    const btn = submitBtn();
    if (btn) btn.disabled = !input() || !input().value.trim();
  }

  function open() {
    const el = overlay();
    if (!el) return;
    el.classList.add("is-open");
    document.body.style.overflow = "hidden";
    if (successEl()) successEl().hidden = true;
    if (errorEl()) errorEl().hidden = true;
    showShot(null);
    if (submitBtn()) submitBtn().textContent = "신고하기";
    updateState();
    setTimeout(() => input() && input().focus(), 50);
  }

  function close() {
    const el = overlay();
    if (!el) return;
    el.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  async function submit() {
    const btn = submitBtn();
    const text = input().value.trim();
    if (!text) return;
    btn.disabled = true;
    btn.textContent = "보내는 중...";
    errorEl().hidden = true;
    try {
      const res = await fetch(window.apiUrl("/api/reports"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          field: "버그제보",
          value: `${text}\n\n---\n${context()}`,
          ...(shot ? { image: shot } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "신고를 보내지 못했어요.");
      successEl().hidden = false;
      input().value = "";
      showShot(null);
      btn.textContent = "보냈어요";
      setTimeout(close, 1400);
    } catch (err) {
      errorEl().textContent = err.message;
      errorEl().hidden = false;
      btn.disabled = false;
      btn.textContent = "신고하기";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const openBtn = document.getElementById("bug-btn");
    if (openBtn) openBtn.addEventListener("click", open);
    const closeBtn = document.getElementById("bug-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (overlay()) overlay().addEventListener("click", (e) => { if (e.target === overlay()) close(); });
    if (input()) input().addEventListener("input", updateState);
    if (submitBtn()) submitBtn().addEventListener("click", submit);

    const shotBtn = document.getElementById("bug-shot-btn");
    const fileInput = document.getElementById("bug-image");
    if (shotBtn && fileInput) {
      shotBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          showShot(await shrink(file));
        } catch (err) {
          errorEl().textContent = err.message;
          errorEl().hidden = false;
        }
      });
    }
    const removeBtn = document.getElementById("bug-shot-remove");
    if (removeBtn) removeBtn.addEventListener("click", () => showShot(null));
  });
})();
