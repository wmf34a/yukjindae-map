// 캡처·녹화용 로컬 서버.
//
// public/ 을 그대로 서빙하고 /api/*, /naver-config, /images/* 만 프로덕션으로
// 프록시한다. wrangler dev 없이도(로컬 워커가 죽어 있어도) 실제 데이터가 붙은
// 화면을 캡처할 수 있다. tools/slide/*.html 은 /_slide/<파일명> 으로 열린다 —
// 앱과 같은 출처여야 슬라이드 페이지가 iframe 안을 조작할 수 있기 때문이다.
//
//   node tools/serve.mjs [port]
//   APP_PUBLIC=<육진대맵 저장소>/public node tools/serve.mjs   # 저장소 밖에서 쓸 때
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 스킬 폴더에 따로 떼어 두고 쓸 수도 있어서, 앱 public/ 위치를 밖에서 받는다.
const ROOT = process.env.APP_PUBLIC
  ? path.resolve(process.env.APP_PUBLIC)
  : path.resolve(HERE, "../../public");
const SLIDES = path.join(HERE, "slide");
const PROD = process.env.PROD_ORIGIN || "https://yukjindae-map.wmf34a.workers.dev";
const PORT = Number(process.argv[2] || process.env.PORT || 8799);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

async function sendFile(res, file) {
  const buf = await readFile(file);
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(buf);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/") || url.pathname === "/naver-config" || url.pathname.startsWith("/images/")) {
        const upstream = await fetch(PROD + url.pathname + url.search);
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "text/plain" });
        return res.end(body);
      }
      if (url.pathname.startsWith("/_slide/")) {
        return await sendFile(res, path.join(SLIDES, url.pathname.slice("/_slide/".length)));
      }
      return await sendFile(res, path.join(ROOT, url.pathname === "/" ? "/index.html" : url.pathname));
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(PORT, () => console.log(`serving public/ + ${PROD} proxy on http://localhost:${PORT}`));
