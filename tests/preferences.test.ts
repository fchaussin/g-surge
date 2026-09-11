/**
 * Ce qui sort du stockage est une entrée non fiable : partagé avec tout ce qui
 * tourne sur l'origine, et plus vieux que le code qui le lit. `sanitise` est la
 * porte, et une valeur qui la passerait donnerait un jeu à l'échelle de rendu
 * négative. Testée seule : le magasin lui-même touche `localStorage`.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, sanitise } from '../src/client/preferences.js';

describe('the preferences sanitiser', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const raw of [null, undefined, 42, 'easy', [], true]) {
      expect(sanitise(raw)).toEqual(DEFAULT_PREFERENCES);
    }
  });

  it('keeps every valid field as it was written', () => {
    const written = {
      difficulty: 'hard',
      lefty: true,
      sound: false,
      haptics: false,
      tips: false,
      sky: false,
      skyDetail: false,
      showFps: true,
      renderScale: 0.7,
    };
    expect(sanitise(written)).toEqual(written);
  });

  it('drops a bad value for its default, field by field, and never the whole object', () => {
    const out = sanitise({
      difficulty: 'insane',
      lefty: 'yes',
      sound: 1,
      renderScale: -3,
      showFps: true,
    });
    expect(out.difficulty).toBe('easy');
    expect(out.lefty).toBe(false);
    expect(out.sound).toBe(true);
    expect(out.renderScale).toBe(1);
    expect(out.showFps).toBe(true);
  });

  it('refuses a render scale outside 0.4 to 1, and anything that is not a finite number', () => {
    expect(sanitise({ renderScale: 0.39 }).renderScale).toBe(1);
    expect(sanitise({ renderScale: 1.01 }).renderScale).toBe(1);
    expect(sanitise({ renderScale: Number.NaN }).renderScale).toBe(1);
    expect(sanitise({ renderScale: '0.8' }).renderScale).toBe(1);
    expect(sanitise({ renderScale: 0.4 }).renderScale).toBe(0.4);
  });

  it('lets a key retired by an earlier version fall away', () => {
    const out = sanitise({ frameTarget: 120, difficulty: 'medium' });
    expect(out).not.toHaveProperty('frameTarget');
    expect(out.difficulty).toBe('medium');
  });
});
