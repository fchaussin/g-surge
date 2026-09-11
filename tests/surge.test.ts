/**
 * La montée et le G-SURGE.
 *
 * Rien ici n'est couvert par les références figées : `climb`, `superT` et
 * `surgeT` ne sont pas dans la trace, et aucune de ses trois exécutions ne
 * dérive — ce que `sim-parity` vérifie explicitement depuis l'ajout de cet
 * état. C'est donc le seul filet de cette mécanique.
 */
import { describe, expect, it } from 'vitest';
import { BACK, HALF, ITEM_SUP, Sim } from '../src/sim/index.js';
import { SurgeMeter } from '../src/client/surge.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };
const BOOSTING = { steer: 0, brake: false, boost: true };

/**
 * Tient un drift sans passer par le pilotage, qui n'est pas le sujet.
 *
 * On force la *cause* et non le drapeau : `step()` recalcule `drift` à chaque
 * pas depuis l'écart entre la vitesse latérale que le nez réclame et celle que
 * les appuis encaissent, donc lever `state.drift` à la main ne survit pas au
 * pas suivant. Ici le nez pointe loin et la trajectoire ne suit pas, ce qui est
 * la définition d'un drift.
 *
 * `boost` tient le bouton ; `sup` maintient un super boost en cours.
 */
function holdDrift(
  sim: Sim,
  seconds: number,
  opts: { attract?: boolean; sup?: boolean; boost?: boolean } = {},
): { surges: number; supers: number } {
  const attract = opts.attract ?? false;
  const fired = { surges: 0, supers: 0 };
  for (let i = 0; i < seconds * 720; i++) {
    if (opts.sup) sim.state.superT = sim.tuning.supTime;
    sim.state.yaw = 0.5;
    sim.state.latVel = -30;
    sim.state.lat = 0;
    sim.step(opts.boost ? BOOSTING : NEUTRAL, DT, attract);
    for (const e of sim.events) {
      if (e.type === 'surgeStart') fired.surges++;
      if (e.type === 'supEarned') fired.supers++;
    }
  }
  return fired;
}

/** Une simulation dont aucun barreau n'est atteignable : on observe la montée seule. */
function unreachable(seed: string): Sim {
  const sim = new Sim({ seed });
  sim.reset(seed);
  sim.tuning.climbSup = 1e9;
  sim.tuning.climbSurge = 1e9;
  return sim;
}

describe('the climb', () => {
  it('counts the metres drifted under boost, and drains when the drift stops', () => {
    const sim = unreachable('climb');

    holdDrift(sim, 1, { boost: true });
    // La prémisse de l'aide, rendue explicite : le pas a bien décroché.
    expect(sim.state.drift).toBe(true);
    expect(sim.state.boosting).toBe(true);
    // Drift et boost dès le premier pas : la montée est la distance parcourue.
    expect(sim.state.climb).toBeCloseTo(sim.state.dist, 6);
    expect(sim.state.climb).toBeGreaterThan(60);

    // Un quart de seconde hors drift : assez pour mesurer la pente, pas assez
    // pour toucher le fond — à la vitesse de départ, une seconde de drift ne
    // fait que 80 m et la descente en efface 100 par seconde.
    const held = sim.state.climb;
    for (let i = 0; i < 180; i++) {
      sim.state.yaw = 0;
      sim.state.latVel = 0;
      sim.step(NEUTRAL, DT, false);
    }
    expect(sim.state.climb).toBeCloseTo(held - sim.tuning.climbDecay * 0.25, 3);
  });

  it('does not climb at cruise: the ladder is taken rung by rung', () => {
    const sim = unreachable('climb');
    holdDrift(sim, 1);
    expect(sim.state.drift).toBe(true);
    expect(sim.state.boosting).toBe(false);
    expect(sim.state.climb).toBe(0);
  });

  it('is cut by a wall, because it rewards cleanliness and not persistence', () => {
    const sim = unreachable('climb');
    holdDrift(sim, 0.5, { boost: true });
    expect(sim.state.climb).toBeGreaterThan(30);

    sim.state.lat = HALF; // contre la paroi
    sim.state.latVel = 8;
    sim.step(BOOSTING, DT, false);
    expect(sim.state.climb).toBe(0);
  });

  it('never accumulates in the attract loop', () => {
    const sim = unreachable('climb');
    holdDrift(sim, 3, { attract: true, sup: true, boost: true });
    expect(sim.state.drift).toBe(true);
    expect(sim.state.climb).toBe(0);
    expect(sim.state.surgeT).toBe(0);
  });
});

