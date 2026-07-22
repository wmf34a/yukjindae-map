# 육진대 맵 (Yukjindae Map) 기획안

> 육진대 아빠들이 직접 다녀온 **아빠와 아이가 갈만한 곳** 전국 지역 베스트 지도 웹앱

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트명 | 육진대 맵 |
| 타겟 | 육진대 멤버 (300+ 아빠 크리에이터) |
| 플랫폼 | 웹앱 (PWA 적용 완료) |
| 저장소 | https://github.com/wmf34a/yukjindae-map |
| 라이브 URL | https://yukjindae-map.wmf34a.workers.dev/ |
| 배포 | Cloudflare Workers (Static Assets) — GitHub Actions로 자동배포 |
| 데이터 관리 | Notion DB (육진대 공용 워크스페이스) |
| 지도 API | 네이버 Maps API (Dynamic Map + Geocoding) |

---

## 2. 핵심 컨셉

- 육진대 아빠 멤버들이 **직접 다녀온 장소**만 등록
- 앱스토어 심사 없이 **링크 공유**로 바로 사용
- 멤버들이 Notion에서 **직접 장소 추가** 가능
- **지역별 카테고리**로 빠르게 탐색

---

## 3. 기능 요구사항

### 3-1. 홈 화면
- [x] 히어로 배너 (육진대 소개 + 통계)
- [x] 장소 검색창
- [x] 전국 지역 카테고리 그리드 (10개 지역: 서울/서울근교/경기북부/경기남부/인천/강원도/충청도/전라도/경상도/제주)
- [x] 카테고리 태그 필터 (UI·필터링 로직 구현. 현재 DB엔 "무료" 태그만 채워져 있어 나머지 태그는 데이터 보강 필요)
- [x] 추천 장소 카드 리스트

### 3-2. 지도 화면
- [x] 네이버 지도 전체 화면
- [x] 지역별 장소 핀 표시
- [ ] 핀 클러스터링 (핀 많을 때 숫자로 묶기)
- [x] 핀 클릭 시 장소 카드 팝업 (하단 시트)
- [x] 현재 내 위치 표시
- [x] 지역 클릭 시 줌인

### 3-3. 장소 카드
- [x] 장소 이미지
- [x] 장소명, 지역, 카테고리 태그
- [x] 추천 이유 (한 줄 요약)
- [x] 운영시간, 입장료
- [ ] 거리 표시 (현재 위치 기준)
- [ ] 평점 + 리뷰 수
- [ ] 좋아요 버튼
- [x] 카카오맵/네이버 지도 길찾기 연동 (지도 팝업·상세페이지)

### 3-4. 장소 상세 페이지
- [ ] 이미지 갤러리 (현재 대표 이미지 1장만)
- [x] 상세 정보 (주소, 운영시간, 입장료, 주차)
- [x] 추천 이유 (육진대 멤버 후기)
- [x] 근처 맛집/카페 추천
- [ ] 지도에서 위치 보기 (미니맵 임베드는 미구현, 길찾기 링크로 대체)
- [ ] 공유하기 버튼

### 3-5. 찜 목록
- [ ] 좋아요한 장소 모아보기
- [ ] 로컬 스토리지 저장

### 3-6. 후기 제보 (MVP 이후)
- [ ] 장소 제보 폼
- [ ] Notion DB 자동 저장
- [ ] 관리자 승인 후 지도 표시

---

## 4. 데이터 구조 (Notion DB)

> 실제 DB: https://app.notion.com/p/3a5a4eba1ccb81148f3cf90a0b73bcc3 (육진대 공용 노션 워크스페이스, "일삼파파")

### 장소 DB 컬럼

| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| 장소명 | Title | 장소 이름 |
| 지역 | Select | 서울/서울근교/경기북부/경기남부/인천/강원도/충청도/전라도/경상도/제주 |
| 카테고리 | Multi-select | 자연·공원/실내놀이/맛집/카페/체험·문화/스포츠/무료 |
| 주소 | Text | 도로명 주소 + 대중교통 정보 (예: "서울 용산구 이태원로 29 (지하철 4·6호선 삼각지역 12번 출구)") |
| 위도 | Number | 좌표 (Geocoding API로 자동 변환 가능) |
| 경도 | Number | 좌표 |
| 사진 | Files | 장소 이미지 (멤버 직촬 권장) |
| 운영시간 | Text | 휴무일 포함 (예: "화~일 09:30~18:00 (매주 월요일 휴무)") |
| 입장료 | Text | 예약 필요 여부 포함 (예: "전원무료(사전예약필수)") |
| 추천이유 | Text | 한 줄 추천 이유 |
| 주차가능여부 | Select | 가능/불가/유료 |
| 주차상세 | Text | 예: "지하주차장 / 기본 2시간 3,000원, 10분당 500원 추가" |
| 유모차동선 | Select | 가능/불가/일부가능 |
| 기저귀교환대 | Checkbox | |
| 수유실 | Checkbox | |
| 근처맛집 | Text | 캔바 자료 기준, 장소명 + 한줄설명 |
| 근처카페 | Text | 캔바 자료 기준, 장소명 + 한줄설명 |
| 등록자 | Text | 육진대 멤버 닉네임 |
| 공개여부 | Checkbox | 승인된 장소만 표시 |

---

## 5. 기술 스택

| 항목 | 기술 |
|------|------|
| 프론트엔드 | HTML/CSS/JavaScript (Vanilla, 빌드 단계 없음) — `public/` 디렉터리 |
| 백엔드 | Cloudflare Workers (`src/worker.js`) — Notion 프록시(`/api/places`), 네이버 키 전달(`/naver-config`) |
| 지도 | 네이버 Maps API (Dynamic Map, 클라이언트 사이드 JS SDK) |
| 데이터 | Notion API (서버에서만 호출, 브라우저에 키 노출 없음) |
| 이미지 | 네이버 이미지검색 API로 찾은 외부 URL을 그대로 핫링크 (Notion에 파일 업로드 아님 — 자세한 내용은 11장) |
| PWA | `public/manifest.json` + `public/sw.js` (stale-while-revalidate, API 응답은 캐시 제외) |
| 배포 | Cloudflare Workers (Static Assets), `wrangler.jsonc` |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`) — push마다 lint→test→(main이면)deploy 자동 실행 |
| 개발 도구 | oxlint(린트), husky+lint-staged(pre-commit/pre-push 훅), vitest(단위 테스트) |
| 버전관리 | GitHub |

---

## 6. 개발 단계

### MVP (1단계) — ✅ 완료
- 홈 화면 + 지역 카테고리
- 네이버 지도 연동 + 핀 표시
- Notion DB 장소 데이터 연동
- 장소 카드 리스트
- Cloudflare Workers 배포 (기획 초안엔 Pages였으나 실제로는 Workers + Static Assets로 진행, 11장 참고)

### 2단계 — 부분 완료
- [ ] 현재 위치 기반 거리 표시
- [x] 카테고리 필터 (UI/로직은 완료, 태그 데이터 보강은 남음 — 3-1 참고)
- [x] 장소 상세 페이지
- [x] 길찾기 연동 (네이버지도/카카오맵 외부 링크)

### 3단계 — 부분 완료
- [ ] 좋아요/찜 기능
- [ ] 장소 제보 기능
- [x] PWA 적용 (manifest + 서비스워커 + 아이콘, 홈 화면 추가 가능)

---

## 7. 디자인 방향

### 컬러 시스템
> 육진대 로고(`육진대첫번째로고02.jpg`)의 색감을 기준으로 전체 디자인 통일

| 역할 | 컬러 | 설명 |
|------|------|------|
| Primary (메인) | `#1A2F6B` | 로고 다크 네이비 |
| Secondary | `#2563EB` | 로고 미디엄 블루 |
| Accent | `#4A90D9` | 로고 라이트 블루 |
| Background | `#F0F4FF` | 연한 블루 배경 |
| Text | `#0D1B3E` | 다크 네이비 텍스트 |
| White | `#FFFFFF` | 카드 배경 |

