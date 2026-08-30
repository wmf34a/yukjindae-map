// 블로그 후기에서 주차 요금을 뽑아낸다.
//
// 지역장들이 현장에서 확인해 준 제보 17건 중 12건이 우리 `주차가능여부`와 달랐고,
// 그중 8건은 "무료"라고 적혀 있었지만 실제로는 유료였다. 헛걸음까진 아니어도
// 아이를 태운 차로 도착해서 예상 못 한 요금을 만나는 건 나쁜 경험이다.
//
// 공식 홈페이지는 주차 요금을 거의 안 적는다. 44곳을 웹 검색으로 확인해 보니
// 3곳 중 1곳만 답이 나왔다. 반면 블로그 후기는 주차 요금을 꼭 적는다 —
// "주차장 넓고 무료라 좋았어요" 같은 문장이 후기의 기본 구성이다.
//
// 그래서 fee-infer.js 와 같은 방식을 쓴다: 최근 후기를 모아 AI에게 읽히되
// 확신이 서는 것만 채우고, 채운 값은 "블로그힌트"로 표시해 사람이 승격하게 한다.
//
// 순수 함수만 담고 Claude 호출은 인자로 주입받는다.

import { mentionsPlace } from "./place-pipeline.js";

// 주차 이야기가 나오는 글만 추린다. "주차"가 없으면 AI에게 읽힐 이유가 없다.
const PARKING_WORDS = /주차/;

// 편의시설(수유실·기저귀대)은 1년만 지나도 못 믿는다. 주차 요금은 그보다 훨씬
// 안 바뀐다 — 특히 "무료냐 유료냐"는 주차장을 새로 짓지 않는 한 그대로다.
// place-pipeline의 짧은 창을 그대로 쓰면 근거가 있는 글까지 전부 버려진다
// (국립산악박물관은 주차 무료를 명시한 글 6건이 전부 이 필터에서 탈락했다).
export const PARKING_MAX_AGE_DAYS = 1095;

export function isRecentEnough(postdate, now = Date.now()) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(postdate || ""));
  if (!m) return true; // 날짜가 없으면 판단하지 않고 통과시킨다
  const posted = new Date(`${m[1]}-${m[2]}-${m[3]}`).getTime();
  return now - posted <= PARKING_MAX_AGE_DAYS * 86400000;
}

export const MAX_SNIPPETS_PER_PLACE = 6;
export const PLACES_PER_CALL = 5;

// 블로그는 "청주시"가 아니라 "청주"라고 쓴다. 행정구역 접미사를 그대로 두면
// 실제 후기가 전부 걸러진다.
export function matchToken(region) {
  return String(region || "").replace(/[시군구]$/, "");
}

// 우리 DB의 장소명은 "나주 국립나주박물관", "김해 워터파크(롯데워터파크 기준)" 처럼
// 지역 접두어나 괄호 주석을 달고 있다. 블로그는 "국립나주박물관", "롯데워터파크"
// 라고만 쓴다. 이름을 그대로 대조하면 근거가 있는 글이 통째로 탈락한다 —
// 남은 30곳 중 8곳이 이 이유로 "근거 없음"이었다.
export function nameVariants(name) {
  const raw = String(name || "").trim();
  const out = [raw];
  const paren = /[(（]([^)）]+)[)）]/.exec(raw);
  // "(롯데워터파크 기준)" 처럼 진짜 이름이 괄호 안에 있는 경우
  if (paren) {
    out.push(raw.replace(/\s*[(（][^)）]*[)）]\s*/g, "").trim());
    out.push(paren[1].replace(/\s*기준\s*$/, "").trim());
  }
  // "나주 국립나주박물관" 의 앞 토막을 떼어 본다. 뒤쪽이 너무 짧으면(=이름이
  // 아니라 수식어를 뗀 것) 버린다.
  const head = raw.replace(/\s*[(（][^)）]*[)）]\s*/g, "").trim();
  const sp = head.indexOf(" ");
  if (sp > 0 && head.length - sp - 1 >= 5) out.push(head.slice(sp + 1));
  return [...new Set(out.filter((v) => v.length >= 3))];
}

