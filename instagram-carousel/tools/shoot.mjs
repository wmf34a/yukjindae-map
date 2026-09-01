// 앱 화면을 폰 크기로 캡처한다(3배 해상도 PNG).
//
//   node tools/shoot.mjs '<json 배열>' [출력폴더]
//
// 각 항목: { name, path, wait?, js?, after?, clipSel? }
//   wait    페이지 로드 후 대기(ms, 기본 6000) — 지도·API 응답을 기다린다
//   js      캡처 직전에 실행할 코드(지도 중심 이동, 버튼 클릭 등)
//   after   js 실행 후 대기(ms, 기본 1500)
//   clipSel 이 선택자 영역만 잘라서 캡처(모달만 크게 뽑을 때)
//
// 환경변수: BASE(기본 로컬 서버) · GEO(내 위치 lat,lng) · VW/VH(뷰포트)
//
// 예)
//   BASE=http://localhost:8799 GEO=37.534,126.986 VW=390 VH=800 \
//   node tools/shoot.mjs '[{"name":"map","path":"/map.html","wait":13000}]' shots
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.argv[3] || path.resolve(HERE, "../shots");
mkdirSync(SHOTS, { recursive: true });

const BASE = process.env.BASE || "http://localhost:8799";
const [GLAT, GLNG] = (process.env.GEO || "37.5340,126.9860").split(",").map(Number);
const VW = Number(process.env.VW || 390);
const VH = Number(process.env.VH || 800);
const PORT = 9333;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "carousel-shoot-"))}`,
  `--window-size=${VW},${VH}`,
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
  await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 3, mobile: true });
  await send("Browser.grantPermissions", { origin: BASE, permissions: ["geolocation"] });
  await send("Emulation.setGeolocationOverride", { latitude: GLAT, longitude: GLNG, accuracy: 30 });
  // 튜토리얼·설치 유도 팝업이 화면을 가려서 미리 "봤음"으로 표시해 둔다.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{
      localStorage.setItem("yukjindae_tour_seen","1");
      localStorage.setItem("installPopupDismissedDate", new Date().toISOString().slice(0,10));
      sessionStorage.setItem("splashShown","1");
    }catch(e){}`,
  });

  for (const shot of JSON.parse(process.argv[2])) {
    await send("Page.navigate", { url: BASE + shot.path });
    await sleep(shot.wait ?? 6000);
    if (shot.js) await send("Runtime.evaluate", { expression: shot.js, awaitPromise: true });
    await sleep(shot.after ?? 1500);

    let params = { format: "png", captureBeyondViewport: false };
    if (shot.clipSel) {
      const { result } = await send("Runtime.evaluate", {
        expression: `(function(){var e=document.querySelector(${JSON.stringify(shot.clipSel)});var r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height})})()`,
        returnByValue: true,
      });
      params = { format: "png", captureBeyondViewport: true, clip: { ...JSON.parse(result.value), scale: 3 } };
    }
    const { data } = await send("Page.captureScreenshot", params);
    writeFileSync(path.join(SHOTS, `${shot.name}.png`), Buffer.from(data, "base64"));
    console.log("saved", shot.name);
  }

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
