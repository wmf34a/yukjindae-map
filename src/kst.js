// 한국 시간(KST) 기준 날짜.
//
// 서버가 UTC라 그냥 new Date() 를 쓰면 자정 무렵 아홉 시간 동안 어제로 판단한다.
// 같은 +9시간 계산이 열 군데에 흩어져 있었고, 한 곳만 어긋나도 그 경로만 조용히
// 하루 밀린다. KST 는 서머타임이 없어 고정 오프셋으로 충분하다.

export function kstNow(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

/** YYYY-MM-DD */
export function todayInKst(now = new Date()) {
  return kstNow(now).toISOString().slice(0, 10);
}
