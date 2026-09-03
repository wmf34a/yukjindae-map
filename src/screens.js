// 어느 화면을 봤는지 남긴다.
//
// 지금까지는 홈에서만 방문을 셌다. 그래서 하루에 몇 명이 왔는지는 알아도,
// 그 사람이 지도를 열었는지 장소를 눌렀는지 어디서 나갔는지는 전혀 몰랐다.
// 재방문이 2.9%인데 어디서 놓치는지 알 방법이 없었다.
//
// 화면 이름을 화이트리스트로 받는다. 임의 문자열을 그대로 적으면 나중에
// 집계할 때 오타와 장난이 섞여 쓸 수 없는 값이 된다.
export const SCREENS = new Set([
  "home",
  "map",
  "place",
  "course",
  "courses",
  "favorite",
  "festival",
  "festivals",
  "about",
  "privacy",
]);

// 파일 이름과 화면 이름이 다른 것들. 화면 이름을 정하는 곳은 여기 하나여야 해서
// 브라우저가 보내는 경로 조각을 여기서 받는다 — 예전에는 util.js 가 같은 표를 한 벌
// 더 들고 있었고, 미니앱 번들은 스냅샷이라 옛 표를 든 번들이 한동안 돌아다닌다.
const ALIASES = {
  index: "home",
  "festival-detail": "festival",
};

/** 목록에 없는 이름은 "other" 로 뭉갠다 — 버리지는 않는다. 새 화면이 생겼다는 신호일 수 있다. */
export function normalizeScreen(value) {
  const raw = String(value || "").trim().toLowerCase().slice(0, 20);
  if (!raw) return "home"; // 화면을 안 보낸 옛 번들은 홈으로 본다
  const name = ALIASES[raw] || raw;
  return SCREENS.has(name) ? name : "other";
}
