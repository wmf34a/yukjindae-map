// 제보함에서 "승인됨"으로 바꾼 건을 장소 DB에 옮겨 적는다.
//
// 지금까지는 운영자가 제보를 읽고 장소 DB에서 같은 값을 손으로 다시 입력해야 했다.
// 두 번 적는 일이라 빠뜨리기 쉽고, 무엇이 반영됐는지도 알기 어려웠다. 상태만
// 바꾸면 반영되도록 한다.
//
// 순수 함수만 담고 Notion 호출은 인자로 주입받는다.

// 제보로 고칠 수 있는 필드와, 노션에 어떤 형태로 쓰는지.
// 화이트리스트를 여기서도 한 번 더 확인한다 — 제보 접수 때 걸렀더라도, 사람이
// 노션에서 필드명을 손으로 바꿔 넣는 일이 있을 수 있다.
const BOOLEAN_FIELDS = new Set(["기저귀교환대", "수유실", "유아의자"]);
const TEXT_FIELDS = new Set([
  "운영시간",
  "입장료",
  "무료입장연령",
  "주차상세",
  "근처맛집",
  "근처카페",
]);

// 여러 가게를 "/"나 ","로 이어 적는 칸. 이 칸을 통째로 덮어쓰면 제보에 안 적힌
// 가게가 사라진다.
//
// 실제로 이것 때문에 데이터가 34번 날아갔다. 검수해 주시는 분들은 자기가 확인한
// 가게만 적어 보내는데, 폼이 지금 값을 미리 채워 주다 보니 "확인 안 한 줄을
// 지우고 제출" 한 모양이 된다. 국립산악박물관은 카페 셋 중 하나만 빠진 제보를
// 승인하면 그 하나가 지워진다.
const LIST_FIELDS = new Set(["근처맛집", "근처카페"]);

export const MODE_ADD = "추가";
export const MODE_REPLACE = "교체";

export function isListField(field) {
  return LIST_FIELDS.has(field);
}

export function splitList(value) {
  return String(value || "")
    // 구분자를 안 쓰고 이어 적은 제보를 가른다. "사니다 (약 6.8km) 목수의 진달래
    // (약 5.8km)" 처럼 거리 괄호 뒤에 바로 다음 가게가 오는 형태가 흔하다.
    .replace(/(\(약\s*[^)]*\))\s+(?=[^/,\s])/g, "$1 / ")
    .split(/\s*[/,]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 거리 꼬리와 공백을 뗀 상호. "스테이오롯이 (약 3.0km)"와 "스테이 오롯이 (약 3km)"를
// 같은 가게로 본다 — 아니면 거리만 고친 제보가 중복 항목을 만든다.
export function bareName(entry) {
  // "(약 3.0km)"도 "(약630m)"도 거리 꼬리다. 제보는 띄어쓰기를 자주 빠뜨린다.
  return String(entry || "").replace(/\s*\(약\s*[^)]*\)\s*$/, "").replace(/\s/g, "");
}

