/* Service Worker — Control de Ingreso
   Precache de toda la app (incluidas las librerías) y "cache first" para funcionar 100 % sin conexión.
   Para publicar una actualización, cambiá VERSION: los dispositivos verán el aviso "Nueva versión disponible". */
const VERSION = 'v1.0.0';
const CACHE = `control-ingreso-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/palettes.js',
  './js/app.js',
  './manifest.webmanifest',
  './lib/xlsx.full.min.js',
  './lib/jspdf.umd.min.js',
  './lib/html2canvas.min.js',
  './lib/jsQR.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('control-ingreso-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Archivos propios de la app: primero la red (así las actualizaciones llegan enseguida) y, si no hay señal
// o tarda más de 3 s, la copia guardada. Librerías e íconos: primero la copia guardada.
const CORE = /\/(index\.html|sw\.js|manifest\.webmanifest|css\/[^/]+\.css|js\/[^/]+\.js)?$/;

function fromNetwork(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const netReq = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
    fetch(netReq).then((res) => {
      clearTimeout(timer);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? './index.html' : req, copy));
      }
      resolve(res);
    }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fromNetwork(req, 3000).catch(() => caches.match('./index.html').then((c) => c || caches.match('./')))
    );
    return;
  }

  if (CORE.test(url.pathname)) {
    event.respondWith(
      fromNetwork(req, 3000).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
