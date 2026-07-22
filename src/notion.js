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

export function toPlace(page) {
  const p = page.properties;
  return {
    id: page.id,
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
