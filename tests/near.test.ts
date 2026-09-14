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
import { DEFAULTS, SHIP, Sim, type SimEvent } from '../src/sim/index.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };
/** Le bord, à la largeur du niveau de ces tests — `fresh()` joue en facile. */
const LIM = DEFAULTS.half - SHIP;

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
      sim.state.lat = sim.tuning.half;
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

  /**
   * La chaîne : frôler pendant un enchaînement armé paie de plus en plus, et
   * rend de la coque. C'est la seule source de coque en dehors des réparations
   * et de la régénération, et elle se mérite — il faut tenir le combo **et**
   * raser le mur sans le toucher. Hors combo, rien ne change.
   */
  it('chains inside an armed combo: pays more each time, and gives hull back', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    sim.state.speed = 200;
    sim.state.hull = 50;
    // Hors combo : un frôlement ne rend aucune coque.
    hold(sim, LIM - 0.2, 0.3, ev);
    hold(sim, 0, DT, ev);
    expect(misses(ev)).toHaveLength(1);
    expect(misses(ev)[0]!.chain).toBe(0);
    // Rien d'autre que la régénération ordinaire, 0,25 par seconde.
    expect(sim.state.hull).toBeLessThan(50.2);

    // Armé : chaque frôlement compte, paie davantage, et rend un peu de coque.
    sim.state.combo = sim.tuning.comboArm;
    sim.state.comboLeft = 1e9;
    const paid: number[] = [];
    for (let n = 0; n < 3; n++) {
      const hull = sim.state.hull;
      const before = ev.length;
      sim.state.speed = 200;
      hold(sim, LIM - 0.2, 0.3, ev);
      hold(sim, 0, DT, ev);
      const miss = misses(ev.slice(before))[0]!;
      expect(miss.chain).toBe(n + 1);
      // bien au-delà de la régénération : la coque rendue par la chaîne
      expect(sim.state.hull).toBeGreaterThan(hull + 0.5);
      paid.push(miss.bonus);
    }
    expect(paid[1]).toBeGreaterThan(paid[0]!);
    expect(paid[2]).toBeGreaterThan(paid[1]!);

    // Un mur casse la chaîne avec l'enchaînement.
    sim.state.lat = sim.tuning.half;
    sim.state.latVel = 8;
    sim.step(NEUTRAL, DT, false);
    expect(sim.state.nearChain).toBe(0);
  });

  /** La coque rendue reste un filet, pas une fontaine : elle plafonne à 100. */
  it('never pushes the hull past full', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    sim.state.speed = 200;
    sim.state.hull = 100;
    sim.state.combo = sim.tuning.comboArm;
    sim.state.comboLeft = 1e9;
    hold(sim, LIM - 0.2, 0.3, ev);
    hold(sim, 0, DT, ev);
    expect(misses(ev)).toHaveLength(1);
    expect(sim.state.hull).toBe(100);
  });

  it('stays out of the band on an ordinary line', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    hold(sim, 4, 1, ev);
    expect(sim.state.near).toBe(false);
    expect(misses(ev)).toHaveLength(0);
  });
});
