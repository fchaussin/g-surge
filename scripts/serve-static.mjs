/* Serveur statique minimal pour les tests de bout en bout.
   Volontairement distinct du `serve` utilisé par `npm run dev` et par l'image :
   il ne dépend d'aucun paquet, donc il démarre sans réseau et se comporte de
   façon identique en local et en intégration continue.
   Usage : node scripts/serve-static.mjs [racine] [port] */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'public');
const port = Number(process.argv[3] ?? 5174);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Empêche un ../ de sortir de la racine servie.
  const target = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      // Comme docker/serve.json : sans cela le cache heuristique du navigateur
      // sert un engine.js périmé entre deux exécutions.
      'Cache-Control': 'no-cache',
    });
    createReadStream(target).pipe(res);
  } catch {
    // Pas de repli sur index.html : une 404 doit rester une 404, sinon une
    // faute de frappe sur un chemin d'actif passe inaperçue.
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`static: ${root} -> http://127.0.0.1:${port}/`);
});
