// TourAPI에서 가져온 축제 후보를 "아빠와 아이가 갈만한 곳"이라는 컨셉에 맞게
// 걸러서 순위를 매긴다. 키워드 매칭이라 완벽할 수 없으므로, 여기서 통과한
// 후보도 노션에는 항상 공개여부=false(검토 대기)로만 들어간다 — 최종 공개는
// 사람이 확인한 뒤 체크박스를 켜야 한다.
const FAMILY_KEYWORDS = [
  "가족", "어린이", "유아", "키즈", "아이", "체험", "놀이", "동물", "곤충",
  "캠핑", "눈썰매", "썰매", "딸기", "벚꽃", "튤립", "코스모스", "단풍",
  "연날리기", "물놀이", "공룡", "별빛", "반딧불이", "크리스마스", "산타",
  "등불", "연등", "농산물", "사과", "배", "포도", "감", "빛축제", "일루미네이션",
];

const EXCLUDE_KEYWORDS = [
  "성인", "19세", "심야", "나이트", "클럽", "주류", "막걸리", "맥주", "와인",
  "소주", "헌팅", "edm", "펍", "포차",
];

function normalize(text) {
  return String(text || "").toLowerCase();
}

// null이면 아예 후보에서 제외(성인 지향 키워드 포함), 숫자면 가점 점수.
export function scoreCandidate(item) {
  const haystack = normalize(item.title);
  if (EXCLUDE_KEYWORDS.some((kw) => haystack.includes(kw))) return null;
  return FAMILY_KEYWORDS.reduce((score, kw) => (haystack.includes(kw) ? score + 1 : score), 0);
}

// 왕궁수문장 교대의식·상설 공연처럼 사실상 연중 열리는 것은 "이번에 가볼 만한
// 축제"가 아니라 상시 볼거리다. 기간이 이만큼 길면 상설로 본다.
const LONG_RUN_DAYS = 180;

