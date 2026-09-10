/* G-SURGE — service worker.
   Coquille applicative : le HTML passe par le réseau d'abord pour que les mises
   à jour arrivent, le reste par le cache d'abord car ces fichiers sont versionnés
   par le nom du cache. */
/* Les deux lignes marquées « build: » sont réécrites par vite.config.ts à la
   compilation. Le bundle porte une empreinte dans son nom, qui change à chaque
   build : elle ne peut pas être tenue à la main ici.

   La version en découle, elle est le condensé de la liste. Elle change donc si
   et seulement si un actif change, ce qui retire une consigne qu'on pouvait
   oublier : plus de numéro à incrémenter.

   Les valeurs ci-dessous sont celles du mode développement, où le service
   worker ne s'enregistre pas — il est conditionné à https. Elles restent du
   JavaScript valide pour que le fichier soit lisible tel quel. */
/* build:version */ const VERSION = 'dev';
/* build:assets */ const ASSETS = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Chaque actif à part : un seul manquant ne doit pas faire échouer
    // l'installation entière, ce que ferait cache.addAll.
    await Promise.all(ASSETS.map(async url => {
      try { await cache.add(url); }
      catch (err) { /* actif absent : on continue */ }
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
