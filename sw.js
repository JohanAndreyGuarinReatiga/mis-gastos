// Service worker: permite instalar la app y abrirla aunque la red esté lenta.
// Estrategia "red primero": siempre intenta la versión más nueva y usa la caché solo sin conexión.
const CACHE = 'mis-gastos-v12';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/config.js', 'js/lector.js', 'js/compresor.js', 'js/ia.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Nunca cachear datos ni archivos de Supabase (son privados).
  if (url.hostname.endsWith('supabase.co')) return;
  // Las tasas de cambio (currency-api) no se cachean: deben ser las del día consultado.
  if (url.pathname.includes('currency-api')) return;
  const cacheable = url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net';
  if (!cacheable) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
