# 육진대 인스타 캐러셀

인스타 캐러셀(1080×1350)을 **HTML/CSS로 짜서 크롬으로 렌더**한다. 앱 화면이든
행사 사진이든 같은 디자인 시스템(`carousel.css`)을 쓴다. 베이비빌리
`어린이집 입소맵` 오픈 게시물의 구성을 참고해 잡은 형식이고, 앞으로 육진대
캐러셀은 이 형식을 따른다.

```
instagram-carousel/
  carousel.css         # ★ 디자인 시스템 — 색·글자·컴포넌트 전부 여기
  themes/              # ★ 테마 3종(클린·써니·나이트) + 미리보기 페이지
  template.html        # ★ 새 캐러셀 시작점(아빠 운동회 예시로 채워둠)
  템플릿-미리보기.html   # 더블클릭하면 바로 열리는 단독 파일(CSS·이미지 내장)
  slides*.html         # 실제 작업 파일들 (맵 오픈 · 유모차 콘서트 · 축제)
  caption*.md          # 각 편의 게시용 캡션
  examples/            # 스킬 패키지로 넘길 때 함께 담는 본보기 모음
  shots/               # 사진·앱 캡처 원본(3배 해상도)
  out/                 # 완성물 01~09-slide.png, 영상 슬라이드 mp4/gif
  tools/
    serve.mjs          # public/ 로컬 서빙 + API 는 프로덕션 프록시
    shoot.mjs          # 앱 화면 캡처
    render.mjs         # HTML → 슬라이드 PNG
    record.mjs         # 움직이는 슬라이드 → mp4(+gif)
    slide/             # 영상 슬라이드용 페이지
```

## 빨리 만들기

```bash
cd instagram-carousel
cp template.html slides-운동회.html     # 사진은 shots/ 에 넣는다
# … 문구·이미지 채우고 …
node tools/render.mjs slides-운동회.html out-운동회
cd out-운동회 && i=1; for f in t*.png; do mv "$f" "$(printf '%02d' $i)-slide.png"; i=$((i+1)); done
```

렌더는 섹션 `id` 를 파일 이름으로 쓴다(`t1.png`, `t2.png` …). 업로드 순서대로
`01-slide.png` … 로 바꿔서 넘긴다. **10장을 넘기지 않는다**(인스타 상한).

주제는 가리지 않는다 — 행사 후기, 모임 모집, 공지, 꿀팁 정리, 장소 추천 무엇이든
같은 컴포넌트로 만든다. 앱 화면은 필요할 때만 넣는다.

## 슬라이드 형식

| # | 역할 | 컴포넌트 |
|---|---|---|
| 1 | 표지 | `.cover` — 사진 그리드/한 장 + 헤드라인 + 브랜드 뱃지 |
| 2 | 뭐예요? | `.checks` 카드 3장 |
| 3~7 | 본문 | 사진(`.photo`, `.photo-grid`) · 앱 화면(`.phone`) · 순서(`.steps`) · 숫자(`.stat`) · 후기(`.quote`) 중 골라서 |
| 8 | 꼭 확인해주세요 | `.checks` 카드 3~4장 |
| 9 | CTA | `.cta` — 댓글 키워드 → 링크/DM |

**슬라이드 하나에 메시지 하나.** 말풍선은 두 개까지, 셋째 문장이 필요하면
슬라이드를 나눈다.

## 디자인 토큰 (`carousel.css` 의 `:root`)

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `--navy` | `#1A2F6B` | 헤드라인 강조, 숫자, 카드 마크 |
| `--text` | `#2C3555` | 본문 제목 |
| `--sub` | `#6E779A` | 설명 글 |
| `--bg` | `#F5F6FA` | 슬라이드 바탕 |
| `--ink` | `#232B47` | 말풍선 배경 |
| `--pop` | `#FFD874` | **유일한 강조색** — 말풍선 `<b>`, CTA 키워드 |
| `--fs-cover` / `--fs-head` / `--fs-card` / `--fs-body` / `--fs-cap` | 78 / 66 / 40 / 28 / 24 px | 이 다섯 밖으로 나가지 않는다 |

글자는 Pretendard, 헤드라인은 800 weight에 `letter-spacing: -.04em`. 색을 새로
만들지 않는다 — 강조가 필요하면 노랑 하나로 해결한다.

## 테마

`carousel.css` 는 색·글자 크기를 토큰으로만 쓰기 때문에, 테마 파일이 토큰을 덮어쓰면
슬라이드 HTML을 건드리지 않고 톤 전체가 바뀐다.

