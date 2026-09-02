self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    })
  );
  self.registration.unregister();
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Always fetch live network, never cache HTML
  return;
});
