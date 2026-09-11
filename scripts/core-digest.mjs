/* L'identité du noyau de simulation.
   Un condensé SHA-256 de `src/sim/*.ts`, dans l'ordre des noms, nom compris.
   Il change si et seulement si le noyau change — pas la version du paquet, qui
   bouge aussi pour une retouche visuelle. C'est la clé qu'une trace porte pour
   qu'un serveur rejoue avec exactement le noyau qui l'a produite ; voir
   docs/NETWORK.md. Utilisé par le build (vite.config.ts) et par les tests.
   Usage : node scripts/core-digest.mjs [racine] */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Douze hexadécimaux : assez pour ne jamais se croiser, court à citer. */
const LENGTH = 12;

export function coreDigest(root = '.') {
  const dir = join(root, 'src', 'sim');
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.ts')) continue;
    hash.update(name);
    hash.update('\0');
    hash.update(readFileSync(join(dir, name)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, LENGTH);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(coreDigest(process.argv[2] ?? '.'));
}
