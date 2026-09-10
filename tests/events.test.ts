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

describe('drift events', () => {
  /**
   * Le drift bascule sur une hystérésis, donc ses deux extrémités doivent
   * s'alterner strictement. Un slalom lent est ce qui en produit le plus :
   * mesuré, dix entrées par minute, et le plus court drift dure un seul pas.
   *
   * Le relevé s'arrête sur un pas sans drift, pour qu'aucun drift en cours ne
   * fausse la somme des durées.
   */
  function weave(seconds: number) {
    const sim = new Sim({ seed: 'drift-events', difficulty: 'medium' });
    sim.reset('drift-events');
    const seen: Array<{ type: string; held: number }> = [];
    let drifting = 0;

    const collect = (i: number) => {
      const steer = Math.max(-1, Math.min(1, Math.sin(i * DT * Math.PI)));
      sim.step({ steer, brake: false, boost: false }, DT, false);
      for (const e of sim.events) {
        if (e.type === 'driftStart') seen.push({ type: e.type, held: 0 });
        else if (e.type === 'driftEnd') seen.push({ type: e.type, held: e.held });
      }
      if (sim.state.drift) drifting += DT;
    };

    let i = 0;
    for (; i < seconds * 720; i++) collect(i);
    for (let guard = 0; sim.state.drift && guard < 720 * 10; guard++) collect(i++);

    return { seen, drifting, stillDrifting: sim.state.drift };
  }

  it('alternates strictly, and never repeats an end', () => {
    const { seen, stillDrifting } = weave(60);

    expect(stillDrifting).toBe(false);
    expect(seen.length).toBeGreaterThan(4);
    expect(seen[0]!.type).toBe('driftStart');
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.type).not.toBe(seen[i - 1]!.type);
    }
  });

  it('carries durations that add up to the time actually spent drifting', () => {
    const { seen, drifting } = weave(60);
    const ends = seen.filter((e) => e.type === 'driftEnd');

    expect(ends.length).toBeGreaterThan(0);
    // Chaque durée est celle d'un drift, et leur somme est le temps total :
    // c'est ce qui attrape un compteur jamais remis à zéro entre deux drifts.
    expect(ends.reduce((a, e) => a + e.held, 0)).toBeCloseTo(drifting, 6);
    for (const e of ends) expect(e.held).toBeGreaterThan(0);

    // La mesure qui justifie le seuil des consommateurs : un drift d'un seul
    // pas existe. Si cette borne remonte un jour, le seuil est à revoir.
    expect(Math.min(...ends.map((e) => e.held))).toBeLessThan(0.12);
  });

  it('ends the drift when the ship takes off, not only when the grip returns', () => {
    const sim = new Sim({ seed: 'drift-air' });
    sim.state.drift = true;
    sim.state.driftHeld = 0.5;
    sim.state.air = true;

    sim.step({ steer: 0, brake: false, boost: false }, DT, false);

    expect(sim.state.drift).toBe(false);
    expect(sim.events.map((e) => e.type)).toContain('driftEnd');
  });
});
