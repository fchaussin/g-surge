/**
 * La trigonométrie du noyau, épinglée par ses réponses et non par `Math`.
 *
 * Le point de `src/sim/trig.ts` est justement de ne plus dépendre du `Math` de
 * l'hôte. Un test qui comparerait les deux réintroduirait la dépendance dans le
 * filet : il virerait au rouge le jour où un moteur change son `Math`, alors que
 * notre code, lui, n'aurait pas bougé. Les valeurs attendues sont donc figées en
 * hexadécimal, motif de bits par motif de bits — un « known-answer test », comme
 * on en écrit pour une primitive cryptographique, et pour la même raison :
 * l'implémentation doit rendre des comptes à une référence extérieure, pas à
 * une autre implémentation.
 *
 * L'accord avec le `Math` de ce moteur-ci est vérifié aussi, mais à une tolérance
 * d'un ULP et à titre indicatif. C'est ce qui explique que les références gelées
 * n'aient pas bougé quand le noyau a cessé d'appeler `Math` : sur ce moteur, les
 * deux rendent le même bit. C'est une commodité, pas le contrat.
 *
 * La preuve inter-moteurs, elle, ne peut pas s'écrire ici : elle demande un vrai
 * navigateur, et vit dans `tests/e2e/trig.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { atan, cos, sin } from '../src/sim/trig.js';

const BITS = new DataView(new ArrayBuffer(8));
/** Motif de bits d'un double : la seule comparaison qui distingue +0 de -0. */
function bits(x: number): bigint {
  BITS.setFloat64(0, x);
  return BITS.getBigUint64(0);
}

/** Distance en ULP, pour la vérification indicative contre `Math`. */
function ulps(a: number, b: number): number {
  if (a === b) return 0;
  const ord = (x: number): bigint => {
    const u = bits(x);
    return u & 0x8000000000000000n ? -(u & 0x7fffffffffffffffn) : u;
  };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}

/**
 * Arguments et motifs de bits attendus.
 *
 * Choisis pour traverser chaque branche : les deux seuils de `kernelCos`, les
 * quatre quadrants, les multiples de π/2 où la réduction annule ses bits de
 * poids fort, le retour anticipé sous 2^-27, le haut du domaine, et les deux
 * zéros signés.
 */
const SIN: Array<[number, bigint]> = [
  [0, 0x0000000000000000n],
  [-0, 0x8000000000000000n],
  [7.450580596923827e-9, 0x3e3fffffffffffffn],
  [1e-30, 0x39b4484bfeebc2a0n],
  [-1e-30, 0xb9b4484bfeebc2a0n],
  [0.1, 0x3fb98eaecb8bcb2cn],
  [0.25, 0x3fcfaaeed4f31577n],
  [0.29999, 0x3fd2e9a583ddb860n],
  [0.3, 0x3fd2e9cd95baba33n],
  [0.5, 0x3fdeaee8744b05f0n],
  [0.7, 0x3fe49d6e694619b8n],
  [0.78125, 0x3fe6888a4e134b2fn],
  [0.7853981633974483, 0x3fe6a09e667f3bccn],
  [-0.7853981633974483, 0xbfe6a09e667f3bccn],
  [1, 0x3feaed548f090ceen],
  [-1, 0xbfeaed548f090ceen],
  [1.5, 0x3fefeb7a9b2c6d8bn],
  [1.5707963267948966, 0x3ff0000000000000n],
  [-1.5707963267948966, 0xbff0000000000000n],
  [2, 0x3fed18f6ead1b446n],
  [3, 0x3fc210386db6d55bn],
  [3.141592653589793, 0x3ca1a62633145c07n],
  [-3.141592653589793, 0xbca1a62633145c07n],
  [4, 0xbfe837b9dddc1eaen],
  [4.5, 0xbfef47ed3dc74080n],
  [4.71238898038469, 0xbff0000000000000n],
  [6.283185307179586, 0xbcb1a62633145c07n],
  [-6.283185307179586, 0x3cb1a62633145c07n],
  [10, 0xbfe1689ef5f34f52n],
  [-10, 0x3fe1689ef5f34f52n],
  [25.132741228718345, 0xbcd1a62633145c07n],
  [50.26548245743669, 0xbce1a62633145c07n],
  [51.83627878423159, 0x3ff0000000000000n],
  [100, 0xbfe03425b78c4db8n],
  [-100, 0x3fe03425b78c4db8n],
  [12.5643, 0xbf60f663d3369b15n],
  [43.788, 0xbfc8b6beea3b84e6n],
  [-43.788, 0x3fc8b6beea3b84e6n],
  [1000.5, 0x3fefd948c50a7a0dn],
  [823549.6, 0xbfb0858be515492bn],
  [1647098, 0xbfef120398822ba6n],
];

