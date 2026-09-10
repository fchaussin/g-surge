/**
 * The end of a super boost is an event, and it has to fire exactly once.
 *
 * `superT` is not in the frozen trace, so nothing in `sim-parity` could catch a
 * mistake here: an event emitted every step, or never, or one step late would
 * all replay identically. This file is the net for that.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/index.js';

const NEUTRAL = { steer: 0, brake: false, boost: false };
const DT = 1 / 720;

/** Steps the simulation, returning the index of each event of one type. */
function stepsEmitting(sim: Sim, steps: number, type: string): number[] {
  const at: number[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step(NEUTRAL, DT, false);
    for (const e of sim.events) if (e.type === type) at.push(i);
  }
  return at;
}

describe('supEnd', () => {
  it('fires once, on the step where the counter reaches zero', () => {
    const sim = new Sim({ seed: 'sup-end' });
    sim.state.superT = sim.tuning.supTime;

    // Bien au-delà de la durée : ce qui est vérifié est aussi qu'il ne se
    // répète pas une fois le compteur au fond.
    const at = stepsEmitting(sim, Math.ceil(sim.tuning.supTime / DT) + 600, 'supEnd');

    expect(at).toHaveLength(1);
    expect(sim.state.superT).toBe(0);
    // Le pas juste avant la fin de la durée, à un pas près selon l'arrondi.
    expect(at[0]).toBeGreaterThanOrEqual(Math.floor(sim.tuning.supTime / DT) - 1);
    expect(at[0]).toBeLessThanOrEqual(Math.ceil(sim.tuning.supTime / DT));
  });

  it('does not fire when no super boost is running', () => {
    const sim = new Sim({ seed: 'sup-end' });
    const at = stepsEmitting(sim, 400, 'supEnd');

    expect(sim.state.superT).toBe(0);
    expect(at).toEqual([]);
  });

  it('fires once per super boost, however many are collected', () => {
    const sim = new Sim({ seed: 'sup-end' });
    let ends = 0;
    let starts = 0;

    for (let i = 0; i < 4; i++) {
      sim.state.superT = sim.tuning.supTime;
      starts++;
      for (let k = 0; k < Math.ceil(sim.tuning.supTime / DT) + 60; k++) {
        sim.step(NEUTRAL, DT, false);
        for (const e of sim.events) if (e.type === 'supEnd') ends++;
      }
    }

    expect(ends).toBe(starts);
  });
});
