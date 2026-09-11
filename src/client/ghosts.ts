/**
 * La meilleure partie de chaque difficulté, gardée pour courir contre elle.
 *
 * Une entrée par difficulté dans `localStorage`, sous la forme compacte de
 * `packTrace` en base64 — cinquante à soixante-dix kilo-octets pour trois
 * minutes au manche, contre quelques centaines en JSON, ce qui est la
 * différence entre tenir dans le stockage partagé de l'origine et le saturer.
 * Le score est rangé à côté pour comparer sans rejouer.
 *
 * Même sonde d'écriture que le tableau des scores : la navigation privée lève
 * au premier contact, et un jeu qui plante au chargement pour un fantôme est
 * pire qu'un jeu qui l'oublie.
 */
import { packTrace, unpackTrace, validTrace, type Difficulty, type Trace } from '../sim/index.js';

/** Suit la forme de la trace, pas la version du jeu : `packTrace` dit `FORMAT`, ceci dit où. */
const KEY = 'gsurge.ghost.v1';

interface Stored {
  score: number;
  bytes: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  // par tranches : `fromCharCode` sur cent mille arguments dépasse la pile
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export class GhostStore {
  private readonly available: boolean;

  constructor() {
    this.available = GhostStore.probe();
  }

  /** La meilleure trace de la difficulté, ou rien. */
  best(difficulty: Difficulty): { trace: Trace; score: number } | null {
    const stored = this.read(difficulty);
    if (!stored) return null;
    try {
      const trace = unpackTrace(fromBase64(stored.bytes));
      if (!trace || !validTrace(trace) || trace.difficulty !== difficulty) return null;
      return { trace, score: stored.score };
    } catch {
      return null;
    }
  }

  /** Score de la meilleure trace, sans la décoder. Zéro sans trace. */
  bestScore(difficulty: Difficulty): number {
    return this.read(difficulty)?.score ?? 0;
  }

  /**
   * Propose une partie finie. Gardée si elle bat la précédente ; dit si elle
   * l'a été. Une trace tronquée ou vide n'est jamais gardée : elle ne
   * reproduirait pas la partie.
   */
  offer(trace: Trace, score: number): boolean {
    if (!this.available || !validTrace(trace) || trace.steps === 0) return false;
    if (score <= this.bestScore(trace.difficulty)) return false;
    try {
      const stored: Stored = { score, bytes: toBase64(packTrace(trace)) };
      localStorage.setItem(`${KEY}.${trace.difficulty}`, JSON.stringify(stored));
      return true;
    } catch {
      // quota dépassé, ou stockage refusé : la partie reste, le fantôme non
      return false;
    }
  }

  clear(): void {
    if (!this.available) return;
    for (const d of ['easy', 'medium', 'hard'] as const) {
      try {
        localStorage.removeItem(`${KEY}.${d}`);
      } catch {
        /* ignoré */
      }
    }
  }

  private read(difficulty: Difficulty): Stored | null {
    if (!this.available) return null;
    try {
      const raw = localStorage.getItem(`${KEY}.${difficulty}`);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<Stored>;
      if (typeof v.score !== 'number' || typeof v.bytes !== 'string') return null;
      return { score: v.score, bytes: v.bytes };
    } catch {
      return null;
    }
  }

  private static probe(): boolean {
    try {
      const k = `${KEY}.probe`;
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }
}
