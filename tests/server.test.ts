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
import type { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootServer, flare } from './helpers/workerd.js';
import { coreDigest } from '../scripts/core-digest.mjs';
import { PER_MINUTE } from '../server/src/limits.js';
import {
  DT,
  outcomeOf,
  packTrace,
  QueuedNodes,
  quantiseSteer,
  replay,
  Rng,
  Sim,
  MAX_TRACE_STEPS,
  unpackNodes,
  unpackTrace,
  validTrace,
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

/**
 * Une adresse par appel, sauf quand un test en impose une.
 *
 * Le serveur limite `/ticket` et `/run` par adresse, et ces tests en font bien
 * plus qu'un joueur en une minute. Leur donner chacun la sienne est ce qu'ils
 * sont — des clients différents — et laisse le plafond se tester pour
 * lui-même, avec une adresse tenue.
 */
let caller = 0;
const from = (): Record<string, string> => ({ 'cf-connecting-ip': `10.0.0.${++caller}` });

const get = (path: string, headers?: Record<string, string>) =>
  mf.dispatchFetch(`https://api.test${path}`, { headers: { ...from(), ...headers } });
const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  mf.dispatchFetch(`https://api.test${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...from(), ...headers },
  });

/**
 * Une partie classée complète, courte : le ticket, la piste entière tirée
 * d'avance — inutile de la redemander pour quelques secondes — puis la
 * soumission. `body` permet de forcer `name` ou `claim` sur ce qu'un client
 * hostile ou dérivé enverrait.
 */
async function rankedRun(
  seed: string,
  difficulty: Difficulty,
  seconds: number,
  body: Record<string, unknown> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const issued = (await (await post('/ticket', { difficulty })).json()) as {
    ticket: string;
    chunk: WireChunk;
  };
  const queue = new QueuedNodes();
  queue.feed(unpackNodes(issued.chunk)!);
  while (queue.ahead < 512) {
    const r = await get(`/track/${issued.ticket}/${queue.wanted}`);
    queue.feed(unpackNodes((await r.json()) as WireChunk)!);
  }
  let attached = false;
  const { trace } = play(seed, difficulty, seconds, (s) => {
    if (!attached) s.track.attach(queue);
    attached = true;
  });
  const later = { 'x-debug-now': String(Date.now() + trace.steps * DT * 1000 + 500) };
  const res = await post('/run', { core, ticket: issued.ticket, trace, ...body }, later);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  ({ mf, core } = await bootServer());
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describe('the server in workerd', () => {
  it('is stamped with the digest of the core it was built from', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, core: coreDigest(), ranked: true });
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
   * La forme compacte sur le fil, qui est celle que le client envoie.
   *
   * Mesuré : trois minutes au manche font 360 Ko en JSON contre 70 en octets,
   * et une partie de dix minutes passait au-dessus du méga-octet que le
   * Worker refuse. Ce qui est vérifié ici est que les deux formes rendent
   * exactement la même issue — sans quoi le gain serait payé d'un score.
   */
  it('reads a trace packed and base64 exactly as it reads the JSON one', async () => {
    const { sim, trace } = play('packed-easy', 'easy', 40);
    const packed = Buffer.from(packTrace(trace)).toString('base64');
    const res = await post('/run', { core, trace: packed });
    expect(res.status).toBe(200);
    const { outcome } = (await res.json()) as { outcome: unknown };
    expect(outcome).toEqual(outcomeOf(sim.state, trace.steps));

    const asJson = await post('/run', { core, trace });
    expect(((await asJson.json()) as { outcome: unknown }).outcome).toEqual(outcome);

    // du base64 qui ne porte pas une trace est refusé, pas rejoué
    expect((await post('/run', { core, trace: 'bm90IGEgdHJhY2U=' })).status).toBe(400);
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
    const { outcome, rank } = (await run.json()) as { outcome: unknown; rank: number };
    expect(outcome).toEqual(outcomeOf(sim.state, trace.steps));
    // seule entrée de la semaine sur cette difficulté : première place
    expect(rank).toBe(1);
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

  it('keeps a weekly board: a valid name kept, an invalid one falls back, rank reflects the score', async () => {
    const a = await rankedRun('board-a', 'hard', 8, { name: 'Néo 01' });
    const b = await rankedRun('board-b', 'hard', 8, { name: 'x' }); // trop court
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const db = await mf.getD1Database('DB');
    const rows = (
      await db.prepare("SELECT name, score FROM runs WHERE difficulty = 'hard' ORDER BY id").all()
    ).results as { name: string; score: number }[];
    expect(rows[0]!.name).toBe('Néo 01');
    expect(rows[1]!.name).toBe('PILOT');

    // le rang est celui au moment de la soumission, pas une fois les deux posées :
    // « a » est seule sur la difficulté quand elle arrive, forcément première
    expect(a.json.rank).toBe(1);
    // « b » arrive quand « a » est déjà là : un de plus que ce qui la bat des deux
    const scores = rows.map((r) => r.score);
    expect(b.json.rank).toBe(1 + scores.filter((s) => s > rows[1]!.score).length);

    const board = (await (await get('/board/hard')).json()) as {
      epoch: string;
      resetAt: number;
      entries: { name: string; score: number }[];
    };
    expect(board.epoch).toMatch(/^\d{4}-W\d{2}$/);
    expect(board.resetAt).toBeGreaterThan(Date.now());
    expect(board.entries.map((e) => e.name).sort()).toEqual(['Néo 01', 'PILOT']);
    expect(board.entries[0]!.score).toBeGreaterThanOrEqual(board.entries[1]!.score);
    // une difficulté sans partie cette semaine : un tableau vide, pas une erreur
    expect((await (await get('/board/easy')).json()) as { entries: unknown[] }).toMatchObject({
      entries: [],
    });
    expect((await get('/board/insane')).status).toBe(400);
  });

  it('reads the board by category — score, distance, top speed, average — never mixing difficulty', async () => {
    // D'autres tests de ce fichier ont déjà posé des parties sur chaque
    // difficulté ; le test mesure l'ordre et l'appartenance, jamais un compte
    // exact de lignes.
    const a = await rankedRun('cat-a', 'medium', 10);
    const b = await rankedRun('cat-b', 'medium', 16);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const outcomeA = (a.json as { outcome: { dist: number; time: number; speedPeak: number } })
      .outcome;
    const outcomeB = (b.json as { outcome: { dist: number; time: number; speedPeak: number } })
      .outcome;

    const pick: Record<string, (o: { dist: number; time: number; speedPeak: number }) => number> = {
      dist: (o) => o.dist,
      speedPeak: (o) => o.speedPeak,
      avg: (o) => o.dist / o.time,
    };
    for (const by of ['dist', 'speedPeak', 'avg'] as const) {
      const board = (await (await get(`/board/medium?by=${by}`)).json()) as {
        entries: { dist: number; time: number; speedPeak: number }[];
      };
      const values = board.entries.map(pick[by]!);
      for (let i = 1; i < values.length; i++)
        expect(values[i - 1]!).toBeGreaterThanOrEqual(values[i]!);
      expect(values).toContain(pick[by]!(outcomeA));
      expect(values).toContain(pick[by]!(outcomeB));
    }

    // une catégorie qui n'existe pas est un refus, jamais une colonne interpolée telle quelle
    expect((await get('/board/medium?by=nonsense')).status).toBe(400);
    // jamais mélangée à la difficulté : ces deux parties, postées en medium,
    // ne peuvent apparaître sur aucun tableau easy, quelle que soit la catégorie
    const easyBoard = (await (await get('/board/easy?by=dist')).json()) as {
      entries: { dist: number }[];
    };
    expect(easyBoard.entries.map((e) => e.dist)).not.toContain(outcomeA.dist);
    expect(easyBoard.entries.map((e) => e.dist)).not.toContain(outcomeB.dist);
  });

  /**
   * Le tableau n'accumule pas : il garde les meilleures et jette le reste.
   *
   * Quarante parties sont posées directement en base — le rejeu n'a rien à
   * prouver ici, c'est le tri qui est en cause — puis une vraie partie classée
   * déclenche l'élagage. Ce qui est vérifié est ce qui coûterait cher à se
   * tromper : la meilleure de chaque colonne survit, y compris celle qui est
   * première à la vitesse de pointe et dernière au score, et une partie
   * médiocre partout s'en va avec ses octets.
   */
  it('keeps only the best: the union of the top of each category, traces with them', async () => {
    const db = await mf.getD1Database('DB');
    const board = (await (await get('/board/easy')).json()) as { epoch: string };
    const week = board.epoch;

    const insert = async (
      tag: string,
      score: number,
      dist: number,
      time: number,
      speed: number,
    ): Promise<number> => {
      const r = await db
        .prepare(
          `INSERT INTO runs (core, difficulty, seed, steps, score, dist, time, coins, mult,
                             wrecked, submitted_at, name, epoch, claim, mismatch, speed_peak)
           VALUES (?, 'easy', ?, 100, ?, ?, ?, 0, 1, 0, ?, ?, ?, '', 0, ?)`,
        )
        .bind(core, tag, score, dist, time, Date.now(), tag, week, speed)
        .run();
      const id = Number(r.meta.last_row_id);
      await db
        .prepare('INSERT INTO traces (run_id, bytes) VALUES (?, ?)')
        .bind(id, new Uint8Array([1, 2, 3]))
        .run();
      return id;
    };

    // Trente parties quelconques, décroissantes sur tout.
    const filler: number[] = [];
    for (let i = 0; i < 30; i++) filler.push(await insert(`f${i}`, 900 - i, 900 - i, 60, 90 - i));
    // Une première à la vitesse de pointe et nulle partout ailleurs.
    const fastest = await insert('fastest', 1, 1, 60, 999);
    // Une première à la vitesse moyenne, par un temps minuscule.
    const quickest = await insert('quickest', 2, 500, 0.5, 1);
    // Une médiocre partout : au-delà du vingtième de chaque colonne.
    const nobody = await insert('nobody', 3, 3, 60, 3);

    expect((await rankedRun('prune', 'easy', 8)).status).toBe(200);

    const left = (
      await db
        .prepare("SELECT id, name FROM runs WHERE epoch = ? AND difficulty = 'easy'")
        .bind(week)
        .all<{ id: number; name: string }>()
    ).results;
    const ids = new Set(left.map((r) => r.id));

    // au plus vingt par colonne, quatre colonnes
    expect(left.length).toBeLessThanOrEqual(80);
    expect(ids.has(filler[0]!)).toBe(true); // la meilleure au score
    expect(ids.has(fastest)).toBe(true); // première à la pointe, dernière au score
    expect(ids.has(quickest)).toBe(true); // première à la moyenne
    expect(ids.has(nobody)).toBe(false); // vingt-et-unième partout

    // Les octets suivent les lignes, dans les deux sens. Toutes difficultés
    // confondues : les autres tests partagent cette base et leurs parties de
    // la semaine gardent légitimement les leurs.
    const traces = (
      await db.prepare('SELECT run_id FROM traces').all<{ run_id: number }>()
    ).results.map((r) => r.run_id);
    const thisWeek = new Set(
      (
        await db.prepare('SELECT id FROM runs WHERE epoch = ?').bind(week).all<{ id: number }>()
      ).results.map((r) => r.id),
    );
    expect(traces).not.toContain(nobody);
    expect((await get(`/trace/${nobody}`)).status).toBe(404);
    for (const id of traces) expect(thisWeek.has(id)).toBe(true);
  });

  /** La trace gardée est celle qui a été jouée : elle se relit et se rejoue. */
  it('serves a kept trace, and it replays to the run it came from', async () => {
    const run = await rankedRun('served', 'medium', 8);
    expect(run.status).toBe(200);
    const board = (await (await get('/board/medium')).json()) as {
      entries: { id: number; score: number }[];
    };
    const top = board.entries[0]!;
    const res = await get(`/trace/${top.id}`);
    expect(res.status).toBe(200);
    const { trace: b64 } = (await res.json()) as { trace: string };
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    const back = unpackTrace(bytes)!;
    expect(back).not.toBeNull();
    expect(replay(back).score).toBeCloseTo(top.score, 6);

    expect((await get('/trace/99999')).status).toBe(404);
    expect((await get('/trace/nope')).status).toBe(400);
  });

  it('flags a claim that disagrees with the replay, without refusing the run', async () => {
    const fake = await rankedRun('claim-fake', 'easy', 6, {
      claim: { steps: 1, wrecked: false, score: 1, dist: 1, time: 1, coins: 0, multPeak: 1 },
    });
    expect(fake.status).toBe(200); // signalé, pas refusé
    const noClaim = await rankedRun('claim-none', 'easy', 6);
    expect(noClaim.status).toBe(200);

    const db = await mf.getD1Database('DB');
    const rows = (
      await db.prepare("SELECT mismatch, claim FROM runs WHERE difficulty = 'easy'").all()
    ).results as { mismatch: number; claim: string }[];
    // le faux claim ('"score":1', quasi impossible sur une vraie partie) est signalé
    expect(rows.find((r) => r.claim.includes('"score":1'))?.mismatch).toBe(1);
    // pas de claim du tout : rien à comparer, rien à signaler
    expect(rows.find((r) => r.claim === '')?.mismatch).toBe(0);
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

  /**
   * Le rejeu est ce qui coûte, et il se compte par adresse.
   *
   * Mesuré à 0,06 µs par pas une fois le JIT chaud : une partie normale se
   * rejoue en quelques dizaines de millisecondes, la plus longue qu'une trace
   * puisse déclarer en deux dixièmes de seconde. Douze par minute et par
   * adresse est large pour un joueur — qui en lance une au plus — et serré
   * pour une boucle.
   */
  it('caps what one address may ask for per minute, and says how long to wait', async () => {
    const ip = { 'cf-connecting-ip': '203.0.113.7' };
    let refused: Awaited<ReturnType<typeof post>> | null = null;
    for (let i = 0; i < PER_MINUTE.ticket! + 1; i++) {
      const res = await post('/ticket', { difficulty: 'easy' }, ip);
      if (res.status === 429) {
        refused = res;
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(refused).not.toBeNull();
    const body = (await refused!.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('rate');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(60);

    // une autre adresse n'est pas punie pour celle-là
    expect((await post('/ticket', { difficulty: 'easy' })).status).toBe(200);

    // la fenêtre glisse : une minute plus tard, la même adresse repasse
    const later = { ...ip, 'x-debug-now': String(Date.now() + 61_000) };
    expect((await post('/ticket', { difficulty: 'easy' }, later)).status).toBe(200);
  });

  /**
   * Une trace de quelques dizaines d'octets pouvait demander deux milliards de
   * pas, et `replay` boucle exactement ce nombre de fois. La partie classée
   * était couverte — la fenêtre du ticket compare les pas au temps écoulé —
   * mais le rejeu simple ne l'était pas : il tournait des minutes dans un
   * objet unique pour un message tenant dans un SMS.
   */
  it('refuses a trace that claims more steps than an hour of play', async () => {
    const { trace } = play('too-long', 'easy', 4);
    const absurd = { ...trace, steps: MAX_TRACE_STEPS + 1 };
    expect((await post('/run', { core, trace: absurd })).status).toBe(400);
    // la borne elle-même passe : c'est un plafond, pas une marge
    expect(validTrace({ ...trace, steps: MAX_TRACE_STEPS })).toBe(true);
  });

  /**
   * Le coupe-circuit : une variable, pas un déploiement. Un second serveur
   * est monté avec `RANKED_OFF` à 1 — sa base est vierge, donc seules les
   * routes qui n'y touchent pas sont regardées : `/health` le dit, `/ticket`
   * et `/run` refusent avec le mot que le client traduit en « ranked mode is
   * off ». Le jeu, lui, ne lit rien de tout ça : il continue hors ligne.
   */
  it('turns ranked off with one variable, and says so where the client reads', async () => {
    const off = flare({ RANKED_OFF: { type: 'text', value: '1' } });
    const call = (path: string, body?: unknown) =>
      off.dispatchFetch(`https://api.test${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
    try {
      expect(((await (await call('/health')).json()) as { ranked: boolean }).ranked).toBe(false);
      const ticket = await call('/ticket', { difficulty: 'easy' });
      expect(ticket.status).toBe(503);
      expect(((await ticket.json()) as { error: string }).error).toBe('ranked-off');
      const { trace } = play('switched-off', 'easy', 4);
      expect((await call('/run', { core, trace })).status).toBe(503);
    } finally {
      await off.dispose();
    }
    // le serveur des autres tests, lui, est ouvert, et `/health` le dit
    expect(((await (await get('/health')).json()) as { ranked: boolean }).ranked).toBe(true);
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
