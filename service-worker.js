// À incrémenter avec APP_VERSION (js/utils.js) à chaque mise en ligne.
const CACHE_NAME = "skullcrusher-cache-v44";
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
  "./js/routine-discover.js",
  "./js/friends.js",
  "./js/history.js",
  "./js/feed.js",
  "./js/workout-detail.js",
  "./js/stats.js",
  "./js/settings.js",
  "./js/workout.js",
  "./js/utils.js",
  "./js/timer-sync.js",
  "./js/timer-sync-config.js",
  "./js/vendor/chart.umd.js",
  "./js/vendor/papaparse.min.js",
  "./js/exercises-seed.js",
  "./js/exercise-guides.js",
  "./js/exercise-detail.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/logo.png",
  "./icons/horns.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // cache: "reload" contourne le cache HTTP du navigateur (GitHub Pages
    // sert les fichiers avec max-age=600) : sans ça, une nouvelle version du
    // service worker pouvait mettre en cache l'ANCIENNE version des scripts.
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Réseau d'abord (toujours la dernière version déployée), cache en secours
// hors connexion. Firestore/CDN ne sont pas interceptés (géré par le SDK).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: "no-cache" }).then((resp) => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return resp;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

// Notification push envoyée par le serveur du minuteur (push-worker/) à la
// fin du repos. iOS exige qu'un push affiche toujours une notification.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || "Repos terminé 🤘", {
    body: data.body || "C'est reparti pour la série suivante.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "skullcrusher-rest-timer",
    renotify: true,
    vibrate: [200, 100, 200]
  }));
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
