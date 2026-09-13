/**
 * Ce qui arrive sur le fil, ramené à une trace.
 *
 * Le client envoie la forme compacte de `packTrace` en base64 — quatre à six
 * fois plus courte que le JSON, ce qui est la différence entre une partie de
 * dix minutes au manche qui passe et une qui se fait refuser à l'entrée. La
 * forme JSON reste acceptée : pendant un déploiement, un joueur resté sur le
 * bundle d'avant envoie encore celle-là, et une partie ne se perd pas pour
 * ça.
 *
 * Le décodeur est ici et non dans `src/sim/` parce que le noyau n'a ni `DOM`
 * ni `types` : `atob` n'y existe pas. Le client a le sien pour la même raison,
 * `src/client/base64.ts`.
 */
import { unpackTrace, type Trace } from '../../src/sim/index.js';

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * La trace portée par un corps de requête, compacte ou JSON. `null` si ce
 * n'en est pas une — `validTrace` juge ensuite ce qu'elle vaut.
 */
export function asTrace(value: unknown): Trace | null {
  if (typeof value === 'string') {
    try {
      return unpackTrace(fromBase64(value));
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null) return value as Trace;
  return null;
}
