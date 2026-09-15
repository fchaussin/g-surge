/**
 * Le Perfect Drift : l'enchaînement de drifts propres.
 *
 * Rien ici n'atteint une référence figée — les traces ne contiennent aucun
 * drift, `sim-parity` l'affirme — donc ce fichier est le seul filet du combo.
 * Comme pour la montée, on force la cause d'un drift et non le drapeau :
 * `step()` recalcule `drift` à chaque pas.
 */
import { describe, expect, it } from 'vitest';
import { Sim, type SimEvent } from '../src/sim/index.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };

function fresh(seed = 'combo'): Sim {
  const sim = new Sim({ seed });
  sim.reset(seed);
  sim.tuning.climbSup = 1e9;
  sim.tuning.climbSurge = 1e9;
  return sim;
}

/** Tient un drift `seconds` secondes puis le lâche, en collectant les événements. */
function drift(sim: Sim, seconds: number, out: SimEvent[]): void {
  for (let i = 0; i < seconds * 720; i++) {
    sim.state.yaw = 0.5;
    sim.state.latVel = -30;
    sim.state.lat = 0;
    sim.step(NEUTRAL, DT, false);
    out.push(...sim.events);
  }
}

/** Roule droit `seconds` secondes : le drift retombe au premier pas. */
function straight(sim: Sim, seconds: number, out: SimEvent[]): void {
  for (let i = 0; i < seconds * 720; i++) {
    sim.state.yaw = 0;
    sim.state.latVel = 0;
    sim.step(NEUTRAL, DT, false);
    out.push(...sim.events);
  }
}

const ups = (ev: SimEvent[]) =>
  ev.filter((e) => e.type === 'comboUp') as Extract<SimEvent, { type: 'comboUp' }>[];
const ends = (ev: SimEvent[]) =>
  ev.filter((e) => e.type === 'comboEnd') as Extract<SimEvent, { type: 'comboEnd' }>[];

