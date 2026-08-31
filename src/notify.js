// 슬랙으로 알림을 보낸다. 배포·수집 결과를 사람에게 알리는 유일한 통로다.
//
// 축제 수집과 예약 수집이 같이 쓴다. worker.js 에만 있던 시절에는 다른 모듈로
// 뺀 코드가 이 함수를 못 써서 다시 worker.js 로 돌아가야 했다.
import { fetchWithTimeout } from "./http.js";

// SLACK_WEBHOOK_URL이 없으면(로컬 등) 조용히 건너뛴다. 알림 실패가 원래 하려던
// 작업(노션 등록 등)을 막을 이유는 없으므로 에러도 조용히 무시한다.
export async function notifySlack(env, text) {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetchWithTimeout(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // 무시 — 위 주석 참고.
  }
}
