/**
 * Le base64 des octets d'une trace, dans les deux sens.
 *
 * `packTrace` rend des octets et rien ne les transporte tels quels : le
 * stockage local veut une chaîne, et le corps d'une requête est du JSON. Les
 * deux usages — `ghosts.ts` et `api.ts` — passent par ici.
 *
 * Le noyau ne peut pas porter ces deux fonctions : `src/sim/` n'a ni `DOM` ni
 * `types`, donc ni `btoa` ni `atob`. Le serveur a son propre décodeur pour la
 * même raison, `server/src/wire.ts`.
 */

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  // par tranches : `fromCharCode` sur cent mille arguments dépasse la pile
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
