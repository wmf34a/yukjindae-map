// 소개 페이지 아래에 방문자 수를 적는다.
//
// 헤더에 두자는 이야기도 있었지만, 오픈 직후 숫자가 작을 때 "23명"이 늘 떠 있으면
// 없느니만 못하다. 여기라면 숫자가 작아도 어색하지 않고, 커지면 자랑이 된다.
//
// 세는 것은 홈에서 하고 여기서는 읽기만 한다 — 소개 페이지만 세면 대부분의
// 사용자가 빠져 숫자가 뜻을 잃는다.
async function loadVisitStats() {
  const box = document.getElementById("visit-stats");
  if (!box) return;
  try {
    const data = await fetchJson("/api/visit");
    const today = Number(data.today) || 0;
    const total = Number(data.total) || 0;
    // 아무도 안 다녀간 상태에서 "0명"을 적어 두면 초라하다. 그냥 감춘다.
    if (!total) return;
    const n = (v) => v.toLocaleString("ko-KR");
    box.textContent = today
      ? `오늘 ${n(today)}명 · 지금까지 ${n(total)}명이 다녀갔어요`
      : `지금까지 ${n(total)}명이 다녀갔어요`;
    box.hidden = false;
  } catch (err) {
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", loadVisitStats);
