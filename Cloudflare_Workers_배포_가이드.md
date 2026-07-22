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

## 1. 배포는 GitHub Actions가 담당 (Cloudflare 네이티브 자동배포 아님)

> ⚠️ Cloudflare 대시보드에서 저장소를 "Connect to Git"으로 연결해도, 실제로는
> **push할 때마다 자동 재배포되지 않습니다** (`wrangler deploy`를 대시보드가
> 대신 실행해주는 게 아니라는 뜻). 이 프로젝트뿐 아니라 같은 계정의
> pokemon/hangul-nori도 마찬가지였고, 지금까지는 매번 `make deploy`를 수동
> 실행해서 배포해왔습니다.
>
> 그래서 이 저장소는 **`.github/workflows/ci.yml`의 `deploy` 잡이 실제 배포를
> 담당**합니다: `main`에 push → lint/test 통과 → `cloudflare/wrangler-action`이
> `wrangler deploy` 실행. Cloudflare 대시보드의 Git 연동 화면은 정보 열람용일
> 뿐, 배포 트리거는 이 워크플로우입니다.

### 최초 1회 설정

1. Cloudflare 대시보드 → 우측 상단 프로필 → **My Profile → API Tokens →
   Create Token** → 템플릿 **"Edit Cloudflare Workers"** 선택 → 토큰 생성
2. GitHub 저장소 **Settings → Secrets and variables → Actions**에 등록
   (또는 `gh secret set`)
   - `CLOUDFLARE_API_TOKEN` — 위에서 만든 토큰
   - `CLOUDFLARE_ACCOUNT_ID` — 대시보드 URL의 계정 ID
     (`dash.cloudflare.com/<이 부분>/...`)

이후로는 `main`에 push하면 CI → deploy가 자동으로 이어집니다.
`workers.dev` 주소는 최초 1회 `make deploy`(로컬에서 `wrangler login` 후)로
직접 만들어두거나, 위 GitHub Actions 첫 실행이 만들어줍니다.

## 2. 빌드 설정

빌드 단계가 없는 순수 정적 사이트라 `pokemon`(React + Vite)과 달리
`npm run build`가 없습니다. `.nvmrc`에 Node `22`를 고정해뒀고, GitHub
Actions의 `actions/setup-node@v4`가 이를 그대로 읽어씁니다.

## 3. 환경변수 (Cloudflare Worker Settings → Variables)

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

## 4. 배포 확인

`https://yukjindae-map.<계정서브도메인>.workers.dev` 주소로 접속해 확인합니다.
GitHub 저장소의 **Actions** 탭에서 `deploy` 잡의 성공 여부를 볼 수 있습니다.

> ⚠️ push했는데 사이트가 안 바뀐다면 (1) Actions 탭에서 워크플로우 자체가
> 실패했는지, (2) `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 시크릿이
> 등록/만료되지 않았는지부터 확인하세요.

### (참고) 수동/즉시 배포

CI를 거치지 않고 로컬에서 바로 배포하고 싶을 때:

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
| push했는데 사이트가 그대로임 | GitHub **Actions** 탭에서 `deploy` 잡이 아예 안 돌았는지(브랜치가 `main`이 아니거나 test 잡 실패로 skip됨) vs 돌았는데 실패했는지(시크릿 확인) 구분 |
| `wrangler-action`이 인증 실패 | `CLOUDFLARE_API_TOKEN`이 "Edit Cloudflare Workers" 권한으로 발급됐는지, 만료/재발급되지 않았는지 확인 |

## 7. 배포 전 체크리스트

- [ ] `make ci` (lint + test)가 로컬에서 에러 없이 끝나는지 확인
- [ ] 환경변수 6개가 Cloudflare 대시보드에 모두 등록되어 있는지 확인
- [ ] 네이버 Maps 콘솔에 배포 도메인이 웹 서비스 URL로 등록되어 있는지 확인
- [ ] `workers.dev` 주소로 접속해 홈/지도/상세 페이지가 실제로 동작하는지 확인