export function pickParkingSnippets(items, { name, regions }, now = Date.now()) {
  const variants = nameVariants(name);
  const tokens = (Array.isArray(regions) ? regions : [regions])
    .map(matchToken).filter(Boolean);
  const picked = [];
  const seenLinks = new Set();
  for (const item of items || []) {
    const hit = tokens.length
      ? variants.some((v) => tokens.some((t) => mentionsPlace(item, v, t)))
      : variants.some((v) => mentionsPlace(item, v));
    if (!hit) continue;
    if (!isRecentEnough(item.date, now)) continue;
    const text = `${item.title || ""} ${item.description || ""}`.replace(/\s+/g, " ").trim();
    if (!PARKING_WORDS.test(text)) continue;
    // 지역을 붙인 검색과 안 붙인 검색이 같은 글을 물어 온다. 같은 글을 두 번
    // 실으면 AI가 "서로 다른 글 2개"로 착각해 한 글만 보고 확정해 버린다.
    const key = item.link || text;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    picked.push({ date: item.date || "", text: text.slice(0, 220), link: item.link || "" });
    if (picked.length >= MAX_SNIPPETS_PER_PLACE) break;
  }
  return picked;
}

export function buildParkingPrompt(entries) {
  const lines = [
    `너는 아이와 갈 만한 곳을 소개하는 지도 서비스의 데이터 검수자다.`,
    `아래는 장소별로 모은 최근 블로그 후기 조각이다. 각 장소의 "주차 요금"을 판정하라.`,
    ``,
    `규칙 — 이 서비스는 정보가 틀리면 아이를 태운 차가 현장에서 당황한다.`,
    `확신이 없으면 반드시 null을 반환하라. 채우지 못하는 것보다 틀리게 채우는 게 훨씬 나쁘다.`,
    `- 서로 다른 글 2개 이상이 같은 내용을 말할 때만 확정한다. 한 글만 말하면 null.`,
    `- 후기가 다른 장소(근처 카페, 같은 이름의 다른 지역 시설)를 말하는 것 같으면 무시한다.`,
    `- "주차장이 넓다", "주차 편하다"는 요금 정보가 아니다. 이것만 있으면 null.`,
    `- 입장료·체험료는 주차료가 아니다. "입장료 무료"를 주차 무료로 읽지 마라.`,
    `- 무료가 확실하면 status="무료".`,
    `- 유료면 status="유료" 이고 detail에 요금을 적는다. 예: "1일 2,000원"`,
    `- 주차장이 아예 없거나 인근 노상에 대야 하면 status="불가".`,
    `- 성수기·주말만 유료인 곳은 status="유료", detail에 조건을 적는다.`,
    `  예: "평일 무료 / 주말·성수기 2,000원" — 조건을 빼면 현장에서 예상 못 한 요금을 만난다.`,
    `- detail에는 요금과 규모만 적는다. 40자 이내. 감상이나 "블로그 참고" 같은 말은 금지.`,
    `- 각 조각 앞의 날짜는 글이 쓰인 날이다. 3년 전 글 하나만 유료라 말하고 최근 글들이`,
    `  무료라 하면 요금제가 바뀐 것이니 최근 쪽을 따른다. 반대도 마찬가지다.`,
    ``,
  ];
  for (const e of entries) {
    lines.push(`### ${e.no}. ${e.name} (${e.region})`);
    for (const s of e.snippets) lines.push(`- (${s.date || "날짜미상"}) ${s.text}`);
    lines.push("");
  }
  lines.push(
    `출력 형식 — 설명 없이 JSON만 출력한다. 모든 장소를 빠짐없이 포함한다.`,
    `{"parking":[{"no":<번호>,"status":<"무료" | "유료" | "불가" | null>,"detail":"<요금·규모, 40자 이내, 없으면 빈 문자열>","basis":"<근거 한 문장, 40자 이내>"}]}`
  );
  return lines.join("\n");
}

