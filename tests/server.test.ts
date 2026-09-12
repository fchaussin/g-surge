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
  QueuedNodes,
  quantiseSteer,
  replay,
  Rng,
  Sim,
  unpackNodes,
  type Difficulty,
  type Input,
  type Trace,
  type WireChunk,
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

/**
 * Une partie au manche, comme dans `replay.test.ts` : dense, quantifiée, non
 * triviale. `feed`, s'il est donné, est appelé avant chaque pas : c'est le
 * client d'une partie classée qui remplit sa file de piste.
 */
function play(
  seed: string,
  difficulty: Difficulty,
  seconds: number,
  feed?: (sim: Sim) => void,
): { sim: Sim; trace: Trace } {
  const sim = new Sim({ seed, difficulty });
  sim.reset(seed);
  const rng = Rng.fromSeed(seed, 'player');
  const input: Input = { steer: 0, brake: false, boost: false };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && !sim.state.wrecked; i++) {
    if (i % 12 === 0) {
      feed?.(sim);
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
const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  mf.dispatchFetch(`https://api.test${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
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

  it('replays a submitted run to the outcome Node computes, and records nothing', async () => {
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const { sim, trace } = play('submit-' + diff, diff, 40);
      const res = await post('/run', { core, trace });
      expect(res.status).toBe(200);
      const { outcome } = (await res.json()) as { outcome: unknown };
      expect(outcome).toEqual(outcomeOf(sim.state, trace.steps));
      expect(outcome).toEqual(replay(trace));
    }
    // rejouée, pas classée : rien n'entre au journal sans ticket
    const db = await mf.getD1Database('DB');
    expect((await db.prepare('SELECT COUNT(*) AS n FROM runs').first<{ n: number }>())?.n).toBe(0);
  });

  /**
   * Le chemin d'une partie classée, de bout en bout : le ticket sans la
   * graine, la piste par tranches — ici demandées en boucle serrée par le
   * client, le vrai les demande sous un seuil — la soumission, et le score
   * que le serveur calcule sur sa propre piste. Le client n'a jamais vu la
   * graine, et son issue est celle du serveur.
   */
  it('runs a ranked run with the seed withheld: ticket, streamed track, replay', async () => {
    const res = await post('/ticket', { difficulty: 'medium' });
    expect(res.status).toBe(200);
    const issued = (await res.json()) as { ticket: string; difficulty: string; chunk: WireChunk };
    expect(issued.ticket).toMatch(/^[0-9a-f]{32}$/);
    expect(issued.difficulty).toBe('medium');
    expect(issued.chunk.from).toBe(0);
    expect(issued.chunk.k.length).toBe(256);

    const queue = new QueuedNodes();
    queue.feed(unpackNodes(issued.chunk)!);
    // une boucle serrée jusqu'à 24 km d'avance : le client synchrone de ce test
    // ne peut pas redemander en cours de partie, le vrai le fait sous un seuil
    const fetchAhead = async (): Promise<void> => {
      while (queue.ahead < 2048) {
        const r = await get(`/track/${issued.ticket}/${queue.wanted}`);
        expect(r.status).toBe(200);
        expect(r.headers.get('cache-control')).toContain('max-age');
        expect(queue.feed(unpackNodes((await r.json()) as WireChunk)!)).toBe(256);
      }
    };
    await fetchAhead();
    // la même plage, redemandée : les mêmes octets, et la file n'en garde rien
    const again = (await (await get(`/track/${issued.ticket}/256`)).json()) as WireChunk;
    expect(queue.feed(unpackNodes(again)!)).toBe(0);

    // le client joue sur la file, sans graine ; la piste ne doit jamais être sèche
    let attached = false;
    const { sim, trace } = play('unknown-to-the-client', 'medium', 30, (s) => {
      if (!attached) s.track.attach(queue);
      attached = true;
    });
    // `play` a attaché la file au premier pas ; le reste s'est joué dessus
    expect(sim.track.dry).toBe(false);
    expect(trace.steps).toBeGreaterThan(1000);

    // sans la graine : la trace part avec la sienne, factice, et le ticket
    const sent: Trace = { ...trace, seed: 'not-the-seed' };
    // soumise « plus tard » : la partie a duré ce qu'elle a duré, le test ne l'attend pas
    const later = { 'x-debug-now': String(Date.now() + trace.steps * DT * 1000 + 500) };
    const run = await post('/run', { core, ticket: issued.ticket, trace: sent }, later);
    expect(run.status).toBe(200);
    const { outcome } = (await run.json()) as { outcome: unknown };
    expect(outcome).toEqual(outcomeOf(sim.state, trace.steps));
    // au journal, avec la graine du serveur et son score
    const db = await mf.getD1Database('DB');
    const rows = await db.prepare('SELECT difficulty, seed, score, steps FROM runs').all();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0]!.difficulty).toBe('medium');
    expect(rows.results[0]!.seed).not.toBe('not-the-seed');
    expect(rows.results[0]!.steps).toBe(trace.steps);
    expect(rows.results[0]!.score).toBe(sim.state.score);

    // un ticket ne sert qu'une fois, et la piste avec lui
    expect((await post('/run', { core, ticket: issued.ticket, trace: sent }, later)).status).toBe(
      404,
    );
    expect((await get(`/track/${issued.ticket}/0`)).status).toBe(404);
  });

  it('holds the ticket window: too early is refused, a wrong difficulty too', async () => {
    const issued = (await (await post('/ticket', { difficulty: 'easy' })).json()) as {
      ticket: string;
      chunk: WireChunk;
    };
    // trois minutes de partie annoncées une seconde après le ticket : impossible
    const queue = new QueuedNodes();
    queue.feed(unpackNodes(issued.chunk)!);
    let attached = false;
    const { trace } = play('x', 'easy', 5, (s) => {
      if (!attached) s.track.attach(queue);
      attached = true;
    });
    const early: Trace = { ...trace, steps: 720 * 180, from: [0], steer: [0], flags: [0] };
    const r = await post('/run', { core, ticket: issued.ticket, trace: early });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'early' });
    // et trop tard : plus d'une heure après la fin annoncée
    const late = { 'x-debug-now': String(Date.now() + 3 * 3600 * 1000) };
    const l = await post('/run', { core, ticket: issued.ticket, trace }, late);
    expect(l.status).toBe(409);
    expect(await l.json()).toEqual({ error: 'expired' });
    // la difficulté du ticket fait foi
    const wrong = await post('/run', {
      core,
      ticket: issued.ticket,
      trace: { ...trace, difficulty: 'hard' },
    });
    expect(wrong.status).toBe(400);
    // le ticket n'est pas consommé par un refus
    expect((await get(`/track/${issued.ticket}/0`)).status).toBe(200);
    expect((await post('/ticket', { difficulty: 'insane' })).status).toBe(400);
    expect((await get('/track/nope/0')).status).toBe(404);
    expect((await get(`/track/${issued.ticket}/-1`)).status).toBe(400);
  });

  it('answers CORS for the game origins and nothing else', async () => {
    for (const origin of [
      'https://g-surge.w23.fr',
      'https://multiplayer.g-surge.pages.dev',
      'http://localhost:5173',
    ]) {
      const r = await mf.dispatchFetch('https://api.test/health', { headers: { origin } });
      expect(r.headers.get('access-control-allow-origin')).toBe(origin);
    }
    const r = await mf.dispatchFetch('https://api.test/health', {
      headers: { origin: 'https://evil.example' },
    });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await mf.dispatchFetch('https://api.test/run', {
      method: 'OPTIONS',
      headers: { origin: 'https://g-surge.w23.fr' },
    });
    expect(pre.status).toBe(204);
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
