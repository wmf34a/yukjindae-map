// 네이버 검색 API는 title/description을 HTML로 반환해서 매칭된 키워드를 <b> 태그로
// 감싸고 &, <, > 같은 문자를 엔티티로 이스케이프한다. 태그만 벗겨내고 엔티티를
// 그대로 두면 "&amp;"처럼 이스케이프된 문자열이 그대로 화면/저장값에 노출된다.
export function decodeNaverHtml(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
