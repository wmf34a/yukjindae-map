// 움직이는 슬라이드를 mp4 로 녹화한다(코스보기 동선 같은 애니메이션용).
//
//   node tools/record.mjs <url> <out.mp4> [초] [폭] [높이]
//   예) node tools/record.mjs http://localhost:8799/_slide/course-video.html out/06-slide.mp4 9
//
// 대상 페이지는 준비가 끝나면 window.__ready = true 를 세워야 한다(실패하면
// window.__error 에 사유). tools/slide/course-video.html 참고.
//
// ffmpeg 는 FFMPEG 환경변수 → PATH → ffmpeg-static 순으로 찾는다.
// (brew ffmpeg 가 libx265 를 못 찾아 죽는다면 brew reinstall x265 ffmpeg)
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function findFfmpeg() {
  const given = process.env.FFMPEG;
  if (given && spawnSync(given, ["-version"], { stdio: "ignore" }).status === 0) return given;
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) return "ffmpeg";
  try { return createRequire(import.meta.url)("ffmpeg-static"); } catch {}
  console.error("ffmpeg 를 못 찾았다. FFMPEG=<경로> 로 알려주거나, brew reinstall x265 ffmpeg 로 고칠 것.");
  process.exit(1);
}

const URL_ = process.argv[2];
const OUT = path.resolve(process.argv[3]);
const SECONDS = Number(process.argv[4] || 9);
const WIDTH = Number(process.argv[5] || 1080);
const HEIGHT = Number(process.argv[6] || 1350);

const FRAMES = mkdtempSync(path.join(os.tmpdir(), "carousel-frames-"));
mkdirSync(path.dirname(OUT), { recursive: true });

const PORT = 9355;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  // 이 세 개가 없으면 크롬이 페이지를 백그라운드로 보고 rAF 를 눌러버려서
  // 9초를 찍어도 프레임이 스무 장도 안 모이는 일이 생긴다.
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(FRAMES, ".profile")}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const frames = [];

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
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      return;
    }
    if (m.method === "Page.screencastFrame") {
      frames.push({ data: m.params.data, t: m.params.metadata.timestamp });
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL_ });

  let ready = false;
  for (let i = 0; i < 150; i++) {
    const { result } = await send("Runtime.evaluate", { expression: "window.__ready === true", returnByValue: true });
    if (result.value) { ready = true; break; }
    const { result: err } = await send("Runtime.evaluate", { expression: "window.__error || ''", returnByValue: true });
    if (err.value) throw new Error("slide page: " + err.value);
    await sleep(400);
  }
  if (!ready) throw new Error("window.__ready 가 오지 않았다 — 슬라이드 페이지 확인");

  await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
  await sleep(SECONDS * 1000);
  await send("Page.stopScreencast");

  // 프레임 간격이 일정하지 않아서 concat 에 실제 간격을 적어 넘긴다.
  if (frames.length < 60) throw new Error(`프레임이 ${frames.length}장뿐이다 — 다시 실행할 것`);
  const lines = [];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(4, "0")}.jpg`;
    writeFileSync(path.join(FRAMES, name), Buffer.from(f.data, "base64"));
    const dur = i < frames.length - 1 ? Math.max(0.01, frames[i + 1].t - f.t) : 0.06;
    lines.push(`file '${path.join(FRAMES, name)}'`, `duration ${dur.toFixed(3)}`);
  });
  lines.push(`file '${path.join(FRAMES, `f${String(frames.length - 1).padStart(4, "0")}.jpg`)}'`);
  writeFileSync(path.join(FRAMES, "list.txt"), lines.join("\n"));

  ws.close();
  chrome.kill();

  const ffmpeg = findFfmpeg();
  const mp4 = spawnSync(ffmpeg, [
    "-y", "-f", "concat", "-safe", "0", "-i", path.join(FRAMES, "list.txt"),
    "-vf", "fps=30,format=yuv420p",
    "-c:v", "libx264", "-profile:v", "high", "-crf", "20", "-movflags", "+faststart",
    OUT,
  ], { encoding: "utf8" });
  if (mp4.status !== 0) { console.error(mp4.stderr.split("\n").slice(-8).join("\n")); process.exit(1); }

  // 미리보기·공유용 GIF 도 같이 만든다(아티팩트 뷰어는 data: mp4 재생을 막는다).
  const gif = OUT.replace(/\.mp4$/, ".gif");
  const palette = path.join(FRAMES, "palette.png");
  spawnSync(ffmpeg, ["-y", "-i", OUT, "-vf", "fps=12,scale=540:-1:flags=lanczos,palettegen=max_colors=128", palette]);
  spawnSync(ffmpeg, ["-y", "-i", OUT, "-i", palette, "-lavfi",
    "fps=12,scale=540:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3", "-loop", "0", gif]);

  rmSync(FRAMES, { recursive: true, force: true });
  console.log(`frames ${frames.length} -> ${OUT}\n              -> ${gif}`);
  process.exit(0);
}

main().catch((e) => { console.error(e.message); chrome.kill(); process.exit(1); });
