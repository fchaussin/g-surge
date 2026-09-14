/**
 * Le QR d'invitation, relu.
 *
 * `qr.ts` disait lui-même que son seul vrai test était l'appareil photo d'un
 * téléphone, et que le test automatique ne vérifiait que la forme — un module
 * noir au bon endroit. C'est ce qui a laissé passer deux modules de
 * synchronisation éteints par la réservation des zones de format.
 *
 * Ce test relit donc le code au lieu de le regarder : un décodeur écrit ici,
 * d'après la norme et non d'après `qr.ts`, refait le chemin inverse — carte des
 * motifs, masque lu dans les bits de format, lecture en serpentin,
 * désentrelacement des blocs — et rend la chaîne. Ce qui est prouvé est ce que
 * le téléphone lira : l'adresse entière, fragment compris.
 *
 * La correction d'erreur n'est pas vérifiée : elle protège une lecture abîmée,
 * et ici la matrice est lue telle qu'elle est écrite.
 */
import { describe, expect, it } from 'vitest';
import { drawQr } from '../src/client/qr.js';

/** Niveau M, versions 1 à 6, table 9 de la norme — la table du décodeur, pas celle de `qr.ts`. */
const VERSIONS: readonly [number, number, number, number, number][] = [
  [16, 1, 0, 0, 10],
  [28, 1, 0, 0, 16],
  [44, 1, 0, 0, 26],
  [32, 2, 0, 0, 18],
  [43, 2, 0, 0, 24],
  [27, 4, 0, 0, 16],
];

/** Centres des motifs d'alignement, table E.1. */
const ALIGN: readonly number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

interface Matrix {
  size: number;
  at: (x: number, y: number) => number;
}

/**
 * Rejoue `drawQr` sur un canvas de papier : le seul dessin est une suite de
 * carrés d'un module, donc les relever redonne la matrice. Le fond blanc est
 * le seul rectangle posé en `#ffffff`, et il est écarté par sa couleur.
 */
function draw(text: string): Matrix {
  const dark: [number, number, number][] = [];
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number) {
      if (this.fillStyle === '#000000') dark.push([x, y, w]);
    },
  };
  const canvas = { width: 232, height: 232, getContext: () => ctx };
  drawQr(canvas as unknown as HTMLCanvasElement, text);

  expect(dark.length).toBeGreaterThan(0);
  const px = dark[0]![2];
  const size = canvas.width / px - 8;
  const modules = new Uint8Array(size * size);
  for (const [x, y] of dark) {
    const mx = x / px - 4;
    const my = y / px - 4;
    modules[my * size + mx] = 1;
  }
  return { size, at: (x, y) => modules[y * size + x]! };
}

/** Les modules que la norme réserve : rien de ce qui suit ne porte de données. */
function reserved(size: number, version: number): Uint8Array {
  const f = new Uint8Array(size * size);
  const mark = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < size && y < size) f[y * size + x] = 1;
  };
  // les trois repères et leurs séparateurs : des carrés de 8 sur 8
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      mark(x, y);
      mark(size - 1 - x, y);
      mark(x, size - 1 - y);
    }
  // les deux pistes de synchronisation, entières
  for (let i = 0; i < size; i++) {
    mark(i, 6);
    mark(6, i);
  }
  // les deux copies des bits de format, et le module toujours sombre
  for (let i = 0; i < 9; i++) {
    mark(i, 8);
    mark(8, i);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  // l'alignement, sauf ceux que les repères recouvrent
  const centres = ALIGN[version - 1]!;
  for (const cy of centres)
    for (const cx of centres) {
      const onFinder =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy);
    }
  return f;
}

/** Le numéro de masque, lu dans la première copie des bits de format. */
function maskOf(m: Matrix): number {
  const spots: [number, number][] = [];
  for (let i = 0; i <= 5; i++) spots.push([8, i]);
  spots.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) spots.push([14 - i, 8]);
  let bits = 0;
  spots.forEach(([x, y], i) => {
    bits |= m.at(x, y) << i;
  });
  return ((bits ^ 0x5412) >> 10) & 0b111;
}

/** La matrice, relue : masque, serpentin, désentrelacement, en-tête, texte. */
function decode(m: Matrix): string {
  const version = (m.size - 17) / 4;
  const [d1, n1, d2, n2] = VERSIONS[version - 1]!;
  const f = reserved(m.size, version);
  const mask = MASKS[maskOf(m)]!;

  const bits: number[] = [];
  let up = true;
  for (let col = m.size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < m.size; k++) {
      const y = up ? m.size - 1 - k : k;
      for (const x of [col, col - 1]) {
        if (f[y * m.size + x]) continue;
        bits.push(mask(x, y) ? m.at(x, y) ^ 1 : m.at(x, y));
      }
    }
    up = !up;
  }

  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j]!;
    words.push(w);
  }

  // les blocs de données, dans l'ordre où l'entrelacement les a pris
  const sizes = [...Array<number>(n1).fill(d1), ...Array<number>(n2).fill(d2)];
  const blocks: number[][] = sizes.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(...sizes); i++)
    for (let b = 0; b < sizes.length; b++) if (i < sizes[b]!) blocks[b]!.push(words[p++]!);
  const data = blocks.flat();

  const stream: number[] = [];
  for (const w of data) for (let i = 7; i >= 0; i--) stream.push((w >> i) & 1);
  const take = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | stream.shift()!;
    return v;
  };
  expect(take(4)).toBe(0b0100); // mode octets
  const length = take(8);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = take(8);
  return new TextDecoder().decode(out);
}

const LINK = 'https://g-surge.pages.dev/#duel=0123456789abcdef';

describe('le QR du lien de duel', () => {
  it('porte le lien entier, fragment compris', () => {
    expect(decode(draw(LINK))).toBe(LINK);
  });

  it('porte aussi une adresse longue, sur plusieurs blocs', () => {
    const long = `https://g-surge-preview-branch.pages.dev/some/path/#duel=fedcba9876543210`;
    expect(decode(draw(long))).toBe(long);
  });

  /**
   * Les deux pistes qui portent la grille. Les modules (6, 8) et (8, 6) sont à
   * elles et non au format : la réservation des zones de format les éteignait,
   * et un lecteur exigeant sur la synchronisation lisait de travers.
   */
  it('garde les deux motifs de synchronisation intacts', () => {
    const m = draw(LINK);
    for (let i = 8; i < m.size - 8; i++) {
      expect(m.at(i, 6), `synchronisation horizontale en ${i}`).toBe(i % 2 === 0 ? 1 : 0);
      expect(m.at(6, i), `synchronisation verticale en ${i}`).toBe(i % 2 === 0 ? 1 : 0);
    }
  });
});
