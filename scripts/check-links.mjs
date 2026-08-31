// 장소에 걸린 바깥 링크가 살아 있는지 확인한다.
//
//   node scripts/check-links.mjs            # 확인만
//   node scripts/check-links.mjs --apply    # 죽은 링크를 비운다
//
// 공식 사이트를 137곳에 채운 다음 날, 제주 비밀의 숲 링크가 없는 페이지로
// 이어진다는 제보가 왔다. 도메인 자체가 사라진 곳이 일곱이었다.
//
// 링크는 우리가 만든 게 아니라 남의 서버라 언제든 죽는다. 넣고 끝낼 일이
// 아니라 주기적으로 확인해야 한다.

import fs from "node:fs";
import { loadVars, sleep } from "./lib/sources.mjs";

/* oxlint-disable no-await-in-loop -- 남의 서버를 두드리는 일이라 순차로 돈다. */

const vars = loadVars();
const apply = process.argv.includes("--apply");
const H = {
  Authorization: `Bearer ${vars.NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "content-type": "application/json",
};
// 봇을 막는 곳이 많아 평범한 브라우저처럼 요청한다.
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" };

// 도메인이 사라진 것만 확실한 사망이다. 인증서가 낡았거나(구형 관공서 서버)
// 응답이 느린 곳은 브라우저에서 멀쩡히 열리므로 지우면 안 된다.
const DEAD_CODES = new Set(["ENOTFOUND", "ERR_NAME_NOT_RESOLVED"]);

async function probe(url) {
  const tries = url.startsWith("http://") ? [url, url.replace("http://", "https://")] : [url];
  let last = null;
  for (const u of tries) {
    try {
      const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: UA });
      if (res.ok) return { ok: true, status: res.status };
      last = { ok: false, status: res.status };
    } catch (err) {
      const code = err.cause?.code || "";
      last = { ok: false, status: "실패", code };
      if (!DEAD_CODES.has(code)) break;
    }
    await sleep(150);
  }
  return last || { ok: false, status: "실패" };
}

const places = [];
let cursor;
do {
  const data = await (await fetch(`https://api.notion.com/v1/databases/${vars.NOTION_DATABASE_ID}/query`, {
    method: "POST", headers: H, body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  })).json();
  for (const p of data.results) {
    const url = p.properties["공식사이트"]?.url;
    if (url) places.push({ id: p.id, name: p.properties["장소명"]?.title?.[0]?.plain_text || "", url });
  }
  cursor = data.has_more ? data.next_cursor : null;
} while (cursor);

console.log(`공식사이트 ${places.length}곳 확인\n`);
const dead = [];
const doubt = [];
for (const p of places) {
  const r = await probe(p.url);
  if (r.ok) { await sleep(100); continue; }
  const row = { ...p, ...r };
  if (DEAD_CODES.has(r.code) || r.status === 404) { dead.push(row); console.log(`  ✗ 죽음   ${p.name} — ${r.code || r.status}`); }
  else { doubt.push(row); console.log(`  · 의심   ${p.name} — ${r.code || r.status} (브라우저에서는 열릴 수 있음)`); }
  await sleep(100);
}
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/링크점검.json", JSON.stringify({ dead, doubt }, null, 2));
console.log(`\n정상 ${places.length - dead.length - doubt.length} · 죽음 ${dead.length} · 의심 ${doubt.length}`);

if (!apply) {
  console.log("\n확인만 했습니다. 죽은 링크를 비우려면 --apply 를 붙이세요.");
  console.log("의심으로 잡힌 것은 손대지 않습니다 — 낡은 인증서나 느린 서버일 뿐 실제로는 열립니다.");
} else {
  let done = 0;
  for (const d of dead) {
    const res = await fetch(`https://api.notion.com/v1/pages/${d.id}`, {
      method: "PATCH", headers: H, body: JSON.stringify({ properties: { "공식사이트": { url: null } } }),
    });
    if (res.ok) done += 1;
    await sleep(320);
  }
  console.log(`\n${done}곳 링크 제거`);
}
