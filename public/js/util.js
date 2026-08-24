// 노션에서 온 텍스트(장소명/추천이유/제보로 반영된 값 등)를 innerHTML에 꽂기 전에
// 반드시 거쳐야 하는 이스케이프 유틸. 지금은 가족이 직접 입력하지만, 퍼블릭 제보가
// 운영자 승인을 거쳐 같은 필드에 들어오게 되므로 렌더링 시점에 한 번 더 막아둔다.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

// href/src로 쓰기 전에 http(s) 스킴인지 확인한다 — javascript: 같은 스킴으로 된
// URL 속성값이 그대로 링크가 되는 걸 막기 위함.
function safeHref(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

// 축제 카드/상세에 붙이는 디데이 딱지. 시작 전이면 "D-n", 기간 중이면 "진행중",
// periodStart가 없으면 빈 문자열(딱지 없음).
function festivalDday(festival) {
  const start = String(festival?.periodStart || "").slice(0, 10);
  if (!start) return "";
  const end = String(festival?.periodEnd || start).slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  if (todayStr < start) {
    const days = Math.round((new Date(start) - new Date(todayStr)) / 86400000);
    return `D-${days}`;
  }
  if (todayStr <= end) return "진행중";
  return "";
}

window.escapeHtml = escapeHtml;
window.safeHref = safeHref;
window.festivalDday = festivalDday;
