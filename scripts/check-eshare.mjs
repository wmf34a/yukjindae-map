// 공유누리(eshare.go.kr) 인증키 확인.
//
//   node scripts/check-eshare.mjs <인증키>
//
// 호출 규격은 눈으로 확인한 것이다. 안내 페이지에는 경로만 있고 메서드가 없어
// 한참 헤맸다 — GET 은 파라미터를 뭘 주든 400 "잘못된요청"이고, POST + JSON 이라야
// 인증 단계까지 간다.
//
//   POST https://www.eshare.go.kr/eshare-openapi/rsrc/list/{apikey}
//   Content-Type: application/json
//   body: {"pageNo":1,"numOfRows":5}
//
// 응답으로 무엇이 오는지에 따라 상태를 이렇게 읽는다.
//
//   400 잘못된요청  → 메서드나 Content-Type 이 틀렸다. 키와 무관하다.
//   404 잘못된경로  → 경로가 틀렸다.
//   401 잘못된권한  → 키가 아직 승인되지 않았거나 무효다. 발급은 담당자 승인을
//                     거치고 3~5일 걸린다고 안내돼 있다. 아무 문자열을 넣어도
//                     같은 401 이 오므로, 이 응답만으로 키가 틀렸다고 단정할 수 없다.
//   200            → 승인됐다. 아래에서 자원분류명을 찍어 준다.
//
// 자원분류명을 봐야 우리 앱에 쓸 데이터인지 판단할 수 있다. 공유누리가 여는 것은
// 주차장·체육시설·강의실·회의실·문화숙박 같은 대관 자원이라, "아빠와 아이가
// 갈만한 곳"과는 결이 다를 수 있다.

const key = process.argv[2];
if (!key) {
  console.error("사용법: node scripts/check-eshare.mjs <인증키>");
  process.exit(1);
}

const res = await fetch(`https://www.eshare.go.kr/eshare-openapi/rsrc/list/${key}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ pageNo: 1, numOfRows: 20 }),
});
const text = await res.text();
console.log(res.status, text.slice(0, 600));

if (res.ok) {
  const data = JSON.parse(text);
  const rows = data.resultList || data.body || data.items || [];
  for (const r of rows) {
    console.log("-", r.rsrcNm, "|", r.rsrcClsNm || r.rsrcClsCd, "|", r.addr);
  }
}
