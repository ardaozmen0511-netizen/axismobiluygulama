// AXIS service worker: uygulama dosyalarını önbelleğe alır, yapay zekâ isteklerini her zaman ağa gönderir.
const CACHE = "axis-v5";
const FILES = ["/", "/axis-core.js", "/manifest.webmanifest", "/logo_axis.png", "/logo_axis_mark.png", "/logo_alreonx.png", "/avatar.png", "/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/")) return;   // sunucu istekleri: ağ
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));                                           // önce ağ, yoksa önbellek
});
