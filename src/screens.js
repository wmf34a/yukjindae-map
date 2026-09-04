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

// 어느 장소를 봤는지까지 남긴다.
//
// 화면 종류만 세니 "상세를 31명이 열었다"까지는 알아도 어느 곳을 열었는지는
// 몰랐다. 사진이 없거나 설명이 부실한 곳을 감으로 골라 채우고 있었는데,
// 실제로 많이 열리는 곳부터 채우는 편이 낫다. 축제·코스 상세도 같은 칸을 쓴다.
//
// 노션 페이지 id 모양만 받는다. 임의 문자열을 그대로 적으면 집계가 지저분해지고,
// 주소창에 아무거나 넣어 통계를 오염시킬 수도 있다. 하이픈은 떼어 한 모양으로
// 맞춘다 — 같은 페이지가 두 줄로 갈리면 세는 의미가 없다.
const NOTION_ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;

export function normalizeTargetId(value) {
  const raw = String(value || "").trim().toLowerCase();
  return NOTION_ID_RE.test(raw) ? raw.replace(/-/g, "") : "";
}
