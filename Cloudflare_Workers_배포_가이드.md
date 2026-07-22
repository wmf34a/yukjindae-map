# Cloudflare Workers 배포 가이드

GitHub 레포 `wmf34a/yukjindae-map`(Vanilla HTML/CSS/JS 정적 웹앱 + Notion/네이버
API 프록시용 Worker)를 Cloudflare Workers(Static Assets)로 배포하는 과정입니다.

이 저장소는 Pages가 아니라 **Workers + Static Assets** 방식을 씁니다
(`wrangler.jsonc`에 `main`과 `assets` 설정 포함). 빌드 단계가 없는 순수 정적
사이트라 `pokemon`(React + Vite) 프로젝트와 달리 `npm run build`가 없습니다.

## 0. 사전 준비

- Notion DB, 네이버 Maps/검색 API 키가 이미 발급되어 있어야 합니다 (`.env.example` 참고).
- `src/worker.js`가 `/api/places`(Notion 프록시)와 `/naver-config`(네이버 지도
  Client ID 전달) 두 라우트를 처리하고, 나머지 경로는 `env.ASSETS.fetch()`로
  정적 파일을 그대로 서빙합니다.

## 1. Cloudflare 계정 연동 (Workers Builds)

1. [dash.cloudflare.com](https://dash.cloudflare.com) 접속 → 로그인/가입
2. 왼쪽 메뉴 **Workers & Pages** → 이 저장소와 연결된 `yukjindae-map` Worker 선택
   (또는 아직 연결 전이면 **Create application** → **Workers** → **Connect to Git**)
3. GitHub 계정 연동 승인 후 `wmf34a/yukjindae-map` 저장소 선택

## 2. 빌드 설정

| 항목 | 값 |
|---|---|
| Build command | *(비워둠 — 빌드 단계 없음)* |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

**Node 버전**: `.nvmrc`에 `22`를 고정해두었습니다. Cloudflare 빌드 환경이 이를
자동 인식합니다 (직접 지정하려면 환경변수 `NODE_VERSION=22`).

## 3. 환경변수 (Settings → Variables)

아래 6개를 **Secret** 타입으로 등록해야 `/api/places`, `/naver-config`가
동작합니다. 이름은 대소문자까지 정확히 일치해야 합니다 (`src/worker.js`가
`env.NOTION_API_KEY` 식으로 참조).

```
NAVER_MAP_CLIENT_ID
NAVER_MAP_CLIENT_SECRET
NOTION_API_KEY
NOTION_DATABASE_ID
NAVER_SEARCH_CLIENT_ID
NAVER_SEARCH_CLIENT_SECRET
```

변수 추가/변경 후에는 재배포가 필요할 수 있습니다.

## 4. 배포

Cloudflare 대시보드에서 **Save and Deploy** 클릭. 완료되면
`https://yukjindae-map.<계정서브도메인>.workers.dev` 주소가 발급됩니다.

이후 `main` 브랜치에 push할 때마다 Cloudflare Workers Builds가 자동으로
재배포해야 합니다 (저장소의 GitHub Actions `ci.yml`은 lint/test만 돌리고
배포는 하지 않음 — 배포는 전적으로 Cloudflare 쪽 파이프라인 담당).

> ⚠️ 만약 push 후에도 사이트가 안 바뀐다면 Worker **Settings → Builds**에서
> 이 저장소/브랜치 연동과 "자동 배포" 옵션이 켜져 있는지 확인하세요. 꺼져있으면
> Deployments 탭에서 수동으로 **Retry deployment**를 눌러야 합니다.

### (참고) 수동/즉시 배포

```bash
npx wrangler login   # 최초 1회
make deploy           # npm run deploy (= wrangler deploy)
```

## 5. 로컬 개발

```bash
make install   # npm install (husky pre-commit/pre-push 훅도 함께 설치됨)
make dev       # wrangler dev — http://localhost:8788
make lint      # oxlint .
make test      # vitest run
make ci        # lint + test (커밋 전 로컬에서 CI와 동일하게 확인)
```

`.dev.vars`에 로컬용 환경변수를 넣어두면 `wrangler dev`가 자동으로 읽습니다
(`.env`와 별개 파일이며 둘 다 git에는 올라가지 않습니다).

## 6. 트러블슈팅

| 증상 | 원인/해결 |
|---|---|
| `✘ [ERROR] Missing entry-point to Worker script or to assets directory` | `wrangler.jsonc`에 `main`(Worker 진입점)과 `assets.directory`가 없음 |
| 새로고침/직접 URL 접속 시 엉뚱하게 홈 화면이 뜸 | `assets.not_found_handling`을 `single-page-application`으로 켜면 이 사이트처럼 다중 페이지(index/map/place.html) 구조에선 존재하지 않는 경로도 index.html로 대체됨 — **이 값은 켜지 않는다** |
| `/api/places`가 502/500 | Notion Integration이 대상 DB/페이지에 "연결"되어 있는지, `NOTION_DATABASE_ID`가 정확한지 확인 |
| 지도가 안 뜸 | `/naver-config` 응답과 네이버 클라우드 콘솔의 Maps 애플리케이션 "웹 서비스 URL"에 배포 도메인이 등록되어 있는지 확인 |
| push했는데 사이트가 그대로임 | Worker **Deployments** 탭에서 빌드가 아예 안 걸렸는지(Builds 연동 확인) vs 빌드는 됐는데 실패했는지(로그 확인) 구분 |

## 7. 배포 전 체크리스트

- [ ] `make ci` (lint + test)가 로컬에서 에러 없이 끝나는지 확인
- [ ] 환경변수 6개가 Cloudflare 대시보드에 모두 등록되어 있는지 확인
- [ ] 네이버 Maps 콘솔에 배포 도메인이 웹 서비스 URL로 등록되어 있는지 확인
- [ ] `workers.dev` 주소로 접속해 홈/지도/상세 페이지가 실제로 동작하는지 확인
