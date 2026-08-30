import { describe, it, expect } from "vitest";
import {
  weatherKind,
  recommendationFor,
  parseForecast,
  buildForecastUrl,
  HOT_THRESHOLD,
  COLD_THRESHOLD,
  remainingRain,
  remainingKind,
  outingWindow,
} from "./today-weather.js";

describe("weatherKind", () => {
  it("WMO 코드를 우리가 쓰는 종류로 접는다", () => {
    expect(weatherKind(0)).toBe("clear");
    expect(weatherKind(3)).toBe("cloudy");
    expect(weatherKind(45)).toBe("fog");
    expect(weatherKind(61)).toBe("rain");
    expect(weatherKind(81)).toBe("rain");
    expect(weatherKind(73)).toBe("snow");
    expect(weatherKind(95)).toBe("storm");
  });

  it("모르는 값은 unknown", () => {
    expect(weatherKind(undefined)).toBe("unknown");
    expect(weatherKind("맑음")).toBe("unknown");
  });
});

describe("recommendationFor", () => {
  it("비 오면 실내를 올리고 야외를 내린다", () => {
    const r = recommendationFor({ kind: "rain", maxTemp: 24, minTemp: 18, rainProbability: 80 });
    expect(r.boost).toContain("실내놀이");
    expect(r.avoid).toContain("자연·공원");
  });

  // 아이를 데리고 나갔다가 비를 맞는 쪽이, 실내에 갔는데 갠 것보다 훨씬 나쁘다.
  it("코드가 흐림이어도 강수확률이 높으면 비로 취급한다", () => {
    const r = recommendationFor({ kind: "cloudy", maxTemp: 24, minTemp: 18, rainProbability: 70 });
    expect(r.tone).toBe("rain");
  });

  it("강수확률이 낮으면 흐림은 야외를 유지한다", () => {
    const r = recommendationFor({ kind: "cloudy", maxTemp: 24, minTemp: 18, rainProbability: 20 });
    expect(r.boost).toContain("자연·공원");
  });

  it("폭염이면 물놀이와 실내를 올린다", () => {
    const r = recommendationFor({ kind: "clear", maxTemp: HOT_THRESHOLD + 2, minTemp: 26, rainProbability: 0 });
    expect(r.tone).toBe("hot");
    expect(r.headline).toContain("33도");
  });

  it("한파면 실내를 올린다", () => {
    const r = recommendationFor({ kind: "clear", maxTemp: 5, minTemp: COLD_THRESHOLD - 3, rainProbability: 0 });
    expect(r.tone).toBe("cold");
    expect(r.boost).toContain("실내놀이");
  });

  // 천둥번개는 비보다 위험해서 스포츠까지 내린다.
  it("천둥번개는 비보다 강하게 실내로 몬다", () => {
    const r = recommendationFor({ kind: "storm", maxTemp: 26, minTemp: 20, rainProbability: 90 });
    expect(r.tone).toBe("storm");
    expect(r.avoid).toContain("스포츠");
  });

  it("맑고 온화하면 야외를 올린다", () => {
    const r = recommendationFor({ kind: "clear", maxTemp: 22, minTemp: 14, rainProbability: 10 });
    expect(r.tone).toBe("clear");
    expect(r.boost).toContain("자연·공원");
    expect(r.avoid).toEqual([]);
  });

  // 비와 폭염이 겹치면 비가 이겨야 한다 — 더워도 비 맞는 건 피해야 한다.
  it("비와 폭염이 겹치면 비를 우선한다", () => {
    const r = recommendationFor({ kind: "rain", maxTemp: 34, minTemp: 27, rainProbability: 90 });
    expect(r.tone).toBe("rain");
  });

  it("기온이 없어도 죽지 않는다", () => {
    const r = recommendationFor({ kind: "clear", maxTemp: null, minTemp: null, rainProbability: null });
    expect(r.tone).toBe("clear");
  });
});

