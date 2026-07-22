const CACHE_NAME = "yukjindae-map-v6";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/map.html",
  "/place.html",
  "/offline.html",
  "/css/style.css",
  "/css/map.css",
  "/css/place.css",
  "/js/app.js",
  "/js/map.js",
  "/js/place.js",
  "/js/pwa.js",
  "/assets/logo/character-logo.svg",
  "/assets/logo/main-logo.svg",
  "/assets/logo/main-logo-blue.svg",
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

  // 항상 최신이어야 하는 API/설정 응답은 캐시하지 않고 네트워크로 그대로 흘려보냄
  if (url.pathname === "/api/places" || url.pathname === "/naver-config") {
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

  // 그 외 정적 리소스(css/js/이미지)는 stale-while-revalidate: 캐시가 있으면 즉시
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
