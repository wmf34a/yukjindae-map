import { describe, it, expect } from "vitest";
import { readChangingToilets, dadCanChange } from "./toilets.js";

describe("readChangingToilets", () => {
  const kv = (value) => ({ RATE_LIMIT: { get: async () => value } });

  it("KV 에 있는 목록을 그대로 준다", async () => {
    const rooms = [{ name: "광장시장 나들이 쉼터", lat: 37.5, lng: 127, dad: false }];
    expect(await readChangingToilets(kv(JSON.stringify(rooms)))).toEqual(rooms);
  });

  it("KV 가 비어 있으면 빈 배열", async () => {
    expect(await readChangingToilets(kv(null))).toEqual([]);
  });

  it("KV 바인딩이 없어도 죽지 않는다 — 레이어 하나 때문에 지도가 깨지면 안 된다", async () => {
    expect(await readChangingToilets({})).toEqual([]);
  });

  it("깨진 JSON 이 들어 있어도 빈 배열", async () => {
    expect(await readChangingToilets(kv("{"))).toEqual([]);
  });

  it("배열이 아닌 값이 들어 있어도 빈 배열", async () => {
    expect(await readChangingToilets(kv('{"rooms":[]}'))).toEqual([]);
  });
});

describe("dadCanChange", () => {
  // 값이 "남자화장실+여자화장실"과 "여자화장실+남자화장실" 둘 다로 들어와
  // 순서를 믿을 수 없다. 실제 데이터에 두 표기가 다 있다.
  it.each([
    ["남자화장실", true],
    ["남자화장실+여자화장실", true],
    ["여자화장실+남자화장실", true],
    ["여자화장실", false],
    ["", false],
    [undefined, false],
  ])("%s → %s", (place, expected) => {
    expect(dadCanChange(place)).toBe(expected);
  });
});
