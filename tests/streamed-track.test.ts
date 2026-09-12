/**
 * La piste servie par tranches est la piste semée, au bit près.
 *
 * C'est la couture de la phase 2 de `NETWORK.md` : en partie classée, le
 * serveur garde la graine et sert les nœuds devant le vaisseau. Ici le
 * générateur semé est d'un côté d'un tuyau, une `QueuedNodes` de l'autre, et
 * les tranches arrivent de travers — tailles quelconques, doublons, une
 * tentative rejouée après un échec — comme sur un vrai réseau. Les références
 * figées doivent sortir de la file exactement comme de la graine.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COUNT,
  DT,
  packNodes,
  QueuedNodes,
  Rng,
  SeededNodes,
  Sim,
  Track,
  tuningFor,
  unpackNodes,
  type Difficulty,
  type Node,
  type WireChunk,
} from '../src/sim/index.js';
import { digest } from './helpers/digest.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'e2e', 'fixtures');
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

/** Le serveur : une graine, des tranches adressées par identifiant de segment. */
class Server {
  private readonly nodes: Node[] = [];
  private readonly gen: SeededNodes;
  constructor(seed: string, difficulty: Difficulty) {
    this.gen = new SeededNodes(tuningFor(difficulty), seed);
  }
  /**
   * `count` nœuds à partir de `from`, passés par le fil — emballés, JSON,
   * déballés — comme le vrai serveur les sert. Rejouable : la même plage rend
   * les mêmes nœuds.
   */
  chunk(from: number, count: number): Node[] {
    while (this.nodes.length < from + count) this.nodes.push(this.gen.next());
    const wire = JSON.parse(JSON.stringify(packNodes(this.nodes.slice(from, from + count))));
    const nodes = unpackNodes(wire as WireChunk);
    if (!nodes) throw new Error('chunk did not survive the wire');
    return nodes;
  }
}

/** Le client : demande la tranche suivante sous un seuil, et le réseau fait ce qu'il veut. */
function stream(
  seed: string,
  difficulty: Difficulty,
  rng: Rng,
): { queue: QueuedNodes; pump: () => void } {
  const server = new Server(seed, difficulty);
  const queue = new QueuedNodes();
  const pump = (): void => {
    while (queue.ahead < 2 * COUNT) {
      const size = 16 + rng.int(300);
      const r = rng.next();
      if (r < 0.15) {
        // une requête perdue : rien n'arrive, on redemande
        continue;
      } else if (r < 0.3) {
        // une réponse tardive d'une plage déjà reçue : un doublon, ignoré
        const back = Math.max(0, queue.wanted - rng.int(200));
        const fresh = Math.max(0, back + size - queue.wanted);
        expect(queue.feed(server.chunk(back, size))).toBe(fresh);
      } else {
        expect(queue.feed(server.chunk(queue.wanted, size))).toBe(size);
      }
    }
  };
  pump();
  return { queue, pump };
}

const snapshot = (t: Track) => ({
  k: Array.from(t.nk),
  g: Array.from(t.ng),
  b: Array.from(t.nb),
  id: Array.from(t.nid),
  items: t.items.map((it) => `${it.id}:${it.lat}:${it.type}`),
  extras: t.extras.map((it) => `${it.id}:${it.lat}:${it.type}`),
});