describe("parseForecast", () => {
  const sample = {
    daily: {
      time: ["2026-08-27"],
      weather_code: [2],
      temperature_2m_max: [31.8],
      temperature_2m_min: [27.3],
      precipitation_probability_max: [78],
    },
  };

  // 시각을 고정한다. 저녁 7시가 지나면 내일을 보게 되어 결과가 달라진다.
  const noon = new Date("2026-08-27T03:00:00Z"); // 한국 시간 12시

  it("Open-Meteo 응답에서 필요한 값만 뽑는다", () => {
    expect(parseForecast(sample, noon)).toEqual({
      date: "2026-08-27",
      kind: "cloudy",
      tomorrow: false,
      maxTemp: 31.8,
      minTemp: 27.3,
      rainProbability: 78,
    });
  });

  it("daily가 없으면 null", () => {
    expect(parseForecast({})).toBeNull();
    expect(parseForecast({ daily: { time: [] } })).toBeNull();
    expect(parseForecast(null)).toBeNull();
  });

  it("일부 값이 비어도 null로 채우고 죽지 않는다", () => {
    const partial = parseForecast({ daily: { time: ["2026-08-27"], weather_code: [0] } });
    expect(partial.maxTemp).toBeNull();
    expect(partial.rainProbability).toBeNull();
    expect(partial.kind).toBe("clear");
  });
});

describe("buildForecastUrl", () => {
  it("위경도와 한국 시간대를 담는다", () => {
    const url = buildForecastUrl({ lat: 33.4996, lng: 126.5312 });
    expect(url).toContain("latitude=33.4996");
    expect(url).toContain("longitude=126.5312");
    expect(url).toContain("Asia%2FSeoul");
  });
});


describe("지금부터 남은 시간만 본다", () => {
  // 의정부는 새벽 84%, 낮 43~49%였다. 하루 최대값만 보면 오후에 앱을 연
  // 사람에게도 "비 소식이 있어요"가 뜬다 — 추천이 아니라 방해다.
  const hourly = {
    precipitation_probability: [
      84, 80, 70, 51, 50, 49, 49, 52, 53, 53, 50, 49,
      49, 46, 43, 43, 41, 40, 39, 40, 42, 43, 43, 42,
    ],
    weather_code: Array.from({ length: 24 }, () => 3),
  };

  // 새벽에 열어도 나들이는 09시부터다. 그 전 시간의 비는 데리고 나갈 일이 없다.
  it("새벽에 열면 아침부터의 예보를 본다", () => {
    expect(remainingRain(hourly, outingWindow(0))).toBe(53);
  });

  it("오후에는 지나간 새벽 비를 세지 않는다", () => {
    expect(remainingRain(hourly, outingWindow(14))).toBe(43);
  });

  it("시간대별이 없으면 하루 값으로 돌아간다", () => {
    const data = {
      daily: { time: ["2026-08-29"], weather_code: [51], temperature_2m_max: [24.5], temperature_2m_min: [19.9], precipitation_probability_max: [84] },
    };
    expect(parseForecast(data).rainProbability).toBe(84);
  });

  it("오후에는 실내를 권하지 않는다", () => {
    const data = {
      daily: { time: ["2026-08-29"], weather_code: [51], temperature_2m_max: [24.5], temperature_2m_min: [19.9], precipitation_probability_max: [84] },
      hourly,
    };
    const at14 = new Date("2026-08-29T05:00:00Z"); // 한국 시간 14시
    const forecast = parseForecast(data, at14);
    expect(forecast.rainProbability).toBe(43);
    expect(recommendationFor(forecast).tone).not.toBe("rain");
  });
});

