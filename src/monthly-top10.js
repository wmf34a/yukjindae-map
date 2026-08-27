// 매월 1일 크론이 지역별 "이달의 Top 10"을 다시 뽑는다. 장소 풀은 계절을 안 가리고
// 쌓이지만 부모가 실제로 갈 만한 곳은 달마다 다르다 — 한겨울에 물놀이장을, 한여름
// 대낮에 그늘 없는 야외를 1위로 올리면 추천이 아니라 방해가 된다.
//
// 이 파일은 순수 함수만 담고, Claude 호출과 Notion 쓰기는 runMonthlyTop10의 인자로
// 주입받는다(enrich.js의 runEnrichment와 같은 방식). 덕분에 테스트가 네트워크 없이 돈다.

export const TOP_N = 10;

// 후보를 통째로 넘기면 토큰이 커지고, 너무 적게 주면 AI가 고를 여지가 없다.
// 지역별 장소가 30곳을 넘는 경우는 아직 경기남부뿐이라 이 상한으로 충분하다.
export const MAX_CANDIDATES_PER_REGION = 40;

// 월별 계절 힌트. 프롬프트에 그대로 실려서 "무엇을 위로 올릴지"의 기준이 된다.
// 한국 기후 기준이고, 장마(6월 하순~7월 중순)와 혹서기·혹한기를 따로 구분한다.
const SEASON_HINTS = {
  1: "한겨울. 바깥에 오래 서 있기 어렵다. 실내 시설을 크게 우대하고, 야외는 짧게 둘러보는 곳만.",
  2: "늦겨울. 아직 춥지만 한낮은 견딜 만하다. 실내 위주로 하되 볕 좋은 야외를 일부 섞는다.",
  3: "이른 봄. 나들이가 시작된다. 공원·수목원 같은 야외를 올리되 아직 쌀쌀한 날을 대비해 실내도 남긴다.",
  4: "완연한 봄. 야외 활동에 가장 좋은 시기. 꽃·숲·공원을 우대한다.",
  5: "늦봄. 야외가 여전히 좋지만 한낮에는 더워진다. 그늘이 있는 곳을 우대한다.",
  6: "초여름이자 장마 시작. 비를 맞아도 되는 실내와 물놀이를 함께 우대한다.",
  7: "한여름 장마·폭염. 물놀이 시설과 냉방되는 실내를 크게 우대한다. 그늘 없는 야외는 내린다.",
  8: "한여름 폭염. 물놀이와 실내를 크게 우대한다. 그늘 없는 야외는 내린다.",
  9: "초가을. 더위가 꺾인다. 야외 활동과 체험을 우대한다.",
  10: "완연한 가을. 야외에 가장 좋은 시기. 단풍·공원·체험을 우대한다.",
  11: "늦가을. 쌀쌀해진다. 야외를 남기되 실내 비중을 늘린다.",
  12: "초겨울. 춥다. 실내 시설을 크게 우대한다.",
};

export function seasonHint(month) {
  return SEASON_HINTS[month] || "";
}

