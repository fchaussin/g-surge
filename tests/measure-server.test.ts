/**
 * Mesure, pas test : ce qu'un rejeu coûte dans workerd, et combien l'arbitre
 * en tient par minute. Ne tourne qu'avec `MEASURE=1` — `npm run
 * measure:server` — et ne vérifie rien, elle imprime.
 *
 * C'est la mesure que M8 demande « dans workerd, pas supposée depuis Node » :
 * le moteur qui arbitre n'est pas celui des tests unitaires, et un Durable
 * Object est un fil unique — ce qu'il fait en série borne ce qu'il tient.
 * Miniflare ne donne pas le temps processeur de l'objet ; ce qui est mesuré
 * est le temps de réponse, qui le contient et le majore. Une adresse par
 * appel : c'est la forme d'un abus réparti, et ce que la limite par adresse
 * ne retient pas est exactement ce que l'objet doit encaisser seul.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { Miniflare } from 'miniflare';
import { DT, quantiseSteer, Sim, packTrace, type Trace } from '../src/sim/index.js';
import { bootServer } from './helpers/workerd.js';

let mf: Miniflare;
let core: string;
let caller = 0;

/** Un manche posé, 120 Hz, quantifié comme `input.ts` le fait : la forme réelle d'une trace. */
function stickTrace(seconds: number): Trace {
  const sim = new Sim({ seed: `load-${seconds}`, difficulty: 'easy' });
  sim.reset(`load-${seconds}`);
  const steps = Math.round(seconds / DT);
  const perFrame = 6;
  let held = 0;
  let target = 0;
  let steer = 0;
  for (let i = 0; i < steps; i++) {
    if (i % perFrame === 0) {
      const f = i / perFrame;
      if (f % 48 === 0) target = Math.sin(f * 0.031) * 0.85;
      held += (target - held) * 0.12;
      steer = quantiseSteer(held);
    }
    sim.step({ steer, brake: false, boost: i % 2000 < 1400 }, DT);
  }
  return sim.trace();
}

const submit = (packed: string) =>
  mf.dispatchFetch('https://api.test/run', {
    method: 'POST',
    body: JSON.stringify({ core, trace: packed }),
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `10.1.${(caller >> 8) & 255}.${caller++ & 255}`,
    },
  });

const median = (xs: number[]): number =>
  xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe.skipIf(!process.env.MEASURE)('the arbiter under load, in workerd', () => {
  beforeAll(async () => {
    ({ mf, core } = await bootServer());
  }, 60_000);
  afterAll(async () => {
    await mf?.dispose();
  });

  it('prints what a replay costs and how many a minute the object serves', async () => {
    const rows: string[] = [];

    // 1. Un rejeu seul, par durée de partie. Le premier appel chauffe le JIT
    //    et n'est pas compté.
    for (const seconds of [30, 180, 600]) {
      const t = stickTrace(seconds);
      const packed = Buffer.from(packTrace(t)).toString('base64');
      await submit(packed);
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const res = await submit(packed);
        times.push(performance.now() - t0);
        if (res.status !== 200) rows.push(`  !! ${seconds}s: status ${res.status}`);
      }
      rows.push(
        `  ${String(seconds).padStart(3)} s of play, ${String(t.steps).padStart(6)} steps, ` +
          `${t.from.length} spans, ${(packed.length / 1024).toFixed(0)} kB: ` +
          `${median(times).toFixed(1)} ms per replay (median of 5)`,
      );
    }

    // 2. Une rafale : deux cents parties de trois minutes, lancées ensemble.
    const burst = 200;
    const packed = Buffer.from(packTrace(stickTrace(180))).toString('base64');
    const t0 = performance.now();
    const results = await Promise.all(Array.from({ length: burst }, () => submit(packed)));
    const wall = (performance.now() - t0) / 1000;
    const ok = results.filter((r) => r.status === 200).length;
    rows.push(
      `  burst of ${burst} × 180 s: ${ok}/${burst} accepted in ${wall.toFixed(1)} s — ` +
        `${((ok / wall) * 60).toFixed(0)} replays a minute, ${((wall * 1000) / ok).toFixed(1)} ms each in the queue`,
    );

    console.log('\nreplay cost in workerd\n' + rows.join('\n') + '\n');
  }, 300_000);
});