// 블로그 근거로도 못 채운 곳에 쓴다. 웹 근거를 붙여 답하는 검색 모델에게
// 공식 안내·최근 후기를 직접 찾게 한다. 판정 형식은 블로그 쪽과 같아서
// parseParking 을 그대로 쓴다.
export function buildParkingWebPrompt(entries) {
  const lines = [
    `아래 장소들의 "주차 요금"을 확인하라. 공식 홈페이지·지자체 안내·최근 방문 후기를 근거로 삼는다.`,
    ``,
    `규칙 — 아이를 태운 차가 현장에서 당황하지 않게 하는 게 목적이다.`,
    `- 확인이 안 되면 반드시 null. 추측해서 적지 마라.`,
    `- 같은 이름의 다른 지역 시설과 헷갈리지 않게 주소를 확인하라.`,
    `- 입장료·체험료는 주차료가 아니다. "입장료 무료"를 주차 무료로 읽지 마라.`,
    `- "주차장이 넓다"는 요금 정보가 아니다.`,
    `- 무료면 status="무료", 유료면 status="유료" 이고 detail에 요금을 적는다.`,
    `- 주차장이 없거나 인근 노상에 대야 하면 status="불가".`,
    `- 성수기·주말만 유료면 status="유료", detail에 조건을 적는다.`,
    `- detail은 요금과 규모만, 40자 이내. "확인 필요" 같은 말은 금지.`,
    ``,
  ];
  for (const e of entries) lines.push(`${e.no}. ${e.name} — ${e.addr || ""}`);
  lines.push(
    ``,
    `출력 형식 — 설명 없이 JSON만 출력한다. 모든 장소를 빠짐없이 포함한다.`,
    `{"parking":[{"no":<번호>,"status":<"무료" | "유료" | "불가" | null>,"detail":"<요금·규모, 40자 이내>","basis":"<근거 출처, 40자 이내>"}]}`
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

// 노션 select 옵션에 없는 값이 오면 PATCH가 통째로 실패한다.
const STATUSES = new Set(["무료", "유료", "불가"]);

// "확인 필요", "블로그 참고" 같은 문장이 주차상세 칸에 들어가면 앱에 그대로 노출된다.
const DETAIL_JUNK = /확인|참고|추정|불명|알 수 없/;

export function parseParking(responseText, entries) {
  const parsed = extractJson(responseText);
  const list = parsed && Array.isArray(parsed.parking) ? parsed.parking : null;
  if (!list) return { ok: false, error: "JSON 파싱 실패", results: [] };

  const byNo = new Map(entries.map((e) => [e.no, e]));
  const seen = new Set();
  const results = [];

  for (const item of list) {
    const no = Number(item && item.no);
    const entry = byNo.get(no);
    if (!entry || seen.has(no)) continue;
    seen.add(no);

    const status = typeof item.status === "string" ? item.status.trim() : "";
    if (!STATUSES.has(status)) {
      results.push({ no, name: entry.name, status: null, detail: "", basis: "" });
      continue;
    }
    let detail = String(item.detail || "").trim().slice(0, 60);
    if (DETAIL_JUNK.test(detail)) detail = "";
    // 유료인데 금액이 없으면 앱에서 "유료"만 보이고 얼마인지 모른다. 그래도
    // "유료"라는 사실만으로도 무료로 잘못 아는 것보다는 낫다 — 상세만 비운다.
    results.push({ no, name: entry.name, status, detail, basis: String(item.basis || "").slice(0, 100) });
  }

  if (results.length === 0) return { ok: false, error: "유효한 판정 없음", results: [] };
  return { ok: true, results };
}

/**
 * 장소 묶음의 주차 요금을 판정한다.
 *
 * @param {Array} entries [{ no, name, region, snippets }]
 * @param {(prompt: string) => Promise<string>} askClaude
 */
export async function inferParking(entries, askClaude) {
  if (!entries.length) return { ok: true, results: [] };
  let responseText;
  try {
    responseText = await askClaude(buildParkingPrompt(entries));
  } catch (err) {
    return { ok: false, error: `호출 실패: ${err.message}`, results: [] };
  }
  return parseParking(responseText, entries);
}
