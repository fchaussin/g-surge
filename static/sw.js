/* G-SURGE — service worker.
   Coquille applicative : le HTML passe par le réseau d'abord pour que les mises
   à jour arrivent, le reste par le cache d'abord car ces fichiers sont versionnés
   par le nom du cache. */
const VERSION = 'gs-v5';
/* Liste volontairement réduite au strict minimum.

   Le bundle porte une empreinte dans son nom, qui change à chaque build : elle
   ne peut pas être écrite ici à la main. L'engendrer à la compilation est
   l'étape 5 de docs/ROADMAP.md, et c'est la partie la moins prévisible de la
   migration. En attendant, seule la coquille est préchargée ; le bundle, lui,
   est mis en cache à la première visite par la stratégie « cache d'abord »
   plus bas, ce qui suffit à un rechargement hors ligne mais pas à une première
   ouverture hors ligne. */
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
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
