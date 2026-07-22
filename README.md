# 육진대 맵

육진대 아빠들이 직접 다녀온 **아빠와 아이가 갈만한 곳** 전국 지역 베스트 지도 웹앱.

기획 상세는 [YUKJINDAE_MAP.md](./YUKJINDAE_MAP.md), 배포 방법은
[Cloudflare_Workers_배포_가이드.md](./Cloudflare_Workers_배포_가이드.md) 참고.

## 로컬 개발

```bash
make install   # npm install (husky pre-commit/pre-push 훅 포함)
make dev       # wrangler dev — http://localhost:8788
make lint      # oxlint .
make test      # vitest run
make ci        # lint + test
```

`.dev.vars.example`을 복사해 `.dev.vars`를 만들고 Notion/네이버 API 키를
채워야 `/api/places`, `/naver-config`가 로컬에서 동작합니다.

## 기술 스택

- 프론트엔드: Vanilla HTML/CSS/JS (빌드 단계 없음)
- 백엔드: Cloudflare Workers (`src/worker.js`) — Notion DB 프록시, 네이버 지도 키 전달
- 지도: 네이버 Maps API (Dynamic Map)
- 데이터: Notion API
- 배포: Cloudflare Workers (Static Assets)
