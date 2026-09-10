/**
 * La chaîne de drift et le G-SURGE.
 *
 * Rien ici n'est couvert par les références figées : `chain` et `surgeT` ne
 * sont pas dans la trace, et aucune de ses trois exécutions ne dérive — ce que
 * `sim-parity` vérifie explicitement depuis l'ajout de cet état. C'est donc le
 * seul filet de cette mécanique.
 */
import { describe, expect, it } from 'vitest';
import { HALF, Sim } from '../src/sim/index.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };

/**
 * Tient un drift sans passer par le pilotage, qui n'est pas le sujet.
 *
 * On force la *cause* et non le drapeau : `step()` recalcule `drift` à chaque
 * pas depuis l'écart entre la vitesse latérale que le nez réclame et celle que
 * les appuis encaissent, donc lever `state.drift` à la main ne survit pas au
 * pas suivant. Ici le nez pointe loin et la trajectoire ne suit pas, ce qui est
 * la définition d'un drift.
 */
function holdDrift(sim: Sim, seconds: number, attract = false): number {
  let fires = 0;
  for (let i = 0; i < seconds * 720; i++) {
    sim.state.yaw = 0.5;
    sim.state.latVel = -30;
    sim.state.lat = 0;
    sim.step(NEUTRAL, DT, attract);
    for (const e of sim.events) if (e.type === 'surgeStart') fires++;
  }
  return fires;
}

describe('the drift chain', () => {
  it('accumulates while drifting and drains when it stops', () => {
    const sim = new Sim({ seed: 'chain' });
    sim.reset('chain');
    sim.tuning.surgeHold = 99; // hors de portée : on observe la chaîne seule

    holdDrift(sim, 0.5);
    // La prémisse de l'aide, rendue explicite : le pas a bien décroché.
    expect(sim.state.drift).toBe(true);
    expect(sim.state.chain).toBeCloseTo(0.5, 2);

    const held = sim.state.chain;
    for (let i = 0; i < 720; i++) {
      sim.state.yaw = 0;
      sim.state.latVel = 0;
      sim.step(NEUTRAL, DT, false);
    }
    expect(sim.state.chain).toBeCloseTo(held - sim.tuning.chainDecay, 2);
  });

  it('is cut by a wall, because it rewards cleanliness and not persistence', () => {
    const sim = new Sim({ seed: 'chain' });
    sim.reset('chain');
    sim.tuning.surgeHold = 99;
    holdDrift(sim, 0.5);
    expect(sim.state.chain).toBeGreaterThan(0.4);

    sim.state.lat = HALF; // contre la paroi
    sim.state.latVel = 8;
    sim.step(NEUTRAL, DT, false);
    expect(sim.state.chain).toBe(0);
  });

  it('never accumulates in the attract loop', () => {
    const sim = new Sim({ seed: 'chain' });
    sim.reset('chain');
    holdDrift(sim, 3, true);
    expect(sim.state.drift).toBe(true);
    expect(sim.state.chain).toBe(0);
    expect(sim.state.surgeT).toBe(0);
  });
});

describe('the surge', () => {
  it('fires once when the chain lands, and empties it', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    let fires = 0;
    let chainAtFire = -1;

    for (let i = 0; i < (sim.tuning.surgeHold + 0.2) * 720; i++) {
      sim.state.yaw = 0.5;
      sim.state.latVel = -30;
      sim.state.lat = 0;
      sim.step(NEUTRAL, DT, false);
      for (const e of sim.events) {
        if (e.type === 'surgeStart') {
          fires++;
          // Relevé à l'instant du déclenchement : le drift continue derrière,
          // donc la chaîne se remet aussitôt à monter. La vider est un fait du
          // pas où elle aboutit, pas un état durable.
          chainAtFire = sim.state.chain;
        }
      }
    }

    expect(fires).toBe(1);
    expect(chainAtFire).toBe(0);
    expect(sim.state.surgeT).toBeGreaterThan(0);
  });

  it('cannot re-enter while it is running, however long the drift is held', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    // Bien plus long que le seuil : sans le verrou, il repartirait en boucle.
    const fires = holdDrift(sim, sim.tuning.surgeTime - 0.5);
    expect(fires).toBe(1);
  });

  it('ends once, at the step where its counter reaches zero', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    sim.state.surgeT = sim.tuning.surgeTime;
    sim.tuning.surgeHold = 99;

    let ends = 0;
    for (let i = 0; i < (sim.tuning.surgeTime + 1) * 720; i++) {
      sim.step(NEUTRAL, DT, false);
      for (const e of sim.events) if (e.type === 'surgeEnd') ends++;
    }
    expect(ends).toBe(1);
    expect(sim.state.surgeT).toBe(0);
  });

  it('spends no reserve while it lasts', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    sim.state.surgeT = sim.tuning.surgeTime;
    sim.state.energy = 60;
    for (let i = 0; i < 720; i++) sim.step({ steer: 0, brake: false, boost: true }, DT, false);
    expect(sim.state.energy).toBe(60);
  });
});
