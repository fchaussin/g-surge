/**
 * Le serveur, dans workerd — le troisième moteur.
 *
 * Node rejoue les références figées dans `sim-parity`, Chromium dans
 * `bundle.spec`. Ceci les rejoue dans le moteur qui arbitrera, à travers le
 * bundle qui sera déployé, sous Miniflare. C'est la mesure que le jalon M2 de
 * `MULTIPLAYER-ROADMAP.md` existe pour faire : si elle échoue, `trig.ts` et
 * `rng.ts` gagnent un cas et rien ne se construit dessus avant.
 *
 * Puis le chemin d'une soumission : une trace de partie postée revient avec
 * l'issue que Node calcule, une ligne atterrit en D1, et les refus refusent.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../scripts/build-server.mjs';
import { coreDigest } from '../scripts/core-digest.mjs';
import {
  DT,
  outcomeOf,
  quantiseSteer,
  replay,
  Rng,
  Sim,
  type Difficulty,
  type Input,
  type Trace,
} from '../src/sim/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests', 'e2e', 'fixtures');
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

/** Le même script que celui des références, `bundle.spec.ts` et `sim-parity`. */
const REFERENCE_SCRIPT = [
  { from: 0, steer: 0, brake: false, boost: false },
  { from: 240, steer: 0.18, brake: false, boost: true },
  { from: 600, steer: -0.22, brake: false, boost: true },
  { from: 900, steer: 0.1, brake: false, boost: false },
  { from: 1200, steer: -0.12, brake: true, boost: false },
  { from: 1500, steer: 0.06, brake: false, boost: true },
];

/** Une partie au manche, comme dans `replay.test.ts` : dense, quantifiée, non triviale. */
function play(seed: string, difficulty: Difficulty, seconds: number): { sim: Sim; trace: Trace } {
  const sim = new Sim({ seed, difficulty });
  sim.reset(seed);
  const rng = Rng.fromSeed(seed, 'player');
  const input: Input = { steer: 0, brake: false, boost: false };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && !sim.state.wrecked; i++) {
    if (i % 12 === 0) {
      const s = sim.state;
      input.steer = quantiseSteer(
        Math.max(-1, Math.min(1, -(s.lat * 0.1 + s.latVel * 0.55) + rng.centered(0.6))),
      );
      input.brake = rng.chance(0.02);
      input.boost = rng.chance(0.7);
    }
    sim.step(input, DT, false);
  }
  return { sim, trace: sim.trace() };
}

let mf: Miniflare;
let core: string;

const get = (path: string) => mf.dispatchFetch(`https://api.test${path}`);
const post = (path: string, body: unknown) =>
  mf.dispatchFetch(`https://api.test${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeAll(async () => {
  const script = join(ROOT, 'server', 'dist', 'index.js');
  core = await buildServer(script);
  // La forme de Miniflare 5 : la configuration d'un Worker telle que Cloudflare
  // la décrit, le bundle en manifeste, les liaisons sous `env`, l'objet sous
  // `exports` — SQLite, le seul stockage du plan gratuit.
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'api',
          type: 'worker',
          compatibilityDate: '2026-09-01',
          manifest: {
            mainModule: 'index.js',
            modules: { 'index.js': { type: 'esm', contents: readFileSync(script, 'utf8') } },
          },
          env: {
            ARBITER: { type: 'durable-object', worker: 'api', exportName: 'Arbiter' },
            DB: { type: 'd1', id: 'gsurge' },
            DEBUG: { type: 'text', value: '1' },
          },
          exports: { Arbiter: { type: 'durable-object', storage: 'sqlite' } },
        },
      },
    ],
  });
  const db = await mf.getD1Database('DB');
  const schema = readFileSync(join(ROOT, 'server', 'migrations', '0001_runs.sql'), 'utf8');
  // les commentaires d'abord, les instructions ensuite : un point-virgule dans
  // une phrase française couperait sinon une instruction en deux
  const statements = schema
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';');
  for (const stmt of statements) if (stmt.trim()) await db.prepare(stmt).run();
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describe('the server in workerd', () => {
  it('is stamped with the digest of the core it was built from', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, core: coreDigest() });
    expect(core).toBe(coreDigest());
  });

  it('regenerates the reference track from its seed', async () => {
    const expected = load('track-reference') as { nodes: unknown; items: unknown };
    const got = (await (await get('/debug/track?seed=reference')).json()) as {
      nodes: unknown;
      items: unknown;
    };
    expect(got.nodes).toEqual(expected.nodes);
    expect(got.items).toEqual(expected.items);
  });

  for (const diff of ['easy', 'medium', 'hard'] as const) {
    it(`replays the ${diff} physics reference`, async () => {
      const expected = load(`physics-${diff}`);
      const res = await post('/debug/probe', {
        seed: 'reference',
        diff,
        steps: 1800,
        dt: 1 / 120,
        every: 120,
        script: REFERENCE_SCRIPT,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expected);
    });
  }

  it('replays a submitted run to the outcome Node computes, and records it', async () => {
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const { sim, trace } = play('submit-' + diff, diff, 40);
      const res = await post('/run', { core, trace });
      expect(res.status).toBe(200);
      const { outcome } = (await res.json()) as { outcome: unknown };
      expect(outcome).toEqual(outcomeOf(sim.state, trace.steps));
      expect(outcome).toEqual(replay(trace));
    }
    const db = await mf.getD1Database('DB');
    const rows = await db.prepare('SELECT difficulty, seed, score FROM runs ORDER BY id').all();
    expect(rows.results.map((r) => [r.difficulty, r.seed])).toEqual([
      ['easy', 'submit-easy'],
      ['medium', 'submit-medium'],
      ['hard', 'submit-hard'],
    ]);
    expect(rows.results.every((r) => (r.score as number) > 0)).toBe(true);
  });

  it('refuses what it cannot judge', async () => {
    const { trace } = play('refuse', 'easy', 5);
    expect((await post('/run', { core: 'deadbeefcafe', trace })).status).toBe(409);
    expect((await post('/run', { core, trace: { ...trace, truncated: true } })).status).toBe(400);
    expect((await post('/run', { core, trace: 'nope' })).status).toBe(400);
    expect((await post('/run', { trace })).status).toBe(400);
    const bloated = { core, trace, pad: 'x'.repeat(1 << 20) };
    expect((await post('/run', bloated)).status).toBe(413);
    expect((await get('/run')).status).toBe(405);
    expect((await get('/nothing')).status).toBe(404);
    const raw = await mf.dispatchFetch('https://api.test/run', {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(raw.status).toBe(400);
  });
});
