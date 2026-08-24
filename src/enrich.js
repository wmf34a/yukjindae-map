// 블로그/카페글 검색 결과에서 유아 편의시설 언급을 찾아 "블로그힌트" 상태로
// 자동 제안한다. 검색 결과는 사람이 직접 쓴 글이라 신뢰도가 낮으므로, 여기서
// 만든 값은 "확인됨"이 아니라 항상 "블로그힌트"로만 표시되고, 사람이 정보출처
// 링크를 보고 직접 검증한 뒤에야 "확인됨"으로 승격된다.
export const ENRICHMENT_TARGETS = [
  { field: "기저귀교환대", type: "boolean", keyword: "기저귀 교환대" },
  { field: "수유실", type: "boolean", keyword: "수유실" },
  { field: "무료입장연령", type: "text" },
];

const NEGATION_PATTERN = /없어요|없습니다|없음|없고|따로 없/;
const FREE_AGE_PATTERN = /(\d{1,2})\s*(개월|세)\s*(미만|이하|까지)\s*(무료|입장료\s*없)/;

// 확인됨/블로그힌트로 이미 표시된 장소는 재검색하지 않는다 — 사람이 검증했거나
// 이미 힌트가 붙어 대기 중인 항목을 API 호출로 덮어쓸 이유가 없기 때문.
export function needsEnrichment(place) {
  return !place.verifiedStatus || place.verifiedStatus === "미확인";
}

export function pendingFields(place) {
  return ENRICHMENT_TARGETS.filter((target) => {
    if (target.type === "boolean") return !place[fieldKey(target.field)];
    return !place.freeAgePolicy;
  });
}

function fieldKey(field) {
  if (field === "기저귀교환대") return "diaperChange";
  if (field === "수유실") return "nursingRoom";
  return field;
}

export function buildSearchQuery(place, target) {
  const keyword = target.type === "boolean" ? target.keyword : "무료입장 연령 몇세";
  return `${place.name} ${keyword}`;
}

// 키워드가 나오더라도 바로 뒤/앞에 "없어요" 류 부정어가 붙어있으면 힌트로 채택하지
// 않는다 — "기저귀 교환대는 없어요" 같은 문장을 있음으로 오판하지 않기 위함.
export function extractBooleanHint(items, target) {
  for (const item of items) {
    const combined = `${item.title} ${item.description}`;
    const idx = combined.indexOf(target.keyword);
    if (idx === -1) continue;
    const window = combined.slice(idx, idx + target.keyword.length + 15);
    if (NEGATION_PATTERN.test(window)) continue;
    return item;
  }
  return null;
}

export function extractFreeAgeHint(items) {
  for (const item of items) {
    const combined = `${item.title} ${item.description}`;
    const match = combined.match(FREE_AGE_PATTERN);
    if (match) return { item, value: `${match[1]}${match[2]} ${match[3]} 무료` };
  }
  return null;
}

// 한 장소에서 발견된 여러 필드 힌트를 노션 PATCH 하나로 합친다 — 필드마다
// 별도 요청을 보내면 API 호출/쓰기 횟수만 늘어나고 확인상태·출처는 어차피
// 같은 값을 반복해서 쓰게 되기 때문.
export function buildPatchProperties(hints, today) {
  const properties = {};
  let sourceUrl = "";
  for (const { target, hint, value } of hints) {
    if (target.type === "boolean") {
      properties[target.field] = { checkbox: true };
    } else {
      properties[target.field] = { rich_text: [{ text: { content: value.slice(0, 200) } }] };
    }
    if (!sourceUrl) sourceUrl = hint.link;
  }
  properties["확인상태"] = { select: { name: "블로그힌트" } };
  properties["정보확인일"] = { date: { start: today } };
  if (sourceUrl) properties["정보출처"] = { url: sourceUrl };
  return properties;
}

// 장소별로 남은 필드를 검색하고, 힌트가 하나라도 나오면 한 번에 PATCH한다.
// searchBlog/patchPlace는 실제 네이버/노션 API 호출을 주입받아 순수 로직만
// 여기서 테스트할 수 있게 한다.
export async function runEnrichment({ places, searchBlog, patchPlace, today, maxPlaces = 10 }) {
  const candidates = places.filter(needsEnrichment).filter((p) => pendingFields(p).length > 0);
  const batch = candidates.slice(0, maxPlaces);
  let patchedCount = 0;

  // 검색 API는 초당 호출 제한이 있어 순차 호출이 필요하다.
  /* oxlint-disable no-await-in-loop */
  for (const place of batch) {
    const hints = [];
    for (const target of pendingFields(place)) {
      const items = await searchBlog(buildSearchQuery(place, target));
      const found = target.type === "boolean" ? extractBooleanHint(items, target) : extractFreeAgeHint(items);
      if (!found) continue;
      if (target.type === "boolean") {
        hints.push({ target, hint: found });
      } else {
        hints.push({ target, hint: found.item, value: found.value });
      }
    }
    if (hints.length > 0) {
      await patchPlace(place.id, buildPatchProperties(hints, today));
      patchedCount += 1;
    }
  }
  /* oxlint-enable no-await-in-loop */

  return { checked: batch.length, patched: patchedCount };
}
