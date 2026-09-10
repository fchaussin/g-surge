/**
 * The local leaderboard.
 *
 * Five best runs, kept in `localStorage`. Access is guarded by a write probe
 * because private browsing throws on the first touch rather than returning
 * null, and a game that crashes on load in a private window is worse than one
 * that forgets its scores.
 */
import type { Difficulty } from '../sim/index.js';

/**
 * Where the board lives.
 *
 * The suffix tracks **scoring compatibility, not the version of the game**. It
 * moves when a change makes old scores incomparable to new ones, and stays put
 * through every feature that does not — otherwise every release would wipe the
 * board for no reason.
 *
 * v2 exists because 1.1.0 keyed the coin ladder to the thrust rung, which moved
 * the reachable multiplier from 26 / 21 / 11 to 22 / 29 / 17 across the
 * difficulties. A board holding both would be ranking two different games
 * against each other, which is worse than a board that starts again.
 *
 * The v1 entries are left where they are, neither migrated nor deleted.
 * Migrating would carry the incomparable scores forward, which is the whole
 * point of moving; deleting would destroy someone's record to reclaim a few
 * hundred bytes. The same goes for `voidrunner.scores.v1`, older still, whose
 * migration is retired with this: it belonged to the same scoring era as v1.
 */
const KEY = 'gsurge.scores.v2';

const KEEP = 5;
/** Below this a run is not worth a row; it is usually a misclick. */
const MIN_SCORE = 50;

export interface ScoreEntry {
  /** Score, not distance. The field name predates the change and stays for compatibility. */
  d: number;
  /** Coins collected. */
  c: number;
  /** Timestamp. */
  t: number;
  /** First letter of the difficulty. */
  x: string;
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-GB');

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export class Scores {
  private entries: ScoreEntry[] = [];
  private readonly available: boolean;

  constructor() {
    this.available = Scores.probe();
    this.load();
  }

  /** Highest score kept, or zero. */
  get best(): number {
    return this.entries[0]?.d ?? 0;
  }

  get bestLabel(): string {
    return `best ${fmt(this.best)}`;
  }

  /**
   * Adds a run and returns whether it took the top spot, plus what the top
   * spot was before — the score screen shows both.
   */
  submit(
    score: number,
    coins: number,
    difficulty: Difficulty,
    now: number,
  ): {
    accepted: boolean;
    wasBest: boolean;
    previousBest: number;
  } {
    const value = Math.round(score);
    const previousBest = this.best;
    if (value < MIN_SCORE) return { accepted: false, wasBest: false, previousBest };

    this.entries.push({ d: value, c: coins, t: now, x: difficulty[0]!.toUpperCase() });
    this.entries.sort((a, b) => b.d - a.d);
    this.entries = this.entries.slice(0, KEEP);
    this.persist();
    this.render();
    return { accepted: true, wasBest: value > previousBest, previousBest };
  }

  clear(): void {
    this.entries = [];
    this.persist();
    this.render();
  }

  render(): void {
    const host = document.getElementById('boardBody');
    if (host) {
      host.innerHTML = this.entries.length
        ? `<ol>${this.entries
            .map(
              (s, i) =>
                `<li><span class="rk">${i + 1}</span>` +
                `<span class="dv">${fmt(s.d)}</span>` +
                `<span class="dt">${s.x ? `${s.x}  ` : ''}` +
                `${s.c ? `${s.c} coins  ` : ''}${fmtDate(s.t)}</span></li>`,
            )
            .join('')}</ol>`
        : '<p class="empty">No runs yet. A score enters the board when you crash, restart or quit.</p>';
    }
    const line = document.getElementById('recline');
    if (line) line.textContent = this.bestLabel;
  }

  /** Private browsing throws on access rather than returning null. */
  private static probe(): boolean {
    try {
      const k = '__gs_probe';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  private load(): void {
    if (this.available) {
      try {
        const raw = window.localStorage.getItem(KEY);
        if (raw) this.entries = (JSON.parse(raw) as ScoreEntry[]) ?? [];
      } catch {
        this.entries = [];
      }
    }
    this.render();
  }

  private persist(): void {
    if (!this.available) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      // Quota reached. The board stays correct in memory for this session.
    }
  }
}
