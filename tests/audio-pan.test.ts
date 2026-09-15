/**
 * Le côté d'où sort un son de bord.
 *
 * Trois lignes de fonction pour un fichier de test, et c'est voulu : ce qu'elle
 * porte est une convention de repère, pas un calcul. Le monde a `+X` à gauche
 * de l'écran — c'est ce qui fait que la direction est inversée exprès dans
 * `step()` — donc le panoramique doit inverser le signe. À l'envers, rien ne
 * plante, rien ne se voit, et tous les sons de bord sortent du mauvais côté,
 * ce qui est pire que le centre : le centre n'affirme rien, l'inverse ment.
 *
 * C'est exactement la forme de bug que ce dépôt a déjà payée deux fois sur cet
 * axe, et la seule chose qui puisse la rattraper est une assertion écrite.
 */
import { describe, expect, it } from 'vitest';
import { panOf } from '../src/client/audio.js';

describe('le panoramique du bus latéral', () => {
  it('envoie le monde +X à gauche, parce que le monde +X est à gauche', () => {
    expect(panOf(1)).toBeLessThan(0);
    expect(panOf(-1)).toBeGreaterThan(0);
  });

  it('laisse le centre au centre', () => {
    // `toBeCloseTo` et non `toBe` : la négation rend `-0`, que `Object.is`
    // distingue de `+0` alors que Web Audio ne les distingue pas.
    expect(panOf(0)).toBeCloseTo(0, 10);
  });

  it('reste dans l’intervalle que `pan` accepte, même hors piste', () => {
    // `lat` dépasse la limite de piste en l'air — `airOverhang` l'y autorise —
    // et `pan` ne prend que −1 à 1.
    for (const v of [-40, -4, -1, -0.5, 0.5, 1, 4, 40]) {
      expect(Math.abs(panOf(v))).toBeLessThanOrEqual(1);
    }
  });

  it('va jusqu’au bord du champ à un bord de piste', () => {
    // On suppose une stéréo équilibrée : rien n'est rabattu pour compenser un
    // montage qu'on ne connaît pas.
    expect(panOf(1)).toBeCloseTo(-1, 10);
    expect(panOf(-1)).toBeCloseTo(1, 10);
  });

  it('est monotone : plus on est au bord, plus le son y va', () => {
    expect(panOf(0.25)).toBeGreaterThan(panOf(0.75));
    expect(panOf(-0.25)).toBeLessThan(panOf(-0.75));
  });
});