### 디자인 원칙
- 전체 톤: **네이비 + 블루 계열** (로고와 동일한 색감)
- 카무플라주 패턴은 포인트 요소로 활용 가능
- 아빠+아이 실루엣 모티브 UI 요소에 활용
- 모바일 퍼스트 (최대 너비 480px)
- 하단 탭바 네비게이션
- 따뜻하되 강인한 느낌 (육진대 = 육아에 진심인 대디)

---

## 8. 환경변수

> ⚠️ API 키는 절대 GitHub에 올리지 말 것 — 로컬은 `.env`/`.dev.vars`, 실제 배포는 Cloudflare Worker Variables + GitHub Secrets로만 관리 (전부 `.gitignore` 처리됨)

### 로컬 개발용 (파일 2개, 용도가 다름 — 둘 다 같은 값을 넣어두면 됨)

| 파일 | 용도 |
|------|------|
| `.env` | 데이터 세팅용 1회성 파이썬 스크립트 등에서 `source .env`로 사용 |
| `.dev.vars` | `wrangler dev`(로컬 서버)가 자동으로 읽는 파일. `.dev.vars.example`을 복사해서 만들면 됨 |

### 필요한 6개 변수

| 변수명 | 설명 | 발급 경로 |
|--------|------|---------|
| `NAVER_MAP_CLIENT_ID` | 네이버 Maps Client ID (클라이언트에 노출되는 값, 도메인 화이트리스트로 보호) | console.ncloud.com → AI·NAVER API → Application (Maps) |
| `NAVER_MAP_CLIENT_SECRET` | 네이버 Maps Client Secret (Geocoding API용, 서버 전용) | 위와 동일 애플리케이션 상세 페이지 |
| `NOTION_API_KEY` | Notion Integration 토큰 | notion.so/my-integrations, 대상 DB에 "연결 추가" 필수 |
| `NOTION_DATABASE_ID` | 장소 DB의 데이터소스 ID | `3a5a4eba-1ccb-8114-8f3c-f90a0b73bcc3` (육진대 공용 워크스페이스) |
| `NAVER_SEARCH_CLIENT_ID` | 네이버 검색 API Client ID (지역검색+이미지검색 공용) | console.ncloud.com → AI·NAVER API → Application (검색) |
| `NAVER_SEARCH_CLIENT_SECRET` | 네이버 검색 API Client Secret | 위와 동일 |

### 실제 배포(프로덕션)에 등록해야 하는 곳 2군데

1. **Cloudflare Worker Settings → Variables**: 위 6개 전부 (Secret 타입 권장) — Worker가 런타임에 `env.NOTION_API_KEY` 식으로 읽음
2. **GitHub 저장소 Secrets** (`gh secret list --repo wmf34a/yukjindae-map`로 확인): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — 이 둘은 위 6개와 다른 용도로, GitHub Actions가 `wrangler deploy`를 실행할 권한용 (11장 참고)

---

## 9. 에셋 (이미지/로고)

> ⚠️ 경로가 `assets/...`가 아니라 **`public/assets/...`** 입니다 (11장 — Cloudflare Workers 배포용으로 `public/` 하위에만 있는 파일이 실제 서빙됨)

| 파일명 | 경로 | 용도 |
|--------|------|------|
| character-logo.svg | `public/assets/logo/character-logo.svg` (원본: 로고(캐릭터).svg) | 헤더, 탭바, 파비콘 등 UI 로고 (SVG — 모든 크기에서 선명) |
| main-logo.svg | `public/assets/logo/main-logo.svg` (원본: 육진대첫번째로고.svg) | 히어로 배너, 스플래시, OG 이미지 등 메인 로고 (SVG) |
| main-logo-fallback.png | `public/assets/logo/main-logo-fallback.png` (원본: 육진대 로고 배경제거.png) | SVG 미지원 환경 폴백용 PNG, PWA 아이콘 원본 소스 |
| main-logo-bg.jpg | `public/assets/logo/main-logo-bg.jpg` (원본: 육진대첫번째로고01-1 (1).jpg) | 배경 있는 영역 폴백용 JPG |
| icon-192.png / icon-512.png / apple-touch-icon.png / favicon-32.png | `public/assets/icons/` | PWA 매니페스트 아이콘 (main-logo-fallback.png를 `sips`로 리사이즈해서 생성) |
| maskable-icon-192.png / maskable-icon-512.png | `public/assets/icons/` | maskable 아이콘 (`purpose: "maskable"`). 로고를 62% 축소 후 `#1A2F6B` 배경으로 패딩 — 원형/사각형 마스킹 시 잘림 방지용 |

