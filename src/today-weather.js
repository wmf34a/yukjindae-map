// 월간 Top 10은 한 달 내내 같은 목록이라 "오늘 뭐하지"에 답하지 못한다. 매일 바뀌는
// 축은 날씨다 — 비 오는 날 야외를 1위로 보여주면 추천이 아니라 방해가 된다.
//
// 기상청 단기예보 API는 서비스별 활용신청이 필요하고 위경도를 격자(nx, ny)로 변환해야
// 하는데, Open-Meteo는 키 없이 위경도를 그대로 받는다. "오늘 비/맑음/기온" 수준의
// 판단에는 충분해서 이쪽을 쓴다.

export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// WMO weather code — Open-Meteo가 돌려주는 표준 코드.
// https://open-meteo.com/en/docs 의 표를 우리가 쓰는 4단계로 접었다.
export function weatherKind(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return "unknown";
  if (c === 0 || c === 1) return "clear";
  if (c === 2 || c === 3) return "cloudy";
  if (c >= 45 && c <= 48) return "fog";
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 95) return "storm";
  return "unknown";
}

// 강수확률이 높으면 코드가 "흐림"이어도 비 올 가능성을 무겁게 본다 — 아이를 데리고
// 나갔다가 비를 맞는 쪽이, 실내에 갔는데 날이 갠 것보다 훨씬 나쁘다.
const RAIN_PROBABILITY_THRESHOLD = 60;

export const HOT_THRESHOLD = 31;
export const COLD_THRESHOLD = 4;

/**
 * 오늘 날씨를 보고 어떤 장소를 위로 올릴지 정한다.
 * @returns {{tone: string, headline: string, boost: string[], avoid: string[]}}
 */
export function recommendationFor({ kind, maxTemp, minTemp, rainProbability }) {
  const rainy = kind === "rain" || kind === "storm" || Number(rainProbability) >= RAIN_PROBABILITY_THRESHOLD;
  const hot = Number.isFinite(maxTemp) && maxTemp >= HOT_THRESHOLD;
  const cold = Number.isFinite(minTemp) && minTemp <= COLD_THRESHOLD;

  if (kind === "storm") {
    return {
      tone: "storm",
      headline: "천둥번개가 예보됐어요. 오늘은 실내가 안전해요",
      boost: ["실내놀이", "체험·문화"],
      avoid: ["자연·공원", "스포츠"],
    };
  }
  if (rainy) {
    return {
      tone: "rain",
      headline: "비 소식이 있어요. 실내에서 놀기 좋은 곳",
      boost: ["실내놀이", "체험·문화"],
      avoid: ["자연·공원"],
    };
  }
  if (kind === "snow") {
    return {
      tone: "snow",
      headline: "눈이 와요. 따뜻한 실내는 어떨까요",
      boost: ["실내놀이", "체험·문화"],
      avoid: ["자연·공원", "스포츠"],
    };
  }
  if (hot) {
    return {
      tone: "hot",
      headline: `오늘 최고 ${Math.round(maxTemp)}도. 물놀이하거나 시원한 실내로`,
      boost: ["실내놀이", "스포츠"],
      avoid: [],
    };
  }
  if (cold) {
    return {
      tone: "cold",
      headline: `아침 ${Math.round(minTemp)}도까지 떨어져요. 실내 위주로`,
      boost: ["실내놀이", "체험·문화"],
      avoid: ["자연·공원"],
    };
  }
  if (kind === "fog") {
    return {
      tone: "fog",
      headline: "안개가 끼었어요. 가까운 실내부터 둘러볼까요",
      boost: ["실내놀이", "체험·문화"],
      avoid: [],
    };
  }
  return {
    tone: "clear",
    headline: kind === "cloudy" ? "나들이하기 무난한 날씨예요" : "나들이하기 좋은 날씨예요",
    boost: ["자연·공원", "스포츠"],
    avoid: [],
  };
}

const pickFirst = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

export function parseForecast(data) {
  const daily = data && data.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) return null;

  const pick = pickFirst;
  const maxTemp = pick(daily.temperature_2m_max);
  const minTemp = pick(daily.temperature_2m_min);
  const rainProbability = pick(daily.precipitation_probability_max);
  const kind = weatherKind(pick(daily.weather_code));

  return {
    date: daily.time[0],
    kind,
    maxTemp: typeof maxTemp === "number" ? maxTemp : null,
    minTemp: typeof minTemp === "number" ? minTemp : null,
    rainProbability: typeof rainProbability === "number" ? rainProbability : null,
  };
}

export function buildForecastUrl({ lat, lng }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Seoul",
    forecast_days: "1",
  });
  return `${OPEN_METEO_URL}?${params}`;
}

// 추천 카테고리에 해당하는 장소를 앞으로 당긴다. 걸러내지 않고 순서만 바꾸는 이유는,
// 비 온다고 야외를 목록에서 지워버리면 "오늘 말고 다음에 갈 곳"을 찾는 사람이
// 아무것도 못 보게 되기 때문이다.
export function sortByWeather(places, recommendation) {
  if (!recommendation) return places;
  const boost = new Set(recommendation.boost || []);
  const avoid = new Set(recommendation.avoid || []);

  const score = (place) => {
    const categories = place.categories || [];
    if (categories.some((c) => boost.has(c))) return 0;
    if (categories.some((c) => avoid.has(c))) return 2;
    return 1;
  };

  return places
    .map((place, index) => ({ place, index, score: score(place) }))
    .toSorted((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index))
    .map((entry) => entry.place);
}
