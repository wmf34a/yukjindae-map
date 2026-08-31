# 육진대 맵

육진대 아빠들이 직접 다녀온 **아빠와 아이가 갈만한 곳** 전국 지역 베스트 지도 웹앱.
데이터는 Notion DB에 있고 앱은 그걸 읽어 네이버 지도에 뿌린다.

기획 배경은 `YUKJINDAE_MAP.md`, 배포 절차 상세는 `Cloudflare_Workers_배포_가이드.md`,
로컬 셋업은 `README.md` 참고.

## 명령어

| 명령 | 하는 일 |
|---|---|
| `make install` | `npm install` (husky 훅 포함) |
| `make dev` | `wrangler dev` — http://localhost:8788 |
| `make lint` / `make lint-fix` | **oxlint** (ESLint 아님) |
| `make test` / `make test-watch` | vitest. 현재 **13개 파일 285개 통과** |
| `make ci` | lint + test. CI와 같은 체크 |
| `make deploy` | `wrangler deploy` (수동/즉시 배포용) — **웹만** |
| `npm run build` | 앱인토스 미니앱 번들 `yukjindae-map.ait` 생성 — **웹과 무관** |
| `npm run deploy:ait` | `ait deploy` — `.ait` 를 콘솔에 업로드 (API 키 필요) |

**웹은 빌드 단계가 없다.** 프론트엔드는 `public/` 의 순수 HTML/CSS/JS를 Static Assets로
그대로 서빙한다. 번들러도 트랜스파일도 없으니 `public/js/*.js` 를 고치면 그게 곧 배포물이다.

`npm run build` 는 웹 배포와 무관하다 — 앱인토스 미니앱 번들(`yukjindae-map.ait`) 전용이다.
`scripts/build-ait.mjs` 가 `public/` 을 `dist/` 로 복사하면서 미니앱용으로 손본 뒤
`ait build` 가 `.ait` 로 패키징한다.

`main` 에 push하면 GitHub Actions(`.github/workflows/ci.yml`)가 lint+test 후 자동 배포한다.

## 구조

```
public/                  # 프론트엔드 (빌드 없음)
  *.html                 # index, map, place, courses, festival, festival-detail, favorite, about, offline
  js/                    # 페이지별 스크립트 + pwa.js, favorites.js, report.js
  sw.js, manifest.json   # PWA
src/worker.js            # Cloudflare Worker 진입점 — 라우팅 + 네이버 프록시 (1000줄+)
src/notion.js            # Notion DB 조회/파싱
src/tourapi.js           # 한국관광공사 TourAPI
src/enrich.js            # 장소 데이터 보강
src/nursing-rooms.js     # 수유실 데이터
src/nursing-match.js     # 장소 ↔ 수유실 매칭
src/festival-import.js   # 축제 데이터 수집
src/rate-limit.js        # 요청 제한
src/http.js              # fetchWithTimeout 등 공용
src/place-pipeline.js    # 신규 장소 등록 파이프라인 (좌표·근처맛집·편의시설)

apps-in-toss.config.ts   # 앱인토스 미니앱 설정
scripts/build-ait.mjs    # public/ → dist/ (미니앱 번들 전처리)
scripts/discover-places.mjs   # 지역별 신규 장소 후보 발굴 + 검수표 생성
scripts/register-places.mjs   # 검수 끝난 후보를 Notion에 등록 + 사진 R2 미러링
scripts/lib/sources.mjs       # 위 두 스크립트가 쓰는 TourAPI/네이버 어댑터
dist/, *.ait, tmp/       # 빌드·발굴 산출물. gitignore 됨
```

## 장소 발굴 파이프라인

장소를 추가할 땐 스크립트 두 개를 순서대로 돌린다. 좌표·상세정보·근처 맛집/카페·
편의시설 근거를 **한 번에** 채우기 위한 것이다 — 예전처럼 따로 돌리면 근처 맛집이 비어
코스보기 핀이 안 찍히거나 편의시설이 통째로 빠진다.

```
node scripts/discover-places.mjs <지역명> [최대개수]   # tmp/<지역>-후보.json + 검수표.md
node scripts/register-places.mjs tmp/<지역>-후보.json  # 공개여부=false 로 Notion 등록
```

- 로직은 `src/place-pipeline.js` 에 순수 함수로 있고 테스트가 붙어 있다. 네트워크
  어댑터만 `scripts/lib/sources.mjs` 에 모여 있다.
- **검수표를 반드시 사람이 읽는다.** 편의시설은 자동으로 체크하지 않고 근거 스니펫과
  링크만 모아 준다 — 블로그 글의 절반은 근처 카페 후기라 그대로 믿으면 틀린다.
