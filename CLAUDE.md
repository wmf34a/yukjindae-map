# CLAUDE.md

프로젝트 기획/기술 배경은 `YUKJINDAE_MAP.md`, 배포 방법은 `Cloudflare_Workers_배포_가이드.md` 참고.

## 배포 후 필수 작업

프로덕션에 배포할 때마다(직접 `wrangler deploy`든, `git push origin main`으로 GitHub Actions CI가 배포하든) 아래 두 가지를 반드시 같이 한다:

1. **Notion 배포노트 기록** — 육진대맵DB의 "배포노트" 페이지(https://www.notion.so/3ada4eba1ccb803ab506cabb93603573) 맨 끝에 `## YYYY-MM-DD — 제목 {toggle="true"}` 형식으로 새 토글 섹션을 추가하고, 그 아래 탭 들여쓰기 불릿으로 이번에 바뀐 내용을 요약한다. 기존 항목들과 같은 형식을 유지할 것.
2. **Slack 웹훅 알림** — `SLACK_WEBHOOK_URL`(`.dev.vars`에 있음, 로컬에서 바로 fetch로 POST 가능)로 배포 완료 알림을 보낸다. `{text: "..."}` 형태의 단순 payload, 이모지로 시작하는 한두 문단짜리 요약(무엇이 바뀌었는지 불릿 몇 개 + 프로덕션 URL) — `src/worker.js`의 `notifySlack()`/`notifyFestivalCandidates()` 스타일을 그대로 따른다.

이미 여러 세션이 이 저장소를 동시에 작업할 수 있으므로, 다른 세션의 커밋이 섞여 있어도(예: 마지막 기록 이후 여러 커밋이 쌓여 있는 경우) 배포노트/슬랙 요약에는 그 사이 커밋들도 함께 정리해서 반영한다.
