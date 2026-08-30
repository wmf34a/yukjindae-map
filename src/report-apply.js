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
export function buildPlacePatch(field, value) {
  if (BOOLEAN_FIELDS.has(field)) {
    // 체크박스는 "없음"으로 끌 수 있으니 따로 지울 길이 필요 없다.
    if (value !== "있음" && value !== "없음") return null;
    return { [field]: { checkbox: value === "있음" } };
  }
  if (!TEXT_FIELDS.has(field)) return null;
  // 지워 달라는 요청이면 빈 값으로 덮는다. 노션에서 rich_text를 비우려면
  // 빈 배열을 보내야 한다.
  if (isClearRequest(value)) return { [field]: { rich_text: [] } };
  const text = String(value || "").trim();
  if (!text) return null;
  return { [field]: { rich_text: [{ text: { content: text.slice(0, 2000) } }] } };
}

// 사람이 확인해 승인한 값이므로 "확인됨"으로 올린다. 블로그에서 추정한 값보다
// 다녀온 사람이 알려준 값이 낫다.
export function buildPlaceProperties(field, value, today) {
  const patch = buildPlacePatch(field, value);
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
 * @param {Array} deps.reports [{ id, placeId, field, value, placeName }]
 * @param {(placeId: string, properties: object) => Promise<void>} deps.patchPlace
 * @param {(reportId: string, properties: object) => Promise<void>} deps.patchReport
 * @param {string} deps.today
 */
export async function applyApprovedReports({ reports, patchPlace, patchReport, today }) {
  const applied = [];
  const skipped = [];

  for (const report of reports || []) {
    // 어떤 장소를 고치라는 것인지 모르면 손대지 않는다. 신규 장소 제보가 여기
    // 섞여 들어오는 경우가 그렇다.
    if (!report.placeId) {
      skipped.push({ ...report, reason: "연결된 장소가 없습니다" });
      continue;
    }
    const properties = buildPlaceProperties(report.field, report.value, today);
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
