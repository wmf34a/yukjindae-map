// 기저귀교환대가 있는 공중화장실. 순수 함수만 둔다 — 내려받기와 지오코딩은
// scripts/fetch-toilets.mjs 가 하고, Worker 는 그 결과를 KV 에서 읽기만 한다.

export const TOILETS_KV_KEY = "toilets:changing";

// 남자화장실에도 있는지.
//
// 이 한 줄이 이 데이터를 쓰는 이유다. 전국 기저귀교환대 9,828곳 중 5,754곳이
// 여자화장실에만 있다. "기저귀교환대 있음"만 보고 갔다가 아빠는 못 쓰는 일이
// 실제로 생긴다 — 수유실의 "아빠 이용 가능"과 같은 문제다.
//
// 값이 "남자화장실+여자화장실"과 "여자화장실+남자화장실" 두 표기로 들어와
// 순서를 믿을 수 없어 포함 여부로만 본다.
export function dadCanChange(place) {
  return /남자\s*화장실/.test(String(place || ""));
}

export async function readChangingToilets(env) {
  if (!env.RATE_LIMIT) return [];
  const raw = await env.RATE_LIMIT.get(TOILETS_KV_KEY);
  if (!raw) return [];
  try {
    const rooms = JSON.parse(raw);
    return Array.isArray(rooms) ? rooms : [];
  } catch {
    return [];
  }
}
