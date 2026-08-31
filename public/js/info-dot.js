// 목록 제목 옆의 작은 물음표. 누르면 "이 목록이 언제 바뀌는지"를 알려준다.
//
// 홈에 있는 세 목록은 갱신 주기가 서로 다르다. 순위는 달마다, 축제는 주마다,
// 정렬은 날마다 바뀐다. 화면에는 그 사실이 어디에도 안 적혀 있어서, 어제와
// 다르면 고장으로 보이고 지난주와 같으면 죽은 앱으로 보인다.
//
// 문구는 실제 크론 주기에서 가져온 값이다(src/worker.js):
//   MONTHLY_TOP10_CRON  매월 1일   — 지역별 Top 10과 추천 순위
//   FESTIVAL_IMPORT_CRON 매주 일요일 새벽 — 축제 수집
//   축제는 종료일이 지나면 /api/festivals 에서 자동으로 빠진다.
// 물음표를 글자로 넣었더니 어두운 헤더 위에서 깨진 글자처럼 보인다는 제보가
// 있었다. 아이콘 마크업은 여기 한 곳에만 둔다.
window.INFO_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="4.6" r="0.95" fill="currentColor"/><path d="M8 7.2v4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

(function () {
  "use strict";

  var open = null;

  function close() {
    if (!open) return;
    open.pop.remove();
    open.button.setAttribute("aria-expanded", "false");
    open = null;
  }

  function place(button, pop) {
    var rect = button.getBoundingClientRect();
    // 화면 밖으로 나가지 않게 좌우를 물린다. 좁은 폰에서 제목이 오른쪽에
    // 붙어 있으면 말풍선이 잘렸다.
    var width = pop.offsetWidth;
    var left = rect.left + window.scrollX - 8;
    var max = window.scrollX + document.documentElement.clientWidth - width - 12;
    var clamped = Math.max(window.scrollX + 12, Math.min(left, max));
    pop.style.left = clamped + "px";
    pop.style.top = rect.bottom + window.scrollY + 9 + "px";
    // 말풍선이 밀려도 꼬리는 물음표를 가리키게 한다.
    var arrow = rect.left + window.scrollX + rect.width / 2 - clamped - 5;
    pop.style.setProperty("--arrow-left", Math.max(8, Math.min(arrow, width - 18)) + "px");
  }

  function toggle(button) {
    var same = open && open.button === button;
    close();
    if (same) return;

    var pop = document.createElement("div");
    pop.className = "info-pop";
    pop.setAttribute("role", "tooltip");
    pop.textContent = button.dataset.info || "";
    document.body.appendChild(pop);
    place(button, pop);
    button.setAttribute("aria-expanded", "true");
    open = { button: button, pop: pop };
  }

  document.addEventListener("click", function (e) {
    var button = e.target.closest("[data-info]");
    if (button) {
      e.preventDefault();
      toggle(button);
      return;
    }
    if (!e.target.closest(".info-pop")) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  // 스크롤하면 말풍선만 남아 엉뚱한 자리에 뜬다. 따라다니게 하지 않고 닫는다.
  window.addEventListener("scroll", close, { passive: true });
  window.addEventListener("resize", close);
})();
