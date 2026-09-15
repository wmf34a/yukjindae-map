// 목록 API 응답을 public/data/*.json 으로 떠 둔다.
//
// 이 파일들은 정적 자산이라 워커를 거치지 않는다. 무료 플랜 하루 한도를 넘겨
// API 가 1027 로 막혀도 그대로 내려가므로, 처음 온 사람이 빈 화면 대신 목록을
// 본다(util.js 의 SNAPSHOTS). 재방문자는 lastGood 이 받쳐 준다.
//
// 배포 전에 돌린다. 로컬 `wrangler dev` 가 떠 있어야 한다 — 프로덕션을 부르면
// 정작 막혀 있을 때 뜰 수가 없다.
//
//   npx wrangler dev --port 8788 &
//   node scripts/dump-snapshots.mjs
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.SNAPSHOT_BASE || "http://localhost:8788";
const TARGETS = [
  ["/api/places", "places.json", "places"],
  ["/api/home", "home.json", "banners"],
  ["/api/courses", "courses.json", "courses"],
];

await mkdir("public/data", { recursive: true });

for (const [path, file, probe] of TARGETS) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  const data = await res.json();
  // 빈 응답을 덮어쓰면 그물이 그물 노릇을 못 한다. 받아온 것이 비었으면 멈춘다.
  if (!Array.isArray(data[probe])) throw new Error(`${path} 응답에 ${probe} 배열이 없다`);
  if (path === "/api/places" && data.places.length === 0) throw new Error("장소가 0곳이다 — 덮어쓰지 않는다");
  await writeFile(`public/data/${file}`, JSON.stringify(data));
  const counts = Object.entries(data)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k} ${v.length}`)
    .join(" · ");
  console.log(`  ${file.padEnd(14)} ${counts}`);
}
