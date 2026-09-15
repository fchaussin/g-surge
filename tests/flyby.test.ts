/**
 * La géométrie d'un objet qu'on double.
 *
 * Les trois fonctions sont pures et sortent de la classe exprès : le câblage
 * Web Audio n'est pas testable en Node, la courbe qui le pilote l'est
 * entièrement. C'est elle qui décide si l'effet se lit comme un objet qui passe
 * ou comme un bourdon qui apparaît, et aucune écoute ne dira *pourquoi* si elle
 * est fausse.
 */
import { describe, expect, it } from 'vitest';
import { flybyDetune, flybyGain, flybyPan } from '../src/client/flyby.js';

describe('le panoramique d’un passage', () => {
  it('reste presque au centre tant que l’objet est loin devant', () => {
    // 10 m de côté à 100 m devant : on le voit sous un petit angle, il sonne
    // presque en face. C'est ce qui fait le balayage sans courbe à régler.
    expect(Math.abs(flybyPan(100, 10))).toBeLessThan(0.15);
  });

  it('part au bord au moment où on le double', () => {
    expect(Math.abs(flybyPan(0, 10))).toBeCloseTo(1, 6);
  });

  it('balaie de façon monotone en approchant', () => {
    const lat = 9;
    let previous = 0;
    for (const ahead of [120, 90, 60, 30, 12, 3, 0]) {
      const v = Math.abs(flybyPan(ahead, lat));
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });

  it('respecte le repère : un objet en monde +X sonne à gauche', () => {
    expect(flybyPan(20, 8)).toBeLessThan(0);
    expect(flybyPan(20, -8)).toBeGreaterThan(0);
  });
});

describe('le gain d’un passage', () => {
  it('est nul à la portée et au-delà, exactement', () => {
    expect(flybyGain(110, 0)).toBe(0);
    expect(flybyGain(400, 0)).toBe(0);
    expect(flybyGain(-400, 0)).toBe(0);
  });

  it('ne laisse pas de marche en sortant de portée', () => {
    // Sans la fenêtre, la voix s'éteindrait sur un palier non nul et ça
    // s'entendrait comme un clic. Juste avant la portée, il ne reste presque
    // rien.
    expect(flybyGain(109.5, 0)).toBeLessThan(0.002);
  });

  it('culmine au passage et décroît des deux côtés', () => {
    const passage = flybyGain(0, 4);
    expect(passage).toBeGreaterThan(flybyGain(40, 4));
    expect(passage).toBeGreaterThan(flybyGain(-40, 4));
    expect(flybyGain(40, 4)).toBeCloseTo(flybyGain(-40, 4), 12);
  });
});

describe('le désaccord d’un passage', () => {
  it('monte devant, s’annule au travers, descend derrière', () => {
    expect(flybyDetune(80, 5, 200)).toBeGreaterThan(0);
    expect(flybyDetune(0, 5, 200)).toBeCloseTo(0, 10);
    expect(flybyDetune(-80, 5, 200)).toBeLessThan(0);
  });

  it('se marque davantage quand on va plus vite', () => {
    expect(flybyDetune(60, 5, 400)).toBeGreaterThan(flybyDetune(60, 5, 90));
  });

  it('reste borné quand la vitesse monte, là où le Doppler physique diverge', () => {
    // Le son va à 340 m/s et le vaisseau monte à 409 : la formule physique
    // passe le mur. On garde la forme, bornée, plutôt que l'infini.
    const ceiling = flybyDetune(60, 5, 10_000);
    expect(Number.isFinite(ceiling)).toBe(true);
    expect(ceiling).toBeCloseTo(flybyDetune(60, 5, 409), 6);
  });
});
