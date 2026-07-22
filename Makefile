.PHONY: install dev lint lint-fix test test-watch ci deploy

install:
	npm install

dev:
	npm run dev

lint:
	npm run lint

lint-fix:
	npm run lint:fix

test:
	npm run test

test-watch:
	npm run test:watch

## CI에서 도는 것과 동일한 체크를 로컬에서 실행
ci: lint test

## Cloudflare Workers(Static Assets)로 즉시 배포 (최초 1회 `npx wrangler login` 필요)
## GitHub 저장소가 Cloudflare Workers Builds에 연결되어 있다면 push만으로 자동 배포되므로
## 이 타겟은 수동/즉시 배포가 필요할 때만 사용하면 됩니다. (설정: wrangler.jsonc)
deploy:
	npm run deploy