> ✅ SVG 우선 사용 — 어떤 크기에도 깨지지 않음  
> ✅ PNG/JPG는 SVG 미지원 환경 대비 폴백으로 보관

---

## 10. API 사용 현황

발급받은 네이버 키는 실질적으로 **애플리케이션 2개**다 — Maps(지도+Geocoding), 검색(지역검색+이미지검색). Notion까지 합쳐도 실제 배포된 웹앱이 매 요청마다 부르는 API는 2개뿐이고, 나머지는 데이터 세팅용 1회성 스크립트에서만 썼다.

### 웹앱이 실시간으로 호출하는 것 (2개)

| API | 어디서 | 용도 |
|---|---|---|
| 네이버 Maps JS SDK (Dynamic Map) | `public/map.html` | 지도 렌더링, 핀 표시, 클릭 이벤트, 지역 줌인 |
| Notion API | `src/worker.js`의 `/api/places` | 요청마다 공개된 장소 데이터 조회 (99곳) |

### 데이터 세팅 스크립트에서만 "한 번" 쓰고 끝난 것 (3개, 웹앱 코드엔 없음)

| API | 언제 썼나 |
|---|---|
| 네이버 Geocoding API | 주소가 있던 42곳 좌표 변환 |
| 네이버 검색 API — 지역검색(local) | 주소 없던 56곳 이름으로 주소/좌표 역추적, 잘못 매칭된 곳 재검증 |
| 네이버 검색 API — 이미지검색 | 99곳 대표 이미지 자동 채움, 깨진 이미지(핫링크 차단/죽은 링크) 재검색 교체 |

> "네이버 플레이스 API"라는 별도 상품은 없음 — 지역검색(local)이 사실상 업체/플레이스 정보 검색 기능이고, 이미지검색과 같은 "검색 API" 애플리케이션 하나(`NAVER_SEARCH_CLIENT_ID`/`SECRET`)에 묶여 있다.

> 💡 이 지역검색/이미지검색 로직은 향후 "3-6. 후기 제보" 기능(멤버가 새 장소 등록 시 주소·좌표·사진 자동 채움) 만들 때 그대로 재사용할 수 있다.

### 이미지가 안 나올 때 (핫링크 이슈)

이미지검색으로 찾은 URL은 원본 사이트(블로그/뉴스/카페)에 그대로 링크만 걸어둔 것이라, 원본 사이트가 **리퍼러(Referer) 체크로 외부 핫링크를 차단**하거나 이미지를 지우면 깨진다 (다음 카페 CDN `t1.daumcdn.net`이 대표적 — 2026-07-22에 서울식물원/퍼스트가든 2곳이 이 문제로 걸렸다가 재검색 후 수정함). 점검 스크립트:

```bash
# 우리 사이트를 Referer로 넣어서 요청 → 403/에러면 핫링크 차단된 것
curl -sI -H "Referer: https://yukjindae-map.wmf34a.workers.dev/" "이미지URL"
```

---

## 11. 배포 아키텍처 (Cloudflare Workers)

자세한 단계별 절차는 **[Cloudflare_Workers_배포_가이드.md](./Cloudflare_Workers_배포_가이드.md)** 참고. 여기는 핵심 구조만 요약.

