// 사용자가 추천한 장소를 등록 가능한 형태로 만든다.
//
// 추천 폼은 장소 이름과 좋았던 이유, 그리고 편의시설만 받는다. 운영시간·입장료·
// 좌표는 이름만 있으면 API로 채울 수 있어 물어볼 이유가 없고, 반대로 편의시설은
// 어떤 API도 모르니 다녀온 사람에게 받는 수밖에 없다.
//
// 그래서 여기서는 두 갈래를 합친다 — 기계가 찾은 것과 사람이 알려준 것.
// 사람이 알려준 값이 언제나 이긴다.
//
// 순수 함수만 담고 네트워크는 인자로 주입받는다.

import { pickNearby, formatNearby, regionFromAddress } from "./place-pipeline.js";
import { inferCategories } from "./category-infer.js";

// 제보 저장 형식: 본문 + "\n[편의시설] 수유실:있음 / 주차:무료"
const AMENITY_LINE = /\[편의시설\]\s*(.+)$/m;

const CHECKBOX_FIELDS = new Set(["수유실", "기저귀교환대", "유아의자"]);
const PARKING_VALUES = new Set(["무료", "유료", "없음"]);

export function parseReportValue(raw) {
  const text = String(raw || "");
  const match = AMENITY_LINE.exec(text);
  const reason = text.replace(AMENITY_LINE, "").trim();
  const amenities = {};

  if (match) {
    for (const part of match[1].split("/")) {
      const [key, value] = part.split(":").map((x) => x.trim());
      if (!key || !value) continue;
      if (CHECKBOX_FIELDS.has(key) && (value === "있음" || value === "없음")) amenities[key] = value;
      else if (key === "주차" && PARKING_VALUES.has(value)) amenities[key] = value;
    }
  }
  return { reason, amenities };
}

// 카카오 검색 결과 중 어느 것이 제보된 장소인지 고른다. 이름만 받았으므로
// 같은 이름이 여러 곳일 수 있고, 그때는 사람이 볼 수 있게 후보를 남기는 편이
// 낫다 — 엉뚱한 곳을 만들어 두면 지도에 잘못된 핀이 생긴다.
export function pickPlaceCandidate(docs, name) {
  const wanted = String(name).replace(/\s/g, "");
  const results = (docs || [])
    .filter((d) => d && d.place_name && Number.isFinite(Number(d.x)) && Number.isFinite(Number(d.y)))
    .map((d) => ({
      name: d.place_name,
      address: d.road_address_name || d.address_name || "",
      lat: Number(d.y),
      lng: Number(d.x),
      category: d.category_name || "",
      exact: d.place_name.replace(/\s/g, "") === wanted,
    }));
  if (results.length === 0) return null;
  return results.find((r) => r.exact) || results[0];
}

// "주차: 무료" 같은 제보값을 노션 선택지에 맞춘다. 없으면 확인이 필요하다고 둔다.
function parkingSelect(amenities) {
  const value = amenities["주차"];
  if (value === "무료" || value === "유료") return value;
  if (value === "없음") return "불가";
  return "확인 필요";
}

const rt = (value) => (value ? [{ text: { content: String(value).slice(0, 2000) } }] : []);

/**
 * 노션 장소 DB에 쓸 속성을 만든다.
 *
 * 공개여부는 항상 꺼서 만든다. 사람이 추천한 곳이라도 기계가 채운 값이 섞여 있어
 * 한 번은 눈으로 봐야 한다.
 */
