import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng.js';

describe('Rng', () => {
  it('rejoue la même séquence pour une même graine', () => {
    const a = Rng.fromSeed('g-surge');
    const b = Rng.fromSeed('g-surge');
    const left = Array.from({ length: 500 }, () => a.next());
    const right = Array.from({ length: 500 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('sépare les flux issus de la même graine', () => {
    const track = Rng.fromSeed('g-surge', 'track');
    const items = Rng.fromSeed('g-surge', 'items');
    const left = Array.from({ length: 200 }, () => track.next());
    const right = Array.from({ length: 200 }, () => items.next());
    expect(left).not.toEqual(right);
  });

  it('reprend une séquence depuis un état sauvegardé', () => {
    const rng = Rng.fromSeed('reprise');
    for (let i = 0; i < 97; i++) rng.next();
    const snapshot = rng.save();
    const expected = Array.from({ length: 50 }, () => rng.next());
    const resumed = Rng.fromState(snapshot);
    expect(Array.from({ length: 50 }, () => resumed.next())).toEqual(expected);
  });

  it('reste dans [0, 1)', () => {
    const rng = Rng.fromSeed('bornes');
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('ne dérive pas sur les booléens à faible probabilité', () => {
    // coinChance vaut 0.015 : c'est le tirage le plus sensible du générateur de
    // piste, et celui qu'un LCG à bits de poids faible corrélés fausserait.
    const rng = Rng.fromSeed('faible-probabilite');
    const n = 2_000_000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (rng.chance(0.015)) hits++;
    expect(hits / n).toBeGreaterThan(0.0146);
    expect(hits / n).toBeLessThan(0.0154);
  });

  it('produit des tirages équilibrés sur sign()', () => {
    const rng = Rng.fromSeed('signe');
    let sum = 0;
    for (let i = 0; i < 200_000; i++) sum += rng.sign();
    expect(Math.abs(sum) / 200_000).toBeLessThan(0.01);
  });

  it('respecte les bornes de range, int et centered', () => {
    const rng = Rng.fromSeed('bornes-helpers');
    for (let i = 0; i < 50_000; i++) {
      const r = rng.range(10, 36);
      expect(r).toBeGreaterThanOrEqual(10);
      expect(r).toBeLessThan(36);

      const n = rng.int(26);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(26);

      const c = rng.centered(11.5);
      expect(c).toBeGreaterThanOrEqual(-11.5);
      expect(c).toBeLessThan(11.5);
    }
  });
});
