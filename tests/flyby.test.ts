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
import { flybyDetune, flybyGain, flybyPan, flybySpeedGain } from '../src/client/flyby.js';

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

describe('le niveau d’un passage selon la vitesse', () => {
  it('reste discret en croisière et se lève au-delà de 500 km/h', () => {
    // 70 m/s font 252 km/h, 140 m/s en font 504, 300 m/s 1 080.
    const cruise = flybySpeedGain(70);
    const seuil = flybySpeedGain(140);
    const vite = flybySpeedGain(220);
    const plafond = flybySpeedGain(300);
    expect(cruise).toBeCloseTo(seuil, 10); // rien ne bouge en dessous du seuil
    expect(vite).toBeGreaterThan(seuil);
    expect(plafond).toBeGreaterThan(vite);
    // Un rapport qui s'entend : le passage vaut plusieurs fois plus au plafond.
    expect(plafond / cruise).toBeGreaterThan(4);
  });

  it('ne se tait jamais tout à fait, et ne monte pas sans fin', () => {
    // En croisière un passage reste un repère de position ; il cesse seulement
    // d'être un événement.
    expect(flybySpeedGain(0)).toBeGreaterThan(0.1);
    // Et au-delà du plafond du super boost, plus rien ne monte.
    expect(flybySpeedGain(409)).toBeCloseTo(flybySpeedGain(300), 10);
    expect(flybySpeedGain(10_000)).toBeCloseTo(flybySpeedGain(300), 10);
  });
});

describe('l’écoutant, qui est la caméra', () => {
  it('fait sonner au centre un objet posé sur la trajectoire', () => {
    // Un objet au même écart latéral que l'écoutant lui passe dessus : il n'a
    // pas de côté. C'est l'écart **relatif** qui compte, et c'est ce que la
    // première version avait faux — elle passait la latérale absolue, donc un
    // objet suivi de près sonnait sur le bord.
    expect(flybyPan(6, 0)).toBeCloseTo(0, 10);
  });

  it('place le passage là où l’oreille est, pas où la coque est', () => {
    // La caméra est 19 m en arrière : un objet au niveau du vaisseau est encore
    // à 19 m devant elle, donc loin du basculement. Le panoramique ne part à
    // fond que 19 m plus tard, quand il atteint vraiment le point d'écoute.
    const surLaCoque = Math.abs(flybyPan(19, 9));
    const surLOreille = Math.abs(flybyPan(0, 9));
    expect(surLOreille).toBeGreaterThan(surLaCoque);
    expect(surLOreille).toBeCloseTo(1, 6);
    // Et le Doppler s'annule au même endroit, pas avant.
    expect(flybyDetune(19, 9, 200)).toBeGreaterThan(0);
    expect(flybyDetune(0, 9, 200)).toBeCloseTo(0, 10);
  });
});
