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
// URL 속성값이 그대로 링크가 되는 걸 막기 위함. 노션 "링크" 필드에 "공식 홈페이지
// https://..." 처럼 라벨이 앞에 붙은 값이 수동 입력돼 있는 경우가 있어, 문자열
// 전체가 아니라 그 안에서 http(s) URL만 추출한다 — 전체를 그대로 넘기면 절대 URL로
// 파싱이 안 돼 우리 사이트 자신을 기준으로 한 상대경로로 잘못 해석돼버린다.
function safeHref(url) {
  if (!url) return "";
  const match = String(url).match(/https?:\/\/\S+/);
  if (!match) return "";
  try {
    const parsed = new URL(match[0]);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

// 앱인토스 미니앱 번들은 *.tossmini.com 오리진에서 실행되지만 API와 이미지는 그대로
// Cloudflare Worker가 서빙한다 — 그래서 미니앱에서만 절대경로가 필요하다. 웹
// (workers.dev)에서는 같은 오리진이라 빈 문자열로 두고 기존 상대경로를 유지한다.
const API_ORIGIN = globalThis.location?.hostname.endsWith(".tossmini.com")
  ? "https://yukjindae-map.wmf34a.workers.dev"
  : "";

function apiUrl(path) {
  const value = String(path ?? "");
  return API_ORIGIN && value.startsWith("/") && !value.startsWith("//") ? API_ORIGIN + value : value;
}

// img src 전용. 우리 이미지는 R2 미러링 결과라 "/images/..." 상대경로로 오고,
// 장소 사진은 외부 https URL로 오는 경우도 있어서 safeHref(http(s) 전용)로는
// 상대경로가 전부 걸러진다. 같은 출처 절대경로와 http(s)만 허용하고 javascript:,
// data: 등 나머지 스킴은 빈 문자열로 떨군다.
function safeImageSrc(url) {
  const value = String(url ?? "").trim();
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return apiUrl(value);
  return safeHref(value);
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

// 브라우저 fetch도 기본 타임아웃이 없다 — 네트워크가 불안정한 이동 중(주 사용
// 상황)에 응답이 안 오면 "불러오는 중..."에서 영영 멈춘다. 공통 래퍼로 10초에
// 끊어서 각 화면의 catch가 에러 문구를 띄우게 한다.
const FETCH_TIMEOUT_MS = 10000;

function fetchJson(url, options = {}) {
  return fetch(apiUrl(url), { ...options, signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS) }).then(
    (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
  );
}

window.escapeHtml = escapeHtml;
window.safeHref = safeHref;
window.safeImageSrc = safeImageSrc;
window.festivalDday = festivalDday;
window.fetchJson = fetchJson;
window.apiUrl = apiUrl;
