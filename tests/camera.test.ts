/**
 * La caméra ne tourne pas sans WebGL, mais son arithmétique d'aspect si.
 *
 * `fitAspect` est ce qui rapproche le vaisseau sur un téléphone en paysage ;
 * une erreur de signe ou d'unité y passerait toutes les références, prises à
 * 16:9 où la fonction est l'identité par construction.
 */
import { describe, expect, it } from 'vitest';
import { fitAspect, REF_ASPECT } from '../src/client/camera.js';

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Le champ horizontal qu'un champ vertical donne à un aspect. */
const horizontal = (vertical: number, aspect: number) =>
  2 * Math.atan(Math.tan(rad(vertical) / 2) * aspect);

describe('fitAspect', () => {
  it('is the identity at 16:9 and narrower, where every scene reference is taken', () => {
    expect(fitAspect(74, REF_ASPECT)).toBe(74);
    expect(fitAspect(74, 4 / 3)).toBe(74);
    expect(fitAspect(74, 9 / 19.5)).toBe(74);
  });

  it('holds the horizontal field constant on a wider screen, so a phone zooms in', () => {
    const wide = 19.5 / 9;
    const fitted = fitAspect(74, wide);
    expect(fitted).toBeLessThan(74);
    expect(horizontal(fitted, wide)).toBeCloseTo(horizontal(74, REF_ASPECT), 9);
  });

  it('grows the ship by the ratio of the aspects, about 17 % at 19.5:9', () => {
    const wide = 19.5 / 9;
    const size = (v: number) => 1 / Math.tan(rad(v) / 2);
    expect(size(fitAspect(74, wide)) / size(74)).toBeCloseTo(wide / REF_ASPECT, 9);
  });
});
