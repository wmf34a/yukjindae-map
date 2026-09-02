import { describe, it, expect, vi, afterEach } from "vitest";
import { trimFloorHint, readFatherAllowed, lookupWithFallback } from "./nursing-reports.js";

afterEach(() => vi.restoreAllMocks());

describe("trimFloorHint", () => {
  // 제보는 "롯데마트 청량리점 3층"처럼 온다. 그대로 검색하면 지도에서 안 나온다.
  it("층과 위치 표현을 떼어낸다", () => {
    expect(trimFloorHint("롯데마트 청량리점 3층")).toBe("롯데마트 청량리점");
    expect(trimFloorHint("스타필드 하남 지하 1층 유아휴게실")).toBe("스타필드 하남");
    expect(trimFloorHint("이마트 성수점 2층 문화센터 옆")).toBe("이마트 성수점");
  });

  it("층 표현이 없으면 그대로 둔다", () => {
    expect(trimFloorHint("김포공항 국내선")).toBe("김포공항 국내선");
  });
});

describe("readFatherAllowed", () => {
  // 이 앱에서 가장 중요한 값이다. 못 들어가는 곳을 갈 수 있다고 하면 안 된다.
  it("아빠가 된다고 하면 true", () => {
    expect(readFatherAllowed("아빠도 들어갈 수 있어요")).toBe(true);
    expect(readFatherAllowed("가족 수유실이라 같이 이용 가능")).toBe(true);
  });

  it("안 된다고 하면 false", () => {
    expect(readFatherAllowed("아빠는 못 들어가요")).toBe(false);
    expect(readFatherAllowed("여성 전용입니다")).toBe(false);
    expect(readFatherAllowed("아빠 이용 불가")).toBe(false);
  });

  // 애매하면 판단하지 않는다 — 부르는 쪽에서 안전한 값으로 처리한다.
  it("알 수 없으면 null", () => {
    expect(readFatherAllowed("깨끗하고 넓어요")).toBeNull();
    expect(readFatherAllowed("")).toBeNull();
  });
});

describe("lookupWithFallback", () => {
  const doc = (name) => ({
    place_name: name, road_address_name: "서울 어딘가 1", y: "37.5", x: "127.0",
  });

  it("이름 그대로 찾으면 그걸 쓴다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ documents: [doc("롯데마트 청량리점")] }), { status: 200 })));
    const out = await lookupWithFallback("key", "롯데마트 청량리점");
    expect(out.name).toBe("롯데마트 청량리점");
    expect(out.lat).toBe(37.5);
  });

  it("못 찾으면 층 표현을 떼고 다시 찾는다", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      const documents = call === 1 ? [] : [doc("롯데마트 청량리점")];
      return new Response(JSON.stringify({ documents }), { status: 200 });
    }));
    const out = await lookupWithFallback("key", "롯데마트 청량리점 3층");
    expect(out.name).toBe("롯데마트 청량리점");
    expect(call).toBe(2);
  });

  it("둘 다 못 찾으면 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ documents: [] }), { status: 200 })));
    expect(await lookupWithFallback("key", "없는곳 3층")).toBeNull();
  });

  it("키가 없으면 부르지 않는다", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await lookupWithFallback("", "어디든")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