describe('the perfect drift combo', () => {
  it('counts each drift long enough, pays nothing under the arm, then pays per level', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    const score0 = () => sim.state.score;
    // `comboUp` part à la sortie du drift, quand sa durée est connue : on lit
    // donc après le retour en ligne droite, pas après le drift.
    for (let n = 1; n <= 4; n++) {
      const before = score0();
      drift(sim, 0.4, ev);
      straight(sim, 0.5, ev);
      const paid = ups(ev).at(-1)!;
      expect(paid.count).toBe(n);
      if (n < sim.tuning.comboArm) expect(paid.bonus).toBe(0);
      else {
        expect(paid.bonus).toBeGreaterThan(0);
        // Les points versés sont dans le score, au-delà de ce que la vitesse rapporte.
        expect(sim.state.score - before).toBeGreaterThan(paid.bonus);
      }
    }
    expect(sim.state.combo).toBe(4);
    expect(ends(ev)).toHaveLength(0);
  });

  it('ignores a drift shorter than comboMinHeld, without breaking the chain', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    drift(sim, 0.4, ev);
    straight(sim, 0.3, ev);
    drift(sim, 0.1, ev); // trop court : ne compte pas
    straight(sim, 0.3, ev);
    drift(sim, 0.4, ev);
    straight(sim, 0.1, ev);
    expect(ups(ev).map((e) => e.count)).toEqual([1, 2]);
  });

  /**
   * La fenêtre expirée retire un barreau, elle ne tue plus l'enchaînement.
   * L'ancien comportement le perdait systématiquement : une ligne droite ne
   * laisse pas produire un drift qualifiant toutes les 1,5 s. Ce qui l'annule
   * d'un coup est le mur, et il a son propre test.
   */
  it('cashes an armed chain when the window runs out, and only erodes below the threshold', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    const cashed = (): Extract<SimEvent, { type: 'comboCashed' }>[] =>
      ev.filter((e): e is Extract<SimEvent, { type: 'comboCashed' }> => e.type === 'comboCashed');

    // Sous le seuil il n'y a rien à encaisser : l'amorce s'effrite, comme avant.
    drift(sim, 0.4, ev);
    straight(sim, sim.tuning.comboWindow + 0.1, ev);
    expect(sim.state.combo).toBe(0);
    expect(cashed()).toHaveLength(0);
    expect(ends(ev)).toHaveLength(0);

    for (let n = 0; n < 4; n++) {
      drift(sim, 0.4, ev);
      straight(sim, 0.3, ev);
    }
    expect(sim.state.combo).toBe(4);
    const before = sim.state.score;

    // **La fenêtre expire sur un combo armé : il se paie et se referme.** Il
    // n'y a plus d'effritement à ce niveau — le combo n'avait aucune fin
    // heureuse, il redescendait barreau par barreau jusqu'à `comboEnd`, si bien
    // que le seul message du mécanisme était celui de la perte.
    straight(sim, sim.tuning.comboWindow, ev);
    expect(sim.state.combo).toBe(0);
    expect(sim.state.comboLeft).toBe(0);
    expect(sim.state.score).toBeGreaterThan(before);
    expect(cashed().map((e) => e.count)).toEqual([4]);
    expect(cashed()[0]!.bonus).toBeGreaterThan(0);
    // Encaisser n'est pas perdre : `comboEnd` reste l'annulation par un mur.
    expect(ends(ev)).toHaveLength(0);

    // Et il ne se paie qu'une fois : rien ne reste à encaisser après.
    straight(sim, sim.tuning.comboWindow * 3, ev);
    expect(cashed()).toHaveLength(1);
  });

  it('vaut plus qu’un drift de plus, sinon rouler propre serait un mauvais calcul', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    for (let n = 0; n < 4; n++) {
      drift(sim, 0.4, ev);
      straight(sim, 0.3, ev);
    }
    const ups = ev.filter((e) => e.type === 'comboUp' && e.bonus > 0);
    const dernierDrift = (ups.at(-1) as { bonus: number }).bonus;
    straight(sim, sim.tuning.comboWindow, ev);
    const gain = (ev.find((e) => e.type === 'comboCashed') as { bonus: number }).bonus;
    expect(gain).toBeGreaterThan(dernierDrift * 2);
  });

  it('est démultiplié par les frôlements enchaînés pendant l’enchaînement', () => {
    const run = (chain: number): number => {
      const sim = fresh();
      const ev: SimEvent[] = [];
      for (let n = 0; n < 4; n++) {
        drift(sim, 0.4, ev);
        straight(sim, 0.3, ev);
      }
      // Posé plutôt que joué : produire des frôlements propres demande de raser
      // le mur sans le toucher, ce que ce fichier ne sait pas piloter.
      sim.state.nearChain = chain;
      straight(sim, sim.tuning.comboWindow, ev);
      return (ev.find((e) => e.type === 'comboCashed') as { bonus: number }).bonus;
    };
    expect(run(3)).toBeGreaterThan(run(0));
  });

  it('tightens the window as the combo grows', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    drift(sim, 0.4, ev);
    straight(sim, DT, ev);
    const first = sim.state.comboLeft;
    for (let n = 0; n < 9; n++) {
      straight(sim, 0.2, ev);
      drift(sim, 0.4, ev);
    }
    straight(sim, DT, ev);
    expect(sim.state.combo).toBe(10);
    expect(sim.state.comboLeft).toBeLessThan(first);
    // Un pas s'est écoulé depuis la sortie du drift : la fenêtre a déjà perdu DT.
    expect(sim.state.comboLeft).toBeCloseTo(sim.tuning.comboWindowMin - DT, 6);
  });

  it('is cut by a wall, and announces the loss from an armed level', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    for (let n = 0; n < 3; n++) {
      drift(sim, 0.4, ev);
      straight(sim, 0.2, ev);
    }
    expect(sim.state.combo).toBe(3);
    sim.state.lat = sim.tuning.half;
    sim.state.latVel = 8;
    sim.step(NEUTRAL, DT, false);
    expect(sim.state.combo).toBe(0);
    expect(sim.events.map((e) => e.type)).toContain('comboEnd');
  });

  it('speeds the climb once armed, and caps the gain', () => {
    const sim = fresh();
    sim.tuning.climbSup = 1e9;
    const ev: SimEvent[] = [];
    // Un pas de drift en boost, combo nul, puis le même pas avec un combo haut.
    // Même vitesse et même distance à chaque fois : `d` dépend des deux, et
    // c'est le rapport des montées qu'on mesure, pas la rampe.
    const climbStep = (combo: number) => {
      sim.state.combo = combo;
      sim.state.comboLeft = 1;
      sim.state.climb = 0;
      sim.state.energy = 100;
      sim.state.speed = 200;
      sim.state.dist = 5000;
      sim.state.yaw = 0.5;
      sim.state.latVel = -30;
      sim.state.lat = 0;
      sim.state.drift = true;
      sim.step({ steer: 0, brake: false, boost: true }, DT, false);
      ev.push(...sim.events);
      return sim.state.climb;
    };
    const plain = climbStep(0);
    const armed = climbStep(sim.tuning.comboArm);
    const high = climbStep(50);
    expect(plain).toBeGreaterThan(0);
    expect(armed).toBeCloseTo(plain * (1 + sim.tuning.comboClimb), 6);
    expect(high).toBeCloseTo(plain * (1 + sim.tuning.comboClimbMax), 6);
  });

  it('never counts in the attract loop', () => {
    const sim = fresh();
    for (let i = 0; i < 720; i++) {
      sim.state.yaw = 0.5;
      sim.state.latVel = -30;
      sim.state.lat = 0;
      sim.step(NEUTRAL, DT, true);
    }
    for (let i = 0; i < 100; i++) {
      sim.state.yaw = 0;
      sim.state.latVel = 0;
      sim.step(NEUTRAL, DT, true);
    }
    expect(sim.state.combo).toBe(0);
  });
});