describe('earning the super boost', () => {
  it('fires once when the climb lands under boost, refills the reserve, and empties the climb', () => {
    const sim = new Sim({ seed: 'earn' });
    sim.reset('earn');
    sim.state.energy = 60;
    let fires = 0;
    let climbAtFire = -1;
    let energyAtFire = -1;

    // Bien plus que nécessaire : sans le verrou du barreau, il repartirait.
    for (let i = 0; i < 12 * 720 && sim.state.superT === 0; i++) {
      sim.state.yaw = 0.5;
      sim.state.latVel = -30;
      sim.state.lat = 0;
      sim.step(BOOSTING, DT, false);
      for (const e of sim.events) {
        if (e.type === 'supEarned') {
          fires++;
          climbAtFire = sim.state.climb;
          energyAtFire = sim.state.energy;
        }
      }
    }

    expect(fires).toBe(1);
    expect(climbAtFire).toBe(0);
    expect(energyAtFire).toBe(100);
    expect(sim.state.superT).toBeCloseTo(sim.tuning.supTime, 2);
  });

  it('is the only thing a climb at rung one can open: never a surge', () => {
    const sim = new Sim({ seed: 'earn' });
    sim.reset('earn');
    sim.tuning.climbSup = 1e9; // le super boost hors de portée, la montée monte
    // Huit secondes : la rampe de vitesse part de 70 m/s, il en faut autant
    // pour dépasser ce que le G-SURGE demanderait, et le montrer inatteint.
    const fired = holdDrift(sim, 8, { boost: true });
    expect(fired.supers).toBe(0);
    expect(fired.surges).toBe(0);
    expect(sim.state.climb).toBeGreaterThan(sim.tuning.climbSurge);
  });
});

describe('the surge', () => {
  it('fires once when the climb lands under a super boost, and empties it', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    let fires = 0;
    let climbAtFire = -1;

    // Jusqu'au déclenchement, avec une marge large : l'état dure cinq secondes
    // et continuer au-delà le verrait finir avant qu'on le lise.
    let climbBefore = 0;
    for (let i = 0; i < 8 * 720 && fires === 0; i++) {
      sim.state.superT = sim.tuning.supTime;
      sim.state.yaw = 0.5;
      sim.state.latVel = -30;
      sim.state.lat = 0;
      climbBefore = sim.state.climb;
      sim.step(NEUTRAL, DT, false);
      for (const e of sim.events) {
        if (e.type === 'surgeStart') {
          fires++;
          // Relevé à l'instant du déclenchement : le drift continue derrière,
          // mais au sommet la montée ne compte plus. La vider est un fait du
          // pas où elle aboutit.
          climbAtFire = sim.state.climb;
        }
      }
    }

    expect(fires).toBe(1);
    expect(climbAtFire).toBe(0);
    // Le pas précédent était encore sous le seuil : c'est bien la montée qui a ouvert.
    expect(climbBefore).toBeLessThan(sim.tuning.climbSurge);
    expect(climbBefore).toBeGreaterThan(sim.tuning.climbSurge * 0.9);
    expect(sim.state.surgeT).toBeCloseTo(sim.tuning.surgeTime, 2);
  });

  it('cannot re-enter while it is running, however long the drift is held', () => {
    const sim = new Sim({ seed: 'surge' });
    sim.reset('surge');
    sim.tuning.climbSurge = 1; // atteint au premier pas de drift
    // Bien plus long que le seuil : sans le verrou, il repartirait en boucle.
    const fired = holdDrift(sim, sim.tuning.surgeTime - 0.5, { sup: true });
    expect(fired.surges).toBe(1);
    expect(sim.state.climb).toBe(0);
  });

  it('ends once, at the step where its counter reaches zero', () => {
    const sim = unreachable('surge');
    sim.state.surgeT = sim.tuning.surgeTime;

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
    for (let i = 0; i < 720; i++) sim.step(BOOSTING, DT, false);
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
    sim.state.climb = 0; // aucune montée : le doublé se suffit à lui-même
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
