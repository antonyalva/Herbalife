const CACHE = "mi-negocio-v5";
const ASSETS = [
  "./", "./index.html", "./catalogo.html",
  "./css/style.css",
  "./js/app.js", "./js/catalogo.js", "./js/db.js", "./js/pricing.js", "./js/config.js", "./js/theme.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/leaf.svg", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Librerías externas: primero caché, luego red
  if (["esm.sh", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Archivos propios: primero red (para recibir actualizaciones), caché si no hay internet
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
});