// "미륵산돌담"과 "미륵산돌담 한정식"처럼 한쪽이 다른 쪽을 품으면 같은 가게로 본다.
// 우리가 상호를 짧게 잡아 둔 걸 제보가 정확한 이름으로 고쳐 주는 경우다.
// 세 글자 미만끼리는 우연히 겹치니 완전히 같을 때만 인정한다.
function sameShop(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * 기존 목록에 제보 값을 더한다. 같은 가게가 이미 있으면 제보 쪽으로 바꾼다 —
 * 거리나 상호를 고쳐 주는 제보가 대부분이라 나중 값이 맞다.
 */
export function mergeList(current, incoming) {
  const merged = splitList(current);
  for (const entry of splitList(incoming)) {
    const bare = bareName(entry);
    const at = merged.findIndex((m) => sameShop(bareName(m), bare));
    if (at === -1) merged.push(entry);
    else merged[at] = entry;
  }
  return merged.join(" / ");
}

export const APPROVED = "승인됨";
export const APPLIED = "반영됨";

export function isApplicableField(field) {
  return BOOLEAN_FIELDS.has(field) || TEXT_FIELDS.has(field);
}

// 값을 지워 달라는 제보. 폼에 빈칸을 내면 접수 자체가 안 되니 이렇게 적어 보낸다.
//
// 일산호수공원의 무료입장연령에 "36개월 미만 무료"가 적혀 있었는데, 애초에
// 입장료를 받지 않는 공원이라 그 줄 자체가 사람을 헷갈리게 했다. 지역장이
// "(삭제요망)"이라고 보내 주셨고, 그때는 이 말을 그대로 값으로 써넣는 코드였다.
// 승인했으면 화면에 "무료입장 연령: (삭제요망)"이 떴을 것이다.
const CLEAR_REQUESTS = [/^\(?\s*삭제\s*(요망|요청|해주세요|바랍니다)?\s*\)?$/, /^\(?\s*(빈칸|공백|없음으로)\s*\)?$/];

export function isClearRequest(value) {
  const text = String(value || "").trim();
  return CLEAR_REQUESTS.some((re) => re.test(text));
}

// 신규 장소 제보는 여기서 다루지 않는다. 장소를 새로 만드는 일은 좌표·사진·근처
// 맛집까지 함께 채워야 해서 발굴 파이프라인의 몫이다.
export function buildPlacePatch(field, value, { mode = MODE_ADD, current = "" } = {}) {
  if (BOOLEAN_FIELDS.has(field)) {
    // 체크박스는 "없음"으로 끌 수 있으니 따로 지울 길이 필요 없다.
    if (value !== "있음" && value !== "없음") return null;
    return { [field]: { checkbox: value === "있음" } };
  }
  if (!TEXT_FIELDS.has(field)) return null;
  // 지워 달라는 요청이면 빈 값으로 덮는다. 노션에서 rich_text를 비우려면
  // 빈 배열을 보내야 한다.
  if (isClearRequest(value)) return { [field]: { rich_text: [] } };
  const raw = String(value || "").trim();
  if (!raw) return null;
  // 목록 칸은 기본이 "추가"다. 통째로 갈아 끼우는 건 제보자가 그렇게 고른
  // 경우에만 한다.
  const text = LIST_FIELDS.has(field) && mode !== MODE_REPLACE ? mergeList(current, raw) : raw;
  if (!text) return null;
  return { [field]: { rich_text: [{ text: { content: text.slice(0, 2000) } }] } };
}

// 사람이 확인해 승인한 값이므로 "확인됨"으로 올린다. 블로그에서 추정한 값보다
// 다녀온 사람이 알려준 값이 낫다.
export function buildPlaceProperties(field, value, today, options) {
  const patch = buildPlacePatch(field, value, options);
  if (!patch) return null;
  return {
    ...patch,
    "확인상태": { select: { name: "확인됨" } },
    ...(today ? { "정보확인일": { date: { start: today } } } : {}),
  };
}

export function buildReportProperties() {
  return { "상태": { select: { name: APPLIED } } };
}

/**
 * 승인된 제보를 장소에 반영한다.
 *
 * @param {object} deps
 * @param {Array} deps.reports [{ id, placeId, field, value, placeName, mode }]
 * @param {(placeId: string, properties: object) => Promise<void>} deps.patchPlace
 * @param {(reportId: string, properties: object) => Promise<void>} deps.patchReport
 * @param {(placeId: string, field: string) => Promise<string>} [deps.readPlaceField]
 *   목록 칸을 "추가"로 반영할 때 지금 값을 읽는다. 없으면 덮어쓰기로 동작한다.
 * @param {string} deps.today
 */
export async function applyApprovedReports({ reports, patchPlace, patchReport, readPlaceField, today }) {
  const applied = [];
  const skipped = [];

  for (const report of reports || []) {
    // 어떤 장소를 고치라는 것인지 모르면 손대지 않는다. 신규 장소 제보가 여기
    // 섞여 들어오는 경우가 그렇다.
    if (!report.placeId) {
      skipped.push({ ...report, reason: "연결된 장소가 없습니다" });
      continue;
    }
    /* oxlint-disable no-await-in-loop */
    // 지금 값을 알아야 더할 수 있다. 못 읽으면 지우는 대신 건너뛴다 —
    // 이 칸이 통째로 날아가는 걸 막으려고 만든 장치다.
    const needsCurrent = isListField(report.field)
      && report.mode !== MODE_REPLACE
      && !isClearRequest(report.value);
    let current = "";
    if (needsCurrent) {
      if (!readPlaceField) {
        skipped.push({ ...report, reason: "지금 값을 읽을 수 없어 건너뜁니다" });
        continue;
      }
      try {
        current = await readPlaceField(report.placeId, report.field);
      } catch (err) {
        skipped.push({ ...report, reason: `지금 값을 읽지 못했습니다: ${err.message}` });
        continue;
      }
    }
    /* oxlint-enable no-await-in-loop */

    const properties = buildPlaceProperties(report.field, report.value, today, {
      mode: report.mode, current,
    });
    if (!properties) {
      skipped.push({ ...report, reason: `반영할 수 없는 필드/값입니다 (${report.field})` });
      continue;
    }

    try {
      /* oxlint-disable no-await-in-loop */
      await patchPlace(report.placeId, properties);
      await patchReport(report.id, buildReportProperties());
      /* oxlint-enable no-await-in-loop */
      applied.push(report);
    } catch (err) {
      // 장소는 고쳤는데 제보 상태를 못 바꾼 경우, 다음 실행에서 같은 값을 한 번
      // 더 쓰게 된다. 같은 값을 덮어쓰는 것이라 해가 없다.
      skipped.push({ ...report, reason: err.message });
    }
  }

  return { applied, skipped };
}
