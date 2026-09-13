/**
 * Le serveur dans workerd, monté pour un test.
 *
 * Le bundle est celui de `scripts/build-server.mjs` — le même qui sert
 * `wrangler dev` et le déploiement — chargé sous Miniflare avec les liaisons
 * que `server/wrangler.jsonc` déclare : l'objet durable en SQLite, seul
 * stockage du plan gratuit, la base D1 avec ses migrations jouées dans
 * l'ordre, et `DEBUG=1` pour que l'heure feinte des tests soit lue.
 *
 * Deux usages : `tests/server.test.ts`, qui vérifie, et
 * `tests/measure-server.test.ts`, qui mesure. Une variable de plus se passe
 * par `extra` — le coupe-circuit, par exemple.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { buildServer } from '../../scripts/build-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'server', 'dist', 'index.js');

const MIGRATIONS = ['0001_runs.sql', '0002_board.sql', '0003_speed_peak.sql', '0004_traces.sql'];

export type Vars = Record<string, { type: 'text'; value: string }>;

/** Construit le bundle une fois ; rend l'empreinte du noyau qu'il porte. */
export async function buildOnce(): Promise<string> {
  return buildServer(SCRIPT);
}

/**
 * Un Worker sous Miniflare, sans base migrée. La forme de Miniflare 5 : la
 * configuration d'un Worker telle que Cloudflare la décrit, le bundle en
 * manifeste, les liaisons sous `env`, l'objet sous `exports`.
 */
export function flare(extra: Vars = {}): Miniflare {
  return new Miniflare({
    workers: [
      {
        config: {
          name: 'api',
          type: 'worker',
          compatibilityDate: '2026-09-01',
          manifest: {
            mainModule: 'index.js',
            modules: { 'index.js': { type: 'esm', contents: readFileSync(SCRIPT, 'utf8') } },
          },
          env: {
            ARBITER: { type: 'durable-object', worker: 'api', exportName: 'Arbiter' },
            DB: { type: 'd1', id: 'gsurge' },
            DEBUG: { type: 'text', value: '1' },
            ...extra,
          },
          exports: { Arbiter: { type: 'durable-object', storage: 'sqlite' } },
        },
      },
    ],
  });
}

/** Joue les migrations de `server/migrations/`, dans l'ordre, sur la base de ce serveur. */
export async function migrate(mf: Miniflare): Promise<void> {
  const db = await mf.getD1Database('DB');
  for (const migration of MIGRATIONS) {
    const schema = readFileSync(join(ROOT, 'server', 'migrations', migration), 'utf8');
    // les commentaires d'abord, les instructions ensuite : un point-virgule dans
    // une phrase française couperait sinon une instruction en deux
    const statements = schema
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';');
    for (const stmt of statements) if (stmt.trim()) await db.prepare(stmt).run();
  }
}

/** Le serveur prêt à servir : bundle construit, base migrée. */
export async function bootServer(extra: Vars = {}): Promise<{ mf: Miniflare; core: string }> {
  const core = await buildOnce();
  const mf = flare(extra);
  await migrate(mf);
  return { mf, core };
}
