/**
 * L'échelle des vitesses, que les références figées ne touchent pas.
 *
 * Les traces de `sim-parity` couvrent 1 345 m et un super boost apparaît tous
 * les 6 300 m : la branche `superOn` de `step()` n'est donc rejouée par aucune
 * référence, et `supFactor` pourrait changer sans qu'une seule ne bouge. C'est
 * exactement ce qui s'est passé quand il est passé de 1,08 à 1,22.
 */
import { describe, expect, it } from 'vitest';
import { Sim, tuningFor } from '../src/sim/index.js';
import { ENGINE_R_MAX } from '../src/client/audio.js';

const DT = 1 / 720;

/** Vitesse d'équilibre, rampe au maximum et coque intacte. */
function settle(opts: { boost: boolean; superBoost?: boolean; surge?: boolean }): number {
  const sim = new Sim({ seed: 'ladder', difficulty: 'easy' });
  sim.reset('ladder');
  const T = sim.tuning;
  sim.state.dist = T.speedRamp * 2;

  for (let i = 0; i < 720 * 20; i++) {
    // Reconduit à chaque pas : la question est la vitesse d'équilibre du
    // palier, pas la durée pendant laquelle il tient.
    // Le palier est imposé, pas subi : sans cette ligne le vaisseau ramasse un
    // super boost en chemin — il roule au centre — et le palier « croisière »
    // mesurait 313 m/s au lieu de 258.
    sim.state.superT = opts.superBoost ? T.supTime : 0;
    sim.state.surgeT = opts.surge ? T.surgeTime : 0;
    // Et la réserve est reconduite, sinon le boost s'éteint au bout de quatre
    // secondes et la mesure retombe sur la croisière.
    sim.state.energy = 100;
    sim.state.hull = 100;
    sim.state.dist = T.speedRamp * 2;
    // Le modèle latéral est écarté délibérément. Manche au neutre, la
    // centrifuge plaque le vaisseau contre un mur et `wallPenalty` le fige à
    // 42 m/s — ce qui est juste, et n'a rien à voir avec le palier mesuré ici.
    sim.state.lat = 0;
    sim.state.latVel = 0;
    sim.step({ steer: 0, brake: false, boost: opts.boost }, DT, false);
  }
  return sim.state.speed;
}

describe('the speed ladder', () => {
  const T = tuningFor('easy');

  it('cruises at speedMax once the ramp is done', () => {
    expect(settle({ boost: false, superBoost: false })).toBeCloseTo(T.speedMax, 1);
  });

  it('boosts to speedMax × boostFactor', () => {
    expect(settle({ boost: true, superBoost: false })).toBeCloseTo(T.speedMax * T.boostFactor, 1);
  });

  it('super boosts one step further, and the step is worth taking', () => {
    const boost = T.speedMax * T.boostFactor;
    const sup = settle({ boost: false, superBoost: true });
    expect(sup).toBeCloseTo(boost * T.supFactor, 1);

    // La marche du haut doit rester comparable à celle du bas, sinon le palier
    // 3 promet une catapulte que la physique ne paie pas — c'est la §15 de la
    // palette, et c'est ce que l'étape 5 a tranché.
    const lower = boost - T.speedMax;
    const upper = sup - boost;
    expect(upper / lower).toBeGreaterThan(0.6);
  });

  it("surges at the super boost's speed and not past it", () => {
    // Le quatrième palier ne gagne aucune vitesse : il ne reste que 7 % sous le
    // plafond auquel audio.ts borne le moteur, et la §15 de la palette veut une
    // perception altérée plutôt qu'une accélération. Ce test est ce qui empêche
    // quelqu'un de « juste un peu » l'augmenter.
    const sup = settle({ boost: false, superBoost: true });
    const surge = settle({ boost: false, surge: true });
    expect(surge).toBeCloseTo(sup, 6);
    expect(T.boostFactor * T.supFactor).toBeLessThan(ENGINE_R_MAX);
  });

  it('does not need the reserve while it lasts', () => {
    const sim = new Sim({ seed: 'ladder' });
    sim.reset('ladder');
    sim.state.superT = sim.tuning.supTime;
    sim.state.energy = 100;
    for (let i = 0; i < 720; i++) sim.step({ steer: 0, brake: false, boost: true }, DT, false);
    expect(sim.state.energy).toBe(100);
  });

  it('stays under the ceiling the engine sound is clamped to', () => {
    // audio.ts borne `speed / speedMax` à ENGINE_R_MAX. Au-delà, toutes les
    // couches du moteur cessent de bouger pendant que le vaisseau accélère
    // encore : le palier le plus haut sonnerait comme le précédent.
    expect(T.boostFactor * T.supFactor).toBeLessThan(ENGINE_R_MAX);
  });
});
