// 블로그 후기에서 유아 편의시설을 찾아낸다.
//
// 수유실이 있는지는 어떤 지도 API도 알려주지 않는다. 224곳 중 98곳이 세 항목
// 모두 비어 있는데, 사람이 하나씩 확인하는 건 현실적이지 않다.
//
// 입장료(fee-infer.js)와 같은 얼개지만 규칙이 하나 더 엄격하다:
// **"없음"은 절대 쓰지 않는다.** 체크박스를 끄는 것은 "확인해 보니 없더라"는
// 뜻인데, 블로그에 언급이 없다는 것은 없다는 뜻이 아니라 아무도 안 적었다는
// 뜻일 뿐이다. 기저귀 갈 곳을 찾아 헤매게 만드는 쪽이, 있는 걸 모르고 지나치는
// 것보다 훨씬 나쁘다.
//
// 순수 함수만 담고 Claude 호출은 인자로 주입받는다.

import { mentionsPlace, isRecent } from "./place-pipeline.js";
import { matchToken } from "./fee-infer.js";

export const AMENITY_FIELDS = ["수유실", "기저귀교환대", "유아의자"];

// 이 단어가 없는 글은 AI에게 읽힐 이유가 없다.
const AMENITY_WORDS = /수유|기저귀|유아의자|아기의자|하이체어|아기 의자|유아용 의자|파우더룸|가족휴게실/;

export const MAX_SNIPPETS_PER_PLACE = 8;
export const PLACES_PER_CALL = 4;

export function pickAmenitySnippets(items, { name, regions }, now = Date.now()) {
  const tokens = (Array.isArray(regions) ? regions : [regions]).map(matchToken).filter(Boolean);
  const picked = [];
  const seen = new Set();
  for (const item of items || []) {
    if (tokens.length && !tokens.some((t) => mentionsPlace(item, name, t))) continue;
    if (!tokens.length && !mentionsPlace(item, name)) continue;
    if (!isRecent(item.date, now)) continue;
    const text = `${item.title || ""} ${item.description || ""}`.replace(/\s+/g, " ").trim();
    if (!AMENITY_WORDS.test(text)) continue;
    // 같은 글이 블로그·카페 검색 양쪽에 걸리는 일이 잦다.
    if (seen.has(text)) continue;
    seen.add(text);
    picked.push({ date: item.date || "", text: text.slice(0, 240), link: item.link || "" });
    if (picked.length >= MAX_SNIPPETS_PER_PLACE) break;
  }
  return picked;
}

export function buildAmenityPrompt(entries) {
  const lines = [
    `너는 아이와 갈 만한 곳을 소개하는 지도 서비스의 데이터 검수자다.`,
    `아래는 장소별로 모은 최근 블로그·카페 글 조각이다. 유아 편의시설이 있는지 판정하라.`,
    ``,
    `판정 항목: 수유실, 기저귀교환대, 유아의자`,
    ``,
    `규칙 — 부모가 이 정보를 믿고 아기를 데리고 간다. 틀리면 현장에서 곤란해진다.`,
    `- true는 "있다는 언급을 실제로 확인했다"는 뜻이다. 서로 다른 글 2개 이상이`,
    `  말하거나, 한 글이라도 위치까지 구체적으로 적었으면("2층 로비 옆 수유실") true.`,
    `- 언급이 없으면 반드시 null이다. false를 쓰지 마라. 글에 안 나온 것은`,
    `  없다는 뜻이 아니라 아무도 적지 않았다는 뜻일 뿐이다.`,
    `- "없어요", "따로 없다"처럼 없다고 명시한 글이 있을 때만 false.`,
    `- 근처 카페나 다른 지역의 같은 이름 시설을 말하는 글은 무시한다.`,
    `- 기저귀교환대는 "기저귀 갈이대", "기저귀 갈 곳"도 같은 뜻이다.`,
    `- 유아의자는 식당·카페의 "아기의자", "하이체어"를 포함한다.`,
    ``,
  ];
  for (const e of entries) {
    lines.push(`### ${e.no}. ${e.name} (${e.region})`);
    for (const s of e.snippets) lines.push(`- (${s.date || "날짜미상"}) ${s.text}`);
    lines.push("");
  }
  lines.push(
    `출력 형식 — 설명 없이 JSON만 출력한다. 모든 장소를 빠짐없이 포함한다.`,
    `{"places":[{"no":<번호>,"수유실":<true|false|null>,"기저귀교환대":<true|false|null>,"유아의자":<true|false|null>,"basis":"<근거 한 문장, 40자 이내>"}]}`
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

export function parseAmenities(responseText, entries) {
  const parsed = extractJson(responseText);
  const list = parsed && Array.isArray(parsed.places) ? parsed.places : null;
  if (!list) return { ok: false, error: "JSON 파싱 실패", results: [] };

  const byNo = new Map(entries.map((e) => [e.no, e]));
  const seen = new Set();
  const results = [];

  for (const item of list) {
    const no = Number(item && item.no);
    const entry = byNo.get(no);
    if (!entry || seen.has(no)) continue;
    seen.add(no);

    const fields = {};
    for (const field of AMENITY_FIELDS) {
      // true만 받는다. 모델이 무심코 false를 넣어도 우리는 켜지도 끄지도 않는다 —
      // 체크박스를 끄는 것은 "확인해 보니 없더라"는 단언인데 근거가 그만큼 없다.
      fields[field] = item[field] === true ? true : null;
    }
    results.push({ no, name: entry.name, fields, basis: String(item.basis || "").slice(0, 100) });
  }

  if (results.length === 0) return { ok: false, error: "유효한 판정 없음", results: [] };
  return { ok: true, results };
}

// 노션에 보낼 속성만 만든다. true인 항목만 담아, 판정이 없는 항목은 손대지 않는다.
export function buildAmenityProperties(fields) {
  const props = {};
  for (const field of AMENITY_FIELDS) {
    if (fields[field] === true) props[field] = { checkbox: true };
  }
  return props;
}

export async function inferAmenities(entries, askClaude) {
  if (!entries.length) return { ok: true, results: [] };
  let responseText;
  try {
    responseText = await askClaude(buildAmenityPrompt(entries));
  } catch (err) {
    return { ok: false, error: `호출 실패: ${err.message}`, results: [] };
  }
  return parseAmenities(responseText, entries);
}
