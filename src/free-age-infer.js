// 유료 시설의 "몇 살까지 무료인지"를 판정한다.
//
// 검수에서 확인된 5곳이 5곳 다 틀렸던 필드다. 원인은 블로그였다 — 글쓴이가
// 자기 아이 나이를 적은 걸 그대로 가져왔다. 그래서 다른 필드와 달리 이 값은
// **블로그를 근거로 쓰면 안 된다.** 매표소 기준을 적어 둔 공식 안내만 인정한다.
//
// 틀리는 방향도 양쪽 다 나왔다. 실제보다 좁게 적히면 낼 필요 없는 돈을 내고,
// 넓게 적히면 무료인 줄 알고 갔다가 현장에서 결제한다. 뒤쪽이 더 나쁘다.
//
// 순수 함수만 담고 검색 호출은 인자로 주입받는다.

export const PLACES_PER_CALL = 5;

export function buildAgePrompt(entries) {
  const lines = [
    `아래 장소들의 "무료입장 연령"을 각 시설의 공식 홈페이지·매표소 안내 기준으로 확인하라.`,
    ``,
    `규칙 — 아이 데리고 가는 부모가 보는 정보다. 틀리면 현장에서 예상 못 한 돈을 낸다.`,
    `- 공식 홈페이지·공공기관 안내에 적힌 것만 인정한다. 블로그 후기는 근거로 쓰지 마라.`,
    `  블로그 글쓴이는 자기 아이 나이만 적는 경우가 많아 실제 기준과 다르다.`,
    `- 확인이 안 되면 반드시 null. 추측해서 적지 마라.`,
    `- 같은 이름의 다른 지역 시설과 헷갈리지 않게 주소를 확인하라.`,
    `- 표기는 원문 그대로 쓴다. "36개월 미만", "만 4세 이하", "24개월 미만" 등.`,
    `  "무료" 같은 말은 붙이지 말고 연령 조건만 적는다.`,
    `- 무료 연령이 아예 없는 시설(모든 연령 유료)이면 "없음".`,
    `- 시설 안에 요금이 여러 개면 대표 입장료 기준으로 적는다.`,
    ``,
  ];
  for (const e of entries) {
    lines.push(`${e.no}. ${e.name} — ${e.addr}${e.fee ? ` (현재 입장료: ${e.fee})` : ""}`);
  }
  lines.push(
    ``,
    `출력 형식 — 설명 없이 JSON만 출력한다. 모든 장소를 빠짐없이 포함한다.`,
    `{"ages":[{"no":<번호>,"age":<"36개월 미만" | "없음" | null>,"source":"<근거 출처, 40자 이내>"}]}`
  );
  return lines.join("\n");
}

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
          // 다음 후보로
        }
      }
    }
  }
  return null;
}

// 연령처럼 보이지 않는 답을 걸러낸다. "홈페이지 참고" 같은 문장이 이 칸에
// 들어가면 앱 상세페이지에 그대로 노출된다.
const AGE_SHAPE = /^(없음|\d+\s*(개월|세)\s*(미만|이하)|만\s*\d+\s*세\s*(미만|이하)|미취학|영유아)/;

export function parseAges(responseText, entries) {
  const parsed = extractJson(responseText);
  const list = parsed && Array.isArray(parsed.ages) ? parsed.ages : null;
  if (!list) return { ok: false, error: "JSON 파싱 실패", results: [] };

  const byNo = new Map(entries.map((e) => [e.no, e]));
  const seen = new Set();
  const results = [];

  for (const item of list) {
    const no = Number(item && item.no);
    const entry = byNo.get(no);
    if (!entry || seen.has(no)) continue;
    seen.add(no);

    const age = typeof item.age === "string" ? item.age.trim() : "";
    if (!age || !AGE_SHAPE.test(age) || age.length > 40) {
      results.push({ no, name: entry.name, age: null, source: "" });
      continue;
    }
    results.push({ no, name: entry.name, age, source: String(item.source || "").slice(0, 80) });
  }

  if (results.length === 0) return { ok: false, error: "유효한 판정 없음", results: [] };
  return { ok: true, results };
}

/**
 * 장소 묶음의 무료입장 연령을 판정한다.
 *
 * @param {Array} entries [{ no, name, addr, fee }]
 * @param {(prompt: string) => Promise<string>} askWeb 웹 근거를 붙여 답하는 검색 모델
 */
export async function inferAges(entries, askWeb) {
  if (!entries.length) return { ok: true, results: [] };
  let responseText;
  try {
    responseText = await askWeb(buildAgePrompt(entries));
  } catch (err) {
    return { ok: false, error: `호출 실패: ${err.message}`, results: [] };
  }
  return parseAges(responseText, entries);
}
