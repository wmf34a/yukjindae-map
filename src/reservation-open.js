// 서울시 공공서비스예약(yeyak.seoul.go.kr) 목록에서 "아이와 갈 만한 곳의
// 예약이 곧 열린다"에 해당하는 것만 뽑는다.
//
// 이 화면의 값은 장소 정보와 성격이 다르다. 장소는 "어디가 좋냐"를 답하지만
// 예약 오픈은 "언제 신청 버튼이 열리냐"를 답한다. 인기 프로그램은 오픈 몇 분
// 만에 마감되므로, 늦게 알면 정보가 있으나 마나다. 그래서 지나간 것은 아무리
// 좋아도 버리고 앞으로 열릴 것만 남긴다.

// 대관·진료·생활체육은 나들이가 아니다. 테니스장 정기대관과 소아과 진료예약이
// "예약 오픈"에 섞이면 목록이 부모에게 쓸모없어진다.
export const RESERVATION_SERVICES = [
  "ListPublicReservationEducation",
  "ListPublicReservationCulture",
];

// 서울시 API는 필드 안에 HTML 엔티티를 그대로 넣어 준다.
// "2026년 상&middot;하반기 &#39;내 친구 박물관&#39;" 을 그대로 화면에 쓰면 깨져 보인다.
const ENTITIES = {
  "&middot;": "·", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
  "&ldquo;": "\u201c", "&rdquo;": "\u201d", "&lsquo;": "\u2018", "&rsquo;": "\u2019",
  "&ndash;": "–", "&mdash;": "—", "&hellip;": "…",
};

