// 월간 Top 10은 한 달 내내 같은 목록이라 "오늘 뭐하지"에 답하지 못한다. 매일 바뀌는
// 축은 날씨다 — 비 오는 날 야외를 1위로 보여주면 추천이 아니라 방해가 된다.
//
// 기상청 단기예보 API는 서비스별 활용신청이 필요하고 위경도를 격자(nx, ny)로 변환해야
// 하는데, Open-Meteo는 키 없이 위경도를 그대로 받는다. "오늘 비/맑음/기온" 수준의
// 판단에는 충분해서 이쪽을 쓴다.
//
// 정렬 자체는 여기서 하지 않는다 — 서버는 boost/avoid만 계산해 내려주고, 실제 순서
// 변경은 프론트(public/js/util.js의 sortByWeather)가 맡는다. 같은 로직을 양쪽에 두면
// 한쪽만 고쳤을 때 조용히 어긋난다.

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

// 비·눈·추위에 올려줄 카테고리.
//
// 예전에는 "체험·문화"도 함께 올렸는데, 그 태그는 실내인지 야외인지 구분하지
// 못한다. 춘천 레고랜드는 카테고리가 "체험·문화" 하나뿐이라 비 오는 날 실내
// 시설로 취급돼 강원도 1순위로 올라왔다 — 야외 놀이공원인데.
//
// 확실히 실내인 곳만 올린다. 실내 박물관인데 태그가 빠져 있던 곳들은 데이터를
// 채웠고(한성백제박물관, 부산 국립해양박물관 등 8곳), 지역마다 실내놀이 장소가
// 최소 3곳은 있어 후보가 마르지 않는다.
const INDOOR_BOOST = ["실내놀이"];

export const HOT_THRESHOLD = 31;
export const COLD_THRESHOLD = 4;

/**
 * 오늘 날씨를 보고 어떤 장소를 위로 올릴지 정한다.
 * @returns {{tone: string, headline: string, boost: string[], avoid: string[]}}
 */
export function recommendationFor({ kind, maxTemp, minTemp, rainProbability, tomorrow }) {
  // 저녁에 앱을 연 사람에게는 내일 예보를 보여준다. 말머리를 붙이지 않으면
  // 지금 날씨로 읽어 "밖에 안 오는데?" 하게 된다.
  const when = tomorrow ? "내일 " : "";
  const rainy = kind === "rain" || kind === "storm" || Number(rainProbability) >= RAIN_PROBABILITY_THRESHOLD;
  const hot = Number.isFinite(maxTemp) && maxTemp >= HOT_THRESHOLD;
  const cold = Number.isFinite(minTemp) && minTemp <= COLD_THRESHOLD;

  if (kind === "storm") {
    return {
      tone: "storm",
      headline: `${when}천둥번개가 예보됐어요. 실내가 안전해요`,
      boost: INDOOR_BOOST,
      avoid: ["자연·공원", "스포츠"],
    };
  }
  if (rainy) {
    return {
      tone: "rain",
      headline: `${when}비 소식이 있어요. 실내에서 놀기 좋은 곳`,
      boost: INDOOR_BOOST,
      avoid: ["자연·공원"],
    };
  }
  if (kind === "snow") {
    return {
      tone: "snow",
      headline: `${when}눈 소식이 있어요. 따뜻한 실내는 어떨까요`,
      boost: INDOOR_BOOST,
      avoid: ["자연·공원", "스포츠"],
    };
  }
  if (hot) {
    return {
      tone: "hot",
      headline: `${tomorrow ? "내일" : "오늘"} 최고 ${Math.round(maxTemp)}도. 물놀이하거나 시원한 실내로`,
      boost: ["실내놀이", "스포츠"],
      avoid: [],
    };
  }
  if (cold) {
    return {
      tone: "cold",
      headline: `${when}아침 ${Math.round(minTemp)}도까지 떨어져요. 실내 위주로`,
      boost: INDOOR_BOOST,
      avoid: ["자연·공원"],
    };
  }
  if (kind === "fog") {
    return {
      tone: "fog",
      headline: `${when}안개가 껴요. 가까운 실내부터 둘러볼까요`,
      boost: INDOOR_BOOST,
      avoid: [],
    };
  }
  return {
    tone: "clear",
    headline: kind === "cloudy" ? `${when}나들이하기 무난한 날씨예요` : `${when}나들이하기 좋은 날씨예요`,
    boost: ["자연·공원", "스포츠"],
    avoid: [],
  };
}

const pickFirst = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

// 아이를 데리고 나가는 시간대.
//
// "지금부터 자정까지"를 보면 밤 비가 낮 나들이를 막는다. 의정부에 오후 5시
// 기준으로 비 소식이 떴는데 정작 비는 밤 10시부터였다 — 그 시간에 아이를
// 데리고 나가는 사람은 없다.
export const OUTING_START_HOUR = 9;
export const OUTING_END_HOUR = 19;

