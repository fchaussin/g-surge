/**
 * La trace en octets.
 *
 * Une forme quatre à six fois plus courte que le JSON, pour le stockage local
 * et le réseau. Graine en unités UTF-16, plages en écarts de pas à longueur
 * variable, braquage sur deux octets quand il est sur la grille de `input.ts`
 * et huit sinon. Sans `TextEncoder` ni base64 : ni l'un ni l'autre n'est dans
 * la bibliothèque ES seule, et le noyau ne prend rien au-delà — le client
 * fait le base64, le serveur lit les octets tels quels.
 */
import { BRAKE, BOOST, type Trace } from './replay.js';
import type { Difficulty } from './tuning.js';

/**
 * Le braquage est quantifié par le client au 1/1024 : `input.ts` arrondit ce
 * que le manche donne, et le clavier ne produit que −1, 0 et 1. Une plage
 * dont le braquage tombe sur la grille tient donc en deux octets ; une autre
 * — un script, un manche d'une autre version — garde ses huit. Le bit dit
 * lequel, et l'aller-retour est exact dans les deux cas.
 */
export const STEER_QUANTUM = 1 / 1024;
const WIDE = 4;

/**
 * Le braquage posé sur la grille. `+ 0` efface le zéro négatif que `round`
 * rend pour un manche à peine à gauche : il se comporte comme zéro dans la
 * physique, mais deux octets ne portent pas son signe et un aller-retour ne
 * serait plus égal au bit près.
 */
export function quantiseSteer(raw: number): number {
  return Math.round(raw / STEER_QUANTUM) * STEER_QUANTUM + 0;
}
/** Premier octet : la version de la forme. */
const FORMAT = 1;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

function varintSize(v: number): number {
  let n = 1;
  while (v >= 0x80) {
    v = Math.floor(v / 128);
    n++;
  }
  return n;
}

/** La trace en octets. */
export function packTrace(t: Trace): Uint8Array {
  const n = t.from.length;
  let size = 1 + 1 + 4 + 2 + t.seed.length * 2 + 4 + 1;
  const wide = new Uint8Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const q = t.steer[i]! / STEER_QUANTUM;
    // un zéro négatif est sur la grille mais deux octets perdraient son signe
    wide[i] = q === Math.round(q) && Math.abs(q) <= 1024 && !Object.is(q, -0) ? 0 : WIDE;
    size += varintSize(t.from[i]! - prev) + (wide[i] ? 8 : 2) + 1;
    prev = t.from[i]!;
  }
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let p = 0;
  bytes[p++] = FORMAT;
  bytes[p++] = DIFFICULTIES.indexOf(t.difficulty);
  view.setUint32(p, t.steps);
  p += 4;
  view.setUint16(p, t.seed.length);
  p += 2;
  for (let i = 0; i < t.seed.length; i++) {
    view.setUint16(p, t.seed.charCodeAt(i));
    p += 2;
  }
  view.setUint32(p, n);
  p += 4;
  bytes[p++] = t.truncated ? 1 : 0;
  prev = 0;
  for (let i = 0; i < n; i++) {
    let d = t.from[i]! - prev;
    prev = t.from[i]!;
    while (d >= 0x80) {
      bytes[p++] = (d % 128) | 0x80;
      d = Math.floor(d / 128);
    }
    bytes[p++] = d;
    // les drapeaux d'abord : ils disent la largeur du braquage qui suit
    bytes[p++] = t.flags[i]! | wide[i]!;
    if (wide[i]) {
      view.setFloat64(p, t.steer[i]!);
      p += 8;
    } else {
      view.setInt16(p, Math.round(t.steer[i]! / STEER_QUANTUM));
      p += 2;
    }
  }
  return bytes;
}

/** L'inverse de `packTrace`. `null` si les octets ne sont pas une trace ; `validTrace` juge le reste. */
export function unpackTrace(bytes: Uint8Array): Trace | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 0;
    if (bytes[p++] !== FORMAT) return null;
    const difficulty = DIFFICULTIES[bytes[p++]!];
    if (difficulty === undefined) return null;
    const steps = view.getUint32(p);
    p += 4;
    const seedLength = view.getUint16(p);
    p += 2;
    let seed = '';
    for (let i = 0; i < seedLength; i++) {
      seed += String.fromCharCode(view.getUint16(p));
      p += 2;
    }
    const n = view.getUint32(p);
    p += 4;
    const truncated = bytes[p++] === 1;
    const from = new Array<number>(n);
    const steer = new Array<number>(n);
    const flags = new Array<number>(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let d = 0;
      let scale = 1;
      let b: number;
      do {
        b = bytes[p++]!;
        d += (b & 0x7f) * scale;
        scale *= 128;
      } while (b & 0x80);
      prev += d;
      from[i] = prev;
      const f = bytes[p++]!;
      flags[i] = f & (BRAKE | BOOST);
      if (f & WIDE) {
        steer[i] = view.getFloat64(p);
        p += 8;
      } else {
        steer[i] = view.getInt16(p) * STEER_QUANTUM;
        p += 2;
      }
    }
    if (p !== bytes.byteLength) return null;
    return { seed, difficulty, steps, from, steer, flags, truncated };
  } catch {
    return null;
  }
}
