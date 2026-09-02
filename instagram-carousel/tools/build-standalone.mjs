// 슬라이드 HTML 을 "혼자서도 열리는" 단일 파일로 만든다.
//
//   node tools/build-standalone.mjs <입력.html> <출력.html>
//
// 로컬 CSS 와 이미지를 파일 안에 넣는다(웹폰트만 인터넷에서 받아온다).
// 더블클릭으로 열거나 다른 폴더로 옮겨도 디자인이 그대로 보인다.
// 없는 이미지는 자리표시 이미지(shots/placeholder/ph-01.svg)로 바꾼다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const BASE = path.dirname(SRC);

const MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

const placeholders = [1, 2, 3, 4, 5, 6].map((n) =>
  path.resolve(HERE, `../shots/placeholder/ph-0${n}.svg`));
let phTurn = 0;

function dataUri(file) {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) return null;
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

let html = readFileSync(SRC, "utf8");

// 1) 로컬 스타일시트를 <style> 로 펼친다. 그 안의 상대 url() 은 없으니 그대로 옮긴다.
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (tag, href) => {
  if (/^https?:\/\//.test(href)) return tag; // 웹폰트는 그대로 둔다
  const file = path.resolve(BASE, href);
  if (!existsSync(file)) return "";
  return `<style>\n/* ${href} */\n${readFileSync(file, "utf8")}\n</style>`;
});

// 2) 로컬 이미지를 data URI 로 넣는다. 없으면 자리표시 이미지로.
html = html.replace(/src="([^"]+)"/g, (attr, src) => {
  if (/^(https?:|data:)/.test(src)) return attr;
  const file = path.resolve(BASE, src);
  const target = existsSync(file) ? file : placeholders[phTurn++ % placeholders.length];
  const uri = dataUri(target);
  return uri ? `src="${uri}"` : attr;
});

// 3) 열었을 때 무엇인지 알려주는 안내 띠를 맨 위에 붙인다(렌더에는 쓰지 않는 파일이다).
const note = `<div style="max-width:1080px;margin:0 auto;padding:18px 22px;font:600 15px/1.6 -apple-system,'Apple SD Gothic Neo',sans-serif;color:#5C6689;background:#EFF1F7;border-bottom:1px solid #DEE2EF">
슬라이드 생김새 확인용 파일입니다. 아래로 스크롤하면 한 장씩 이어집니다 · 회색 판은 사진이 들어갈 자리예요
</div>`;
html = html.replace(/<body([^>]*)>/, `<body$1>\n${note}`);

writeFileSync(OUT, html);
console.log(`${path.basename(OUT)}  ${(html.length / 1024 / 1024).toFixed(2)} MB`);