// "2026-09" 형태만 받는다. Date 연산으로 월을 만들면 타임존 때문에 하루 차이로
// 엉뚱한 달이 잡히는 사고가 나므로, 크론에서 만든 문자열을 그대로 쓴다.
export function parseMonthKey(monthKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function groupByRegion(places) {
  const groups = new Map();
  for (const place of places) {
    if (!place.region) continue;
    if (!groups.has(place.region)) groups.set(place.region, []);
    groups.get(place.region).push(place);
  }
  return groups;
}

// 프롬프트에 실을 후보 목록. 노션 페이지 ID는 36자라 40곳이면 그것만 1,400자가
// 넘는다 — 1부터 매기는 번호로 주고받고, 응답을 받은 뒤 번호를 다시 ID로 돌린다.
export function buildCandidates(places) {
  return places.slice(0, MAX_CANDIDATES_PER_REGION).map((place, index) => ({
    no: index + 1,
    id: place.id,
    name: place.name,
    categories: place.categories || [],
    fee: place.fee || "",
    freeAgePolicy: place.freeAgePolicy || "",
    hours: place.hours || "",
    reason: place.reason || "",
    pinned: Boolean(place.rankPinned),
  }));
}

function candidateLine(c) {
  const parts = [`${c.no}. ${c.name}`];
  if (c.categories.length) parts.push(`[${c.categories.join("·")}]`);
  if (c.fee) parts.push(`입장료: ${truncate(c.fee, 60)}`);
  if (c.freeAgePolicy) parts.push(`무료: ${truncate(c.freeAgePolicy, 30)}`);
  if (c.hours) parts.push(`운영: ${truncate(c.hours, 50)}`);
  if (c.reason) parts.push(`설명: ${truncate(c.reason, 120)}`);
  return parts.join(" / ");
}

function truncate(value, max) {
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function buildPrompt({ monthKey, region, candidates }) {
  const parsed = parseMonthKey(monthKey);
  const month = parsed ? parsed.month : 0;
  const limit = Math.min(TOP_N, candidates.length);

  return [
    `너는 아이와 갈 만한 곳을 추천하는 서비스의 큐레이터다.`,
    `아래는 "${region}" 지역에 등록된 장소 목록이다. ${monthKey}에 방문하기 좋은 순서로 상위 ${limit}곳을 골라라.`,
    ``,
    `이 달의 특징: ${seasonHint(month)}`,
    ``,
    `기준`,
    `- 그 달의 날씨와 계절에 실제로 어울리는지를 가장 먼저 본다.`,
    `- 아이를 데리고 가는 부모가 독자다. 무료이거나 영유아 입장이 무료면 가산점.`,
    `- 실내/야외 균형을 고려한다. 한 종류로만 채우지 않는다.`,
    `- 목록에 없는 장소는 절대 만들어내지 않는다. 반드시 주어진 번호 중에서만 고른다.`,
    ``,
    `장소 목록`,
    ...candidates.map(candidateLine),
    ``,
    `출력 형식 — 설명 없이 JSON만 출력한다.`,
    `{"picks":[{"no":<장소 번호>,"reason":"<이 달에 좋은 이유 한 문장, 40자 이내>"}]}`,
    `picks는 좋은 순서대로 정확히 ${limit}개.`,
  ].join("\n");
}

// 모델 응답에서 JSON을 꺼낸다. 코드펜스로 감싸 오거나 앞뒤에 말을 붙이는 경우가
// 있어서, 통째로 파싱해보고 실패하면 첫 중괄호 블록만 잘라 다시 시도한다.
export function extractJson(responseText) {
  const text = String(responseText || "").trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = fenced ? [fenced[1], text] : [text];

  for (const raw of candidates) {
    try {
      return JSON.parse(raw);
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1));
        } catch {
          // 다음 후보로 넘어간다
        }
      }
    }
  }
  return null;
}

// 모델이 없는 번호를 부르거나, 같은 곳을 두 번 넣거나, 개수를 초과하는 일이 실제로
// 일어난다. 여기서 전부 걸러낸다 — 걸러낸 결과가 비면 호출 자체를 실패로 본다.
export function parseRanking(responseText, candidates) {
  const parsed = extractJson(responseText);
  const picks = parsed && Array.isArray(parsed.picks) ? parsed.picks : null;
  if (!picks) return { ok: false, error: "JSON 파싱 실패", ranking: [] };

  const byNo = new Map(candidates.map((c) => [c.no, c]));
  const seen = new Set();
  const ranking = [];

  for (const pick of picks) {
    const no = Number(pick && pick.no);
    const candidate = byNo.get(no);
    if (!candidate) continue;
    if (seen.has(no)) continue;
    seen.add(no);
    ranking.push({
      id: candidate.id,
      name: candidate.name,
      reason: truncate(pick.reason || "", 100),
    });
    if (ranking.length >= Math.min(TOP_N, candidates.length)) break;
  }

  if (ranking.length === 0) return { ok: false, error: "유효한 장소 없음", ranking: [] };
  return { ok: true, ranking };
}

