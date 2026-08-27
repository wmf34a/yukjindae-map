import { describe, it, expect } from "vitest";
import {
  weatherKind,
  recommendationFor,
  parseForecast,
  buildForecastUrl,
  sortByWeather,
  HOT_THRESHOLD,
  COLD_THRESHOLD,
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

  it("Open-Meteo 응답에서 필요한 값만 뽑는다", () => {
    expect(parseForecast(sample)).toEqual({
      date: "2026-08-27",
      kind: "cloudy",
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

describe("sortByWeather", () => {
  const places = [
    { name: "공원", categories: ["자연·공원"] },
    { name: "박물관", categories: ["실내놀이", "체험·문화"] },
    { name: "맛집", categories: ["맛집"] },
  ];

  it("추천 카테고리를 앞으로 당긴다", () => {
    const rec = { boost: ["실내놀이"], avoid: ["자연·공원"] };
    expect(sortByWeather(places, rec).map((p) => p.name)).toEqual(["박물관", "맛집", "공원"]);
  });

  // 비 온다고 야외를 지워버리면 "다음에 갈 곳"을 찾는 사람이 아무것도 못 본다.
  it("걸러내지 않고 순서만 바꾼다", () => {
    const rec = { boost: ["실내놀이"], avoid: ["자연·공원"] };
    expect(sortByWeather(places, rec)).toHaveLength(3);
  });

  it("같은 점수끼리는 원래 순서를 지킨다", () => {
    const rec = { boost: [], avoid: [] };
    expect(sortByWeather(places, rec).map((p) => p.name)).toEqual(["공원", "박물관", "맛집"]);
  });

  it("추천이 없으면 그대로 둔다", () => {
    expect(sortByWeather(places, null)).toBe(places);
  });

  it("카테고리가 없는 장소도 죽지 않는다", () => {
    const rec = { boost: ["실내놀이"], avoid: [] };
    expect(sortByWeather([{ name: "무태그" }], rec).map((p) => p.name)).toEqual(["무태그"]);
  });
});
