// 공유누리(eshare.go.kr) 인증키 확인.
//
//   node scripts/check-eshare.mjs <인증키>
//
// 경로와 파라미터는 공유누리 OPEN API 안내(svcNo=1)에서 확인한 것이다.
// 인증키는 쿼리스트링이 아니라 URL 경로에 들어간다 — 이걸 틀리면 404 가 아니라
// 400 "잘못된요청"이 와서 키가 잘못된 것처럼 보인다.
//
//   목록: https://www.eshare.go.kr/eshare-openapi/rsrc/list/{apikey}
//   상세: https://www.eshare.go.kr/eshare-openapi/rsrc/detail/{apikey}  (rsrcNoList 필수)
//
// 400 "잘못된요청"이 계속 나오면 키가 아직 승인 대기이거나 다른 서비스의 키다.

const key = process.argv[2];
if (!key) {
  console.error("사용법: node scripts/check-eshare.mjs <인증키>");
  process.exit(1);
}

const url = `https://www.eshare.go.kr/eshare-openapi/rsrc/list/${key}?pageNo=1&numOfRows=5`;
const res = await fetch(url, { headers: { Accept: "application/json" } });
const text = await res.text();
console.log(res.status, text.slice(0, 600));

if (res.ok) {
  const data = JSON.parse(text);
  const rows = data.resultList || data.body || data.items || [];
  // 자원분류명을 봐야 우리 앱에 쓸 데이터인지 판단할 수 있다. 대관용 회의실만
  // 잔뜩 나오면 "아빠와 아이가 갈만한 곳"과는 결이 다르다.
  for (const r of rows.slice(0, 5)) {
    console.log("-", r.rsrcNm, "|", r.rsrcClsNm || r.rsrcClsCd, "|", r.addr);
  }
}
