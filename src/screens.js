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

/** 목록에 없는 이름은 "other" 로 뭉갠다 — 버리지는 않는다. 새 화면이 생겼다는 신호일 수 있다. */
export function normalizeScreen(value) {
  const name = String(value || "").trim().toLowerCase().slice(0, 20);
  if (!name) return "home"; // 화면을 안 보낸 옛 번들은 홈으로 본다
  return SCREENS.has(name) ? name : "other";
}
