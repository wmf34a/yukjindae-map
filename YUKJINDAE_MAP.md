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
| 이미지 | Cloudflare R2(`yukjindae-map-images` 버킷)에 자체 호스팅. `src/worker.js`의 `/images/:key` 라우트가 R2에서 직접 서빙 (1년 캐시). 원래는 네이버 이미지검색 API로 찾은 외부 URL을 핫링크했으나 하루에 두 번 깨져서 R2로 이전함 — 자세한 내용은 10·11장 |
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

### 홈 화면 리디자인 — "여기어때" 스타일 (2026-07-22)

기본 스타일 위에 앱처럼 보이도록 홈 화면을 다듬음 (12장 로그 참고):
- **스플래시**: 첫 접속 시 네이비(`#1A2F6B`) 풀스크린 + 로고, 2초 후 페이드아웃 (세션당 1회, `sessionStorage`)
- **카테고리 그리드**: 지역명을 3D 느낌 이모지 타일로 (그라데이션 배경 + 그림자 + `drop-shadow`), 선택 시 블루 그라데이션으로 강조
- **히어로 배너**: 로고/통계 슬라이드 3장이 3초마다 자동 전환, 하단 점 인디케이터
- **장소 카드**: 썸네일 확대(88→108px), 라운드 20px, 그림자, 탭 시 눌리는 인터랙션
- **하단 탭바**: 이모지 아이콘(🏠🗺️❤️👤) + 텍스트, 3개 페이지 전부 통일
- **타이포/여백**: 본문 폰트 굵기 500 기본, 제목·카드명 800으로 강조, section/카드 패딩 전반 확대

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
| maskable-icon-192.png / maskable-icon-512.png | `public/assets/icons/` | maskable 아이콘 (`purpose: "maskable"`). 로고를 62% 축소 후 흰색(`#FFFFFF`) 배경으로 패딩 — 원형/사각형 마스킹 시 잘림 방지용 (처음엔 네이비 배경이었으나 로고와 대비가 안 나와서 흰색으로 교체) |

> ✅ SVG 우선 사용 — 어떤 크기에도 깨지지 않음  
> ✅ PNG/JPG는 SVG 미지원 환경 대비 폴백으로 보관

> 💡 여기 나온 로고/아이콘은 `public/assets/`에 있는 **브랜드 에셋**이고, 99곳 **장소 사진**은 별개로 Cloudflare R2(`yukjindae-map-images` 버킷)에 있다 — 10장 참고.

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

### 이미지는 이제 핫링크가 아니라 R2 자체 호스팅 (2026-07-22 이전)

처음엔 이미지검색으로 찾은 URL을 원본 사이트(블로그/뉴스/카페)에 그대로 핫링크했는데, 하루 만에 두 번 깨졌다:
1. 다음 카페 CDN(`t1.daumcdn.net`)이 **리퍼러(Referer) 체크로 외부 핫링크 차단** → 서울식물원/퍼스트가든 403
2. 오래된 네이버 쇼핑 CDN(`shop1.phinf.naver.net`)이 **SSL 인증서 호스트명 불일치**(Akamai 인증서를 씀) → 크롬이 `http://` 이미지를 `https://`로 자동 승격하다가 실패 → 용인 공룡월드/원주 소금산 그랜드밸리 로드 실패

둘 다 근본 원인은 같음(제3자 호스팅에 의존), 그래서 **99곳 이미지를 전부 다운로드해서 Cloudflare R2(`yukjindae-map-images` 버킷)에 재업로드**하고 Notion `사진` 필드를 `https://yukjindae-map.wmf34a.workers.dev/images/<노션페이지ID>.<확장자>`로 교체했다. 이제 원본 사이트가 뭘 하든 우리 이미지는 안 깨진다.

**서빙 구조**: `wrangler.jsonc`의 `r2_buckets` 바인딩(`IMAGES`) → `src/worker.js`의 `/images/:key` 라우트가 `env.IMAGES.get(key)`로 객체를 읽어 1년 캐시(`cache-control: public, max-age=31536000, immutable`)로 응답.

> 💡 향후 "3-6. 후기 제보"로 멤버가 새 사진을 올리면, 그 사진도 같은 방식으로 R2에 저장하도록 확장하면 된다 (지금은 마이그레이션 스크립트로 1회성 처리했을 뿐, 업로드 API 자체는 아직 없음).

<details>
<summary>참고: 핫링크 시절 점검용으로 썼던 스크립트 (지금은 불필요)</summary>

```bash
# 우리 사이트를 Referer로 넣어서 요청 → 403/에러면 핫링크 차단된 것
curl -sI -H "Referer: https://yukjindae-map.wmf34a.workers.dev/" "이미지URL"
```

