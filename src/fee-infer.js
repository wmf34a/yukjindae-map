// 블로그 후기에서 입장료를 뽑아낸다.
//
// TourAPI는 공원·수목원의 요금 필드를 대부분 비워 둔다. 58곳을 등록해 보니 51곳이
// 그랬다. 그렇다고 "공원이니 무료겠지"로 채우면 틀렸을 때 고객이 헛걸음하고,
// 51곳을 사람이 하나씩 확인하는 것도 현실적이지 않다.
//
// 그래서 최근 후기를 모아 AI에게 읽히되, 확신이 서는 것만 채운다. 채워진 값도
// "확인됨"이 아니라 "블로그힌트"로만 표시된다 — enrich.js가 편의시설에 쓰는 것과
// 같은 규칙이다. 사람이 보고 승격시켜야 확정이 된다.
//
// 순수 함수만 담고 Claude 호출은 인자로 주입받는다.

import { mentionsPlace, isRecent } from "./place-pipeline.js";

// 요금 이야기가 나오는 글만 추린다. 이 단어가 없으면 AI에게 읽힐 이유가 없다.
const FEE_WORDS = /입장료|이용료|관람료|요금|무료|원\s*$|,000원|천원/;

// 한 장소에 이만큼이면 판단에 충분하고, 더 실으면 프롬프트만 커진다.
export const MAX_SNIPPETS_PER_PLACE = 6;

// 한 번에 묶어 물어보는 장소 수. 장소마다 부르면 호출이 51번이 된다.
export const PLACES_PER_CALL = 5;

// 블로그는 "청주시"가 아니라 "청주"라고 쓴다. 행정구역 접미사를 그대로 두면
// 실제 후기가 전부 걸러진다.
export function matchToken(region) {
  return String(region || "").replace(/[시군구]$/, "");
}

// 시·군·구 하나만 보면 "마포구"를 안 쓰고 "서울 난지한강공원"이라 적은 글을 통째로
// 놓친다. 시·도까지 후보로 두고 하나만 맞아도 통과시킨다.
export function pickFeeSnippets(items, { name, regions }, now = Date.now()) {
  const tokens = (Array.isArray(regions) ? regions : [regions])
    .map(matchToken).filter(Boolean);
  const picked = [];
  for (const item of items || []) {
    if (tokens.length && !tokens.some((t) => mentionsPlace(item, name, t))) continue;
    if (!tokens.length && !mentionsPlace(item, name)) continue;
    if (!isRecent(item.date, now)) continue;
    const text = `${item.title || ""} ${item.description || ""}`.replace(/\s+/g, " ").trim();
    if (!FEE_WORDS.test(text)) continue;
    picked.push({ date: item.date || "", text: text.slice(0, 220), link: item.link || "" });
    if (picked.length >= MAX_SNIPPETS_PER_PLACE) break;
  }
  return picked;
}

export function buildFeePrompt(entries) {
  const lines = [
    `너는 아이와 갈 만한 곳을 소개하는 지도 서비스의 데이터 검수자다.`,
    `아래는 장소별로 모은 최근 블로그 후기 조각이다. 각 장소의 입장료를 판정하라.`,
    ``,
    `규칙 — 이 서비스는 정보가 틀리면 고객이 헛걸음한다. 확신이 없으면 반드시 null을 반환하라.`,
    `- 서로 다른 글 2개 이상이 같은 내용을 말할 때만 확정한다. 한 글만 말하면 null.`,
    `- 후기가 다른 장소(근처 카페, 같은 이름의 다른 지역 시설)를 말하는 것 같으면 무시한다.`,
    `- 금액이 불분명하거나 글마다 다르면 null. 추측해서 적지 마라.`,
    `- 무료가 확실하면 "무료".`,
    `- 유료면 대상별로 적는다. 예: "어른 1,000원 / 어린이 500원"`,
    `- 주차료·체험료·식비는 입장료가 아니다. 섞지 마라.`,
    `- 공원은 무료인데 안의 주요 시설(박물관·전시관·체험관)이 유료면 함께 적는다.`,
    `  예: "무료 (서대문형무소역사관 별도 유료)" — 사람들이 그 시설 때문에 가는데`,
    `  "무료"라고만 적으면 현장에서 예상 못 한 요금을 만나게 된다.`,
    ``,
  ];
  for (const e of entries) {
    lines.push(`### ${e.no}. ${e.name} (${e.region})`);
    for (const s of e.snippets) lines.push(`- (${s.date || "날짜미상"}) ${s.text}`);
    lines.push("");
  }
  lines.push(
    `출력 형식 — 설명 없이 JSON만 출력한다. 모든 장소를 빠짐없이 포함한다.`,
    `{"fees":[{"no":<번호>,"fee":<"무료" | "어른 1,000원 / 어린이 500원" | null>,"basis":"<근거 한 문장, 40자 이내>"}]}`
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

// 금액처럼 보이지 않는 답을 걸러낸다. "확인 필요", "블로그 참고" 같은 문장이
// 입장료 칸에 들어가면 앱에서 그대로 노출된다.
// "무료"로 시작하거나(뒤에 유료 시설 단서가 붙을 수 있다) 실제 숫자+원이 있어야 한다.
const FEE_SHAPE = /^무료|\d[\d,]*\s*원/;

export function parseFees(responseText, entries) {
  const parsed = extractJson(responseText);
  const list = parsed && Array.isArray(parsed.fees) ? parsed.fees : null;
  if (!list) return { ok: false, error: "JSON 파싱 실패", results: [] };

  const byNo = new Map(entries.map((e) => [e.no, e]));
  const seen = new Set();
  const results = [];

  for (const item of list) {
    const no = Number(item && item.no);
    const entry = byNo.get(no);
    if (!entry || seen.has(no)) continue;
    seen.add(no);

    const raw = item.fee;
    const fee = typeof raw === "string" ? raw.trim() : "";
    if (!fee || !FEE_SHAPE.test(fee) || fee.length > 120) {
      results.push({ no, name: entry.name, fee: null, basis: "" });
      continue;
    }
    results.push({ no, name: entry.name, fee, basis: String(item.basis || "").slice(0, 100) });
  }

  if (results.length === 0) return { ok: false, error: "유효한 판정 없음", results: [] };
  return { ok: true, results };
}

/**
 * 장소 묶음의 입장료를 판정한다.
 *
 * @param {Array} entries [{ no, name, region, snippets }]
 * @param {(prompt: string) => Promise<string>} askClaude
 */
export async function inferFees(entries, askClaude) {
  if (!entries.length) return { ok: true, results: [] };
  let responseText;
  try {
    responseText = await askClaude(buildFeePrompt(entries));
  } catch (err) {
    return { ok: false, error: `호출 실패: ${err.message}`, results: [] };
  }
  return parseFees(responseText, entries);
}
