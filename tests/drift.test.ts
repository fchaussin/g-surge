/**
 * L'échelle partagée de la dérive, et l'enveloppe de la gerbe.
 *
 * `state.slip` est en m/s, pas en radians : chaque effet qui en tire une
 * intensité doit choisir un plafond, et deux plafonds différents se
 * contrediraient à l'écran. Ce fichier fixe le plafond unique et la contrainte
 * géométrique que la gerbe ne doit pas franchir.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, createState, tuningFor } from '../src/sim/index.js';
import { SLIP_CEILING, driftIntensity, driftSide } from '../src/client/drift.js';
import { REACH } from '../src/client/drift-spray.js';

const state = () => createState(tuningFor('medium'));

describe('drift intensity', () => {
  it('is nothing at all when the ship is not drifting', () => {
    const s = state();
    s.drift = false;
    s.slip = 999;
    expect(driftIntensity(s)).toBe(0);
    expect(driftSide(s)).toBe(0);
  });

  it('runs from zero to one, and saturates rather than overshooting', () => {
    const s = state();
    s.drift = true;
    s.slip = 0;
    expect(driftIntensity(s)).toBe(0);
    s.slip = SLIP_CEILING / 2;
    expect(driftIntensity(s)).toBeCloseTo(0.5, 6);
    s.slip = SLIP_CEILING;
    expect(driftIntensity(s)).toBe(1);
    s.slip = SLIP_CEILING * 40;
    expect(driftIntensity(s)).toBe(1);
    s.slip = -SLIP_CEILING * 40;
    expect(driftIntensity(s)).toBe(1);
  });

  it('throws the spray away from the nose, which was measured and not deduced', () => {
    // Manche à fond vers la gauche : yaw +0,397, latVel −4,69, slip +23,72.
    // Le nez pointe à gauche, la trajectoire part à droite.
    const s = state();
    s.drift = true;
    s.slip = 23.72;
    expect(driftSide(s)).toBe(-1);
    s.slip = -23.72;
    expect(driftSide(s)).toBe(1);
  });

  it('is already two thirds of the way up the scale the moment grip breaks', () => {
    // Le décrochage a lieu à gripLimit / gripHold. Si un réglage rendait ce
    // seuil supérieur au plafond, toute la plage utile serait à fond.
    const T = tuningFor('medium');
    const entry = T.gripLimit / T.gripHold;
    expect(entry).toBeLessThan(SLIP_CEILING);
    expect(entry / SLIP_CEILING).toBeGreaterThan(0.5);
  });
});

describe('drift spray envelope', () => {
  it('never reaches the camera', () => {
    // Une particule lâchée dans le monde croise la caméra 19 m derrière le
    // vaisseau et remplit l'écran. La gerbe est parentée, donc elle ne peut pas
    // la croiser, mais sa profondeur doit rester franchement en deçà : c'est
    // cette marge qu'allonger la durée de vie mangerait en silence.
    expect(REACH).toBeLessThan(DEFAULTS.camDist - 3);
  });

  it('stays inside the smoke trail it sits beside', () => {
    // La fumée va jusqu'à 13,6 m — 2,6 de décalage plus 11 de longueur. Deux
    // effets voisins qui ne s'accordent pas sur la longueur du vaisseau se
    // contredisent à l'écran.
    expect(REACH).toBeLessThanOrEqual(13.6);
  });
});