- **Pages가 아니라 Workers + Static Assets**. `wrangler.jsonc`에 `main`(Worker 진입점: `src/worker.js`)과 `assets.directory`(`./public`)가 있어야 함.
- **정적 파일은 반드시 `public/` 하위에만** 둔다. 프로젝트 루트를 통째로 assets로 지정했다가 `.wrangler/` 캐시를 자기가 감시해서 로컬 dev 서버가 무한 리로드에 빠진 적 있음 — `public/`으로 분리해서 해결.
- **`assets.not_found_handling`은 절대 `single-page-application`으로 켜지 않는다.** 이 사이트는 index/map/place.html이 각각 실제 라우트인 다중 페이지 사이트라, SPA 폴백을 켜면 존재하지 않는 경로도 전부 index.html로 응답해버림.
- **자동배포는 Cloudflare 대시보드의 "Connect to Git"이 아니라 GitHub Actions가 담당.** Cloudflare의 Git 연동 화면만 보고 자동배포된다고 착각하기 쉬운데(실제로 이 프로젝트도, 같은 계정의 pokemon/hangul-nori도 전부 아니었음), 진짜 배포 트리거는 `.github/workflows/ci.yml`의 `deploy` 잡(`cloudflare/wrangler-action`)이다: `main` push → lint+test 통과 → `wrangler deploy`.
- **로컬 개발**: `make dev`(`wrangler dev`), `make lint`, `make test`, `make ci`(lint+test), `make deploy`(수동/즉시 배포용, 평소엔 안 씀).

---

## 12. 작업 이력 (진행 로그)

> 다음 세션은 이 로그부터 훑어보고 이어서 진행하면 됨. 최신 항목이 아래.

### 2026-07-22 — 프로젝트 시작 ~ MVP 완성 ~ PWA까지

1. **저장소/스캐폴드 생성**: `gh`로 GitHub 저장소 생성, 홈/디자인 에셋(로고 SVG·PNG·JPG) 정리, 기본 HTML/CSS/JS 뼈대
2. **Notion DB 설계·생성**: 18개 컬럼 스키마 설계 후 API로 실제 DB 생성 (개인 워크스페이스에서 시작 → 이후 육진대 공용 워크스페이스로 마이그레이션, 스키마+데이터 그대로 복제)
3. **장소 데이터 99곳 입력**: 제공된 PDF 6개(서울/서울근교, 경기북부/인천, 경기남부, 충청도, 전라도, 강원도)를 파싱해서 Notion에 일괄 등록. 네이버 이미지검색 API로 대표 이미지 자동 채움
4. **좌표(위도/경도) 채움**: 주소 있는 42곳은 Geocoding API, 주소 없는 57곳은 지역검색(local) API로 이름 기반 역추적 — 이 과정에서 잘못 매칭된 5곳(서울식물원↔남산야외식물원 등) 발견해서 재검색으로 수정
5. **웹앱 개발**:
   - `src/worker.js`: Notion 프록시(`/api/places`), 네이버 키 전달(`/naver-config`)
   - 홈 화면(`index.html`): 지역/카테고리 필터, 검색, 실제 데이터 카드 리스트
   - 지도 화면(`map.html`): 네이버 Dynamic Map, 핀 표시, 지역 줌, 클릭 시 하단 시트, 길찾기 링크
   - 상세 화면(`place.html`): 장소 상세 정보, 근처 맛집/카페, 길찾기
