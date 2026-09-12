/**
 * Les tickets : une partie classée commence par en demander un.
 *
 * Le ticket porte la graine, que le client ne voit jamais — il reçoit la
 * piste par tranches, `track.ts` — et l'heure d'émission, que la soumission
 * est mesurée contre : une partie de `steps` pas ne peut pas arriver avant
 * `steps × DT` secondes, ni longtemps après. Une partie par ticket, en temps
 * réel ; c'est le levier « ticket » de `docs/NETWORK.md`.
 *
 * Le stockage est celui de l'objet : un ticket par clé, balayé à l'émission
 * suivante quand il est périmé. Tout est mesuré à l'horloge de l'objet, donc
 * le décalage d'horloge du client n'entre pas.
 */
import type { Difficulty } from '../../src/sim/index.js';

export interface Ticket {
  readonly seed: string;
  readonly difficulty: Difficulty;
  /** `Date.now()` de l'objet à l'émission. */
  readonly issued: number;
}

/** Une partie classée dure au plus une heure ; au-delà le ticket ne vaut plus rien. */
export const TICKET_LIFE_MS = 60 * 60 * 1000;
/**
 * Marge sur la soumission : la partie doit avoir duré au moins sa durée
 * simulée moins ceci — un client peut avoir joué la première seconde avant que
 * la réponse au ticket ne soit comptée — et au plus sa durée plus la vie du ticket.
 */
export const EARLY_SLACK_MS = 2000;

const PREFIX = 'ticket:';

/** Seize octets d'aléa en hexadécimal : un identifiant ou une graine. */
export function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export class Tickets {
  constructor(private readonly storage: DurableObjectStorage) {}

  async issue(difficulty: Difficulty, now: number): Promise<{ id: string; ticket: Ticket }> {
    const id = randomHex();
    const ticket: Ticket = { seed: randomHex(), difficulty, issued: now };
    await this.storage.put(PREFIX + id, ticket);
    await this.sweep(now);
    return { id, ticket };
  }

  async get(id: string): Promise<Ticket | null> {
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    return (await this.storage.get<Ticket>(PREFIX + id)) ?? null;
  }

  /** Un ticket consommé ne sert qu'une fois. */
  async consume(id: string): Promise<void> {
    await this.storage.delete(PREFIX + id);
  }

  /**
   * Une soumission de `simulatedMs` millisecondes de partie, reçue à `now`,
   * est-elle dans la fenêtre du ticket ? Rend le refus, ou `null` si c'est bon.
   */
  static window(ticket: Ticket, simulatedMs: number, now: number): 'early' | 'expired' | null {
    const elapsed = now - ticket.issued;
    if (elapsed + EARLY_SLACK_MS < simulatedMs) return 'early';
    if (elapsed > simulatedMs + TICKET_LIFE_MS) return 'expired';
    return null;
  }

  /** Efface les tickets périmés, quelques-uns par appel : le balayage est amorti, jamais long. */
  private async sweep(now: number): Promise<void> {
    const old = await this.storage.list<Ticket>({ prefix: PREFIX, limit: 64 });
    const gone: string[] = [];
    for (const [key, t] of old) if (now - t.issued > 2 * TICKET_LIFE_MS) gone.push(key);
    if (gone.length) await this.storage.delete(gone);
  }
}
