// 별점과 후기.
//
// 별 다섯 개만으로는 이 앱에서 쓸모가 적다. "여기 4.2점이래"는 아무것도
// 알려주지 않는다. 아빠가 알고 싶은 것은 하나다 — 내 아이 나이에 맞나.
// 그래서 별점과 함께 아이 나이대·머문 시간·재방문 의사를 눌러서 받고,
// 상세 화면에서 나이대별로 갈라 보여준다.

export const REVIEWS_KV_KEY = "reviews:public";

export const RATINGS = ["1", "2", "3", "4", "5"];
export const AGE_BANDS = ["0~2세", "3~5세", "6~8세", "9세 이상"];
export const STAY_TIMES = ["1시간 미만", "1~2시간", "반나절", "하루 종일"];
export const REVISIT = ["또 갈래요", "한 번이면 충분"];

export const REVIEW_TEXT_MAX = 200;
export const MAX_PHOTOS = 3;

/**
 * 후기 제출값을 검사한다.
 *
 * 글은 선택이다. 강제하면 아무도 안 쓴다 — 별점과 눌러서 답하는 항목만으로도
 * 다음 사람에게 도움이 된다.
 */
export function validateReview({ placeId, rating, ageBand, stayTime, revisit, text, photos }) {
  if (typeof placeId !== "string" || !placeId.trim()) return "장소를 알 수 없어요.";
  if (!RATINGS.includes(String(rating))) return "별점을 골라주세요.";
  if (ageBand !== undefined && ageBand !== null && !AGE_BANDS.includes(ageBand)) return "아이 나이를 다시 골라주세요.";
  if (stayTime !== undefined && stayTime !== null && !STAY_TIMES.includes(stayTime)) return "머문 시간을 다시 골라주세요.";
  if (revisit !== undefined && revisit !== null && !REVISIT.includes(revisit)) return "다시 갈지 여부를 다시 골라주세요.";
  if (text !== undefined && text !== null) {
    if (typeof text !== "string") return "후기 내용이 올바르지 않습니다.";
    if (text.length > REVIEW_TEXT_MAX) return `후기는 ${REVIEW_TEXT_MAX}자까지 쓸 수 있어요.`;
  }
  if (photos !== undefined && photos !== null) {
    if (!Array.isArray(photos)) return "사진 형식이 올바르지 않습니다.";
    if (photos.length > MAX_PHOTOS) return `사진은 ${MAX_PHOTOS}장까지 올릴 수 있어요.`;
  }
  return null;
}

/** 소수점 한 자리. 후기가 없으면 null 이다 — 0.0 으로 보이면 최악 평가처럼 읽힌다. */
export function averageRating(reviews) {
  if (!reviews || reviews.length === 0) return null;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating || 0), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

/**
 * 장소 하나의 후기를 요약한다.
 *
 * 나이대별 평균이 이 요약의 핵심이다. 전체 4.2 보다 "3~5세 부모 12명이 4.6"이
 * 훨씬 쓸모 있다. 다만 한두 명뿐인 나이대는 평균이라고 부르기 어려워
 * 최소 인원을 채운 것만 내보낸다.
 */
export const MIN_AGE_BAND_COUNT = 2;

export function summarize(reviews) {
  const list = reviews || [];
  const byAge = [];
  for (const band of AGE_BANDS) {
    const picked = list.filter((r) => r.ageBand === band);
    if (picked.length >= MIN_AGE_BAND_COUNT) {
      byAge.push({ band, count: picked.length, average: averageRating(picked) });
    }
  }
  return {
    count: list.length,
    average: averageRating(list),
    byAge,
    revisit: list.filter((r) => r.revisit === "또 갈래요").length,
    stayTimes: STAY_TIMES
      .map((name) => ({ name, count: list.filter((r) => r.stayTime === name).length }))
      .filter((x) => x.count > 0),
  };
}

/** 같은 기기가 같은 장소에 이미 남겼는지. 도배를 막는 최소한의 장치다. */
export function alreadyReviewed(reviews, placeId, authorKey) {
  if (!authorKey) return false;
  return (reviews || []).some((r) => r.placeId === placeId && r.authorKey === authorKey);
}

export async function readPublicReviews(env) {
  if (!env.RATE_LIMIT) return [];
  const raw = await env.RATE_LIMIT.get(REVIEWS_KV_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
