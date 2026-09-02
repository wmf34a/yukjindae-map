// 사람이 알려준 수유실을 다룬다.
//
// 지도에 뜨는 2,900곳은 공공 명부라서 지자체·기관 시설에 몰려 있다. 역과 마트,
// 도서관은 많은데 아빠들이 실제로 가는 대형 카페는 스물두 곳뿐이고 그마저 대부분
// 키즈카페다. 없어진 곳이 남아 있기도 하다. 그 빈자리는 다녀온 사람만 안다.
//
// 문제는 검수다. "롯데마트 청량리점 3층"이라고만 오면 운영자가 지도를 열어 찾아보고
// 좌표를 옮겨 적어야 한다. 제보가 쌓이면 그걸 아무도 안 하게 된다.
//
// 그래서 기계가 먼저 조사한다. 이름으로 지도를 검색해 실제로 있는 곳인지, 좌표가
// 어디인지 붙여서 슬랙으로 알린다. 운영자에게 남는 판단은 "이 사람 말이 맞나" 하나다.
// 노션에서 승인하면 좌표까지 붙은 채로 지도에 올라간다.

import { fetchWithTimeout } from "./http.js";
import { notifySlack } from "./notify.js";

export const USER_ROOMS_KV_KEY = "nursing-rooms:user";
export const NEW_NURSING_FIELD = "신규수유실";
export const NURSING_FIX_FIELD = "수유실정보수정";

const NOTION_VERSION = "2022-06-28";

// 제보한 이름으로 지도를 찾아본다. 없는 곳이면 그렇다고 알려주는 것이 목적이라
// 실패를 숨기지 않는다.
export async function lookupPlace(kakaoKey, name) {
  if (!kakaoKey || !name) return null;
  const qs = new URLSearchParams({ query: name, size: "5" });
  try {
    const res = await fetchWithTimeout(
      `https://dapi.kakao.com/v2/local/search/keyword.json?${qs}`,
      { headers: { Authorization: `KakaoAK ${kakaoKey}` } },
      8000
    );
    if (!res.ok) return null;
    const docs = (await res.json()).documents || [];
    if (docs.length === 0) return null;
    const top = docs[0];
    return {
      name: top.place_name,
      address: top.road_address_name || top.address_name || "",
      lat: Number(top.y),
      lng: Number(top.x),
      candidates: docs.length,
    };
  } catch {
    return null;
  }
}

// 제보 이름에는 "롯데마트 청량리점 3층"처럼 층 정보가 붙어 온다. 그대로 검색하면
// 안 나오므로 뒤쪽 위치 표현을 떼고 한 번 더 찾아본다.
export function trimFloorHint(name) {
  return String(name || "")
    .replace(/\s*(지하\s*)?\d+\s*층.*$/, "")
    .replace(/\s*(내부|안|옆|근처|쪽)\s*$/, "")
    .trim();
}

export async function lookupWithFallback(kakaoKey, name) {
  const direct = await lookupPlace(kakaoKey, name);
  if (direct) return direct;
  const trimmed = trimFloorHint(name);
  if (trimmed && trimmed !== name) return lookupPlace(kakaoKey, trimmed);
  return null;
}

/** 제보 한 건을 조사해 슬랙으로 알린다. 제보가 들어온 직후에 부른다. */
export async function announceNursingReport(env, { field, placeName, value, unverified }) {
  const found = await lookupWithFallback(env.KAKAO_REST_API_KEY, placeName);
  const head = field === NEW_NURSING_FIELD
    ? "🍼 새 수유실 제보"
    : "🍼 수유실 정보 수정 제보";
  const lines = [
    `${head}${unverified ? " (사람 확인 안 됨)" : ""}`,
    `• ${placeName}`,
    `• ${value}`,
  ];
  lines.push(found
    ? `• 지도 확인: ${found.name} (${found.address})${found.candidates > 1 ? ` · 비슷한 곳 ${found.candidates}건` : ""}`
    : "• 지도 확인: 못 찾음 — 이름이 정확한지 봐야 합니다");
  lines.push("• 노션에서 상태를 '승인됨'으로 바꾸면 지도에 올라갑니다");
  await notifySlack(env, lines.join("\n"));
  return found;
}

