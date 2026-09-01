// slides.html 의 .slide 마다 1080×1350 PNG 를 뽑는다.
//
//   node tools/render.mjs [slides.html] [출력폴더]
//
// 파일명은 각 섹션의 id(s1, s2 …). 업로드 순서대로 01-slide.png … 로 바꾸는 건
// README 의 명령 한 줄로 처리한다.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.argv[2] || path.resolve(HERE, "../slides.html"));
const OUT = path.resolve(process.argv[3] || path.resolve(HERE, "../out"));
mkdirSync(OUT, { recursive: true });

const PORT = 9344;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--allow-file-access-from-files",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "carousel-render-"))}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();

function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((res, rej) => pending.set(msgId, { res, rej }));
}

async function main() {
  let list;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); list = await r.json(); if (list.length) break; } catch {}
    await sleep(300);
  }
  ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1350, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "file://" + SRC });
  await sleep(6000);
  // 웹폰트(Pretendard)가 붙기 전에 찍으면 자간이 통째로 달라진다.
  await send("Runtime.evaluate", { expression: "document.fonts.ready.then(()=>1)", awaitPromise: true });

  const { result } = await send("Runtime.evaluate", {
    expression: `JSON.stringify([...document.querySelectorAll('.slide')].map(function(el){var r=el.getBoundingClientRect();return {id:el.id,x:r.x+window.scrollX,y:r.y+window.scrollY,w:r.width,h:r.height}}))`,
    returnByValue: true,
  });

  for (const r of JSON.parse(result.value)) {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 },
    });
    writeFileSync(path.join(OUT, `${r.id}.png`), Buffer.from(data, "base64"));
    console.log("rendered", r.id, `${r.w}x${r.h}`);
  }

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