</details>

---

## 11. 배포 아키텍처 (Cloudflare Workers)

자세한 단계별 절차는 **[Cloudflare_Workers_배포_가이드.md](./Cloudflare_Workers_배포_가이드.md)** 참고. 여기는 핵심 구조만 요약.

- **Pages가 아니라 Workers + Static Assets**. `wrangler.jsonc`에 `main`(Worker 진입점: `src/worker.js`)과 `assets.directory`(`./public`)가 있어야 함.
- **정적 파일은 반드시 `public/` 하위에만** 둔다. 프로젝트 루트를 통째로 assets로 지정했다가 `.wrangler/` 캐시를 자기가 감시해서 로컬 dev 서버가 무한 리로드에 빠진 적 있음 — `public/`으로 분리해서 해결.
- **`assets.not_found_handling`은 절대 `single-page-application`으로 켜지 않는다.** 이 사이트는 index/map/place.html이 각각 실제 라우트인 다중 페이지 사이트라, SPA 폴백을 켜면 존재하지 않는 경로도 전부 index.html로 응답해버림.
- **자동배포는 Cloudflare 대시보드의 "Connect to Git"이 아니라 GitHub Actions가 담당.** Cloudflare의 Git 연동 화면만 보고 자동배포된다고 착각하기 쉬운데(실제로 이 프로젝트도, 같은 계정의 pokemon/hangul-nori도 전부 아니었음), 진짜 배포 트리거는 `.github/workflows/ci.yml`의 `deploy` 잡(`cloudflare/wrangler-action`)이다: `main` push → lint+test 통과 → `wrangler deploy`.
- **로컬 개발**: `make dev`(`wrangler dev`), `make lint`, `make test`, `make ci`(lint+test), `make deploy`(수동/즉시 배포용, 평소엔 안 씀).
- **R2 바인딩**: `wrangler.jsonc`의 `r2_buckets`에 `{ "binding": "IMAGES", "bucket_name": "yukjindae-map-images" }`가 있어야 장소 이미지 서빙(`/images/:key`)이 동작함. 버킷 자체는 `wrangler r2 bucket create`로 미리 만들어둔 것이라 배포 시 자동 생성되지 않음 — 계정을 새로 옮기거나 버킷을 지웠다면 다시 만들어야 함. R2는 Cloudflare 대시보드에서 계정별로 한 번 활성화(Enable R2)해야 쓸 수 있음 (결제 수단 등록 필요하지만 이 프로젝트 규모론 사실상 무료).

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
- 기저귀교환대/수유실/유모차동선 데이터 보강 (컬럼은 있으나 99곳 전부 비어있음 — PDF 원본에 없던 정보라 멤버 제보로 채워야 함)
- 디자인 다듬기 (현재는 로고 색감만 반영한 기본 스타일, 캔바 자료 기준 비주얼 정리는 미착수)

### 2026-07-22 — PWA 개선 (maskable 아이콘, 오프라인 폴백, 설치 배너)

기본 PWA(manifest+sw.js+아이콘)는 이미 완료된 상태였고, 이번엔 그 위에 세 가지를 추가:

1. **maskable 아이콘**: `main-logo-fallback.png`(1024x1024, 배경 제거본)를 `sips`로 62% 축소 후 `#1A2F6B` 배경색으로 512/192 캔버스에 패딩해서 `maskable-icon-512.png`/`maskable-icon-192.png` 생성. Android 등에서 아이콘이 원형/사각형으로 마스킹될 때 로고가 잘리지 않도록 안전 영역 확보. `manifest.json`에 `purpose: "maskable"` 항목으로 추가 등록 (기존 `purpose: "any"` 아이콘은 유지)
2. **오프라인 폴백 페이지**: `public/offline.html` 신규 추가 (사이트 톤에 맞춘 네이비 톤 안내 화면 + 다시 시도 버튼). `sw.js`를 v2→v3로 캐시 버전 올리고 프리캐시 목록에 추가, `navigate` 모드 fetch 실패 시 `캐시 매치 → 없으면 offline.html` 순으로 폴백하도록 수정
3. **설치 유도 배너**: `js/pwa.js`에 `beforeinstallprompt` 이벤트를 받아 하단 탭바 위에 뜨는 배너 UI 추가 (설치/닫기 버튼, 닫으면 `localStorage`에 기억해서 재노출 안 함). 스타일은 `css/style.css`에 `.install-banner*` 클래스로 추가, index/map/place 세 페이지 모두 `js/pwa.js`를 공유하므로 어디서든 동일하게 동작 — ⚠️ 이 배너는 바로 다음 항목에서 모달 팝업으로 교체됨 (`.install-banner*` 클래스는 더 이상 안 씀)
4. **로컬 검증**: `wrangler dev`로 서비스워커 activate, `caches.match('/offline.html')` 프리캐시 확인, `showInstallBanner()` 강제 호출로 배너 렌더링, `/offline.html` 직접 접속 렌더링까지 브라우저로 확인. `npm run lint`/`npm run test` 통과

