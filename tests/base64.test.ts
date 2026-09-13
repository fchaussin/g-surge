/**
 * Le base64 du client est celui de Node, octet pour octet.
 *
 * C'est la moitié navigateur d'un chemin que rien d'autre ne testait : la
 * trace part en `packTrace` puis `toBase64`, et le serveur la lit avec
 * `atob`. Un base64 sans bourrage, ou en variante URL, passerait `verify` et
 * casserait chaque vraie partie classée. Les longueurs couvrent la tranche de
 * 0x8000 par laquelle `toBase64` découpe `fromCharCode`.
 */
import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../src/client/base64.js';

const bytesOf = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7919 + 13) & 255;
  return b;
};

describe('base64', () => {
  it('matches Buffer and round-trips, across the 0x8000 chunk boundary', () => {
    for (const n of [0, 1, 2, 3, 100, 0x7fff, 0x8000, 0x8001, 0x18003]) {
      const bytes = bytesOf(n);
      const encoded = toBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect(fromBase64(encoded)).toEqual(bytes);
    }
  });
});