| 테마 | 파일 | 톤 | 어울리는 소식 |
|---|---|---|---|
| A 클린 | (기본) | 밝은 회백 + 네이비 + 노랑 | 정보 전달·앱 소개·공지 |
| B 써니 | `themes/theme-b-sunny.css` | 크림 종이 + 둥근 글씨(Jua) + 두꺼운 테두리 | 아이 행사·모집·후기 |
| C 나이트 | `themes/theme-c-night.css` | 짙은 남색 + 민트·노랑 형광 | 야간 축제·불꽃놀이·공연 |

```html
<link rel="stylesheet" href="carousel.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap" />
<link rel="stylesheet" href="themes/theme-b-sunny.css" />
```

`themes/preview-a.html` · `preview-b.html` · `preview-c.html` 을 렌더하면 네 종류
슬라이드(표지·사진카드·글카드·CTA)로 톤을 비교할 수 있다.

**표지만 다른 테마로 섞어도 된다.** 2026-09 축제 캐러셀은 표지를 나이트, 본문을
써니로 뽑았다 — 테마별로 한 벌씩 렌더한 뒤 필요한 장만 한 폴더에 모으면 된다.

## 컴포넌트 카탈로그

전부 `carousel.css` 에 있고, 쓰는 예시는 `template.html` 에 슬라이드별로 있다.

| 클래스 | 언제 |
|---|---|
| `.slide` | 슬라이드 하나(1080×1350). 모든 섹션의 기본 |
| `.cover` + `.cover__grid` | 표지. 사진 12장을 3×4로 깔고 딤 처리 |
| `.cover__bg` | 표지를 사진 한 장으로 갈 때(`.cover__veil--light` 와 함께) |
| `.cover__phone` | 표지에 앱 화면을 세워둘 때 |
| `.head` / `.head--tight` | 슬라이드 상단 헤드라인(2줄 권장) |
| `.checks` / `.check` | 체크 카드 목록 — 글로만 가는 슬라이드 |
| `.stage` + `.phone.phone--clip` | 앱 화면 폰 목업. **아래는 화면 밖으로 흘린다** |
| `.stage--duo` | 폰 2대 나란히(±3도) |
| `.card-shot` | 화면 일부나 사진 한 장을 확대 컷 카드로 |
| `.photo` + `.photo__caption` | 사진 한 장을 꽉 채우고 아래에 글 |
| `.photo-grid` / `.photo-grid--3` | 사진 2~4장을 카드로. `--3` 은 첫 장이 가로로 큼 |
| `.steps` / `.step` | 순서·시간표(운동회 프로그램 등) |
| `.stat` | 큰 숫자 한 방(참가 가족 수 등) |
| `.quote` | 참가자 한마디·후기 |
| `.bubble` + `--tl/--tr/--bl/--br/--b/--foot/--wide` | 화면 위 말풍선 |
| `.brandmark` | 하단 워터마크. 주인공이 아래를 채우는 슬라이드엔 넣지 않는다 |
| `.cta` | 마지막 슬라이드 |

폰 비율은 레퍼런스를 재서 맞춘 값이다 — 폰 폭 ÷ 슬라이드 폭 ≈ 0.55(590px),
높이 1080px로 아래를 잘라내 앱 화면이 커 보이게 한다.

## 소재가 앱 화면일 때

```bash
node tools/serve.mjs &          # public/ 서빙, /api/* 는 프로덕션 프록시

BASE=http://localhost:8799 GEO=37.5340,126.9860 \
node tools/shoot.mjs '[
  {"name":"map","path":"/map.html","wait":13000,
   "js":"map.setCenter(new naver.maps.LatLng(37.5320,126.9880)); map.setZoom(13);","after":6000},
  {"name":"place","path":"/place.html?id=<장소id>","wait":7000,"js":"window.scrollTo(0,800)"}
]'
```

- `GEO` 는 "내 위치". 장소가 몰린 곳(용산·남산 `37.5340,126.9860`)으로 잡는다.
  빈 지도가 나오면 캐러셀이 초라해 보인다.
- 튜토리얼·설치 팝업은 스크립트가 미리 꺼둔다.
- **실기기 스크린샷을 그대로 쓰지 않는다** — 내 위치 파란 점에 실제 위치가 찍혀 나간다.
- 모달처럼 화면 일부만 크게 쓸 땐 `clipSel` 로 그 요소만 자른다.

## 소재가 사진일 때 (운영진이 사진을 넘겨준 경우)

1. 받은 사진을 `shots/` 에 넣는다. 세로 사진이 편하다(4:5에 잘 맞는다).
2. `template.html` 을 복사해 표지 그리드에 12장, 본문에 대표컷 몇 장을 배치한다.
3. 사진마다 한 문장씩 붙인다 — 무슨 장면인지, 왜 좋았는지.
4. 숫자(참가 가족 수 등)는 운영진에게 확인한 값만 쓴다. 모르면 `.stat` 슬라이드를 뺀다.
5. 얼굴이 크게 나오는 사진은 **당사자 동의를 받은 것만.** 공개 게시물이다.