const COS: Array<[number, bigint]> = [
  [0, 0x3ff0000000000000n],
  [-0, 0x3ff0000000000000n],
  [7.450580596923827e-9, 0x3ff0000000000000n],
  [1e-30, 0x3ff0000000000000n],
  [-1e-30, 0x3ff0000000000000n],
  [0.1, 0x3fefd712f9a817c0n],
  [0.25, 0x3fef01549f7deea1n],
  [0.29999, 0x3fee922406b85a31n],
  [0.3, 0x3fee921dd42f09ban],
  [0.5, 0x3fec1528065b7d50n],
  [0.7, 0x3fe87996529f9d93n],
  [0.78125, 0x3fe6b898fa9efb5dn],
  [0.7853981633974483, 0x3fe6a09e667f3bcdn],
  [-0.7853981633974483, 0x3fe6a09e667f3bcdn],
  [1, 0x3fe14a280fb5068cn],
  [-1, 0x3fe14a280fb5068cn],
  [1.5, 0x3fb21bd54fc5f9a7n],
  [1.5707963267948966, 0x3c91a62633145c07n],
  [-1.5707963267948966, 0x3c91a62633145c07n],
  [2, 0xbfdaa22657537205n],
  [3, 0xbfefae04be85e5d2n],
  [3.141592653589793, 0xbff0000000000000n],
  [-3.141592653589793, 0xbff0000000000000n],
  [4, 0xbfe4eaa606db24c1n],
  [4.5, 0xbfcafb5b54583d6an],
  [4.71238898038469, 0xbcaa79394c9e8a0an],
  [6.283185307179586, 0x3ff0000000000000n],
  [-6.283185307179586, 0x3ff0000000000000n],
  [10, 0xbfead9ac890c6b1fn],
  [-10, 0xbfead9ac890c6b1fn],
  [25.132741228718345, 0x3ff0000000000000n],
  [50.26548245743669, 0x3ff0000000000000n],
  [51.83627878423159, 0x3cb19abb2567f739n],
  [100, 0x3feb981dbf665fdfn],
  [-100, 0x3feb981dbf665fdfn],
  [12.5643, 0x3feffffb81193589n],
  [43.788, 0x3fef65db2ec0292en],
  [-43.788, 0x3fef65db2ec0292en],
  [1000.5, 0x3fb8dbff75eb664fn],
  [823549.6, 0x3fefeeebfee47670n],
  [1647098, 0x3fcea0f180b71c45n],
];

const ATAN: Array<[number, bigint]> = [
  [0, 0x0000000000000000n],
  [-0, 0x8000000000000000n],
  [1e-12, 0x3d719799812dea11n],
  [-1e-12, 0xbd719799812dea11n],
  [0.1, 0x3fb983e282e2cc4dn],
  [0.4374, 0x3fda638eb495898fn],
  [0.4375, 0x3fda64eec3cc23fdn],
  [0.5, 0x3fddac670561bb4fn],
  [0.6875, 0x3fe345f01cce37bbn],
  [0.9, 0x3fe77338a80603ben],
  [1, 0x3fe921fb54442d18n],
  [-1, 0xbfe921fb54442d18n],
  [1.1875, 0x3febde70ed439fe7n],
  [1.265, 0x3fecdc170b5d8ee8n],
  [-1.265, 0xbfecdc170b5d8ee8n],
  [1.5, 0x3fef730bd281f69bn],
  [2.4375, 0x3ff2e75728833a54n],
  [3, 0x3ff3fc176b7a8560n],
  [10, 0x3ff789bd2c160054n],
  [-10, 0xbff789bd2c160054n],
  [1000000, 0x3ff921fa47d4b30dn],
  [Infinity, 0x3ff921fb54442d18n],
  [-Infinity, 0xbff921fb54442d18n],
];