- 흔한 이름(7자 미만)은 글이 지역까지 함께 말하는 것만 인정한다. 안 그러면 인천
  장미공원을 찾는데 중랑 장미공원 글이 걸린다.
- 블로그 언급이 5건도 안 되는 곳은 후보에서 뺀다 — 동네 근린공원이지 목적지가 아니다.
- 취지에 안 맞아 뺀 곳은 `place-pipeline.js` 의 `REJECTED` 목록에 이유와 함께 남긴다.
  발굴을 다시 돌려도 올라오지 않는다.
- 지역당 5곳 안팎으로만 채운다. 공공데이터로 무제한 늘리면 "아빠들이 직접 다녀온 곳"
  이라는 앱의 정체성이 흐려진다.

`src/` 는 worker.js만 크고 나머지는 전부 순수 함수 모듈이라 테스트가 붙어 있다.
로직을 추가할 땐 worker.js에 밀어넣지 말고 모듈로 빼는 쪽이 이 저장소의 결에 맞는다.

**Worker 엔드포인트**: `/api/places` · `/api/banners` · `/api/courses` · `/api/festivals` ·
`/api/festivals/:id` · `/api/nursing-rooms` · `/api/nearby-place` · `/api/geocode` ·
`/api/directions` · `/api/reports` · `/naver-config` · `/images/*`

## 환경 변수

`.dev.vars.example` 을 복사해 `.dev.vars` 를 만든다. 14개 키 — Notion(DB 5종),
네이버 Maps/Search, TourAPI, Cloudflare Turnstile, Slack 웹훅.
키가 없으면 `/api/places` 와 `/naver-config` 가 로컬에서 죽는다.

네이버 키는 **절대 프론트로 내보내지 않는다.** `/naver-config` 가 Worker에서
필요한 값만 골라 넘기는 구조다. 제보(`/api/reports`)는 Turnstile 사람 확인 +
`rate-limit.js` 를 통과해야 Notion에 쓰인다 — 스팸 때문에 넣은 것이니 우회로를 만들지 말 것.

## 장소 사진 규칙

**사진에는 반드시 `사진출처`를 함께 적는다.** 출처를 안 적고 넣은 사진 무리에서
언론사 사진이 여럿 나왔다 — YONHAP NEWS·NEWSIS·SBN NEWS 워터마크가 그대로 박힌
채였고, 개관식 테이프커팅처럼 얼굴이 정면으로 식별되는 사진과 사진이 아닌
안내도 일러스트도 섞여 있었다. 저작권·초상권 문제라 오픈 전에 정리해야 한다.

- 발굴 파이프라인(`discover-*.mjs` → `register-places.mjs`)은 출처를 자동으로
  채운다. 손으로 넣을 때만 빠진다.
- 쓸 수 있는 출처: 한국관광공사(TourAPI), 지자체·시설 공식 제공, 지역장 촬영본.
  뉴스 기사 사진은 쓰지 않는다.
- `node scripts/audit-photos.mjs --no-credit` 로 워터마크·얼굴·안내도를 걸러낸다.
  `scripts/replace-photos.mjs` 가 공공 API 에서 대체를 찾고, 못 찾은 곳은
  `tmp/사진필요.md` 에 남긴다 — **사진을 지우지는 않는다.**

## 배포 후 필수 작업

프로덕션에 배포할 때마다(직접 `wrangler deploy` 든, `git push origin main` 으로 GitHub Actions CI가 배포하든) 아래 두 가지를 반드시 같이 한다:

