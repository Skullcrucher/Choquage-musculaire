const CACHE_NAME = "fonte-cache-v24";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./fonts/anton-latin-400-normal.woff2",
  "./fonts/inter-latin-400-normal.woff2",
  "./fonts/inter-latin-500-normal.woff2",
  "./fonts/inter-latin-600-normal.woff2",
  "./fonts/inter-latin-700-normal.woff2",
  "./js/app.js",
  "./js/auth.js",
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
  "./js/exercise-guides.js",
  "./js/exercise-detail.js",
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

// Ramène l'app au premier plan (ou l'ouvre) quand on tape la notification
// de fin de repos.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});
