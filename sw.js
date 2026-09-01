// RaceLogger — © 2026 Josh "Yoshi" Retief. All rights reserved. See LICENSE.
// Offline app shell. The app is one HTML file + Leaflet; cache them so the
// home-screen icon opens (and times laps) with no signal at the venue.
//   index.html : network first, cache fallback  -> a deploy shows up on the
//                next load when online, and the last good copy works offline
//   vendor/*   : cache first                     -> never re-downloaded
// Map tiles and /api/* are never cached here.
const VERSION = "rl-shell-v2";
const SHELL = ["./", "./index.html", "./vendor/leaflet.js", "./vendor/leaflet.css", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.includes("/vendor/") || /\/(icon-\d+\.png|manifest\.json)$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res;
    })));
    return;
  }
  // the app shell itself (navigations / index.html)
  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/")) {
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))));
  }
});
