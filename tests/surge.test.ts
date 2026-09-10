/**
 * La chaîne de drift et le G-SURGE.
 *
 * Rien ici n'est couvert par les références figées : `chain` et `surgeT` ne
 * sont pas dans la trace, et aucune de ses trois exécutions ne dérive — ce que
 * `sim-parity` vérifie explicitement depuis l'ajout de cet état. C'est donc le
 * seul filet de cette mécanique.
 */
import { describe, expect, it } from 'vitest';
import { BACK, HALF, ITEM_SUP, Sim } from '../src/sim/index.js';
import { SurgeMeter } from '../src/client/surge.js';

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
function holdDrift(
  sim: Sim,
  seconds: number,
  opts: { attract?: boolean; sup?: boolean } = {},
): number {
  const attract = opts.attract ?? false;
  let fires = 0;
  for (let i = 0; i < seconds * 720; i++) {
    if (opts.sup) sim.state.superT = sim.tuning.supTime;
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
    holdDrift(sim, 3, { attract: true, sup: true });
    expect(sim.state.drift).toBe(true);
    expect(sim.state.chain).toBe(0);
    expect(sim.state.surgeT).toBe(0);
  });
});

describe('the surge', () => {
  it('does not fire on the chain alone, however long the drift is held', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    // Dix fois le seuil, sans super boost : la porte est le ramassage, et la
    // chaîne ne dit que « bien conduit », pas « maintenant ».
    const fires = holdDrift(sim, sim.tuning.surgeHold * 10);
    expect(fires).toBe(0);
    expect(sim.state.chain).toBeGreaterThan(sim.tuning.surgeHold);
  });

  it('fires once when the chain lands under a super boost, and empties it', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    let fires = 0;
    let chainAtFire = -1;

    for (let i = 0; i < (sim.tuning.surgeHold + 0.2) * 720; i++) {
      sim.state.superT = sim.tuning.supTime;
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
    const fires = holdDrift(sim, sim.tuning.surgeTime - 0.5, { sup: true });
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

describe('a second super boost', () => {
  /**
   * Pose un super boost juste sous le vaisseau, prêt à être ramassé au pas
   * suivant. `nid[0] + BACK` est l'identifiant que le curseur vient de
   * dépasser, ce qui est exactement la condition testée par `step`.
   */
  function dropSup(sim: Sim): void {
    sim.state.lat = 0;
    sim.track.items.push({
      id: sim.track.nid[0]! + BACK,
      lat: 0,
      type: ITEM_SUP,
      done: false,
      taken: false,
    });
  }

  it('escalates straight to the surge when one is already running', () => {
    const sim = new Sim({ seed: 'double' });
    sim.reset('double');
    sim.state.superT = sim.tuning.supTime;
    sim.state.chain = 0; // aucune chaîne : le doublé se suffit à lui-même
    dropSup(sim);

    sim.step(NEUTRAL, DT, false);

    expect(sim.events.map((e) => e.type)).toContain('surgeStart');
    expect(sim.state.surgeT).toBeCloseTo(sim.tuning.surgeTime, 2);
  });

  it('extends the surge instead of restarting it, and stops at twice its length', () => {
    const sim = new Sim({ seed: 'double' });
    sim.reset('double');
    sim.state.surgeT = 1;

    dropSup(sim);
    sim.step(NEUTRAL, DT, false);
    expect(sim.state.surgeT).toBeCloseTo(1 + sim.tuning.surgeTime - DT, 2);
    // Un second déclenchement serait faux : l'état tourne déjà.
    expect(sim.events.map((e) => e.type)).not.toContain('surgeStart');

    dropSup(sim);
    sim.step(NEUTRAL, DT, false);
    dropSup(sim);
    sim.step(NEUTRAL, DT, false);
    expect(sim.state.surgeT).toBeLessThanOrEqual(sim.tuning.surgeTime * 2);
  });

  it('is an ordinary super boost when nothing is running', () => {
    const sim = new Sim({ seed: 'double' });
    sim.reset('double');
    dropSup(sim);

    sim.step(NEUTRAL, DT, false);

    expect(sim.state.superT).toBeCloseTo(sim.tuning.supTime, 2);
    expect(sim.state.surgeT).toBe(0);
    expect(sim.events.map((e) => e.type)).not.toContain('surgeStart');
  });
});

describe('the surge meter', () => {
  const top = (sim: Sim) => sim.tuning.speedMax * sim.tuning.boostFactor * sim.tuning.supFactor;

  /** Avance le compteur d'une seconde dans l'état donné. */
  function run(meter: SurgeMeter, sim: Sim, seconds: number): void {
    for (let i = 0; i < seconds * 60; i++) meter.update(1 / 60, sim.state, sim.tuning);
  }

  it('climbs while the state runs clean, and saturates', () => {
    const sim = new Sim({ seed: 'meter' });
    sim.reset('meter');
    sim.state.surgeT = 99;
    sim.state.speed = top(sim);
    const meter = new SurgeMeter();

    run(meter, sim, 1);
    expect(meter.value).toBeGreaterThan(0.3);
    expect(meter.value).toBeLessThan(0.6);

    run(meter, sim, 5);
    expect(meter.value).toBe(1);
  });

  it('drops fast against a wall, which is the whole point of it', () => {
    const sim = new Sim({ seed: 'meter' });
    sim.reset('meter');
    sim.state.surgeT = 99;
    sim.state.speed = top(sim);
    const meter = new SurgeMeter();
    run(meter, sim, 5);
    expect(meter.value).toBe(1);

    sim.state.contact = true;
    run(meter, sim, 0.25);
    expect(meter.value).toBeLessThan(0.6);
    run(meter, sim, 1);
    expect(meter.value).toBe(0);
  });

  it('stops climbing when the speed falls away, braking included', () => {
    const sim = new Sim({ seed: 'meter' });
    sim.reset('meter');
    sim.state.surgeT = 99;
    sim.state.speed = top(sim) * 0.8;
    const meter = new SurgeMeter();

    run(meter, sim, 3);
    expect(meter.value).toBe(0);
  });

  it('is empty outside the state, and after a reset', () => {
    const sim = new Sim({ seed: 'meter' });
    sim.reset('meter');
    sim.state.surgeT = 99;
    sim.state.speed = top(sim);
    const meter = new SurgeMeter();
    run(meter, sim, 5);

    sim.state.surgeT = 0;
    run(meter, sim, 2);
    expect(meter.value).toBe(0);

    sim.state.surgeT = 99;
    run(meter, sim, 1);
    expect(meter.value).toBeGreaterThan(0);
    meter.reset();
    expect(meter.value).toBe(0);
  });
});