// 노션에서 "승인됨"으로 바뀐 수유실 제보를 읽는다.
async function fetchApprovedReports(env) {
  const res = await fetchWithTimeout(
    `https://api.notion.com/v1/databases/${env.NOTION_REPORTS_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        "Notion-Version": NOTION_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        page_size: 50,
        filter: {
          and: [
            { property: "상태", select: { equals: "승인됨" } },
            { property: "필드명", select: { equals: NEW_NURSING_FIELD } },
          ],
        },
      }),
    },
    15_000
  );
  if (!res.ok) throw new Error(`노션 조회 실패 ${res.status}`);
  return (await res.json()).results || [];
}

const titleOf = (page) =>
  (page.properties?.["장소명"]?.title || []).map((t) => t.plain_text).join("");
const textOf = (page, key) =>
  (page.properties?.[key]?.rich_text || []).map((t) => t.plain_text).join("");

async function markReport(env, pageId, state) {
  await fetchWithTimeout(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({ properties: { "상태": { select: { name: state } } } }),
  }, 10_000);
}

// 제보 내용에서 아빠 이용 여부를 읽는다. 사람이 자유롭게 쓴 문장이라 확실할 때만
// 판단하고, 애매하면 모른다고 둔다 — 못 들어가는 곳을 갈 수 있다고 하면 안 된다.
export function readFatherAllowed(value) {
  const text = String(value || "");
  if (/아빠.*(불가|안\s*되|못\s*들어|금지)|여성\s*전용|엄마만/.test(text)) return false;
  if (/아빠.*(가능|이용|들어갈|출입)|가족\s*수유실|남녀\s*모두/.test(text)) return true;
  return null;
}

/** 승인된 제보를 지도에 올린다. 주간 크론이 부른다. */
export async function applyApprovedNursingReports(env) {
  if (!env.NOTION_API_KEY || !env.NOTION_REPORTS_DATABASE_ID || !env.RATE_LIMIT) return 0;

  const pages = await fetchApprovedReports(env);
  if (pages.length === 0) return 0;

  let saved = [];
  try {
    saved = JSON.parse((await env.RATE_LIMIT.get(USER_ROOMS_KV_KEY)) || "[]");
  } catch {
    saved = [];
  }

  let added = 0;
  /* oxlint-disable no-await-in-loop -- 노션 쓰기는 초당 제한이 있어 순차로 돈다. */
  for (const page of pages) {
    const name = titleOf(page);
    const value = textOf(page, "제안값");
    const found = await lookupWithFallback(env.KAKAO_REST_API_KEY, name);
    if (!found) {
      // 좌표를 못 구하면 지도에 못 올린다. 반려로 돌려 운영자가 다시 보게 한다.
      await markReport(env, page.id, "반려");
      await notifySlack(env, `🍼 승인된 수유실 제보를 지도에서 못 찾았습니다\n• ${name}\n• 이름을 고쳐 다시 승인해주세요`);
      continue;
    }
    const father = readFatherAllowed(value);
    saved.push({
      name,
      address: found.address,
      place: value.slice(0, 120),
      tel: "",
      lat: found.lat,
      lng: found.lng,
      // 모르면 false 로 둔다. 갈 수 있다고 했다가 못 들어가는 것보다 낫다.
      fatherAllowed: father === true,
      source: "이용자 제보",
      sourceUrl: "",
    });
    await markReport(env, page.id, "반영됨");
    added += 1;
  }
  /* oxlint-enable no-await-in-loop */

  if (added > 0) {
    await env.RATE_LIMIT.put(USER_ROOMS_KV_KEY, JSON.stringify(saved));
    await notifySlack(env, `🍼 제보받은 수유실 ${added}곳을 지도에 올렸습니다`);
  }
  return added;
}
