/**
 * Le Near Miss : frôler le mur sans le toucher.
 *
 * Le pilote des traces figées entre dans la bande et touche à chaque fois, ce
 * que `sim-parity` affirme ; un passage propre y paierait en score et en
 * réserve. Ce fichier est donc le seul filet de la mécanique. Le vaisseau est
 * posé dans la bande à la main, sans vitesse latérale, pour que la physique
 * n'ait pas à y être conduite.
 */
import { describe, expect, it } from 'vitest';
import { HALF, SHIP, Sim, type SimEvent } from '../src/sim/index.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };
const LIM = HALF - SHIP;

function fresh(seed = 'near'): Sim {
  const sim = new Sim({ seed });
  sim.reset(seed);
  sim.tuning.climbSup = 1e9;
  return sim;
}

/** Tient le vaisseau à `lat` pendant `seconds`, en collectant les événements. */
function hold(sim: Sim, lat: number, seconds: number, out: SimEvent[]): void {
  for (let i = 0; i < Math.round(seconds * 720); i++) {
    sim.state.lat = lat;
    sim.state.latVel = 0;
    sim.state.yaw = 0;
    sim.step(NEUTRAL, DT, false);
    out.push(...sim.events);
  }
}

const misses = (ev: SimEvent[]) =>
  ev.filter((e) => e.type === 'nearMiss') as Extract<SimEvent, { type: 'nearMiss' }>[];

describe('the near miss', () => {
  it('pays on leaving the band cleanly, by speed and by how close it got', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    sim.state.energy = 50;
    const inside = LIM - sim.tuning.nearBand * 0.25; // aux trois quarts de la bande
    hold(sim, inside, 0.3, ev);
    expect(misses(ev)).toHaveLength(0); // pas encore sorti
    const score = sim.state.score;
    const energy = sim.state.energy;
    hold(sim, 0, DT, ev);
    const m = misses(ev);
    expect(m).toHaveLength(1);
    expect(m[0]!.closeness).toBeCloseTo(0.75, 6);
    expect(m[0]!.bonus).toBeGreaterThan(0);
    expect(sim.state.score - score).toBeGreaterThan(m[0]!.bonus);
    expect(sim.state.energy - energy).toBeCloseTo(sim.tuning.nearCharge * 0.75, 1);
  });

  it('pays nothing when the wall was touched during the pass', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    hold(sim, LIM - 0.3, 0.2, ev);
    // Contre la paroi, en poussant dedans : contact.
    for (let i = 0; i < 30; i++) {
      sim.state.lat = HALF;
      sim.state.latVel = 8;
      sim.step(NEUTRAL, DT, false);
      ev.push(...sim.events);
    }
    expect(ev.some((e) => e.type === 'wallImpact')).toBe(true);
    hold(sim, LIM - 0.3, 0.2, ev);
    hold(sim, 0, DT, ev);
    expect(misses(ev)).toHaveLength(0);
  });

  it('pays nothing for a pass too brief to count', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    hold(sim, LIM - 0.2, sim.tuning.nearMinHeld / 2, ev);
    hold(sim, 0, DT, ev);
    expect(misses(ev)).toHaveLength(0);
  });

  it('pays nothing for a pass that ends in the air, and nothing in the attract loop', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    hold(sim, LIM - 0.2, 0.3, ev);
    sim.state.air = true;
    sim.state.hop = 2;
    sim.state.vyRel = 5;
    sim.state.lat = 0;
    sim.step(NEUTRAL, DT, false);
    ev.push(...sim.events);
    expect(misses(ev)).toHaveLength(0);

    const attract = fresh();
    for (let i = 0; i < 200; i++) {
      attract.state.lat = LIM - 0.2;
      attract.state.latVel = 0;
      attract.step(NEUTRAL, DT, true);
    }
    attract.state.lat = 0;
    attract.step(NEUTRAL, DT, true);
    expect(attract.state.near).toBe(false);
    expect(attract.events.some((e) => e.type === 'nearMiss')).toBe(false);
  });

  it('stays out of the band on an ordinary line', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    hold(sim, 4, 1, ev);
    expect(sim.state.near).toBe(false);
    expect(misses(ev)).toHaveLength(0);
  });
});
