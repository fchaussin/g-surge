/**
 * La file de piste côté client tient sous un réseau qui rate.
 *
 * `TrackStream.pump()` est appelé à chaque frame et lance au plus une requête
 * ; une requête ratée est redemandée à la frame suivante, sans autre logique,
 * parce que les tranches sont adressées par segment. Ce test remplace `fetch`
 * par un serveur qui perd, retarde et répète, et vérifie que la file ne se
 * vide jamais tant que le serveur finit par répondre — et qu'elle se déclare
 * sèche proprement quand il ne répond plus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packNodes, SeededNodes, Sim, tuningFor, type WireChunk } from '../src/sim/index.js';
import { CHUNK, LOW, TrackStream } from '../src/client/stream.js';

/** Le serveur : tranches par identifiant depuis une graine, comme le vrai. */
function server(seed: string) {
  const gen = new SeededNodes(tuningFor('easy'), seed);
  const nodes: ReturnType<typeof gen.next>[] = [];
  return (from: number): WireChunk => {
    while (nodes.length < from + CHUNK) nodes.push(gen.next());
    return packNodes(nodes.slice(from, from + CHUNK));
  };
}

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

let calls: number[];
beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** `fetch` remplacé : `plan(from, n)` dit ce que la n-ième requête de cette plage fait. */
function stub(
  chunk: (from: number) => WireChunk,
  plan: (from: number, n: number) => 'ok' | 'lose' | 'garbage',
) {
  const seen = new Map<number, number>();
  vi.stubGlobal('fetch', (url: string) => {
    const from = Number(url.split('/').pop());
    const n = (seen.get(from) ?? 0) + 1;
    seen.set(from, n);
    calls.push(from);
    const what = plan(from, n);
    if (what === 'lose') return Promise.reject(new TypeError('network'));
    if (what === 'garbage')
      return Promise.resolve(json({ from, k: [1], g: [], b: [], items: [], extras: [] }));
    return Promise.resolve(json(chunk(from)));
  });
}

/** Laisse les promesses du `fetch` factice aboutir : `setImmediate`, sans le plancher d'une milliseconde de `setTimeout`. */
const flush = () => new Promise((r) => setImmediate(r));

describe('the track stream', () => {
  it('keeps the queue between two and three chunks ahead, one request at a time', async () => {
    const chunk = server('stream');
    stub(chunk, () => 'ok');
    const stream = TrackStream.from({ ticket: 't', difficulty: 'easy', chunk: chunk(0) })!;
    expect(stream.queue.ahead).toBe(CHUNK);
    // une frame : sous LOW, une requête part ; une deuxième frame n'en lance pas une autre
    stream.pump();
    stream.pump();
    expect(calls).toEqual([CHUNK]);
    await flush();
    expect(stream.queue.ahead).toBe(2 * CHUNK);
    stream.pump();
    await flush();
    // à LOW, plus rien à demander
    expect(calls).toEqual([CHUNK]);
    expect(stream.queue.ahead).toBe(LOW);
  });

  it(
    'survives lost requests, garbage and duplicates without a gap',
    { timeout: 30_000 },
    async () => {
      const chunk = server('ragged');
      // chaque plage rate deux fois — une perte, un déchet — puis passe
      stub(chunk, (_from, n) => (n === 1 ? 'lose' : n === 2 ? 'garbage' : 'ok'));
      const stream = TrackStream.from({ ticket: 't', difficulty: 'easy', chunk: chunk(0) })!;
      const sim = new Sim({ seed: 'unused' });
      sim.reset('unused');
      stream.attach(sim);
      const seeded = new Sim({ seed: 'ragged' });
      seeded.reset('ragged');
      const input = { steer: 0, brake: false, boost: true };
      // 60 s à fond, une frame de 12 pas, une requête possible par frame
      for (let f = 0; f < 60 * 60; f++) {
        stream.pump();
        await flush();
        for (let i = 0; i < 12; i++) {
          sim.step(input, 1 / 720, false);
          seeded.step(input, 1 / 720, false);
        }
      }
      expect(sim.track.dry).toBe(false);
      // sans braquer, il finit dans un mur ; ce qui compte est d'y arriver sur la même piste
      expect(sim.state.dist).toBeGreaterThan(2000);
      expect(sim.state.dist).toBe(seeded.state.dist);
      expect(Array.from(sim.track.nk)).toEqual(Array.from(seeded.track.nk));
      expect(stream.failures).toBe(0);
      // chaque plage a bien été demandée trois fois, jamais plus
      const perFrom = new Map<number, number>();
      for (const c of calls) perFrom.set(c, (perFrom.get(c) ?? 0) + 1);
      expect(Math.max(...perFrom.values())).toBe(3);
    },
  );

  it(
    'runs dry cleanly when the server stops answering, and says how many times it asked',
    { timeout: 30_000 },
    async () => {
      const chunk = server('gone');
      stub(chunk, (from) => (from >= 2 * CHUNK ? 'lose' : 'ok'));
      const stream = TrackStream.from({ ticket: 't', difficulty: 'easy', chunk: chunk(0) })!;
      const sim = new Sim({ seed: 'unused' });
      sim.reset('unused');
      stream.attach(sim);
      const input = { steer: 0, brake: false, boost: true };
      let frames = 0;
      while (!sim.track.dry && frames < 60 * 600) {
        stream.pump();
        await flush();
        for (let i = 0; i < 12; i++) sim.step(input, 1 / 720, false);
        frames++;
      }
      expect(sim.track.dry).toBe(true);
      // deux tranches reçues, 512 segments ; la piste est sèche quand son bord
      // avant, 120 segments devant le vaisseau, dépasse le dernier : à 4 584 m
      expect(sim.state.dist).toBeGreaterThan(4500);
      expect(stream.failures).toBeGreaterThan(50);
      expect(Number.isFinite(sim.state.speed)).toBe(true);
    },
  );

  it('refuses a first chunk that is not one', () => {
    expect(
      TrackStream.from({
        ticket: 't',
        difficulty: 'easy',
        chunk: { from: 0, k: [1], g: [], b: [], items: [], extras: [] },
      }),
    ).toBeNull();
  });
});
