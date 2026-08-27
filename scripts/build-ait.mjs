// 앱인토스 미니앱 번들(.ait)에 들어갈 정적 파일을 dist/에 만든다. public/을 그대로
// 쓰지 않는 이유는 두 가지다.
//   1. 웹뷰 오리진(*.tossmini.com)에서 "/naver-config" 상대경로가 Worker가 아니라
//      번들 자신을 가리켜 지도 키가 안 실려온다. <script src>는 런타임 분기를 넣을
//      자리가 없어서 빌드 시점에 절대경로로 바꾼다.
//   2. PWA 설치 유도(pwa.js/manifest/sw.js)는 이미 토스 앱 안이라 의미가 없고,
//      외부 설치 유도로 읽혀 출시 검수에서 걸릴 수 있다.
// API·이미지 경로는 util.js의 apiUrl()이 런타임에 처리하므로 여기서 손대지 않는다.
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public");
const OUT = path.join(ROOT, "dist");
const WORKER_ORIGIN = "https://yukjindae-map.wmf34a.workers.dev";

// 번들에서 빼는 파일들. sw.js는 등록 주체인 pwa.js가 빠지면 죽은 파일이 된다.
const EXCLUDED = new Set(["sw.js", "manifest.json", path.join("js", "pwa.js")]);

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, {
  recursive: true,
  filter: (source) => !EXCLUDED.has(path.relative(SRC, source)),
});

await Promise.all(
  (await htmlFiles(OUT)).map(async (file) => {
    const before = await readFile(file, "utf8");
    const after = before
      .replace(/<script src="\/naver-config"><\/script>/g, `<script src="${WORKER_ORIGIN}/naver-config"></script>`)
      .replace(/^[ \t]*<link rel="manifest"[^>]*>\n/gm, "")
      .replace(/^[ \t]*<script src="js\/pwa\.js"><\/script>\n/gm, "");
    if (after !== before) await writeFile(file, after);
  })
);

console.log(`dist/ 생성 완료 — ${WORKER_ORIGIN} 기준`);
