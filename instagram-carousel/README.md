# 육진대 인스타 캐러셀

인스타 캐러셀(1080×1350)을 **실제 앱 화면을 캡처해서** 만든다. 목업을 그리지
않는다 — 화면에 보이는 숫자와 문구는 전부 프로덕션 데이터다.

베이비빌리 `어린이집 입소맵` 오픈 게시물의 구성을 참고해서 잡은 형식이고,
앞으로 육진대 캐러셀은 이 형식을 따른다.

```
instagram-carousel/
  slides.html          # 슬라이드 원본. 여기만 고치고 다시 렌더하면 된다
  caption.md           # 게시용 캡션 + 해시태그 + 수치 확인표
  shots/               # 앱 캡처 원본(3배 해상도) + 커버 사진
  out/                 # 완성물 01~09-slide.png, 영상 슬라이드 mp4/gif
  tools/               # 캡처·렌더·녹화 스크립트
    serve.mjs          # public/ 로컬 서빙 + API 는 프로덕션 프록시
    shoot.mjs          # 앱 화면 캡처
    render.mjs         # slides.html → 슬라이드 PNG
    record.mjs         # 움직이는 슬라이드 → mp4(+gif)
    slide/             # 영상 슬라이드용 페이지(앱을 iframe 으로 태운다)
```

## 만드는 순서

```bash
cd instagram-carousel

# 1) 로컬 서버 (public/ 서빙, /api/* 는 프로덕션 프록시)
node tools/serve.mjs &

# 2) 필요한 앱 화면 캡처 — GEO 는 "내 위치". 장소가 몰린 곳으로 잡는다
BASE=http://localhost:8799 GEO=37.5340,126.9860 \
node tools/shoot.mjs '[
  {"name":"home","path":"/","wait":8000},
  {"name":"map","path":"/map.html","wait":13000,
   "js":"map.setCenter(new naver.maps.LatLng(37.5320,126.9880)); map.setZoom(13);","after":6000},
  {"name":"place","path":"/place.html?id=<장소id>","wait":7000,"js":"window.scrollTo(0,800)"}
]'

# 3) slides.html 에서 문구·이미지 교체 후 렌더
node tools/render.mjs

# 4) 업로드 순서대로 이름 바꾸기
cd out && for i in 1 2 3 4 5 6 7 8 9; do
  [ -f s$i.png ] && mv s$i.png $(printf "%02d" $i)-slide.png
done; cd ..

# 5) 움직임을 보여줄 슬라이드가 있으면 녹화(mp4 + gif 동시 생성)
node tools/record.mjs http://localhost:8799/_slide/course-video.html out/06-slide.mp4 9
```

`shoot.mjs` 는 튜토리얼·설치 유도 팝업을 미리 "봤음"으로 눌러두고, 위치 권한도
허용한 상태로 찍는다. **실기기 스크린샷을 그대로 쓰지 않는다** — 내 위치 파란
점에 실제 위치가 찍혀 나간다.

## 슬라이드 형식

9장이 기본. 늘어나도 10장을 넘기지 않는다(인스타 상한).

| # | 역할 | 만드는 법 |
|---|---|---|
| 1 | 표지 | 장소 사진 12장 그리드(블러+네이비 딤) 위에 헤드라인 + 홈화면 폰 목업 |
| 2 | 뭐예요? | 곰돌이 로고 + 체크 카드 3장 |
| 3~7 | 기능 | 폰 목업 1대(또는 2대) + 말풍선 2개. 슬라이드당 기능 하나 |
| 8 | 꼭 확인해주세요 | 체크 카드 4장(주의사항·제보 유도) |
| 9 | CTA | 곰돌이 로고 + "'육진대' 라고 댓글 남기면 링크 드려요" |

기능 슬라이드는 **화면 하나에 메시지 하나**. 말풍선 두 개까지만 쓰고, 셋째
문장이 필요하면 슬라이드를 나눈다.

## 디자인 토큰 (slides.html `<style>`)

