const CACHE_NAME = "yukjindae-map-v1";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/map.html",
  "/place.html",
  "/css/style.css",
  "/css/map.css",
  "/css/place.css",
  "/js/app.js",
  "/js/map.js",
  "/js/place.js",
  "/js/pwa.js",
  "/assets/logo/character-logo.svg",
  "/assets/logo/main-logo.svg",
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

  // stale-while-revalidate: 캐시가 있으면 즉시 보여주고, 백그라운드로 최신화
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