describe("확률이 바닥인 비 코드", () => {
  // 서울이 남은 시간 최대 강수확률 9%인데 "비 소식이 있어요"로 떴다. 어느 한
  // 시간에 이슬비 코드가 붙어 있었기 때문이다.
  const hourly = {
    precipitation_probability: Array.from({ length: 24 }, (_, i) => (i === 20 ? 9 : 5)),
    weather_code: Array.from({ length: 24 }, (_, i) => (i === 20 ? 51 : 3)),
  };

  it("9% 이슬비는 흐림으로 본다", () => {
    expect(remainingKind(hourly, outingWindow(14))).toBe("cloudy");
  });

  it("확률이 충분하면 비로 본다", () => {
    const wet = {
      precipitation_probability: Array.from({ length: 24 }, () => 70),
      weather_code: Array.from({ length: 24 }, () => 51),
    };
    expect(remainingKind(wet, outingWindow(14))).toBe("rain");
  });

  // 확률을 모를 때는 코드를 그대로 믿는다 — 정보가 없으면 안전한 쪽이다.
  it("확률이 없으면 코드를 믿는다", () => {
    const noProb = { weather_code: Array.from({ length: 24 }, () => 51) };
    expect(remainingKind(noProb, outingWindow(14))).toBe("rain");
  });
});

describe("비 오는 날 실내 판정", () => {
  // 춘천 레고랜드는 카테고리가 "체험·문화" 하나뿐이라 실내 시설로 취급돼
  // 비 오는 날 강원도 1순위로 올라왔다. 야외 놀이공원인데.
  it("체험·문화는 실내로 보지 않는다", () => {
    const rec = recommendationFor({ kind: "rain", rainProbability: 80 });
    expect(rec.boost).toEqual(["실내놀이"]);
    expect(rec.boost).not.toContain("체험·문화");
  });

  it("실내를 권하는 모든 상황이 같은 기준을 쓴다", () => {
    for (const f of [
      { kind: "rain", rainProbability: 80 },
      { kind: "storm" },
      { kind: "snow" },
      { kind: "fog" },
      { kind: "clear", minTemp: 0 },
    ]) {
      expect(recommendationFor(f).boost).toEqual(["실내놀이"]);
    }
  });

  it("맑은 날은 그대로 야외를 권한다", () => {
    expect(recommendationFor({ kind: "clear", maxTemp: 22, minTemp: 15 }).boost)
      .toEqual(["자연·공원", "스포츠"]);
  });
});

describe("나들이 시간대만 본다", () => {
  // 의정부에 오후 5시 기준으로 비 소식이 떴는데 정작 비는 밤 10시부터였다.
  // 그 시간에 아이를 데리고 나가는 사람은 없다.
  const hourly = {
    // 0~21시 맑음, 22~23시 비
    precipitation_probability: Array.from({ length: 48 }, (_, i) => ((i % 24) >= 22 ? 80 : 10)),
    weather_code: Array.from({ length: 48 }, (_, i) => ((i % 24) >= 22 ? 61 : 2)),
  };

  it("오후 5시에는 밤 비를 세지 않는다", () => {
    expect(remainingRain(hourly, outingWindow(17))).toBe(10);
  });

  it("나들이 시간대는 09시에 시작한다", () => {
    expect(outingWindow(6)).toMatchObject({ tomorrow: false, from: 9 });
    expect(outingWindow(14)).toMatchObject({ tomorrow: false, from: 14 });
  });

  // 밤에 앱을 여는 사람은 오늘이 아니라 내일 갈 곳을 찾는다.
  it("저녁 7시가 지나면 내일을 본다", () => {
    expect(outingWindow(21)).toMatchObject({ tomorrow: true, from: 33, to: 43 });
  });

  it("내일 기준이면 말머리에 내일을 붙인다", () => {
    const rec = recommendationFor({ kind: "rain", rainProbability: 80, tomorrow: true });
    expect(rec.headline.startsWith("내일")).toBe(true);
  });

  it("오후 5시 의정부는 실내를 권하지 않는다", () => {
    const data = {
      daily: {
        time: ["2026-08-30", "2026-08-31"],
        weather_code: [61, 61], temperature_2m_max: [28, 24],
        temperature_2m_min: [22, 21], precipitation_probability_max: [60, 60],
      },
      hourly,
    };
    const at17 = new Date("2026-08-30T08:00:00Z"); // 한국 시간 17시
    const forecast = parseForecast(data, at17);
    expect(forecast.rainProbability).toBe(10);
    expect(recommendationFor(forecast).tone).not.toBe("rain");
  });
});
