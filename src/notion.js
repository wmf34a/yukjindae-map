export function text(prop) {
  if (!prop || !prop.rich_text || prop.rich_text.length === 0) return "";
  return prop.rich_text.map((t) => t.plain_text).join("");
}

export function title(prop) {
  if (!prop || !prop.title || prop.title.length === 0) return "";
  return prop.title.map((t) => t.plain_text).join("");
}

export function selectName(prop) {
  return prop && prop.select ? prop.select.name : "";
}

export function multiSelectNames(prop) {
  if (!prop || !prop.multi_select) return [];
  return prop.multi_select.map((o) => o.name);
}

export function firstFileUrl(prop) {
  if (!prop || !prop.files || prop.files.length === 0) return "";
  const f = prop.files[0];
  if (f.type === "external") return f.external.url;
  if (f.type === "file") return f.file.url;
  return "";
}

// firstFileUrl과 달리 Notion 자체 호스팅 파일(type: "file")의 URL은 시간이 지나면
// 만료되는 서명 URL이라, R2 미러링 시 안정적인 소스 식별자(쿼리스트링 제외)가 따로 필요하다.
export function firstFileSource(prop) {
  if (!prop || !prop.files || prop.files.length === 0) return null;
  const f = prop.files[0];
  if (f.type === "external") return { url: f.external.url, stable: true };
  if (f.type === "file") return { url: f.file.url, stable: false };
  return null;
}

export function toPlace(page) {
  const p = page.properties;
  return {
    id: page.id,
    createdAt: page.created_time,
    name: title(p["장소명"]),
    region: selectName(p["지역"]),
    categories: multiSelectNames(p["카테고리"]),
    address: text(p["주소"]),
    lat: p["위도"] && p["위도"].number,
    lng: p["경도"] && p["경도"].number,
    image: firstFileUrl(p["사진"]),
    hours: text(p["운영시간"]),
    fee: text(p["입장료"]),
    reason: text(p["추천이유"]),
    parkingAvailable: selectName(p["주차가능여부"]),
    parkingDetail: text(p["주차상세"]),
    strollerAccess: selectName(p["유모차동선"]),
    diaperChange: p["기저귀교환대"] && p["기저귀교환대"].checkbox,
    nursingRoom: p["수유실"] && p["수유실"].checkbox,
    nearbyRestaurant: text(p["근처맛집"]),
    nearbyCafe: text(p["근처카페"]),
    registeredBy: text(p["등록자"]),
  };
}

export function toBanner(page) {
  const p = page.properties;
  return {
    id: page.id,
    createdAt: page.created_time,
    title: title(p["제목"]),
    tagline: text(p["문구"]),
    link: (p["링크"] && p["링크"].url) || "",
    order: (p["순서"] && p["순서"].number) ?? 0,
    imageSource: firstFileSource(p["이미지"]),
  };
}

export function toCourse(page) {
  const p = page.properties;
  return {
    id: page.id,
    createdAt: page.created_time,
    name: title(p["코스명"]),
    description: text(p["설명"]),
    imageSource: firstFileSource(p["대표이미지"]),
    placeIds: (p["장소"] && p["장소"].relation ? p["장소"].relation : []).map((r) => r.id),
  };
}

export function toFestival(page) {
  const p = page.properties;
  const date = p["기간"] && p["기간"].date;
  return {
    id: page.id,
    createdAt: page.created_time,
    title: title(p["제목"]),
    periodStart: (date && date.start) || "",
    periodEnd: (date && date.end) || "",
    placeName: text(p["장소명"]),
    imageSource: firstFileSource(p["이미지"]),
    link: (p["링크"] && p["링크"].url) || "",
    region: selectName(p["지역"]),
    order: (p["순서"] && p["순서"].number) ?? 0,
  };
}
