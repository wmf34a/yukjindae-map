import { describe, it, expect, vi, afterEach } from "vitest";
import { isNotionId, upstreamErrorResponse, serverErrorResponse, fetchWithTimeout } from "./http.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isNotionId", () => {
  it("하이픈이 있는 노션 페이지 ID를 통과시킨다", () => {
    expect(isNotionId("3afa4eba-1ccb-8119-9a6b-c82398028807")).toBe(true);
  });

  it("하이픈이 없는 32자리도 통과시킨다", () => {
    expect(isNotionId("3afa4eba1ccb81199a6bc82398028807")).toBe(true);
  });

  it("대문자 16진수도 통과시킨다", () => {
    expect(isNotionId("3AFA4EBA1CCB81199A6BC82398028807")).toBe(true);
  });

  // 클라이언트가 준 값이 그대로 `api.notion.com/v1/pages/${id}` 경로에 들어가므로,
  // 경로를 조작할 수 있는 문자가 섞이면 반드시 걸러져야 한다.
  it("경로 조작을 노린 값을 걸러낸다", () => {
    expect(isNotionId("../databases/abc/query")).toBe(false);
    expect(isNotionId("3afa4eba1ccb81199a6bc82398028807/../../secret")).toBe(false);
    expect(isNotionId("3afa4eba1ccb81199a6bc82398028807?filter=x")).toBe(false);
  });

  it("길이가 다르거나 16진수가 아니면 걸러낸다", () => {
    expect(isNotionId("abc123")).toBe(false);
    expect(isNotionId("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
    expect(isNotionId("")).toBe(false);
  });

  it("문자열이 아닌 값을 걸러낸다", () => {
    expect(isNotionId(null)).toBe(false);
    expect(isNotionId(undefined)).toBe(false);
    expect(isNotionId(12345)).toBe(false);
    expect(isNotionId({})).toBe(false);
  });
});

describe("upstreamErrorResponse", () => {
  it("상대 API의 에러 본문을 응답에 담지 않는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = upstreamErrorResponse("정보를 불러오지 못했습니다.", "object_not_found: db_id=secret-123");

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "정보를 불러오지 못했습니다." });
    expect(JSON.stringify(body)).not.toContain("secret-123");
  });

  it("원본 오류는 로그로는 남긴다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    upstreamErrorResponse("실패", "내부 상세");
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0])).toContain("내부 상세");
  });
});

describe("serverErrorResponse", () => {
  it("예외 메시지를 응답에 노출하지 않는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = serverErrorResponse(new Error("Notion API 오류: token=ntn_abc"), "장소 정보를 불러오지 못했습니다.");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "장소 정보를 불러오지 못했습니다." });
    expect(JSON.stringify(body)).not.toContain("ntn_abc");
  });
});

describe("fetchWithTimeout", () => {
  it("모든 요청에 AbortSignal을 붙인다", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await fetchWithTimeout("https://example.com", { method: "POST" });

    const [, options] = spy.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("응답이 지연되면 중단된다", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(opts.signal.reason));
      })
    );

    await expect(fetchWithTimeout("https://example.com", {}, 10)).rejects.toThrow();
  });
});