export function buildNewPlaceProperties({ candidate, reason, amenities, nearby, detail, today }) {
  const { restaurants, cafes } = nearby || { restaurants: [], cafes: [] };
  const props = {
    "장소명": { title: [{ text: { content: candidate.name } }] },
    "주소": { rich_text: rt(candidate.address) },
    "위도": { number: candidate.lat },
    "경도": { number: candidate.lng },
    "추천이유": { rich_text: rt(reason) },
    "근처맛집": { rich_text: rt(formatNearby(restaurants)) },
    "근처카페": { rich_text: rt(formatNearby(cafes)) },
    "주차가능여부": { select: { name: parkingSelect(amenities) } },
    // 사용자가 알려준 곳이라는 것을 남긴다. 나중에 어디서 온 데이터인지 가릴 때 쓴다.
    "등록자": { rich_text: rt("사용자 추천") },
    "확인상태": { select: { name: "미확인" } },
    "공개여부": { checkbox: false },
  };

  const region = regionFromAddress(candidate.address);
  if (region) props["지역"] = { select: { name: region } };

  // 카테고리가 비면 카테고리 필터에도 안 걸리고 비 오는 날 실내 추천에서도 빠진다.
  // 이름으로 짐작해 채워 두고, 공개 전에 사람이 한 번 본다.
  const categories = inferCategories({ name: candidate.name, fee: detail?.fee || "" });
  if (categories.length) props["카테고리"] = { multi_select: categories.map((n) => ({ name: n })) };
  if (today) props["정보확인일"] = { date: { start: today } };

  // 편의시설은 제보자가 알려준 것만 쓴다. "없음"이라고 한 것도 그대로 존중한다 —
  // 블로그 추정과 달리 다녀온 사람이 직접 확인한 값이다.
  for (const field of CHECKBOX_FIELDS) {
    if (amenities[field]) props[field] = { checkbox: amenities[field] === "있음" };
  }

  if (detail) {
    if (detail.hours) props["운영시간"] = { rich_text: rt(detail.hours) };
    if (detail.fee) props["입장료"] = { rich_text: rt(detail.fee) };
    if (detail.homepage) props["정보출처"] = { url: detail.homepage };
  }
  return props;
}

/**
 * 추천 한 건을 장소로 만든다.
 *
 * @param {object} deps
 * @param {string} deps.placeName 제보된 장소 이름
 * @param {string} deps.reportValue 제보 본문(편의시설 줄 포함)
 * @param {(name: string) => Promise<Array>} deps.searchPlace 카카오 키워드 검색
 * @param {(coords: object) => Promise<Array>} deps.findNearby 근처 맛집·카페
 * @param {(candidate: object) => Promise<object|null>} deps.fetchDetail 운영시간 등
 * @param {(from, to) => Promise<number|null>} [deps.roadDistance] 없으면 거리를 안 적는다
 */
export async function prepareUserPlace({
  placeName, reportValue, searchPlace, findNearby, fetchDetail, roadDistance, today,
}) {
  const { reason, amenities } = parseReportValue(reportValue);

  const docs = await searchPlace(placeName).catch(() => []);
  const candidate = pickPlaceCandidate(docs, placeName);
  if (!candidate) {
    return { ok: false, error: "장소를 찾지 못했습니다" };
  }

  const nearbyRaw = await findNearby({ lat: candidate.lat, lng: candidate.lng }).catch(() => []);
  const nearby = pickNearby(nearbyRaw, { placeName: candidate.name });

  // 고른 몇 곳만 도로 거리를 잰다. 카카오가 주는 거리는 직선이라 실제와 세 배까지
  // 어긋난다 — 대전 국립중앙과학관에서 팔선생까지 직선 511m, 차로 1,687m다.
  if (roadDistance) {
    const origin = { lat: candidate.lat, lng: candidate.lng };
    for (const item of [...nearby.restaurants, ...nearby.cafes]) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      /* oxlint-disable no-await-in-loop -- 네이버 길찾기는 초당 제한이 있어 순차로 돈다. */
      item.roadDist = await roadDistance(origin, { lat: item.lat, lng: item.lng }).catch(() => null);
    }
  }

  const detail = fetchDetail ? await fetchDetail(candidate).catch(() => null) : null;

  return {
    ok: true,
    candidate,
    properties: buildNewPlaceProperties({ candidate, reason, amenities, nearby, detail, today }),
  };
}