// 사람이 켠 "추천고정"은 AI 결과보다 항상 우선한다. 고정된 곳을 앞에 세우고,
// 나머지 자리를 AI 순서로 채운다.
export function applyPinned(ranking, candidates) {
  const pinned = candidates.filter((c) => c.pinned);
  if (pinned.length === 0) return ranking;

  const pinnedIds = new Set(pinned.map((c) => c.id));
  const fromAi = ranking.filter((r) => !pinnedIds.has(r.id));
  const byId = new Map(ranking.map((r) => [r.id, r]));

  const head = pinned.map((c) => byId.get(c.id) || { id: c.id, name: c.name, reason: "" });
  return [...head, ...fromAi].slice(0, Math.min(TOP_N, candidates.length));
}

const rt = (value) => (value ? [{ text: { content: String(value).slice(0, 2000) } }] : []);

export function buildPatchProperties({ rank, monthKey, reason }) {
  return {
    "추천순위": { number: rank },
    "추천월": { rich_text: rt(monthKey) },
    "추천사유": { rich_text: rt(reason) },
  };
}

// 지난달 순위가 남아 있으면 이번 달에 안 뽑힌 곳이 예전 순위로 계속 노출된다.
// 순위를 비우는 PATCH를 따로 만들어 정리한다.
export function buildClearProperties() {
  return {
    "추천순위": { number: null },
    "추천월": { rich_text: [] },
    "추천사유": { rich_text: [] },
  };
}

export function pickPlacesToClear(places, ranked, monthKey) {
  const rankedIds = new Set(ranked.map((r) => r.id));
  return places.filter((p) => !rankedIds.has(p.id) && (p.rank !== null || p.rankMonth === monthKey));
}

/**
 * 지역별로 Claude를 한 번씩 부르고, 결과를 Notion에 되쓴다.
 *
 * @param {object} deps
 * @param {Array} deps.places 공개된 장소 전체 (toPlace 형태)
 * @param {(prompt: string) => Promise<string>} deps.askClaude 프롬프트를 넣으면 응답 텍스트를 주는 함수
 * @param {(placeId: string, properties: object) => Promise<void>} deps.patchPlace Notion 페이지 갱신
 * @param {string} deps.monthKey "2026-09"
 */
export async function runMonthlyTop10({ places, askClaude, patchPlace, monthKey }) {
  if (!parseMonthKey(monthKey)) {
    return { ok: false, error: `잘못된 monthKey: ${monthKey}`, regions: [] };
  }

  const groups = groupByRegion(places);
  const regions = [];

  for (const [region, regionPlaces] of groups) {
    const candidates = buildCandidates(regionPlaces);
    if (candidates.length === 0) continue;

    let responseText;
    try {
      /* oxlint-disable no-await-in-loop */
      responseText = await askClaude(buildPrompt({ monthKey, region, candidates }));
      /* oxlint-enable no-await-in-loop */
    } catch (err) {
      regions.push({ region, ok: false, error: `호출 실패: ${err.message}`, ranked: 0 });
      continue;
    }

    const parsed = parseRanking(responseText, candidates);
    if (!parsed.ok) {
      // 지난달 순위를 그대로 두는 편이, 순위를 지워서 아무것도 못 보여주는 것보다 낫다.
      regions.push({ region, ok: false, error: parsed.error, ranked: 0 });
      continue;
    }

    const ranking = applyPinned(parsed.ranking, candidates);
    const failures = [];

    for (let i = 0; i < ranking.length; i += 1) {
      const entry = ranking[i];
      try {
        /* oxlint-disable no-await-in-loop */
        await patchPlace(entry.id, buildPatchProperties({ rank: i + 1, monthKey, reason: entry.reason }));
        /* oxlint-enable no-await-in-loop */
      } catch (err) {
        failures.push(`${entry.name}: ${err.message}`);
      }
    }

    for (const place of pickPlacesToClear(regionPlaces, ranking, monthKey)) {
      try {
        /* oxlint-disable no-await-in-loop */
        await patchPlace(place.id, buildClearProperties());
        /* oxlint-enable no-await-in-loop */
      } catch (err) {
        failures.push(`${place.name} 순위 정리: ${err.message}`);
      }
    }

    regions.push({ region, ok: failures.length === 0, ranked: ranking.length, failures });
  }

  return { ok: regions.every((r) => r.ok), monthKey, regions };
}
