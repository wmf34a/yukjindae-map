const CACHE_NAME = "yukjindae-map-v152";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/map.html",
  "/place.html",
  "/about.html",
  "/privacy.html",
  "/favorite.html",
  "/festival.html",
  "/festival-detail.html",
  "/courses.html",
  "/offline.html",
  "/css/style.css",
  "/css/map.css",
  "/css/place.css",
  "/js/app.js",
  "/js/region-map-paths.js",
  "/js/map.js",
  "/js/util.js",
  "/js/info-dot.js",
  "/js/place.js",
  "/js/reviews.js",
  "/js/report.js",
  "/js/suggest.js",
  "/js/bug-report.js",
  "/js/pwa.js",
  "/js/favorites.js",
  "/js/favorite-page.js",
  "/js/about.js",
  "/js/festival.js",
  "/js/festival-detail.js",
  "/js/courses.js",
  "/js/course.js",
  "/js/vendor/MarkerClustering.js",
  "/assets/logo/character-logo-96.png",
  "/assets/logo/main-logo.svg",
  "/assets/splash/splash-bg.jpg",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 항상 최신이어야 하는 API/설정 응답은 캐시하지 않고 네트워크로 그대로 흘려보냄.
  // /api/courses만 빠뜨렸다가 노션에서 공개여부를 켜도 옛날 빈 응답이 계속 보이는
  // 문제가 있었음 — 개별 경로를 나열하는 대신 /api/ 전체를 예외로 둔다.
  if (url.pathname.startsWith("/api/") || url.pathname === "/naver-config") {
    return;
  }
  if (event.request.method !== "GET") return;

  // 페이지 이동(navigate) 요청은 캐시에 쓰지 않고 네트워크 우선으로만 처리.
  // map.html -> /map 같은 리다이렉트를 따라간 navigate 요청을 cache.put()하려다
  // 실패하면 respondWith의 프라미스가 reject되어 브라우저가 통째로 네트워크 에러
  // 페이지를 띄우는 문제가 있었음. 오프라인 대비는 설치 시 채워둔 precache로 충분.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          caches.match(event.request).then((cached) => cached || caches.match("/offline.html"))
      )
    );
    return;
  }

  // 코드(css/js)는 네트워크를 먼저 본다.
  //
  // 아래 stale-while-revalidate 는 캐시에 있는 것을 먼저 내주고 갱신은 뒤로 미룬다.
  // 그래서 배포한 코드가 **다음 실행에야** 적용된다. 게다가 서비스워커 안의 fetch 도
  // 브라우저 HTTP 캐시를 거치는데 /js/* 가 max-age=300 이라, 그 5분 동안은 갱신해도
  // 옛 파일을 다시 캐시에 넣는다 — 앱을 두 번 껐다 켜도 안 바뀌는 일이 실제로 났다.
  //
  // 코드는 정적 자산이라 워커 요청으로 잡히지 않는다(청구·한도와 무관). 매번 네트워크를
  // 보고, 안 되면 그때 캐시를 쓴다. 느린 망에서도 캐시가 받쳐 주므로 화면이 비지 않는다.
  if (url.pathname.startsWith("/js/") || url.pathname.startsWith("/css/")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 장소 사진은 캐시에 있으면 그대로 쓰고 네트워크를 부르지 않는다.
  //
  // 아래 stale-while-revalidate 는 캐시가 맞아도 fetch 를 매번 띄운다. 그래서
  // 2026-09-16 에 사진만 이 갈래로 빼면 R2 읽기가 크게 줄 줄 알았는데 **틀렸다.**
  // 서비스워커 안의 fetch 도 브라우저 HTTP 캐시를 거치고, handleImage 가 붙이는
  // max-age=86400 덕에 그 재검증은 애초에 네트워크로 안 나가고 있었다. 하루치를
  // 재 보니 화면당 사진 요청이 8.6 → 10.9 로 오히려 늘었다(줄지 않았다는 뜻이다).
  //
  // 그러니 이 갈래는 "요청을 줄이는 수정"이 아니다. 캐시 적중을 한 겹 앞당길 뿐이고,
  // 요청 수를 실제로 줄이려면 사진을 워커 밖(정적 자산)으로 빼야 한다.
  // 사진 요청의 대부분은 첫 방문자의 콜드 페치로 보인다 — 유입이 인스타·카톡
  // 인앱 브라우저라 캐시가 방문마다 비어 있는 것으로 추정한다(확증 못 함).
  //
  // 사진을 갈아끼웠을 때는 노션의 사진 URL 뒤 ?v=날짜 를 바꾼다. URL 이 달라지므로
  // 캐시가 비껴가고 새 사진이 내려간다 — 얼굴이 찍힌 사진을 내려야 할 때 쓰는 길이
  // 이것뿐이니, 사진을 교체하면 ?v= 도 반드시 함께 올릴 것.
  if (url.pathname.startsWith("/images/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // 그 외 정적 리소스(css/js)는 stale-while-revalidate: 캐시가 있으면 즉시
  // 보여주고, 백그라운드로 최신화. 캐시 저장 실패는 무시하고 응답은 항상 반환.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const resClone = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, resClone))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
