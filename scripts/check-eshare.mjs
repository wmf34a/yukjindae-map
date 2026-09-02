// 공유누리(eshare.go.kr) 공유자원 조회.
//
//   node scripts/check-eshare.mjs <인증키> [분류코드]
//
// 호출 규격은 안내 페이지에 흩어져 있어 두 번 헤맸다. 둘 다 응답만 보면
// 키가 잘못된 것처럼 보인다:
//
//   GET 으로 부르면 → 400 "잘못된요청". 아무 문자열을 키 자리에 넣어도 같은 400 이
//     온다. 키 문제가 아니라 메서드 문제다. POST + application/json 이라야 한다.
//   승인받지 않은 서비스의 분류코드로 부르면 → 401 "잘못된권한". 이것도 아무
//     문자열에 같은 401 이라, 키가 승인 대기인 줄 알기 쉽다.
//
// 서비스마다 경로가 다르다. 분류코드가 경로에 들어가고, 그 서비스를 따로
// 승인받아야 한다.
//
//   전체 목록  POST /eshare-openapi/rsrc/list/{apikey}
//   분류별     POST /eshare-openapi/rsrc/list/{분류코드}/{apikey}
//   상세       POST /eshare-openapi/rsrc/detail/{apikey}   body: {"rsrcNoList":[...]}
//
// 2026-09-02 기준 승인된 것은 문화·숙박(010000)과 체육시설(010500) 두 가지다.

const CLASSES = {
  "010000": "문화·숙박",
  "010100": "회의실",
  "010200": "강의실·강당",
  "010500": "체육시설",
  "010700": "주차장",
  "020000": "물품(생활·사무·교통)",
  "030000": "연구·실험장비",
  "040000": "교육·강좌",
};

const key = process.argv[2];
const only = process.argv[3];
if (!key) {
  console.error("사용법: node scripts/check-eshare.mjs <인증키> [분류코드]");
  process.exit(1);
}

async function call(path, body) {
  const res = await fetch(`https://www.eshare.go.kr/eshare-openapi/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const codes = only ? [only] : Object.keys(CLASSES);
for (const code of codes) {
  const { status, json } = await call(`rsrc/list/${code}/${key}`, { pageNo: 1, numOfRows: 5 });
  const name = CLASSES[code] || code;
  if (status !== 200) {
    console.log(`${code} ${name}: ${status} ${json?.resultMsg || ""} — 이 서비스는 승인되지 않았다`);
    continue;
  }
  console.log(`${code} ${name}: 총 ${json.resultCount}건`);
  for (const r of json.data || []) console.log(`   - ${r.rsrcNm} | ${r.addr}`);
}
