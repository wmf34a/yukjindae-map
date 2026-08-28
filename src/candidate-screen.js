// 발굴한 후보가 "아빠가 아이를 데리고 일부러 찾아갈 만한 곳"인지 AI에게 묻는다.
//
// 이름 필터와 블로그 언급량으로 걸러도 동네 근린공원이 남는다. 수봉공원은 언급이
// 22건, 장미공원은 5건이었는데 둘 다 목적지가 아니라 산책로다. 광주는 다섯 자리가
// 전부 근린공원으로 채워졌다. 언급량은 "사람들이 아는 곳"은 가려도 "일부러 갈 곳"은
// 못 가린다.
//
// 그 판단을 이미 잘하는 것이 앱 안에 있다 — 월간 Top 10을 뽑는 Claude 호출이다.
// 같은 방식(번호로 주고받고 응답을 검증)을 그대로 쓴다.
//
// 순수 함수만 담고 Claude 호출은 인자로 주입받는다.

// 지역당 한 번 부르므로 한 번에 다 실을 수 있어야 한다.
export const MAX_SCREEN_CANDIDATES = 30;

// 통과 기준. 3점 이상만 남긴다 — 2점은 "가도 나쁘지 않다" 수준이라, 그런 곳으로
// 지역을 채우면 앱이 동네 공원 목록이 된다.
export const PASS_SCORE = 3;

export function buildScreenCandidates(places) {
  return places.slice(0, MAX_SCREEN_CANDIDATES).map((place, index) => ({
    no: index + 1,
    name: place.name,
    address: place.address || "",
    hours: place.hours || "",
    fee: place.fee || "",
    reason: place.reason || "",
  }));
}

function truncate(value, max) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function candidateLine(c) {
  const parts = [`${c.no}. ${c.name}`];
  if (c.address) parts.push(truncate(c.address, 40));
  if (c.hours) parts.push(`운영: ${truncate(c.hours, 40)}`);
  if (c.fee) parts.push(`요금: ${truncate(c.fee, 40)}`);
  if (c.reason) parts.push(`설명: ${truncate(c.reason, 150)}`);
  return parts.join(" / ");
}

export function buildScreenPrompt({ region, candidates }) {
  return [
    `너는 "아빠와 아이가 갈 만한 곳"만 모으는 지도 서비스의 편집자다.`,
    `아래는 ${region} 지역에서 공공데이터로 발굴한 후보다. 각각이 우리 지도에 실릴 자격이 있는지 판정하라.`,
    ``,
    `핵심 질문: 아빠가 아이를 데리고 **일부러 찾아갈** 곳인가, 아니면 근처 사람만 지나가는 동네 산책로인가?`,
    ``,
    `점수 기준 (1~5)`,
    `5 — 그곳에 가는 것 자체가 나들이의 목적이 된다 (동물원, 과학관, 체험시설, 테마파크, 대형 수목원)`,
    `4 — 목적지가 될 만하다. 아이가 할 것이 뚜렷하다`,
    `3 — 갈 만하다. 아이를 위한 요소가 어느 정도 있다`,
    `2 — 동네 사람에겐 좋지만 일부러 갈 이유는 약하다 (근린공원, 체육공원, 하천 산책로)`,
    `1 — 아이와 무관하거나 부적합하다`,
    ``,
    `판정 시 유의할 것`,
    `- 이름에 "공원"이 들어가도 수목원·생태공원·테마공원은 목적지가 될 수 있다. 반대로 "○○근린공원", "○○체육공원"은 대개 2점이다.`,
    `- 전면 예약제이거나 아이 1인당 비용이 큰 곳은 "가볍게 다녀오는 곳"이 아니므로 낮춘다.`,
    `- 설명이 부실하다는 이유로 낮추지 말고, 장소의 성격만 본다.`,
    `- 목록에 없는 장소는 절대 만들어내지 않는다. 주어진 번호로만 답한다.`,
    ``,
    `후보`,
    ...candidates.map(candidateLine),
    ``,
    `출력 형식 — 설명 없이 JSON만 출력한다. 모든 후보를 빠짐없이 포함한다.`,
    `{"verdicts":[{"no":<번호>,"score":<1~5>,"reason":"<판정 이유 한 문장, 40자 이내>"}]}`,
  ].join("\n");
}

// 모델이 코드펜스로 감싸거나 앞뒤에 말을 붙이는 경우가 있다.
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

// 없는 번호, 중복, 범위 밖 점수를 전부 걸러낸다. 판정이 빠진 후보는 통과시키지
// 않는다 — 사람이 다시 보게 두는 편이 근거 없이 등록되는 것보다 낫다.
export function parseVerdicts(responseText, candidates) {
  const parsed = extractJson(responseText);
  const list = parsed && Array.isArray(parsed.verdicts) ? parsed.verdicts : null;
  if (!list) return { ok: false, error: "JSON 파싱 실패", verdicts: [] };

  const byNo = new Map(candidates.map((c) => [c.no, c]));
  const seen = new Set();
  const verdicts = [];

  for (const item of list) {
    const no = Number(item && item.no);
    const candidate = byNo.get(no);
    if (!candidate || seen.has(no)) continue;
    const score = Number(item.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) continue;
    seen.add(no);
    verdicts.push({
      no,
      name: candidate.name,
      score,
      reason: truncate(item.reason, 100),
      pass: score >= PASS_SCORE,
    });
  }

  if (verdicts.length === 0) return { ok: false, error: "유효한 판정 없음", verdicts: [] };
  const missing = candidates.filter((c) => !seen.has(c.no)).map((c) => c.name);
  return { ok: true, verdicts, missing };
}

/**
 * 지역 하나의 후보를 심사한다.
 *
 * @param {object} deps
 * @param {string} deps.region
 * @param {Array} deps.places 발굴 결과 (name/address/hours/fee/reason)
 * @param {(prompt: string) => Promise<string>} deps.askClaude
 */
export async function screenCandidates({ region, places, askClaude }) {
  const candidates = buildScreenCandidates(places);
  if (candidates.length === 0) return { ok: true, verdicts: [], missing: [] };

  let responseText;
  try {
    responseText = await askClaude(buildScreenPrompt({ region, candidates }));
  } catch (err) {
    return { ok: false, error: `호출 실패: ${err.message}`, verdicts: [] };
  }
  return parseVerdicts(responseText, candidates);
}
