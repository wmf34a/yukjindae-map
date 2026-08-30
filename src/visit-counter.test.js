import { describe, it, expect, beforeEach } from "vitest";
import {
  todayInKst, pickShard, sumValues, countVisit, readStats, SHARDS,
} from "./visit-counter.js";

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
  };
}

describe("todayInKst", () => {
  // 서버가 UTC라 그냥 today를 쓰면 자정 무렵 아홉 시간 동안 어제로 센다.
  it("한국 시간 기준으로 날짜를 준다", () => {
    expect(todayInKst(new Date("2026-08-30T16:00:00Z"))).toBe("2026-08-31");
    expect(todayInKst(new Date("2026-08-30T14:00:00Z"))).toBe("2026-08-30");
  });
});

describe("pickShard", () => {
  it("같은 사람은 늘 같은 조각으로 간다", () => {
    expect(pickShard("abc")).toBe(pickShard("abc"));
  });

  it("조각 범위를 벗어나지 않는다", () => {
    for (const id of ["a", "zzzz", "1234-5678", ""]) {
      const s = pickShard(id);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(SHARDS);
    }
  });
});

describe("countVisit", () => {
  let kv;
  beforeEach(() => { kv = fakeKv(); });

  it("처음 오면 센다", async () => {
    expect(await countVisit(kv, "dev-1", "2026-08-30")).toBe(true);
    expect(await readStats(kv, "2026-08-30")).toEqual({ today: 1, total: 1 });
  });

  // 같은 사람이 하루에 다섯 번 열어도 한 명이어야 "오늘 300명"이 진짜 300명이다.
  it("같은 사람이 또 와도 다시 세지 않는다", async () => {
    await countVisit(kv, "dev-1", "2026-08-30");
    expect(await countVisit(kv, "dev-1", "2026-08-30")).toBe(false);
    expect(await readStats(kv, "2026-08-30")).toEqual({ today: 1, total: 1 });
  });

  it("날이 바뀌면 오늘은 다시 세고 누적은 이어진다", async () => {
    await countVisit(kv, "dev-1", "2026-08-30");
    await countVisit(kv, "dev-1", "2026-08-31");
    expect(await readStats(kv, "2026-08-30")).toEqual({ today: 1, total: 2 });
    expect(await readStats(kv, "2026-08-31")).toEqual({ today: 1, total: 2 });
  });

  it("사람이 여럿이면 각각 센다", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) await countVisit(kv, id, "2026-08-30");
    expect(await readStats(kv, "2026-08-30")).toEqual({ today: 5, total: 5 });
  });

  it("KV나 ID가 없으면 아무 일도 하지 않는다", async () => {
    expect(await countVisit(null, "a", "2026-08-30")).toBe(false);
    expect(await countVisit(kv, "", "2026-08-30")).toBe(false);
    expect(kv.store.size).toBe(0);
  });
});

describe("readStats", () => {
  it("KV가 없으면 0을 준다", async () => {
    expect(await readStats(null, "2026-08-30")).toEqual({ today: 0, total: 0 });
  });

  it("조각을 합쳐서 센다", () => {
    expect(sumValues(["3", "4", null, "5"])).toBe(12);
  });
});