앱 얘기가 하나도 없어도 된다. 마지막 CTA 의 댓글 키워드만 그 행사에 맞게 바꾼다.

## 영상 슬라이드

정지 화면으로 전달이 안 되는 것(코스보기 동선 위를 자동차가 달리는 것 등)만
영상으로 만든다. `tools/slide/course-video.html` 이 본보기 — 슬라이드 프레임 안에
앱을 iframe 으로 태우고, 보여줄 화면까지 스스로 조작한 뒤 `window.__ready = true`
를 세운다. 같은 출처(로컬 서버)라 iframe 안을 만질 수 있다.

```bash
node tools/record.mjs http://localhost:8799/_slide/course-video.html out/06-slide.mp4 9
```

- 나오는 것: `out/06-slide.mp4`(업로드용) + `06-slide.gif`(공유·미리보기용)
- 인스타는 캐러셀 안의 영상 슬라이드를 그대로 받는다. GIF 는 업로드용이 아니다.
- 정지컷 PNG 도 같이 남겨둔다(영상이 막힐 때 대체).

## 캡션

`caption.md` 참고. 구조는 해시태그 → 오픈 한 줄 → 페인포인트 → 📍핵심 → 💡참고사항
→ 댓글 CTA.

앱 관련 숫자는 **게시 직전에 확인한다.**

```bash
curl -s https://yukjindae-map.wmf34a.workers.dev/api/places        | jq .count
curl -s https://yukjindae-map.wmf34a.workers.dev/api/festivals     | jq '.festivals|length'
curl -s https://yukjindae-map.wmf34a.workers.dev/api/courses       | jq '.courses|length'
curl -s https://yukjindae-map.wmf34a.workers.dev/api/nursing-rooms | jq '.rooms|length'
```

## 미리보기 아티팩트

완성하면 슬라이드를 한 페이지에서 넘겨볼 수 있는 아티팩트로 만들어 링크를 넘긴다.
영상 슬라이드는 **GIF 로 넣는다** — 아티팩트 뷰어는 `data:` mp4 재생을 막아서
포스터 이미지만 보인다.

## 다른 사람에게 넘길 때

받는 사람 준비물: **Node 22 이상**(`tools/*.mjs` 가 내장 WebSocket 을 쓴다),
**Chrome**(맥 기본 경로. 다르면 `CHROME=<경로>` 로 알려준다), 그리고 Claude Code.

| 무엇을 만드나 | 넘길 파일 |
|---|---|
| 사진으로 만드는 캐러셀(행사·모임 등) | `carousel.css` · `template.html` · `README.md` · `tools/render.mjs` · `.claude/skills/carousel/SKILL.md` |
| 앱 화면이 들어가는 캐러셀 | 위 + `tools/serve.mjs` · `tools/shoot.mjs` |
| 움직이는 슬라이드까지 | 위 + `tools/record.mjs` · `tools/slide/` (그리고 ffmpeg) |

저장소를 clone 할 수 있으면 그냥 `yukjindae-map` 를 받아서 `instagram-carousel/`
안에서 작업하면 된다 — 스킬(`.claude/skills/carousel/`)이 같이 딸려온다.

폴더만 따로 받은 경우 폴더 구조는 지켜야 한다(`carousel.css` 와 `template.html`
는 같은 폴더, `tools/` 는 그 아래, 사진은 `shots/`).

## 걸렸던 것들

- `wrangler dev` 는 `allow_custom_ports` 플래그 때문에 지금 로컬에서 안 뜬다.
  그래서 `tools/serve.mjs` 로 `public/` 을 직접 서빙하고 API 만 프로덕션으로 넘긴다.
- 렌더 전에 `document.fonts.ready` 를 기다리지 않으면 Pretendard 가 늦게 붙어
  자간이 통째로 달라진 이미지가 나온다(`render.mjs` 가 처리).
- `record.mjs` 는 크롬 프로필을 `/tmp/carousel-record-profile` 에 고정해 재사용한다.
  매번 새 프로필로 띄우면 지도 타일을 처음부터 받느라 프레임이 스무 장도 안 모인다.
  그래도 프레임이 적게 나오면 한 번 더 실행한다(첫 실행은 캐시가 비어 있다).
- brew ffmpeg 가 `libx265` 를 못 찾아 죽는 상태라면 `brew reinstall x265 ffmpeg`,
  급하면 `FFMPEG=<ffmpeg-static 경로> node tools/record.mjs …` 로 우회한다.
