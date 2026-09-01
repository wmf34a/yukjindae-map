// 외부 API(노션/네이버/공공데이터/슬랙) 호출용 공통 헬퍼.
//
// Workers의 fetch는 기본 타임아웃이 없어서, 상대 API가 응답을 늦게 주면 그 요청이
// Worker 실행 시간 한도까지 그대로 매달린다 — 사용자에게는 "로딩이 안 끝나는" 화면이
// 되고, 크론에서는 뒤에 있는 작업이 통째로 밀린다. nursing-rooms.js/tourapi.js는
// 이미 AbortSignal.timeout을 쓰고 있었지만 worker.js의 호출부에는 전부 빠져 있어서
// 한곳으로 모았다.
export const DEFAULT_TIMEOUT_MS = 8000;

export function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// 한 번 흔들렸다고 화면을 비우지 않기 위한 재시도.
//
// 장소 목록은 노션을 세 번 연달아 부른다(100개씩 페이지네이션). 그중 하나만
// 타임아웃 나도 목록 전체가 500이 되어 사용자는 빈 화면을 본다 — 오픈 당일 실제로
// 한 번 그랬다. 상대가 잠깐 느린 것과 우리가 잘못 부른 것은 다르게 다뤄야 한다.
//
// 그래서 네트워크 오류와 5xx·429 만 다시 부른다. 4xx 는 다시 불러도 같은 답이
// 오므로 그대로 돌려준다.
export async function fetchWithRetry(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, backoffMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      if (res.status < 500 && res.status !== 429) return res;
      if (attempt === retries) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }
    console.warn(`[retry ${attempt + 1}/${retries}] ${String(url).slice(0, 80)}: ${lastError.message}`);
    await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
  }
  throw lastError;
}

// 상대 API가 준 에러 본문(detail)을 그대로 클라이언트에 내려주면 노션 DB 구조나
// 내부 오류 메시지가 외부에 노출된다. 로그에는 남기고 응답에는 일반화된 문구만
// 담는다.
export function upstreamErrorResponse(message, detail, status = 502) {
  if (detail) console.error(`[upstream ${status}] ${message}:`, String(detail).slice(0, 500));
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function serverErrorResponse(err, message = "서버 오류") {
  console.error(`[server] ${message}:`, err);
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// 노션 페이지/DB ID는 하이픈 유무만 다른 32자리 16진수다. 클라이언트가 준 ID를
// 그대로 `https://api.notion.com/v1/pages/${id}` 같은 URL에 끼워 넣기 전에 형식을
// 확인해서, 경로 조작(`../databases/...`)이나 엉뚱한 호출을 막는다.
export function isNotionId(value) {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{32}$/i.test(value.replace(/-/g, ""));
}