6. **배포 삽질 및 해결** (11장 요약):
   - Cloudflare가 Pages가 아니라 Workers 프로젝트로 잡혀서 "Missing entry-point" 에러 → `wrangler.jsonc` + `src/worker.js` 구조로 전환
   - `wrangler@3.x`/`vitest@4.x` esbuild 버전 충돌로 CI `npm ci` 실패 → wrangler 4로 업그레이드
   - `assets.directory`가 프로젝트 루트라 로컬 dev 서버가 `.wrangler/` 캐시를 감시해서 무한 리로드 → 정적 파일을 `public/`으로 분리
   - Cloudflare 네이티브 Git 연동은 자동배포가 안 된다는 것을 확인(pokemon/hangul-nori도 동일) → GitHub Actions(`wrangler-action`)로 진짜 CD 구성, `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 시크릿 등록
7. **개발 도구 정비**: pokemon 프로젝트 컨벤션에 맞춰 oxlint, husky(pre-commit lint / pre-push test), lint-staged, vitest(Notion 변환 로직 12개 단위 테스트) 적용. `Makefile`, `.nvmrc`(Node 22), `.env.example`/`.dev.vars.example` 추가
8. **PWA 전환**: `manifest.json`, 서비스워커(`sw.js`, 정적 셸은 stale-while-revalidate 캐시하되 `/api/places`·`/naver-config`는 캐시 제외), 아이콘 세트 생성, 프로덕션에서 서비스워커 activated까지 확인
9. **이미지 버그 수정**: 99곳 전체를 사이트 리퍼러 기준으로 점검해서 핫링크 차단(서울식물원)/죽은 링크(퍼스트가든) 2건 발견 → 재검색 후 Notion 업데이트로 수정

**남은 작업(우선순위 낮은 순 아님, 그냥 목록)**:
- 핀 클러스터링, 현재 위치 기반 거리 표시, 평점/리뷰 수, 좋아요 버튼, 이미지 갤러리, 지도 미니맵 임베드, 공유 버튼 (3장 체크리스트)
- 찜 목록, 장소 제보 폼 (3-5, 3-6)
- 카테고리 태그 데이터 보강 (현재 "무료"만 채워짐, 나머지 6개 태그는 DB에 수동/자동 입력 필요)
- 디자인 다듬기 (현재는 로고 색감만 반영한 기본 스타일, 캔바 자료 기준 비주얼 정리는 미착수)
- 이미지 핫링크 구조를 자체 호스팅(Cloudflare 등)으로 바꿀지 검토 (10장 참고 — 언제든 다시 깨질 수 있는 구조)

### 2026-07-22 — PWA 개선 (maskable 아이콘, 오프라인 폴백, 설치 배너)

기본 PWA(manifest+sw.js+아이콘)는 이미 완료된 상태였고, 이번엔 그 위에 세 가지를 추가:

1. **maskable 아이콘**: `main-logo-fallback.png`(1024x1024, 배경 제거본)를 `sips`로 62% 축소 후 `#1A2F6B` 배경색으로 512/192 캔버스에 패딩해서 `maskable-icon-512.png`/`maskable-icon-192.png` 생성. Android 등에서 아이콘이 원형/사각형으로 마스킹될 때 로고가 잘리지 않도록 안전 영역 확보. `manifest.json`에 `purpose: "maskable"` 항목으로 추가 등록 (기존 `purpose: "any"` 아이콘은 유지)
2. **오프라인 폴백 페이지**: `public/offline.html` 신규 추가 (사이트 톤에 맞춘 네이비 톤 안내 화면 + 다시 시도 버튼). `sw.js`를 v2→v3로 캐시 버전 올리고 프리캐시 목록에 추가, `navigate` 모드 fetch 실패 시 `캐시 매치 → 없으면 offline.html` 순으로 폴백하도록 수정
3. **설치 유도 배너**: `js/pwa.js`에 `beforeinstallprompt` 이벤트를 받아 하단 탭바 위에 뜨는 배너 UI 추가 (설치/닫기 버튼, 닫으면 `localStorage`에 기억해서 재노출 안 함). 스타일은 `css/style.css`에 `.install-banner*` 클래스로 추가, index/map/place 세 페이지 모두 `js/pwa.js`를 공유하므로 어디서든 동일하게 동작
4. **로컬 검증**: `wrangler dev`로 서비스워커 activate, `caches.match('/offline.html')` 프리캐시 확인, `showInstallBanner()` 강제 호출로 배너 렌더링, `/offline.html` 직접 접속 렌더링까지 브라우저로 확인. `npm run lint`/`npm run test` 통과

---

## 13. 참고 자료

- 강원도 best9.pdf
- 경기북부·인천 TOP9.pdf
- 서울·서울근교 BEST.pdf
- 네이버 Maps API 문서: https://api.ncloud-docs.com/docs/application-maps-overview
- Notion API 문서: https://developers.notion.com
- Cloudflare Workers 배포 가이드: [Cloudflare_Workers_배포_가이드.md](./Cloudflare_Workers_배포_가이드.md)