/**
 * 어느 구간의 예보를 볼지 정한다.
 *
 * 나들이 시간 안이면 지금부터 저녁까지, 이미 지났으면 내일 나들이 시간이다.
 * 밤에 앱을 여는 사람은 오늘이 아니라 내일 갈 곳을 찾는다.
 */
export function outingWindow(hour) {
  if (hour < OUTING_END_HOUR) {
    return { tomorrow: false, from: Math.max(hour, OUTING_START_HOUR), to: OUTING_END_HOUR };
  }
  return { tomorrow: true, from: 24 + OUTING_START_HOUR, to: 24 + OUTING_END_HOUR };
}

// 지금 몇 시인지(한국 기준). 지나간 시간의 예보는 오늘 나들이와 상관이 없다.
export function kstHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul", hour: "2-digit", hour12: false,
    }).format(now)
  ) % 24;
}

// 나들이 시간대의 최대 강수확률.
//
// 새벽에 지나간 비를 근거로 오후에 실내를 권하면 방해고, 밤 10시 비를 근거로
// 낮 나들이를 막는 것도 마찬가지다. 반대로 지금은 맑아도 오후 늦게 비가 오면
// 알려줘야 하므로, 그 구간 안에서는 최대값을 쓴다.
export function remainingRain(hourly, window) {
  const probs = hourly && hourly.precipitation_probability;
  if (!Array.isArray(probs) || !probs.length) return null;
  const rest = probs.slice(window.from, window.to + 1).filter((x) => typeof x === "number");
  if (!rest.length) return null;
  return Math.max(...rest);
}

// 코드가 "비"라도 그 시간 강수확률이 이보다 낮으면 비로 세지 않는다.
//
// 서울이 남은 시간 최대 강수확률 9%인데 "비 소식이 있어요"로 떴다. 어느 한
// 시간에 이슬비 코드가 붙어 있었고, 남은 시간 중 가장 나쁜 코드를 대표로
// 삼다 보니 9%짜리 이슬비가 온종일 실내를 권하게 만든 것이다.
const RAIN_CODE_MIN_PROBABILITY = 30;

export function remainingKind(hourly, window) {
  const codes = hourly && hourly.weather_code;
  if (!Array.isArray(codes) || !codes.length) return null;
  const probs = Array.isArray(hourly.precipitation_probability)
    ? hourly.precipitation_probability
    : [];

  const rest = [];
  for (let i = window.from; i <= Math.min(window.to, codes.length - 1); i += 1) {
    const code = codes[i];
    if (typeof code !== "number") continue;
    const kind = weatherKind(code);
    const wet = kind === "rain" || kind === "snow" || kind === "storm";
    const prob = probs[i];
    // 확률이 바닥인 비 코드는 그 시간대를 흐림으로 본다. 확률을 모르면
    // 코드를 그대로 믿는다 — 정보가 없을 때 안전한 쪽이다.
    if (wet && typeof prob === "number" && prob < RAIN_CODE_MIN_PROBABILITY) {
      rest.push(3);
      continue;
    }
    rest.push(code);
  }
  if (!rest.length) return null;
  // 남은 시간 중 가장 나쁜 하늘을 대표로 삼는다. 코드가 클수록 험한 날씨다.
  return weatherKind(Math.max(...rest));
}

export function parseForecast(data, now = new Date()) {
  const daily = data && data.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) return null;

  const hour = kstHour(now);
  const window = outingWindow(hour);
  // 내일을 본다면 기온도 내일 것을 쓴다.
  const dayIndex = window.tomorrow && daily.time.length > 1 ? 1 : 0;
  const at = (arr) => (Array.isArray(arr) && arr.length > dayIndex ? arr[dayIndex] : pickFirst(arr));

  const maxTemp = at(daily.temperature_2m_max);
  const minTemp = at(daily.temperature_2m_min);

  // 시간대별이 있으면 나들이 시간대를 쓰고, 없으면 예전처럼 하루 값을 쓴다.
  const restRain = remainingRain(data.hourly, window);
  const restKind = remainingKind(data.hourly, window);
  const rainProbability = restRain === null ? at(daily.precipitation_probability_max) : restRain;
  const kind = restKind === null ? weatherKind(at(daily.weather_code)) : restKind;

  return {
    date: daily.time[dayIndex] || daily.time[0],
    kind,
    tomorrow: window.tomorrow,
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
    // 시간대별도 함께 받는다. 하루 최대 강수확률만 보면 새벽에 지나간 비 때문에
    // 온종일 "비 소식"이 뜬다 — 의정부가 새벽 84%, 낮 43~49%인데 오후에 앱을 연
    // 사람에게도 실내를 권하고 있었다.
    hourly: "precipitation_probability,weather_code",
    timezone: "Asia/Seoul",
    // 이틀치를 받는다. 저녁에 앱을 열면 오늘 나들이는 이미 끝났으니 내일을 본다.
    forecast_days: "2",
  });
  return `${OPEN_METEO_URL}?${params}`;
}

