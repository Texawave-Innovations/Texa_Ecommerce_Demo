/* Texa Fashions POS service worker — app-shell cache so the tablet boots with no network.
 * Data offline-ness is handled by Firestore's IndexedDB cache (persistentLocalCache); this only caches the Next.js shell + assets.
 * Strategy: network-first for navigations (falls back to the cached shell), stale-while-revalidate for static assets. */
const VERSION = 'pos-v1';
const SHELL = ['/', '/login', '/shift', '/sell', '/customer-display', '/returns', '/parked', '/z-report', '/history', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => undefined)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // Firebase/emulator traffic is never intercepted
  if (url.pathname.startsWith('/_next/webpack-hmr') || url.pathname.includes('hot-update')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req).then((r) => r || caches.match(url.pathname) || caches.match('/sell') || caches.match('/'))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
