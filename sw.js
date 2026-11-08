/**
 * sw.js — Service Worker do Rádio Personal (cache básico / offline da UI).
 * O streaming de áudio (Drive ou local) NUNCA é cacheado.
 */
const CACHE = 'radio-personal-v6';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/settings.js',
  './js/drive.js',
  './js/ai.js',
  './js/player.js',
  './js/playlists.js',
  './js/offline.js',
  './js/tts.js',
  './js/audiofx.js',
  './js/scheduler.js',
  './js/wakelock.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;

  // Nunca intercepta: APIs de IA, Google APIs e streams de áudio do Drive
  if (/generativelanguage\.googleapis\.com|api\.openai\.com|api\.groq\.com|googleapis\.com\/drive|drive\.usercontent\.google\.com/.test(url) ||
      url.startsWith('blob:') || url.startsWith('data:') || url.includes('offline.radio-p')) {
    return; // rede direta
  }

  // Navegação: network-first com fallback ao cache
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }

  // Demais ativos: cache-first
  e.respondWith(
    caches.match(e.request).then((c) => c || fetch(e.request).then((r) => {
      if (r.ok) caches.open(CACHE).then((cc) => cc.put(e.request, r.clone())).catch(() => {});
      return r;
    }))
  );
});