export function decodeEntities(text) {
  return String(text || "")
    .replace(/&(?:middot|amp|lt|gt|quot|nbsp|ldquo|rdquo|lsquo|rsquo|ndash|mdash|hellip|#39);/g, (m) => ENTITIES[m] || m)
    .replace(/\s+/g, " ")
    .trim();
}

// "2026-08-24 10:00:00.0" — 표준이 아니라서 Date가 못 읽는다. 초 이하를 떼고
// 한국 시간으로 읽는다(API가 KST로 준다).
export function parseKst(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`);
}

// 이용대상은 "성인(유아ㆍ어린이 양육자 및 예비 양육자)" 처럼 괄호 앞이 진짜
// 대상이고 괄호 안은 부연이다. 괄호까지 통으로 보면 양육자 대상 강좌가
// "어린이"라는 글자 때문에 아이 프로그램으로 둔갑한다.
export function audienceOf(useTarget) {
  const text = decodeEntities(useTarget);
  const head = text.split(/[(（]/)[0];
  return head.split(/[,·ㆍ/]/).map((t) => t.trim()).filter(Boolean);
}

const KID_AUDIENCE = /유아|어린이|아동|초등|가족|키즈|영유아|미취학/;
const KID_WORDS = /유아|어린이|아동|초등|가족|키즈|영유아|미취학/;

// 개인이 신청할 수 없는 것들. 학급 단체 교육은 학교가 신청하지, 아빠가
// 아이 손 잡고 갈 수 있는 자리가 아니다.
const GROUP_ONLY = /학급|단체/;
// 매주 나가는 정기 강좌는 나들이가 아니라 학원 등록이다. 우리동네키움센터는
// 등록 아동만 쓰는 동네 돌봄시설이라 통째로 뺀다.
const NOT_OUTING = /수강생\s*모집|교실\s*(수강|모집)|우리동네키움센터|키움센터|노동자복지관/;
// "수시 모집(주중/평일/오후반)" 같은 정기 등록반. 매주 같은 시간에 나가는
// 반이지, 주말에 한 번 다녀오는 나들이가 아니다.
const REGULAR_CLASS = /(주중|평일|정기|오전|오후)\s*반/;
// 서울형 키즈카페는 동마다 하나씩 열세 곳이 매주 같은 마감으로 올라와 띠를
// 통째로 덮는다. 성격도 다르다 — 시각을 놓치면 끝나는 오픈이 아니라 상설
// 시설의 상시 예약이라, 이런 곳은 장소 DB에 실어야 맞다.
const STANDING_FACILITY = /서울형\s*키즈카페/;
// 이미 끝난 것이 "접수중" 상태로 남아 있다.
const CLOSED_IN_TITLE = /모집완료|접수마감|취소됨/;
// 나들이가 아니라 복지·의료 신청이다. 안경 할인 사업과 영유아 검진은 아이
// 대상이 맞지만 "이번 주말에 어디 갈까"에 대한 답이 아니다.
const NOT_A_TRIP = /지킴이\s*사업|지원\s*사업|검진|접종|진료|상담\s*신청|연수|교원|양성\s*과정/;

export function isForKids(row) {
  const audience = audienceOf(row.USETGTINFO);
  const title = decodeEntities(row.SVCNM);
  const detail = decodeEntities(row.USETGTINFO);
  const place = decodeEntities(row.PLACENM);

  if (CLOSED_IN_TITLE.test(title)) return false;
  if (NOT_A_TRIP.test(title)) return false;
  if (GROUP_ONLY.test(detail) || GROUP_ONLY.test(title)) return false;
  if (NOT_OUTING.test(title) || NOT_OUTING.test(place)) return false;
  if (REGULAR_CLASS.test(title)) return false;
  if (STANDING_FACILITY.test(title) || STANDING_FACILITY.test(place)) return false;

  // 대상 칸이 비었거나 "제한없음"이면 제목으로 판단한다 — 아니면 성인 강좌가
  // 통째로 딸려 들어온다.
  if (audience.length === 0 || audience.some((a) => a.includes("제한없음"))) {
    return KID_WORDS.test(title);
  }
  return audience.some((a) => KID_AUDIENCE.test(a));
}

// 접수 시작이 아직 안 왔고 지금부터 windowDays 안에 열리는 것.
export function opensSoon(row, now = Date.now(), windowDays = 14) {
  const begin = parseKst(row.RCPTBGNDT);
  if (!begin) return false;
  const ms = begin.getTime() - now;
  return ms > 0 && ms <= windowDays * 24 * 60 * 60 * 1000;
}

// 이미 열려 있고 아직 안 닫힌 것. 오픈 예정만 보이면 목록이 텅 비는 주가
// 생겨서, 지금 신청 가능한 것도 뒤에 붙인다.
export function isOpenNow(row, now = Date.now()) {
  const begin = parseKst(row.RCPTBGNDT);
  const end = parseKst(row.RCPTENDDT);
  if (!begin || !end) return false;
  if (row.SVCSTATNM === "예약마감" || row.SVCSTATNM === "접수종료") return false;
  return begin.getTime() <= now && now <= end.getTime();
}

// 서울 25개 자치구를 우리 DB의 권역 두 개로 나눈다. place-pipeline 쪽 분류와
// 같은 경계를 쓴다 — 한쪽만 바꾸면 같은 구가 화면마다 다른 지역에 뜬다.
const SEOUL_BUKBU_GU = new Set([
  "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구",
  "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구",
]);

export function regionOf(areaName) {
  const a = String(areaName || "").trim();
  if (!a) return "";
  return SEOUL_BUKBU_GU.has(a) ? "서울강북" : "서울강남";
}

// 화면에 그대로 쓸 모양으로 바꾼다. 노션과 프론트가 같은 값을 보게 하려고
// 여기서 한 번에 만든다.
export function toEntry(row) {
  const begin = parseKst(row.RCPTBGNDT);
  const end = parseKst(row.RCPTENDDT);
  return {
    id: row.SVCID,
    title: decodeEntities(row.SVCNM),
    place: decodeEntities(row.PLACENM),
    target: decodeEntities(row.USETGTINFO),
    // "유료(요금안내문의)" 처럼 괄호가 붙어 온다. 칩에 넣을 짧은 말만 남긴다.
    fee: decodeEntities(row.PAYATNM).replace(/\s*\(.*\)\s*$/, ""),
    category: decodeEntities(row.MINCLASSNM),
    area: decodeEntities(row.AREANM),
    region: regionOf(row.AREANM),
    url: row.SVCURL || "",
    image: row.IMGURL || "",
    openAt: begin ? begin.toISOString() : "",
    closeAt: end ? end.toISOString() : "",
    lat: Number(row.Y) || null,
    lng: Number(row.X) || null,
  };
}

// 오픈 예정을 먼저, 그 안에서는 빨리 열리는 순. 이미 열린 것은 뒤로 보내고
// 마감이 임박한 순으로 둔다 — 둘 다 "서둘러야 하는 순"이다.
// 같은 프로그램이 지점·회차별로 수십 건씩 올라온다. 서울형 키즈카페는 동마다
// 한 건씩 열두 개가 잡혀 띠를 통째로 도배했다. 앞머리 대괄호와 괄호를 떼고 남는
// 이름의 앞부분을 열쇠로 삼아 계열당 하나만 남긴다.
export function seriesKey(title) {
  return decodeEntities(title)
    .replace(/^\s*[[［【][^\]］】]*[\]］】]\s*/, "")
    .replace(/[(（][^)）]*[)）]/g, "")
    .replace(/\s/g, "")
    .slice(0, 10);
}

// 한 시설이 목록을 먹지 않게 한 곳당 하나만 싣는다. 은평목재문화체험장 하나가
// 목공체험 네 건으로 자리를 차지하면, 그 주에 열리는 다른 동네 프로그램이
// 전부 밀린다. 어차피 한 곳을 누르면 그 시설의 다른 회차도 같이 보인다.
export function pickReservations(rows, { now = Date.now(), windowDays = 14, limit = 12, perPlace = 1 } = {}) {
  const kids = (rows || []).filter((r) => r && r.SVCID && isForKids(r));
  const seenId = new Set();
  const seenSeries = new Set();
  const placeCount = new Map();
  const unique = kids.filter((r) => {
    if (seenId.has(r.SVCID)) return false;
    seenId.add(r.SVCID);
    const key = seriesKey(r.SVCNM);
    if (key && seenSeries.has(key)) return false;
    seenSeries.add(key);
    // "서울특별시 산악문화체험센터>노을여가센터" 처럼 상위 시설이 앞에 붙는다.
    // 꺾쇠 뒤가 실제로 가는 곳이라 그쪽을 센다.
    const place = decodeEntities(r.PLACENM).split(">").pop().trim();
    const n = placeCount.get(place) || 0;
    if (place && n >= perPlace) return false;
    placeCount.set(place, n + 1);
    return true;
  });

  const withStatus = (rows2, status) => rows2.map((r) => {
    const entry = toEntry(r);
    entry.status = status;
    return entry;
  });

  const soon = withStatus(unique.filter((r) => opensSoon(r, now, windowDays)), "오픈예정")
    .toSorted((a, b) => a.openAt.localeCompare(b.openAt));

  const open = withStatus(unique.filter((r) => isOpenNow(r, now)), "접수중")
    .toSorted((a, b) => a.closeAt.localeCompare(b.closeAt));

  return [...soon, ...open].slice(0, limit);
}

// "9/1(화) 10:00" — 인스타 카드가 쓰는 표기와 같게 맞춘다.
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatOpenAt(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const mm = kst.getUTCMonth() + 1;
  const dd = kst.getUTCDate();
  const day = DAYS[kst.getUTCDay()];
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd}(${day}) ${hh}:${mi}`;
}
