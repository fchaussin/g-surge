/* Le bundle du serveur.
   Une seule sortie, server/dist/index.js, pour Miniflare dans les tests,
   `wrangler dev` et le déploiement : c'est ici que le condensé du noyau est
   estampillé, et un chemin unique garantit que ce qui est testé est ce qui
   part. `cloudflare:*` reste externe, workerd le fournit.
   Usage : node scripts/build-server.mjs */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { coreDigest } from './core-digest.mjs';

export async function buildServer(outfile = 'server/dist/index.js') {
  const digest = coreDigest();
  await build({
    entryPoints: ['server/src/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile,
    external: ['cloudflare:*'],
    define: { __CORE_DIGEST__: JSON.stringify(digest) },
    sourcemap: true,
    logLevel: 'warning',
  });
  return digest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const digest = await buildServer();
  console.log(`server: core ${digest}`);
}
