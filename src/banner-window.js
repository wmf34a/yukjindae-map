// 배너를 오늘 보여줄지 판단한다.
//
// 노출여부 체크박스만으로는 "9월 12일 행사"처럼 끝나는 날이 정해진 배너를 사람이
// 직접 꺼야 했다. 유모차 콘서트가 지나도 배너가 남아 있으면 지난 행사를 광고하는
// 셈이고, 협찬 배너는 계약 기간을 넘겨 노출되면 곤란하다.
//
// 노출기간이 비어 있으면 예전처럼 체크박스만 본다 — 기존 배너를 건드리지 않는다.

import { todayInKst } from "./kst.js";

/**
 * @param {{startDate?: string, endDate?: string}} banner
 * @param {string} [today] YYYY-MM-DD
 */
export { todayInKst };

export function isWithinWindow(banner, today = todayInKst()) {
  const start = String(banner?.startDate || "").slice(0, 10);
  const end = String(banner?.endDate || "").slice(0, 10);
  if (start && today < start) return false;
  // 종료일 당일까지는 보여준다. 9월 12일 행사 배너는 그날 하루 종일 떠 있어야 한다.
  if (end && today > end) return false;
  return true;
}

export function filterByWindow(banners, today = todayInKst()) {
  return (banners || []).filter((b) => isWithinWindow(b, today));
}
