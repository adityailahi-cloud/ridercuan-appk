/**
 * RiderCuan — Service Worker
 * Strategy: Cache-First untuk aset statis, Network-First untuk API
 */

const CACHE_NAME    = 'ridercuan-v1';
const OFFLINE_URL   = '/';

// Aset yang di-cache saat install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── INSTALL ──────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing RiderCuan Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache failed (mungkin offline):', err))
  );
});

// ── ACTIVATE ─────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Lewati request non-GET dan request ke origin lain
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls → Network-First (data harus fresh)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => response)
        .catch(() => {
          // Jika offline saat akses API, kembalikan JSON error
          return new Response(
            JSON.stringify({ error: 'Tidak ada koneksi internet. Data mungkin tidak terkini.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // Aset statis → Cache-First dengan fallback ke network
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Tetap update cache di background (Stale-While-Revalidate)
          fetch(request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => cache.put(request, networkResponse.clone()));
            }
          }).catch(() => {});
          return cachedResponse;
        }

        // Belum ada di cache → fetch dari network
        return fetch(request)
          .then(networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
              return networkResponse;
            }
            // Simpan ke cache
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
            return networkResponse;
          })
          .catch(() => {
            // Offline fallback → kembalikan halaman utama dari cache
            if (request.destination === 'document') {
              return caches.match(OFFLINE_URL);
            }
          });
      })
  );
});

// ── BACKGROUND SYNC (opsional untuk masa depan) ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    console.log('[SW] Background sync: sync-transactions');
    // TODO: implementasi offline queue
  }
});