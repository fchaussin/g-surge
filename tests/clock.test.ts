import { describe, expect, it } from 'vitest';
import { Clock, DT, HZ, MAX_FRAME, MAX_STEPS } from '../src/sim/clock.js';

describe('Clock', () => {
  it("720 divise les cadences d'écran courantes, ce qui évite l'interpolation", () => {
    for (const refresh of [30, 60, 72, 90, 120, 144, 240, 360]) {
      expect(HZ % refresh, `${refresh} Hz`).toBe(0);
    }
  });

  it('rend un nombre entier et constant de pas par image sur ces cadences', () => {
    for (const refresh of [60, 72, 90, 120, 144, 240]) {
      const clock = new Clock();
      const frame = 1 / refresh;
      const counts = new Set<number>();
      for (let i = 0; i < 600; i++) counts.add(clock.advance(frame));
      // un seul nombre de pas possible : le rendu tombe toujours au même endroit
      expect([...counts], `${refresh} Hz`).toEqual([HZ / refresh]);
    }
  });

  it('ne perd pas de temps sur une cadence qui ne divise pas', () => {
    const clock = new Clock();
    const frame = 1 / 165;
    let steps = 0;
    const counts = new Set<number>();
    const frames = 165 * 20;
    for (let i = 0; i < frames; i++) {
      const n = clock.advance(frame);
      steps += n;
      counts.add(n);
    }
    // 20 s de temps réel, donc 720 * 20 pas à un pas près
    expect(Math.abs(steps - HZ * 20)).toBeLessThanOrEqual(1);
    // 720/165 vaut 4,36 : le compte alterne entre deux entiers voisins, ce qui
    // décale le déplacement d'une image d'environ 11 %. Invisible à 165 images
    // par seconde, là où 120 Hz de simulation sur un écran 144 aurait alterné
    // entre zéro et un pas, soit 120 %.
    expect([...counts].sort()).toEqual([4, 5]);
  });

  it('borne une image longue au lieu de rattraper indéfiniment', () => {
    const clock = new Clock();
    expect(clock.advance(5)).toBe(MAX_STEPS);
    expect(clock.advance(60)).toBe(MAX_STEPS);
  });

  it("ignore un delta absurde sans casser l'accumulateur", () => {
    const clock = new Clock();
    expect(clock.advance(-1)).toBe(0);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.pending).toBe(0);
    expect(clock.advance(1 / 60)).toBe(HZ / 60);
  });

  it('conserve le reliquat entre deux images', () => {
    const clock = new Clock();
    const frame = DT * 1.5;
    expect(clock.advance(frame)).toBe(1);
    expect(clock.pending).toBeCloseTo(DT * 0.5, 12);
    expect(clock.advance(frame)).toBe(2);
  });

  it('repart proprement après une remise à zéro', () => {
    const clock = new Clock();
    clock.advance(DT * 0.9);
    expect(clock.pending).toBeGreaterThan(0);
    clock.reset();
    expect(clock.pending).toBe(0);
  });

  it('expose des constantes cohérentes', () => {
    expect(DT).toBeCloseTo(1 / HZ, 15);
    expect(MAX_STEPS).toBe(Math.ceil(MAX_FRAME * HZ));
  });
});