describe('the streamed track', () => {
  it('regenerates the reference track through a queue fed in ragged chunks', () => {
    const expected = load('track-reference') as { nodes: unknown; items: unknown };
    const rng = Rng.fromSeed('network', 'chaos');
    const { queue } = stream('reference', 'easy', rng);
    const track = new Track(tuningFor('easy'), 'unused');
    track.attach(queue);
    expect(track.dry).toBe(false);
    expect({
      k: Array.from(track.nk),
      g: Array.from(track.ng),
      b: Array.from(track.nb),
      id: Array.from(track.nid),
    }).toEqual(expected.nodes);
    expect(track.items.map((it) => ({ id: it.id, lat: it.lat, type: it.type }))).toEqual(
      expected.items,
    );
  });

  it('matches the seeded track over sixty seeds and a thousand pushes each', () => {
    const rng = Rng.fromSeed('network', 'chaos');
    for (let i = 0; i < 60; i++) {
      const seed = `ref-${i}`;
      const seeded = new Track(tuningFor('medium'), seed);
      const { queue, pump } = stream(seed, 'medium', rng);
      const queued = new Track(tuningFor('medium'), 'unused');
      queued.attach(queue);
      for (let p = 0; p < 1000; p++) {
        seeded.push();
        queued.push();
        if (p % 50 === 0) pump();
      }
      expect(queued.dry).toBe(false);
      expect(digest(snapshot(queued))).toBe(digest(snapshot(seeded)));
    }
  });

  for (const diff of ['easy', 'medium', 'hard'] as const) {
    it(`replays the ${diff} physics reference on a streamed track`, () => {
      const expected = load(`physics-${diff}`) as { frames: unknown[] };
      const rng = Rng.fromSeed('network', diff);
      const { queue, pump } = stream('reference', diff, rng);
      const sim = new Sim({ seed: 'reference', difficulty: diff });
      sim.reset('reference');
      sim.track.attach(queue);
      const script = [
        { from: 0, steer: 0, brake: false, boost: false },
        { from: 240, steer: 0.18, brake: false, boost: true },
        { from: 600, steer: -0.22, brake: false, boost: true },
        { from: 900, steer: 0.1, brake: false, boost: false },
        { from: 1200, steer: -0.12, brake: true, boost: false },
        { from: 1500, steer: 0.06, brake: false, boost: true },
      ];
      const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
      const st = sim.state;
      const frames: unknown[] = [];
      let cur = script[0]!;
      let si = 0;
      const snap = (i: number) => ({
        i,
        dist: r6(st.dist),
        travel: r6(st.travel),
        cursor: r6(st.cursor),
        speed: r6(st.speed),
        lat: r6(st.lat),
        latVel: r6(st.latVel),
        yaw: r6(st.yaw),
        hop: r6(st.hop),
        vyRel: r6(st.vyRel),
        energy: r6(st.energy),
        hull: r6(st.hull),
        mult: r6(st.mult),
        score: r6(st.score),
        coins: st.coins,
        air: st.air,
        drift: st.drift,
        wrecked: st.wrecked,
      });
      frames.push(snap(-1));
      for (let i = 0; i < 1800; i++) {
        while (si < script.length && script[si]!.from <= i) cur = script[si++]!;
        sim.step(cur, 1 / 120, false);
        if (i % 30 === 0) pump();
        if ((i + 1) % 120 === 0 || i === 1799) frames.push(snap(i));
      }
      expect(sim.track.dry).toBe(false);
      expect(frames).toEqual(expected.frames);
    });
  }

  it('runs dry cleanly: the track goes straight and says so, the simulation keeps its invariants', () => {
    const server = new Server('dry', 'easy');
    const queue = new QueuedNodes();
    queue.feed(server.chunk(0, COUNT + 20));
    const sim = new Sim({ seed: 'dry' });
    sim.reset('dry');
    sim.track.attach(queue);
    const input = { steer: 0, brake: false, boost: true };
    let steps = 0;
    while (!sim.track.dry && steps < 720 * 60) {
      sim.step(input, DT, false);
      steps++;
    }
    expect(sim.track.dry).toBe(true);
    expect(steps).toBeGreaterThan(0);
    const lastK = sim.track.nk[COUNT - 1];
    const lastId = sim.track.nid[COUNT - 1];
    for (let i = 0; i < 720; i++) sim.step(input, DT, false);
    // prolongée tout droit : même courbure, identifiants qui continuent, rien de cassé
    expect(sim.track.nk[COUNT - 1]).toBe(lastK);
    expect(sim.track.nid[COUNT - 1]).toBeGreaterThan(lastId!);
    expect(Number.isFinite(sim.state.dist)).toBe(true);
    expect(sim.state.wrecked).toBe(false);
  });

  it('refuses a chunk that is not one, instead of crashing the step', () => {
    const server = new Server('wire', 'easy');
    const good = packNodes(server.chunk(0, 8));
    expect(unpackNodes(good)?.length).toBe(8);
    const bad = (patch: Partial<WireChunk>): Node[] | null => unpackNodes({ ...good, ...patch });
    expect(bad({ from: -1 })).toBeNull();
    expect(bad({ from: 1.5 })).toBeNull();
    expect(bad({ g: good.g.slice(1) })).toBeNull();
    expect(bad({ k: good.k.map((v, i) => (i === 3 ? NaN : v)) })).toBeNull();
    expect(bad({ items: [0, 1] })).toBeNull();
    expect(bad({ items: [99, 0, 0] })).toBeNull(); // un objet hors de la tranche
    expect(bad({ extras: [1, 0, 7] })).toBeNull(); // un type qui n'existe pas
    expect(bad({ extras: [1, Infinity, 3] })).toBeNull();
  });

  it('feeds only what extends the queue, and reports it', () => {
    const server = new Server('feed', 'hard');
    const q = new QueuedNodes();
    expect(q.feed(server.chunk(5, 10))).toBe(0); // un trou devant : rien
    expect(q.feed(server.chunk(0, 10))).toBe(10);
    expect(q.feed(server.chunk(0, 10))).toBe(0); // doublon exact
    expect(q.feed(server.chunk(5, 10))).toBe(5); // chevauchement : la moitié neuve
    expect(q.wanted).toBe(15);
    expect(q.ahead).toBe(15);
    for (let i = 0; i < 15; i++) expect(q.next()?.id).toBe(i);
    expect(q.next()).toBeNull();
  });
});