### 2026-07-22 — 이미지 자체 호스팅으로 전환 (Cloudflare R2)

핫링크 이미지가 하루에 두 번 깨진 뒤(9번 항목의 리퍼러 차단, 그리고 뒤이어 발견된 `shop1.phinf.naver.net`의 SSL 인증서 호스트명 불일치로 인한 mixed-content 실패), 근본적으로 R2 자체 호스팅으로 이전:

1. R2는 계정에서 처음엔 비활성 상태라 사용자가 직접 대시보드에서 Enable R2 (계정 설정이라 대신 할 수 없는 부분)
2. `wrangler r2 bucket create yukjindae-map-images`로 버킷 생성, `wrangler.jsonc`에 `r2_buckets` 바인딩(`IMAGES`) 추가
3. `src/worker.js`에 `/images/:key` 라우트 추가 — `env.IMAGES.get(key)`로 R2 객체를 읽어 1년 immutable 캐시로 서빙
4. 1회성 마이그레이션 스크립트(스크래치 전용, 저장소엔 미포함)로 99곳 전부: 기존 이미지 URL 다운로드(https 강제 + Referer/User-Agent 지정) → `wrangler r2 object put`으로 R2 업로드 → Notion `사진` 필드를 `/images/<페이지ID>.<확장자>`로 교체. 99곳 전부 성공
5. 배포 후 GitHub Actions의 `CLOUDFLARE_API_TOKEN`이 R2 쓰기 권한까지 커버하는지는 이미 검증됨(로컬에서 같은 토큰으로 버킷 생성·업로드 성공) — 별도 시크릿 추가 없이 기존 2개(`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`)로 충분
6. 실제 브라우저로 이미지 로드 확인, `curl`로 `cache-control: public, max-age=31536000, immutable` 헤더 확인

### 2026-07-22 — 설치 유도 팝업 + 헤더 설치 버튼, maskable 아이콘 배경 수정

위 "PWA 개선" 항목의 하단 배너를 첫 접속 시 자동으로 뜨는 모달 팝업으로 교체하고, 상시 노출되는 헤더 버튼을 추가:

1. **설치 팝업으로 교체**: `js/pwa.js`의 `showInstallBanner()`를 제거하고 `showInstallPopup()`으로 전면 교체. `window`의 `load` 이벤트 0.8초 후 자동 표시(이미 standalone이면 스킵, `localStorage`의 `installPopupDismissedDate`가 오늘 날짜면 스킵). User-Agent로 `isIOS()` 판별해서 분기:
   - Android/기타: "홈 화면에 설치하기" 버튼 → `deferredInstallPrompt.prompt()` 직접 호출. 캡처된 이벤트가 없으면 안내 문구로 폴백
   - iOS: Safari 공유 버튼 → 홈 화면에 추가 2단계를 아이콘(SVG 직접 그림, Apple 실제 UI 캡처 아님)으로 안내
   - 공통: "오늘 하루 보지 않기" 버튼(오늘 날짜를 `localStorage`에 저장) / X 닫기(오늘 다시 뜸) 구분
   - CSS는 `.install-popup*` 클래스로 `css/style.css`에 흰 배경 카드 + 네이비 텍스트/버튼 스타일 추가
