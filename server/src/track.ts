/**
 * La piste servie par tranches.
 *
 * Le serveur garde la graine et sert les nœuds devant le vaisseau, `CHUNK`
 * segments à la fois, adressés par identifiant absolu de segment. La même
 * plage rend toujours les mêmes octets, donc une requête rejouée coûte une
 * requête et rien d'autre : c'est ce qui rend les nouvelles tentatives
 * gratuites côté client, `QueuedNodes` ne gardant que ce qui prolonge.
 *
 * Régénéré depuis la graine à chaque requête plutôt que mis en cache : un
 * nœud coûte quelques microsecondes, et une partie de 10 km en demande huit
 * cents — moins qu'une lecture de stockage.
 */
import {
  packNodes,
  SeededNodes,
  tuningFor,
  type Difficulty,
  type Node,
  type WireChunk,
} from '../../src/sim/index.js';

/** 256 segments, 3 km : voir le dimensionnement dans docs/NETWORK.md. */
export const CHUNK = 256;
/** Au-delà, ce n'est plus une partie : 100 000 segments font 1 200 km. */
const MAX_FROM = 100_000;

export function chunk(seed: string, difficulty: Difficulty, from: number): WireChunk | null {
  if (!Number.isInteger(from) || from < 0 || from > MAX_FROM) return null;
  const gen = new SeededNodes(tuningFor(difficulty), seed);
  const nodes: Node[] = [];
  for (let i = 0; i < from + CHUNK; i++) {
    const n = gen.next();
    if (i >= from) nodes.push(n);
  }
  return packNodes(nodes);
}
