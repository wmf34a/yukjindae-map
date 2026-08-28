// 제보가 들어오면 노션 페이지에 댓글로 운영진을 멘션한다.
//
// 운영진은 개발자가 아니라 슬랙을 쓰지 않는다. 카카오톡은 단체방에 넣는 API가
// 아예 없고 1:1 발송도 심사와 사용자 동의가 필요하다. 메일을 직접 보내려면 Workers
// 밖의 발송 서비스와 도메인 인증이 또 붙는다.
//
// 노션은 멘션된 사람에게 알아서 메일을 보내 준다. 게스트도 무료라 워크스페이스
// 멤버로 넣지 않아도 되고, 메일 링크를 누르면 곧바로 그 제보 페이지가 열린다.
// 그래서 우리가 만들 것은 댓글 하나뿐이다.

// 아직 노션에 초대되지 않은 사람은 멘션할 수 없다 — 노션 사용자 ID가 없기 때문이다.
// 그 사람들은 조용히 건너뛰고, 댓글 본문에 이름만 남겨 초대가 빠졌다는 걸 드러낸다.
export function parseNotifyEmails(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export function resolveMentionTargets(users, emails) {
  const byEmail = new Map();
  for (const user of users || []) {
    const email = user && user.person && user.person.email;
    if (user.type === "bot" || !email) continue;
    byEmail.set(String(email).toLowerCase(), { id: user.id, name: user.name || email });
  }

  const targets = [];
  const missing = [];
  for (const email of emails) {
    const hit = byEmail.get(email);
    if (hit) targets.push(hit);
    else missing.push(email);
  }
  return { targets, missing };
}

const NEW_PLACE_FIELD = "신규장소";

// 노션 rich_text는 멘션과 글자를 한 배열에 섞는다. 멘션 객체 사이에 공백 텍스트를
// 넣지 않으면 이름이 서로 붙어 읽기 어려워진다.
export function buildReportComment({ placeName, field, value, targets, missing }) {
  const rich = [];
  for (const target of targets || []) {
    rich.push({ type: "mention", mention: { type: "user", user: { id: target.id } } });
    rich.push({ type: "text", text: { content: " " } });
  }

  const headline = field === NEW_PLACE_FIELD
    ? `새 장소 추천이 들어왔습니다 — ${placeName}`
    : `제보가 들어왔습니다 — ${placeName} / ${field}`;

  rich.push({ type: "text", text: { content: `\n${headline}\n${String(value || "").slice(0, 1500)}` } });

  if (missing && missing.length) {
    // 초대가 안 된 사람은 알림을 못 받는다. 조용히 빠지면 아무도 눈치채지 못하므로
    // 댓글에 남겨, 보는 사람이 초대를 마저 하도록 한다.
    rich.push({
      type: "text",
      text: { content: `\n\n(노션에 초대되지 않아 알림을 못 받는 사람: ${missing.join(", ")})` },
    });
  }

  return rich;
}