| 항목 | 값 |
|---|---|
| 슬라이드 | 1080 × 1350 (4:5) |
| 배경 | `#F5F6FA` · 텍스트 `#2C3555` · 강조 네이비 `#1A2F6B` |
| 말풍선 | 배경 `#232B47`, 강조 글자 `#FFD874`, 28px/600, radius 22 |
| 헤드라인 | 66px / 800 / letter-spacing -.04em, 2줄 |
| 폰트 | Pretendard (jsDelivr CDN) |
| 폰 목업 | 폭 590px, 높이 1080px — **아래는 슬라이드 밖으로 흘려보낸다** |
| 폰 2대 | 폭 466px, 높이 1000px, ±3도 회전 |
| 카드 확대컷 | 폭 966px, radius 30 |

폰 비율은 레퍼런스(베이비빌리)를 재서 맞춘 값이다: 폰 폭 ÷ 슬라이드 폭 ≈ 0.55,
아래는 화면 밖으로 잘려나가 앱 화면이 커 보인다. 폰이 하단을 채우는 슬라이드에는
브랜드마크를 넣지 않는다.

## 영상 슬라이드

정지 화면으로 전달이 안 되는 것(코스보기 동선 위를 자동차가 달리는 것 등)은
영상으로 만든다. `tools/slide/course-video.html` 이 본보기다 — 슬라이드 프레임
안에 앱을 iframe 으로 태우고, 열어야 할 화면까지 스스로 조작한 뒤
`window.__ready = true` 를 세운다. 같은 출처(로컬 서버)라서 iframe 안을 만질 수 있다.

- 결과물: `out/NN-slide.mp4`(업로드용) + `NN-slide.gif`(공유·미리보기용)
- 인스타는 캐러셀 안의 영상 슬라이드를 그대로 받는다. GIF 는 업로드용이 아니다.
- 정지컷 PNG 도 같이 남겨둔다(영상이 막힐 때 대체).

## 캡션

`caption.md` 참고. 구조는 해시태그 → 오픈 한 줄 → 페인포인트 → 📍핵심 기능 →
💡참고사항 → 댓글 CTA.

**숫자는 게시 직전에 확인한다.** 장소 249곳·축제 9개·코스 10개·수유실 522곳은
전부 API 응답에서 나온 값이라 시간이 지나면 달라진다.

```bash
curl -s https://yukjindae-map.wmf34a.workers.dev/api/places     | jq .count
curl -s https://yukjindae-map.wmf34a.workers.dev/api/festivals  | jq '.festivals|length'
curl -s https://yukjindae-map.wmf34a.workers.dev/api/courses    | jq '.courses|length'
curl -s https://yukjindae-map.wmf34a.workers.dev/api/nursing-rooms | jq '.rooms|length'
```

## 미리보기 아티팩트

완성하면 슬라이드 전체를 한 페이지에서 넘겨볼 수 있는 아티팩트로 만들어
링크를 넘긴다. 영상 슬라이드는 **GIF 로 넣는다** — 아티팩트 뷰어는 `data:` 로
넣은 mp4 재생을 막아서 포스터 이미지만 보인다.

## 걸렸던 것들

- `wrangler dev` 는 `allow_custom_ports` 플래그 때문에 지금 로컬에서 안 뜬다.
  그래서 `tools/serve.mjs` 로 `public/` 을 직접 서빙하고 API 만 프로덕션으로 넘긴다.
- 렌더 전에 `document.fonts.ready` 를 기다리지 않으면 Pretendard 가 늦게 붙어
  자간이 통째로 달라진 이미지가 나온다.
- `record.mjs` 가 프레임을 60장도 못 모으면 페이지가 준비되기 전에 찍은 것이다.
  그냥 다시 실행하면 된다.
- brew ffmpeg 가 `libx265` 를 못 찾아 실행이 안 되는 상태라면
  `npm i -D ffmpeg-static` 으로 우회한다(`record.mjs` 가 알아서 찾는다).