describe('trigonométrie déterministe', () => {
  it('rend les motifs de bits attendus pour le sinus', () => {
    for (const [x, expected] of SIN) expect(bits(sin(x)), `sin(${x})`).toBe(expected);
  });

  it('rend les motifs de bits attendus pour le cosinus', () => {
    for (const [x, expected] of COS) expect(bits(cos(x)), `cos(${x})`).toBe(expected);
  });

  it("rend les motifs de bits attendus pour l'arc tangente", () => {
    for (const [x, expected] of ATAN) expect(bits(atan(x)), `atan(${x})`).toBe(expected);
  });

  /**
   * Cent mille arguments couvrant tout le domaine, résumés par une empreinte.
   *
   * Les vecteurs ci-dessus disent où passer, celui-ci dit qu'on n'a rien cassé
   * ailleurs. L'empreinte ne dit pas *quoi* a bougé, mais elle tient en une
   * ligne là où cent mille vecteurs tiendraient en un fichier illisible.
   */
  it('reproduit un balayage de cent mille arguments', () => {
    let state = 20260910;
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    let h = 0x811c9dc5;
    const feed = (text: string): void => {
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
    };
    for (let i = 0; i < 100000; i++) {
      const x = (next() - 0.5) * 2 * 1e5;
      feed(bits(sin(x)).toString(36));
      feed(',');
      feed(bits(cos(x)).toString(36));
      feed(',');
      feed(bits(atan(x / 1e4)).toString(36));
      if (i < 99999) feed(',');
    }
    expect((h >>> 0).toString(16).padStart(8, '0')).toBe('bff87859');
  });

  it('préserve le signe du zéro, que le polynôme perdrait', () => {
    // sin(-0) doit rendre -0. Sans le retour anticipé sous 2^-27, le polynôme
    // rend +0, et rien dans les références gelées ne l'aurait vu : JSON écrit
    // les deux « 0 ». Trouvé par un vecteur explicite, pas par un balayage.
    expect(bits(sin(-0))).toBe(bits(-0));
    expect(bits(sin(0))).toBe(bits(0));
    expect(bits(atan(-0))).toBe(bits(-0));
    expect(cos(-0)).toBe(1);
  });

  it('traite les valeurs non finies comme Math', () => {
    expect(sin(NaN)).toBeNaN();
    expect(cos(NaN)).toBeNaN();
    expect(atan(NaN)).toBeNaN();
    expect(sin(Infinity)).toBeNaN();
    expect(cos(-Infinity)).toBeNaN();
    expect(atan(Infinity)).toBe(Math.PI / 2);
    expect(atan(-Infinity)).toBe(-Math.PI / 2);
  });

  it('rend deux fois le même bit, et ne garde rien entre deux appels', () => {
    // Le reste de la réduction est un objet réutilisé, pour ne rien allouer à
    // 720 Hz. Un appel intercalé ne doit donc pas pouvoir corrompre le suivant.
    const x = 43.788;
    const first = bits(sin(x));
    sin(1e5);
    cos(-7.25);
    atan(0.5);
    expect(bits(sin(x))).toBe(first);
  });

  /**
   * Indicatif : ce moteur-ci est d'accord avec nous.
   *
   * Mesuré à 100 % bit-identique sur trois millions de valeurs, mais l'assertion
   * laisse un ULP. Un moteur qui s'en écarterait davantage ne rendrait pas ce
   * fichier faux — il rendrait vraie la raison d'être de `trig.ts`.
   */
  it('reste à un ULP du Math de ce moteur sur le domaine du jeu', () => {
    let state = 7;
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    let worst = 0;
    for (let i = 0; i < 50000; i++) {
      const x = (next() - 0.5) * 2 * 90; // le jeu plafonne à 44 rad
      worst = Math.max(worst, ulps(sin(x), Math.sin(x)), ulps(cos(x), Math.cos(x)));
      const a = (next() - 0.5) * 4;
      worst = Math.max(worst, ulps(atan(a), Math.atan(a)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
});