function daysBetween(startYyyymmdd, endYyyymmdd) {
  if (!startYyyymmdd || !endYyyymmdd) return 0;
  const toDate = (v) => Date.parse(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`);
  const diff = toDate(endYyyymmdd) - toDate(startYyyymmdd);
  return Number.isNaN(diff) ? 0 : diff / 86400000;
}

// "임박한 순" 비교자. 상설(장기) 행사를 뒤로 밀고, 나머지는 시작일이 이른 순으로 본다.
// 이미 시작했더라도 아직 진행 중이면 후보로 유효하다 — 홍성남당항 대하축제처럼
// 두 달 넘게 하는 축제를 "이미 시작했다"는 이유로 밀어내면 영영 못 올라온다.
function byImminence(a, b) {
  const longA = daysBetween(a.item.eventStartDate, a.item.eventEndDate) >= LONG_RUN_DAYS;
  const longB = daysBetween(b.item.eventStartDate, b.item.eventEndDate) >= LONG_RUN_DAYS;
  if (longA !== longB) return longA ? 1 : -1;
  return (a.item.eventStartDate || "").localeCompare(b.item.eventStartDate || "");
}

// 가점 높은 순 → 같은 점수면 임박한 순으로 정렬해 상위 limit개를 뽑고,
// 그 뒤에 0점 후보도 임박한 순으로 zeroScoreLimit개까지 덧붙인다.
//
// 0점 몫을 따로 두는 이유: 키워드 목록은 아무리 늘려도 샌다. 실제로 "홍성남당항
// 대하축제"처럼 지역을 대표하는 먹거리 축제는 걸리는 키워드가 하나도 없어
// 248건 중 234건이 0점으로 통째로 탈락했다. 어차피 노션에는 공개여부=false로만
// 들어가고 사람이 검토하므로, 검토거리 몇 건 더 보는 쪽이 놓치는 쪽보다 싸다.
export function rankCandidates(items, { limit = 10, zeroScoreLimit = 10 } = {}) {
  const scored = items
    .map((item) => ({ item, score: scoreCandidate(item) }))
    .filter(({ score }) => score !== null);

  const positive = scored.filter(({ score }) => score > 0);
  positive.sort((a, b) => (b.score !== a.score ? b.score - a.score : byImminence(a, b)));

  const zero = scored.filter(({ score }) => score === 0);
  zero.sort(byImminence);

  return [...positive.slice(0, limit), ...zero.slice(0, zeroScoreLimit)].map(({ item }) => item);
}

// TourAPI는 areacode를 비워서 주는 경우가 많아 addr1 문자열로 우리 DB의 10개
// 권역 옵션에 최대한 맞춰본다. 서울/경기/인천처럼 세부 지역이 갈리는 곳은 구/시
// 이름으로 한 번 더 나눈다 — 못 맞추면 사람이 검토하면서 채우도록 비워둔다.
const SEOUL_BUKU_GU = [
  "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구",
  "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구",
];
const GYEONGGI_BUKBU_SI = [
  "고양시", "의정부시", "남양주시", "파주시", "양주시", "구리시", "포천시",
  "동두천시", "가평군", "연천군", "김포시",
];

export function mapAddressToRegion(addr1) {
  const a = String(addr1 || "");
  if (!a) return "";

  if (a.startsWith("서울")) {
    return SEOUL_BUKU_GU.some((gu) => a.includes(gu)) ? "서울강북" : "서울강남";
  }
  if (a.startsWith("인천")) return "인천·부천";
  if (a.startsWith("경기")) {
    if (a.includes("부천시")) return "인천·부천";
    return GYEONGGI_BUKBU_SI.some((si) => a.includes(si)) ? "경기북부" : "경기남부";
  }
  if (a.startsWith("강원")) return "강원도";
  if (a.startsWith("충청") || a.startsWith("충북") || a.startsWith("충남") || a.startsWith("대전") || a.startsWith("세종")) {
    return "충청도";
  }
  if (a.startsWith("전라") || a.startsWith("전북") || a.startsWith("전남") || a.startsWith("광주")) return "전라도";
  if (
    a.startsWith("경상") ||
    a.startsWith("경북") ||
    a.startsWith("경남") ||
    a.startsWith("대구") ||
    a.startsWith("울산") ||
    a.startsWith("부산")
  ) {
    return "경상도";
  }
  if (a.startsWith("제주")) return "제주";
  return "";
}

function toIsoDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// runFestivalImport가 새로 만들 노션 페이지의 속성을 구성한다. order는 이미
// 존재하는 축제들과 순서가 겹치지 않도록 호출부에서 넘겨준다.
export function toNotionProperties(item, order) {
  const start = toIsoDate(item.eventStartDate);
  const end = toIsoDate(item.eventEndDate);
  const region = mapAddressToRegion(item.addr1);

  const properties = {
    "제목": { title: [{ text: { content: item.title.slice(0, 200) } }] },
    "장소명": { rich_text: [{ text: { content: item.addr2.slice(0, 200) } }] },
    "주소": { rich_text: [{ text: { content: item.addr1.slice(0, 200) } }] },
    "순서": { number: order },
    "공개여부": { checkbox: false },
    "TourAPI_ID": { rich_text: [{ text: { content: item.contentId } }] },
  };
  // TourAPI는 항상 eventstartdate를 주지만, 형식이 어긋난 값까지 노션에 잘못된
  // 날짜로 저장하지 않도록 유효할 때만 "기간"을 포함한다.
  if (start) {
    properties["기간"] = { date: { start, end: end && end !== start ? end : null } };
  }
  if (item.image) {
    properties["이미지"] = { files: [{ type: "external", name: "festival", external: { url: item.image } }] };
  }
  if (region) {
    properties["지역"] = { select: { name: region } };
  }
  return properties;
}

// 이미 노션에 들어있는 TourAPI_ID는 다시 만들지 않는다(주간 배치가 매번
// 중복 생성하는 것을 막기 위함). limit을 주면 그만큼만 남긴다 — 기본값은 제한
// 없음이라 rankCandidates가 정한 몫(가점 상위 + 0점 몫)이 그대로 살아남는다.
export function selectNewCandidates(rankedItems, existingTourApiIds, { limit = Infinity } = {}) {
  const existing = new Set(existingTourApiIds.filter(Boolean));
  return rankedItems.filter((item) => !existing.has(item.contentId)).slice(0, limit);
}
