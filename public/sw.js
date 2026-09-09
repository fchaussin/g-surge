/* G-SURGE — service worker.
   Coquille applicative : le HTML passe par le réseau d'abord pour que les mises
   à jour arrivent, le reste par le cache d'abord car ces fichiers sont versionnés
   par le nom du cache. */
const VERSION = 'gs-v1';
const ASSETS = [
  './',
  './index.html',
  './engine.js',
  './game.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // trois.js vient d'un autre domaine : requête CORS explicite, sinon la
    // réponse serait opaque et inutilisable hors ligne
    await Promise.all(ASSETS.map(async url => {
      try {
        const req = url.startsWith('http') ? new Request(url, { mode: 'cors' }) : url;
        await cache.add(req);
      } catch (err) { /* un actif manquant ne doit pas faire échouer l'installation */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate'){
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')){
        const cache = await caches.open(VERSION);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});
