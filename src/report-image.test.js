import { describe, it, expect } from "vitest";
import { decodeImageDataUrl, reportImageKey, MAX_IMAGE_BYTES } from "./report-image.js";

// 1x1 JPEG 을 base64 로. 내용은 중요하지 않고 형식만 본다.
const TINY = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("decodeImageDataUrl", () => {
  it("JPEG data URL 을 바이트로 바꾼다", () => {
    const out = decodeImageDataUrl(TINY);
    expect(out.contentType).toBe("image/jpeg");
    expect(out.bytes.length).toBeGreaterThan(0);
  });

  it("PNG 도 받는다", () => {
    expect(decodeImageDataUrl("data:image/png;base64,iVBORw0KGgo=").contentType).toBe("image/png");
  });

  // SVG 는 스크립트를 품을 수 있다. 그걸 그대로 되돌려주면 저장된 XSS 가 된다.
  it("SVG 는 거부한다", () => {
    expect(decodeImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
  });

  it("이미지가 아닌 data URL 은 거부한다", () => {
    expect(decodeImageDataUrl("data:text/html;base64,PGgxPmhpPC9oMT4=")).toBeNull();
  });

  it("data URL 이 아니면 거부한다", () => {
    expect(decodeImageDataUrl("https://example.com/a.jpg")).toBeNull();
    expect(decodeImageDataUrl("")).toBeNull();
    expect(decodeImageDataUrl(undefined)).toBeNull();
  });

  it("base64 가 깨져 있으면 거부한다", () => {
    expect(decodeImageDataUrl("data:image/jpeg;base64,!!!not-base64!!!")).toBeNull();
  });

  it("너무 큰 이미지는 디코딩하기 전에 거부한다", () => {
    const huge = "A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8);
    expect(decodeImageDataUrl(`data:image/jpeg;base64,${huge}`)).toBeNull();
  });
});

describe("reportImageKey", () => {
  // 접두어를 나눠야 30일 자동 삭제를 여기에만 걸 수 있다. 장소 사진은 지우면 안 된다.
  it("reports/ 아래에 날짜와 함께 넣는다", () => {
    const key = reportImageKey("bug", "image/jpeg", new Date("2026-09-02T05:00:00Z"), "abc");
    expect(key).toBe("reports/bug/2026-09-02-abc.jpg");
  });

  // 늘 .jpg 로 두면 PNG 가 .jpg 라는 이름으로 남아 파일만 보고 판단하는 쪽이 헷갈린다.
  it("PNG 은 확장자도 png 로 남긴다", () => {
    const key = reportImageKey("bug", "image/png", new Date("2026-09-02T05:00:00Z"), "abc");
    expect(key).toBe("reports/bug/2026-09-02-abc.png");
  });
});
