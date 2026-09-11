/**
 * Le carburant : une ressource permanente, secondaire par conception.
 *
 * `fuel` n'est pas dans la trace figée, et les bidons sont des extras, donc
 * les références ne voient rien de ceci ; mais le boost est conditionné au
 * carburant, et un réservoir qui se viderait dans les quinze secondes d'une
 * trace la déplacerait. Le premier test dit pourquoi ça n'arrive pas.
 */
import { describe, expect, it } from 'vitest';
import {
  BACK,
  ITEM_FUEL,
  Sim,
  tuningFor,
  type Difficulty,
  type SimEvent,
} from '../src/sim/index.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };
const BOOSTING = { steer: 0, brake: false, boost: true };

function fresh(seed = 'fuel', difficulty: Difficulty = 'easy'): Sim {
  const sim = new Sim({ seed, difficulty });
  sim.reset(seed);
  sim.tuning.climbSup = 1e9;
  return sim;
}

function dropCan(sim: Sim): void {
  sim.state.lat = 0;
  sim.track.extras.push({
    id: sim.track.nid[0]! + BACK,
    lat: 0,
    type: ITEM_FUEL,
    done: false,
    taken: false,
  });
}

function run(sim: Sim, seconds: number, input = NEUTRAL, out?: SimEvent[]): void {
  for (let i = 0; i < Math.round(seconds * 720); i++) {
    sim.state.lat = 0;
    sim.state.latVel = 0;
    sim.step(input, DT, false);
    out?.push(...sim.events);
  }
}

describe('fuel', () => {
  it('cannot run dry within a frozen trace, even boosting throughout on hard', () => {
    // 15 s de trace, et aucun super boost dedans — `sim-parity` l'affirme —
    // donc le pire cas est le boost tenu du premier au dernier pas, ce que le
    // script de référence ne fait même pas. Ce test prend cette borne.
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const t = tuningFor(d);
      expect(Math.max(t.fuelBoost, t.fuelCruise) * 15).toBeLessThan(100);
    }
  });

  it('burns nothing at cruise on easy, and slowly on medium and hard', () => {
    const easy = fresh('fuel', 'easy');
    run(easy, 2);
    expect(easy.state.fuel).toBe(100);

    const hard = fresh('fuel', 'hard');
    run(hard, 2);
    expect(hard.state.fuel).toBeCloseTo(100 - hard.tuning.fuelCruise * 2, 1);
  });

  it('burns faster under boost, and stops the boost when dry', () => {
    const sim = fresh();
    sim.state.dist = 20000;
    sim.tuning.fuelBoost = 40; // pour vider en 2,5 s
    const ev: SimEvent[] = [];
    run(sim, 1, BOOSTING, ev);
    expect(sim.state.boosting).toBe(true);
    expect(sim.state.fuel).toBeCloseTo(60, 0);
    run(sim, 2, BOOSTING, ev);
    expect(sim.state.fuel).toBe(0);
    expect(sim.state.boosting).toBe(false);
    expect(ev.filter((e) => e.type === 'fuelEmpty')).toHaveLength(1);
    // Vide, le bouton ne relance rien.
    sim.state.energy = 100;
    run(sim, 0.5, BOOSTING, ev);
    expect(sim.state.boosting).toBe(false);
    expect(ev.filter((e) => e.type === 'fuelEmpty')).toHaveLength(1);
  });

  it('leaves the cruise alone when dry, unless the dry factor says otherwise', () => {
    const sim = fresh();
    sim.state.dist = 20000;
    sim.state.fuel = 0;
    // La vitesse converge à speedGain = 0,42/s : quinze secondes pour l'atteindre.
    run(sim, 15);
    expect(sim.state.speed).toBeCloseTo(sim.tuning.speedMax, 0);

    sim.tuning.fuelDryFactor = 0.8;
    run(sim, 15);
    expect(sim.state.speed).toBeCloseTo(sim.tuning.speedMax * 0.8, 0);
  });

  it('is refilled by a can, capped at 100, and told how much it got', () => {
    const sim = fresh();
    sim.state.fuel = 90;
    dropCan(sim);
    sim.step(NEUTRAL, DT, false);
    const e = sim.events.find((x) => x.type === 'pickup' && x.kind === 'fuel');
    expect(e && e.type === 'pickup' && e.kind === 'fuel' ? e.gain : -1).toBeCloseTo(10, 6);
    expect(sim.state.fuel).toBe(100);
  });

  it('is refilled by the surge, which then burns nothing on easy and a little on hard', () => {
    const easy = fresh('fuel', 'easy');
    easy.state.fuel = 20;
    easy.state.superT = easy.tuning.supTime;
    easy.state.climb = easy.tuning.climbSurge; // le pas suivant ouvre le surge
    easy.tuning.climbSurge = 1;
    easy.state.drift = true;
    easy.state.yaw = 0.5;
    easy.state.latVel = -30;
    easy.step(NEUTRAL, DT, false);
    expect(easy.events.some((e) => e.type === 'surgeStart')).toBe(true);
    expect(easy.state.fuel).toBe(100);
    run(easy, 2);
    expect(easy.state.fuel).toBe(100);

    const hard = fresh('fuel', 'hard');
    hard.state.surgeT = hard.tuning.surgeTime;
    hard.state.fuel = 100;
    run(hard, 2);
    expect(hard.state.fuel).toBeCloseTo(100 - hard.tuning.fuelSurge * 2, 1);
  });

  it('lets a found super boost run on an empty tank', () => {
    const sim = fresh();
    sim.state.fuel = 0;
    sim.state.superT = sim.tuning.supTime;
    run(sim, 1);
    expect(sim.state.superT).toBeGreaterThan(0);
    expect(sim.state.boosting).toBe(true);
  });

  it('never burns in the attract loop', () => {
    const sim = fresh('fuel', 'hard');
    for (let i = 0; i < 720; i++) sim.step(NEUTRAL, DT, true);
    expect(sim.state.fuel).toBe(100);
  });
});
