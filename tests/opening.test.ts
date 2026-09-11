/**
 * L'ouverture d'une piste : droite et plate devant le vaisseau sur
 * `openingStraight` mètres, des virages ensuite, et aucune vrille avant
 * `rollFrom`. Une piste qui s'apprend avant de se retourner.
 */
import { describe, expect, it } from 'vitest';
import { BACK, SEG, Sim } from '../src/sim/index.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };

describe('the opening of a track', () => {
  it('is straight and flat ahead of the ship for openingStraight metres, on every seed', () => {
    for (let s = 0; s < 30; s++) {
      const sim = new Sim({ seed: `open-${s}` });
      sim.reset(`open-${s}`);
      const t = sim.track;
      for (let i = 0; i < t.nid.length; i++) {
        const ahead = (t.nid[i]! - BACK) * SEG;
        if (ahead < sim.tuning.openingStraight) {
          expect(t.nk[i], `k at ${ahead} m, seed ${s}`).toBe(0);
          expect(t.ng[i], `g at ${ahead} m, seed ${s}`).toBe(0);
          expect(t.nb[i], `b at ${ahead} m, seed ${s}`).toBe(0);
        }
      }
    }
  });

  it('bends within a few hundred metres after the opening', () => {
    let bent = 0;
    for (let s = 0; s < 30; s++) {
      const sim = new Sim({ seed: `open-${s}` });
      sim.reset(`open-${s}`);
      const t = sim.track;
      for (let i = 0; i < t.nid.length; i++) {
        const ahead = (t.nid[i]! - BACK) * SEG;
        if (ahead >= sim.tuning.openingStraight && ahead < 800 && Math.abs(t.nk[i]!) > 1e-4) {
          bent++;
          break;
        }
      }
    }
    expect(bent).toBeGreaterThan(20); // la plupart des graines tournent avant 800 m
  });

  it('never rolls before rollFrom, and does roll after it', () => {
    let rolledAfter = 0;
    for (let s = 0; s < 12; s++) {
      const sim = new Sim({ seed: `open-${s}` });
      sim.reset(`open-${s}`);
      // On avance 8 km en mode attraction, où le pilote automatique se recentre
      // et où rien ne blesse : c'est la piste qu'on regarde, pas la conduite.
      // Le dévers d'une vrille dépasse largement celui d'un virage, borné à
      // 1,25 rad.
      while (sim.state.travel < 8000) {
        for (let i = 0; i < 720; i++) sim.step(NEUTRAL, DT, true);
        const t = sim.track;
        for (let i = 0; i < t.nid.length; i++) {
          const ahead = (t.nid[i]! - BACK) * SEG;
          if (Math.abs(t.nb[i]!) > 1.3) {
            expect(ahead, `roll at ${ahead} m, seed ${s}`).toBeGreaterThanOrEqual(
              sim.tuning.rollFrom,
            );
            rolledAfter++;
          }
        }
      }
    }
    expect(rolledAfter).toBeGreaterThan(0);
  });
});
