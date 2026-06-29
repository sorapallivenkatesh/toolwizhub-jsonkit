// sw.js — JSONKit service worker. Precaches the app shell so the tool works
// fully offline (fits the 100%-local brand), and runtime-caches everything else
// (the ES modules and libs) with a stale-while-revalidate strategy.
const CACHE = "jsonkit-v1";

const CORE = [
  "./",
  "index.html",
  "css/styles.css",
  "js/main.js",
  "js/editor.js",
  "js/registry.js",
  "js/core/util.js",
  "js/core/parse.js",
  "lib/js-yaml.min.js",
  "lib/papaparse.min.js",
  "lib/jsonpath-plus.min.js",
  "lib/jmespath.min.js",
  "manifest.webmanifest",
  "assets/logo-icon.webp",
  "assets/logo-full.webp",
  "assets/logo-horizontal.webp",
  "assets/favicon.webp",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // never touch cross-origin (e.g. From URL fetches)

  // Navigation requests: serve cached shell when offline.
  if (request.mode === "navigate") {
    e.respondWith(fetch(request).catch(() => caches.match("index.html")));
    return;
  }

  // Same-origin assets: stale-while-revalidate.
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
