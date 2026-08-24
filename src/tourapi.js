// 한국관광공사 TourAPI(KorService2)에서 제목으로 축제를 찾아 개요/주소를 보충한다.
// 노션에 "설명"을 직접 채워둔 축제는 그 값을 그대로 쓰고, 비어있을 때만 이 모듈을
// 거친다 — 제목만으로 매칭하는 방식이라 확신이 낮은 결과까지 보여주지 않기 위해
// 정규화한 제목이 완전히 일치하거나 한쪽을 포함하는 경우로만 채택을 제한한다.
const TOUR_API_BASE = "https://apis.data.go.kr/B551011/KorService2";
const FESTIVAL_CONTENT_TYPE_ID = "15";

export function normalizeTitle(title) {
  return String(title || "")
    .replace(/[\s()（）·,.\-!?]/g, "")
    .toLowerCase();
}

// 짧은 제목끼리 우연히 포함 관계가 되는 오탐을 줄이기 위해, 정규화한 제목이
// 완전히 같거나 4자 이상일 때만 포함 관계 매칭을 허용한다.
export function findMatchingItem(items, title) {
  const target = normalizeTitle(title);
  if (!target) return null;

  const exact = items.find((item) => normalizeTitle(item.title) === target);
  if (exact) return exact;

  if (target.length < 4) return null;
  return (
    items.find((item) => {
      const candidate = normalizeTitle(item.title);
      return candidate.length >= 4 && (candidate.includes(target) || target.includes(candidate));
    }) || null
  );
}

export function parseSearchItems(data) {
  const item = data && data.response && data.response.body && data.response.body.items && data.response.body.items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

// TourAPI의 homepage 필드는 가끔 순수 URL이 아니라 `<a href="...">라벨</a>` 형태의
// HTML 조각으로 온다 — href 값만 뽑아낸다.
function extractHomepageUrl(raw) {
  if (!raw) return "";
  const match = raw.match(/href=["']([^"']+)["']/i);
  return match ? match[1] : raw.trim();
}

export function parseOverview(data) {
  const items = parseSearchItems(data);
  const first = items[0];
  if (!first) return null;
  return {
    overview: first.overview || "",
    addr1: first.addr1 || "",
    addr2: first.addr2 || "",
    homepage: extractHomepageUrl(first.homepage),
  };
}

// data.go.kr이 발급하는 서비스키는 이미 URL 인코딩된 형태라, URLSearchParams에
// 그대로 넣으면 다시 인코딩되어(%2B → %252B) 이중 인코딩된 키를 보내게 되고
// "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"로 실패한다. 먼저 디코딩해서 넘긴다.
async function callTourApi(env, path, params) {
  const query = new URLSearchParams({
    serviceKey: decodeURIComponent(env.TOUR_API_KEY),
    MobileOS: "ETC",
    MobileApp: "yukjindaemap",
    _type: "json",
    ...params,
  });
  // TourAPI가 느려질 때 상세페이지 요청이 무한정 대기하지 않도록 짧게 끊는다 —
  // 실패해도 fetchFestivalDescription이 조용히 null로 처리해 노션 데이터만으로
  // 페이지가 뜨게 되어 있다.
  const res = await fetch(`${TOUR_API_BASE}/${path}?${query.toString()}`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return null;
  return res.json();
}

// 실패하거나 확신할 만한 매칭이 없으면 조용히 null을 반환한다 — 노션에 이미 있는
// 정보(기간/지역/링크)만으로도 상세페이지는 정상 동작해야 하기 때문.
export async function fetchFestivalDescription(env, title) {
  if (!env.TOUR_API_KEY) return null;

  try {
    const searchData = await callTourApi(env, "searchKeyword2", {
      keyword: title,
      contentTypeId: FESTIVAL_CONTENT_TYPE_ID,
      numOfRows: "10",
      pageNo: "1",
    });
    const matched = findMatchingItem(parseSearchItems(searchData), title);
    if (!matched) return null;

    const detailData = await callTourApi(env, "detailCommon2", { contentId: matched.contentid });
    const detail = parseOverview(detailData);
    if (!detail) return null;

    return {
      description: detail.overview,
      address: [detail.addr1, detail.addr2].filter(Boolean).join(" "),
      link: detail.homepage,
    };
  } catch {
    return null;
  }
}

function normalizeCandidate(item) {
  return {
    contentId: item.contentid,
    title: item.title || "",
    eventStartDate: item.eventstartdate || "",
    eventEndDate: item.eventenddate || item.eventstartdate || "",
    addr1: item.addr1 || "",
    addr2: item.addr2 || "",
    image: item.firstimage || item.firstimage2 || "",
  };
}

// eventStartDate~eventEndDate 구간과 겹치는 축제를 최대 maxItems개까지 모아온다.
// 여러 페이지를 순회하지만 실패한 페이지가 있어도 이미 모은 결과는 그대로 반환한다
// — 주간 배치라 이번 회차에 일부만 못 가져와도 다음 주에 다시 시도되기 때문.
export async function searchFestivalsInRange(env, { startDate, endDate, maxItems = 300 }) {
  if (!env.TOUR_API_KEY) return [];

  const pageSize = 100;
  const items = [];
  let pageNo = 1;

  /* oxlint-disable no-await-in-loop */
  while (items.length < maxItems) {
    let data;
    try {
      data = await callTourApi(env, "searchFestival2", {
        eventStartDate: startDate,
        eventEndDate: endDate,
        numOfRows: String(pageSize),
        pageNo: String(pageNo),
        arrange: "O",
      });
    } catch {
      break;
    }
    const pageItems = parseSearchItems(data);
    if (pageItems.length === 0) break;

    items.push(...pageItems.map(normalizeCandidate));
    if (pageItems.length < pageSize) break;
    pageNo += 1;
  }
  /* oxlint-enable no-await-in-loop */

  return items.slice(0, maxItems);
}
