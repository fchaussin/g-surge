/**
 * La jauge est l'échelle, et c'est la seule lecture que le joueur en a.
 *
 * Rien de ceci n'atteint une référence figée : les traces ne contiennent ni
 * drift ni super boost, et la capture du HUD est prise avant qu'un barreau
 * bouge. Un calcul de couche faux ne serait donc vu par aucun autre test.
 */
import { describe, expect, it } from 'vitest';
import { driftFill, Sim } from '../src/sim/index.js';
import { createLayers, ladderLayers } from '../src/client/ladder.js';

function fresh(seed = 'ladder') {
  const sim = new Sim({ seed });
  sim.reset(seed);
  return sim;
}

describe('the ladder layers', () => {
  it('show the reserve alone at cruise, nothing above it', () => {
    const sim = fresh();
    sim.state.energy = 64;
    const L = ladderLayers(sim.state, sim.tuning, createLayers());
    expect(L).toMatchObject({ l1: 64, l2: 0, l3: 0, up: 0, sup: false, surging: false });
  });

  it('raise the reserve when drifting at cruise, and the white layer when drifting under boost', () => {
    const sim = fresh();
    sim.state.drift = true;
    let L = ladderLayers(sim.state, sim.tuning, createLayers());
    expect(L.up).toBe(1);

    sim.state.boosting = true;
    sim.state.climb = sim.tuning.climbSup / 4;
    L = ladderLayers(sim.state, sim.tuning, L);
    expect(L.up).toBe(2);
    expect(L.l2).toBe(25);
  });

  it('pin the reserve under a super boost, count the super boost down in white, and climb the surge in warm white', () => {
    const sim = fresh();
    sim.state.energy = 37; // épinglée à 100 par l'affichage, quoi qu'il en soit
    sim.state.superT = sim.tuning.supTime / 2;
    sim.state.climb = sim.tuning.climbSurge * 0.6;
    sim.state.drift = true;
    const L = ladderLayers(sim.state, sim.tuning, createLayers());
    expect(L.l1).toBe(100);
    expect(L.l2).toBe(50);
    expect(L.l3).toBe(60);
    expect(L.up).toBe(3);
    expect(L.sup).toBe(true);
  });

  it('count the surge down on top of a full stack, with nothing left to climb', () => {
    const sim = fresh();
    sim.state.surgeT = sim.tuning.surgeTime * 0.3;
    sim.state.drift = true;
    sim.state.climb = 99999; // au sommet, la montée ne compte plus
    const L = ladderLayers(sim.state, sim.tuning, createLayers());
    expect(L).toMatchObject({ l1: 100, l2: 100, l3: 30, up: 0, surging: true });
  });

  it('never exceed 100, however long a second pickup made the state', () => {
    const sim = fresh();
    sim.state.surgeT = sim.tuning.surgeTime * 2;
    expect(ladderLayers(sim.state, sim.tuning, createLayers()).l3).toBe(100);
    sim.state.surgeT = 0;
    sim.state.superT = sim.tuning.supTime * 1.5;
    expect(ladderLayers(sim.state, sim.tuning, createLayers()).l2).toBe(100);
  });

  it('write into the object they are given, and allocate nothing', () => {
    const sim = fresh();
    const out = createLayers();
    expect(ladderLayers(sim.state, sim.tuning, out)).toBe(out);
  });
});

describe('what the drift fills', () => {
  it('is the reserve at cruise, the climb in thrust, and full at the top', () => {
    const sim = fresh();
    sim.state.energy = 40;
    expect(driftFill(sim.state, sim.tuning)).toBeCloseTo(0.4, 9);

    sim.state.boosting = true;
    sim.state.climb = sim.tuning.climbSup * 0.25;
    expect(driftFill(sim.state, sim.tuning)).toBeCloseTo(0.25, 9);

    sim.state.superT = 1;
    sim.state.climb = sim.tuning.climbSurge * 0.5;
    expect(driftFill(sim.state, sim.tuning)).toBeCloseTo(0.5, 9);

    sim.state.surgeT = 1;
    expect(driftFill(sim.state, sim.tuning)).toBe(1);
  });

  it('never exceeds one', () => {
    const sim = fresh();
    sim.state.boosting = true;
    sim.state.climb = sim.tuning.climbSup * 3;
    expect(driftFill(sim.state, sim.tuning)).toBe(1);
  });
});
