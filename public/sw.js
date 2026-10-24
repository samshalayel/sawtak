// Service worker for the installable app. It only keeps the app's own files (code, styles, icons, avatars)
// so it opens fast and survives a weak connection. Customer content — texts, generated audio and video, and
// every /api request — is never stored, in line with the site's no-storage policy.
const CACHE = 'sawtik-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isStatic = url =>
  /^\/(new\/)?assets\//.test(url.pathname) || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/avatars/');

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: always try the network first (fresh deploys), fall back to the last page when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then(r => r || Response.error()))
    );
    return;
  }

  // Built files have content hashes in their names, so a cached copy is always correct
  if (isStatic(url)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
