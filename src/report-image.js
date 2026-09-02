// 제보에 딸려 오는 스크린샷.
//
// 화면이 깨졌다는 말은 글로 옮기기 어렵다. "글씨가 이상해요"라는 제보 하나를
// 두고 무슨 화면인지 되묻느라 왕복이 길었다 — 캡처 한 장이면 끝날 일이었다.
//
// 사진은 브라우저에서 이미 줄여서 보낸다(긴 변 1600px, JPEG). 여기서는 크기와
// 형식만 확인하고 R2 에 넣는다. 서버에서 이미지를 다시 그리지 않으므로 변환
// 비용이 들지 않는다.

// 브라우저가 1600px JPEG 로 줄여 보내면 대개 300KB 안쪽이다. 2MB 는 그보다
// 한참 넉넉한 값으로, 리사이즈가 실패한 원본이 통째로 올라오는 것만 막는다.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// data URL 앞머리. JPEG 과 PNG 만 받는다 — SVG 는 스크립트를 품을 수 있고,
// 우리가 그걸 그대로 되돌려주면 저장된 XSS 가 된다.
const DATA_URL_RE = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/;

/**
 * 브라우저가 보낸 data URL 을 검사해 바이트로 바꾼다.
 *
 * @returns {{bytes: Uint8Array, contentType: string} | null} 못 쓰는 값이면 null
 */
export function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  const [, kind, base64] = match;
  // base64 는 원본보다 약 4/3 크다. 디코딩하기 전에 걸러야 큰 문자열을 통째로
  // 메모리에 펼치지 않는다.
  if ((base64.length * 3) / 4 > MAX_IMAGE_BYTES) return null;
  let binary;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType: `image/${kind}` };
}

/**
 * R2 키를 만든다. 접두어를 나눠 두면 30일 뒤 자동 삭제 규칙을 이 접두어에만
 * 걸 수 있다 — 장소 사진은 지우면 안 된다.
 */
export function reportImageKey(kind, contentType = "image/jpeg", now = new Date(), random = crypto.randomUUID()) {
  const date = now.toISOString().slice(0, 10);
  // 확장자는 실제 형식을 따른다. 늘 .jpg 로 두면 PNG 가 .jpg 라는 이름으로 남아,
  // 나중에 파일만 보고 판단하는 사람이나 도구가 헷갈린다.
  const ext = contentType === "image/png" ? "png" : "jpg";
  return `reports/${kind}/${date}-${random}.${ext}`;
}