1. **Notion 배포노트 기록** — 육진대맵DB의 "배포노트" 페이지(https://www.notion.so/3ada4eba1ccb803ab506cabb93603573) 맨 끝에 `## YYYY-MM-DD — 제목 {toggle="true"}` 형식으로 새 토글 섹션을 추가하고, 그 아래 탭 들여쓰기 불릿으로 이번에 바뀐 내용을 요약한다. 기존 항목들과 같은 형식을 유지할 것.
2. **Slack 웹훅 알림** — `SLACK_WEBHOOK_URL`(`.dev.vars`에 있음, 로컬에서 바로 fetch로 POST 가능)로 배포 완료 알림을 보낸다. `{text: "..."}` 형태의 단순 payload, 이모지로 시작하는 한두 문단짜리 요약(무엇이 바뀌었는지 불릿 몇 개 + 프로덕션 URL) — `src/worker.js`의 `notifySlack()`/`notifyFestivalCandidates()` 스타일을 그대로 따른다.

이미 여러 세션이 이 저장소를 동시에 작업할 수 있으므로, 다른 세션의 커밋이 섞여 있어도(예: 마지막 기록 이후 여러 커밋이 쌓여 있는 경우) 배포노트/슬랙 요약에는 그 사이 커밋들도 함께 정리해서 반영한다.

## 두 개의 배포 대상 — 웹과 미니앱

같은 `public/` 을 두 곳에 서비스한다. **어느 쪽 얘기인지 항상 구분할 것.**

| | 웹 (원본) | 앱인토스 미니앱 |
|---|---|---|
| 주소 | https://yukjindae-map.wmf34a.workers.dev | `intoss://yukjindae-map` |
| 대상 | 육진대 인스타 팔로워 | 토스 앱 사용자 |
| 프론트 서빙 | Worker의 Static Assets (`public/` 직접) | 토스가 호스팅하는 `.ait` 번들 (`public/` 의 **스냅샷**) |
| 오리진 | `yukjindae-map.wmf34a.workers.dev` | `yukjindae-map.apps.tossmini.com` 등 |
| 배포 | `wrangler deploy` 또는 `main` push | `.ait` 업로드 → 검수 → 승인 → 출시 |
| 반영 속도 | 즉시 | 검수 1~2 영업일 |

**둘은 서로를 대체하지 않는다.** 미니앱을 출시해도 웹은 그대로 서비스한다.
API·이미지는 양쪽 다 이 저장소의 Worker 하나가 처리한다 — 미니앱은 프론트만 토스에 있고
데이터는 여전히 `workers.dev` 를 부른다.

### 무엇이 어디에 반영되나

| 고친 것 | 웹 | 미니앱 |
|---|---|---|
| `src/worker.js`, Notion 데이터, R2 이미지 | `wrangler deploy` 즉시 | **즉시** (같은 Worker를 부르므로) |
| `public/**` (HTML/CSS/JS) | 즉시 | ❌ 새 `.ait` 빌드 + 검수 필요 |

즉 **장소 추가 같은 운영은 검수 없이 양쪽 즉시 반영**되고, UI를 고쳤을 때만 미니앱이 뒤처진다.

### 프론트 코드 규칙 (중요)

미니앱은 오리진이 달라서 `/api/...` 같은 루트 상대경로가 Worker가 아니라 번들 자신을
가리킨다. 그래서:

- **`fetch("/api/...")` 를 직접 쓰지 말 것.** `fetchJson()` 을 쓰거나, 꼭 raw fetch가
  필요하면 `window.apiUrl("/api/...")` 로 감싼다.
- 이미지 경로도 `safeImageSrc()` 를 거치게 한다 — 내부에서 같은 처리를 한다.
- 이 규칙을 어기면 **웹에서는 멀쩡하고 미니앱에서만 조용히 깨진다.** 로컬 테스트로는
  절대 안 잡힌다.
- `<script src="/...">` 처럼 런타임 분기를 넣을 수 없는 자리는 `scripts/build-ait.mjs`
  에서 빌드 시점에 절대경로로 치환한다. 새로 추가하면 그 스크립트도 같이 고칠 것.

미니앱 번들에서는 PWA 설치 유도(`js/pwa.js`, `manifest.json`, `sw.js`)를 제외한다 —
이미 토스 앱 안이라 의미가 없고, 외부 설치 유도로 읽혀 출시 검수에서 걸릴 수 있다.

### 미니앱 쪽 함정

- **지도가 안 뜨면** 네이버 클라우드 콘솔 Maps 애플리케이션의 Web 서비스 URL에 미니앱
  오리진이 등록됐는지부터 본다. `ncpKeyId` 는 URL 화이트리스트로 막힌다.
  등록해야 하는 오리진: `https://yukjindae-map.{apps,private-apps,web,private-web}.tossmini.com`
  (`private-*` 는 콘솔 QR 테스트용 — 없으면 테스트 단계에서 막힌다)
- `ait init` 은 `package.json` 의 기존 `deploy` 스크립트를 `ait deploy` 로 **덮어쓴다.**
  다시 돌릴 일이 있으면 `deploy: wrangler deploy` 가 살아 있는지 확인할 것.
- 콘솔 상태: 워크스페이스 `이현아빠`(70601), 미니앱 `육진대`(69505), 앱정보 검토 승인 완료,
  번들 미등록. 출시 직전에 워크스페이스 서비스 제휴 약관 동의가 필요하다(대표관리자만 가능).
- 앱인토스 콘솔 작업은 `apps-in-toss-console` MCP로 조회·수정할 수 있다. 약관 동의와
  사업자 등록은 MCP로 못 하고 콘솔 웹에서만 된다.

### 출시 상태

**아직 출시 전.** 기능 개발이 끝난 뒤에 번들을 올린다 — 개발 중에 올리면 UI가 바뀔 때마다
재검수를 다시 받아야 한다. 이식 배선(`apps-in-toss.config.ts`, `scripts/build-ait.mjs`,
`apiUrl()`, Worker CORS)은 한 번 해두면 끝이라 기능이 늘어도 손댈 필요 없다.