2. **헤더 설치 버튼**: index/map/place 세 페이지 헤더 우측에 `.header__install` 버튼 상시 노출(이미 설치됐으면 `hidden`). 클릭 시 Android는 캡처된 프롬프트로 바로 설치(원터치), iOS는 위 팝업을 띔
3. **maskable 아이콘 배경 수정**: 처음 만들 때 배경을 `#1A2F6B`(네이비)로 패딩했는데, 로고 자체도 네이비 톤이라 대비가 안 나와서 안 보이는 문제 발견 → 배경을 흰색(`#FFFFFF`)으로 재생성 (`maskable-icon-192.png`/`-512.png`, 생성 스크립트는 동일하고 `--padColor`만 교체)
4. **검증**: `wrangler dev`로 팝업 Android/iOS(UA 오버라이드) 분기, "오늘 하루 보지 않기" 저장·재방문 억제, 헤더 버튼 클릭 시 실제 크로미움 네이티브 설치 프롬프트 호출까지 브라우저로 확인. lint/test 통과 후 3개 커밋으로 나눠 푸시, CI 배포 성공 확인
5. **참고**: 테스트 중 `wrangler dev`가 "이 세션이 AI 에이전트에서 실행 중"임을 감지하고 `/cdn-cgi/explorer/api`(로컬 D1/R2/KV 등 조회용 API)를 자동 노출한다는 걸 발견. 이 API 자체가 파일을 수정하진 않지만, 방문했을 때 R2 관련 바인딩이 `wrangler.jsonc`에 잠깐 나타난 적이 있어(작업 중이던 다른 세션의 R2 커밋과 타이밍이 겹쳐서 혼동했었음) — 실제로는 무관한 두 가지였음. 다음 세션도 비슷한 걸 보면 `git status`/`git log`로 실제 커밋 여부부터 확인할 것

### 2026-07-22 — 홈 화면 "여기어때" 스타일 리디자인

사용자 요청 7가지를 그대로 구현 (7장 "홈 화면 리디자인" 요약과 동일 내용, 여기는 구현 세부):

1. **스플래시 화면**: `index.html` body 최상단에 `#splash` 오버레이 추가, `main-logo.svg` + `#1A2F6B` 배경. 인라인 `<script>`가 `sessionStorage.splashShown` 체크 → 없으면 2초 후 `splash--hide` 클래스(opacity 전환) 추가하고 400ms 뒤 `display:none`, 있으면 즉시 숨김 (탭 이동 시 반복 노출 방지)
2. **카테고리 3D 이모지 그리드**: `js/app.js`에 `REGION_EMOJI` 매핑(서울🗼/서울근교🌳/경기북부🏙️/경기남부🌆/인천✈️/강원도🏔️/충청도🌾/전라도🌊/경상도🏯/제주🌴 — 사용자가 8개만 지정해서 서울근교·경상도는 임의 보완) 추가, `region-grid__item` 마크업에 `region-grid__icon`/`region-grid__label` 분리. CSS는 그라데이션 배경 + `box-shadow`(외부 그림자 + inset 하이라이트) + 이모지 `drop-shadow`로 입체감
3. **히어로 슬라이더**: `.hero__track`(flex) 안에 슬라이드 3장(로고+태그라인 / "300+" / "99곳"), `js/app.js`의 `initHeroSlider()`가 3초 간격 `setInterval`로 `translateX` 이동 + 점 인디케이터(`.hero__dot.is-active`) 갱신. 외부 라이브러리 없이 순수 CSS transform
4. **장소 카드**: `.place-card__thumb` 88px→108px, `.place-card` `border-radius` 14→20px, `border` 제거하고 `box-shadow`로 대체, `:active`에 `scale(0.98)` 인터랙션 추가
5. **하단 탭바**: `index.html`/`map.html`/`place.html` 3곳 전부 `tabbar__item`에 `<span class="tabbar__icon">` 추가(🏠🗺️❤️👤), 기존 `flex-direction:column` 레이아웃이라 아이콘이 텍스트 위에 자동으로 배치됨
6. **폰트/여백**: `body` 기본 `font-weight:500`, 제목류(`header__title`, `section__title`, `place-card__name`) `700→800`, `section`/`.place-list`/`.tag-filter`/`.search` 패딩 확대(16px 기준→18~20px)
7. **검증 중 발견한 것**: 로컬 `wrangler dev`가 이전 턴 사이에 알 수 없는 이유로 죽어있어서(다른 프로세스 정리 중 같이 종료된 듯) 잠깐 프로덕션 URL로 착각하게 만드는 상황 발생 — `ps aux | grep wrangler`로 프로세스 확인 후 재시작해서 해결. 배포 직후 첫 로드는 서비스워커의 stale-while-revalidate 때문에 구버전 CSS가 잠깐 보였다가 새로고침 한 번으로 정상화됨 (예상된 동작, 버그 아님)
8. 사용자 요청대로 `git add . && git commit -m "홈화면 여기어때 스타일 리디자인" && git push` 그대로 실행, CI/CD 성공 확인

---

## 13. 참고 자료

- 강원도 best9.pdf
- 경기북부·인천 TOP9.pdf
- 서울·서울근교 BEST.pdf
- 네이버 Maps API 문서: https://api.ncloud-docs.com/docs/application-maps-overview
- Notion API 문서: https://developers.notion.com
- Cloudflare Workers 배포 가이드: [Cloudflare_Workers_배포_가이드.md](./Cloudflare_Workers_배포_가이드.md)
