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
        body: JSON.stringify({ field: "버그제보", value: `${text}\n\n---\n${context()}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "신고를 보내지 못했어요.");
      successEl().hidden = false;
      input().value = "";
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
  });
})();
