const CACHE_NAME = "fonte-cache-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/cache.js",
  "./js/db.js",
  "./js/firebase-config.js",
  "./js/import.js",
  "./js/routines.js",
  "./js/history.js",
  "./js/stats.js",
  "./js/settings.js",
  "./js/workout.js",
  "./js/utils.js",
  "./js/vendor/chart.umd.js",
  "./js/vendor/papaparse.min.js",
  "./js/exercises-seed.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first pour l'app shell, réseau direct pour Firestore (géré par le SDK lui-même).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // laisse passer Firebase/CDN sans interception

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return resp;
      }).catch(() => cached);
    })
  );
});
