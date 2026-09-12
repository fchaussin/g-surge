/**
 * La piste servie par tranches, côté client.
 *
 * Une `QueuedNodes` attachée à la piste vivante, et une boucle qui la garde
 * pleine : sous `LOW` nœuds d'avance, la tranche suivante est demandée ; une
 * requête ratée est simplement redemandée, parce que les tranches sont
 * adressées par segment et que la file ignore ce qu'elle a déjà. Le tampon
 * est dimensionné pour ça — voir docs/NETWORK.md : entre deux et trois
 * tranches d'avance, quinze à vingt secondes au plafond pour rater trois ou
 * quatre requêtes avant que la piste ne soit sèche.
 *
 * Aucune promesse n'est attendue dans la boucle de frame : `pump()` regarde
 * l'état et lance au plus une requête, dont l'issue reviendra plus tard.
 */
import { QueuedNodes, unpackNodes, type Sim, type WireChunk } from '../sim/index.js';
import { api, type Issued } from './api.js';

/** Une tranche du serveur, en segments ; `LOW` en est deux. */
export const CHUNK = 256;
export const LOW = 2 * CHUNK;

export class TrackStream {
  readonly queue = new QueuedNodes();
  private inflight = false;
  /** Requêtes ratées d'affilée, pour la télémétrie et rien d'autre : on redemande toujours. */
  failures = 0;

  constructor(readonly ticket: string) {}

  /** Depuis un ticket : la première tranche est déjà là. `null` si elle est mal formée. */
  static from(issued: Issued): TrackStream | null {
    const stream = new TrackStream(issued.ticket);
    return stream.accept(issued.chunk) ? stream : null;
  }

  /** Branche la file sur la piste vivante ; à faire après `sim.reset`, avant le premier pas. */
  attach(sim: Sim): void {
    sim.track.attach(this.queue);
  }

  /** À appeler à chaque frame. Lance la requête suivante s'il en faut une. */
  pump(): void {
    if (this.inflight || this.queue.ahead >= LOW) return;
    this.inflight = true;
    const from = this.queue.wanted;
    api
      .chunk(this.ticket, from)
      .then((chunk) => {
        if (!this.accept(chunk)) this.failures++;
        else this.failures = 0;
      })
      .catch(() => {
        this.failures++;
      })
      .finally(() => {
        this.inflight = false;
      });
  }

  private accept(chunk: WireChunk): boolean {
    const nodes = unpackNodes(chunk);
    if (!nodes) return false;
    this.queue.feed(nodes);
    return true;
  }
}
