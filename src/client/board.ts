/**
 * L'écran du tableau hebdomadaire : lit `GET /board/:difficulty`, montre le
 * top dix et le temps avant la remise à zéro — ou dit pourquoi rien ne
 * s'affiche, sans jamais faire semblant d'avoir une réponse.
 *
 * Une lecture par ouverture d'écran et par changement de difficulté, jamais
 * suivie ensuite : le tableau reste correct à la fraction de seconde près où
 * il a été lu, ce qui suffit à une chose qui ne bouge qu'une fois la partie
 * classée quelqu'un soumise.
 */
import type { Difficulty } from '../sim/index.js';
import { api, online, type Board, type BoardCategory, type BoardEntry } from './api.js';

const fmt = (v: number): string => Math.round(v).toLocaleString('en-GB');
const kmh = (mps: number): string => `${fmt(mps * 3.6)} km/h`;

/**
 * La colonne affichée par catégorie. La vitesse moyenne n'a pas de champ
 * dédié — `dist` et `time` suffisent, gardés contre une partie à peine
 * commencée où `time` vaut encore zéro.
 */
const VALUE_BY_CATEGORY: Record<BoardCategory, (e: BoardEntry) => string> = {
  score: (e) => fmt(e.score),
  dist: (e) => `${fmt(e.dist)} m`,
  speedPeak: (e) => kmh(e.speedPeak),
  avg: (e) => kmh(e.time > 0 ? e.dist / e.time : 0),
};

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Le serveur assainit déjà le nom ; échappé quand même, une lecture réseau est une entrée non fiable. */
function countdown(resetAt: number): string {
  const ms = resetAt - Date.now();
  if (ms <= 0) return 'resetting…';
  const totalHours = Math.floor(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `resets in ${days}d ${hours}h` : `resets in ${hours}h`;
}

export class BoardScreen {
  private difficulty: Difficulty;
  private category: BoardCategory = 'score';
  /** Compte les lectures : une réponse tardive d'une difficulté quittée n'écrase pas la suivante. */
  private token = 0;

  constructor(
    private readonly body: HTMLElement | null,
    private readonly resetLine: HTMLElement | null,
    initialDifficulty: Difficulty,
  ) {
    this.difficulty = initialDifficulty;
  }

  setDifficulty(d: Difficulty): void {
    this.difficulty = d;
    this.load();
  }

  setCategory(c: BoardCategory): void {
    this.category = c;
    this.load();
  }

  /** À l'ouverture de l'écran : toujours une lecture fraîche, jamais celle d'une visite précédente. */
  open(): void {
    this.load();
  }

  private async load(): Promise<void> {
    if (!this.body) return;
    const shown = ++this.token;

    if (!online()) {
      this.render('Offline — the weekly board needs a connection.');
      return;
    }
    this.render('Loading…');

    let board: Board;
    try {
      board = await api.board(this.difficulty, this.category);
    } catch {
      if (shown === this.token) this.render('Could not reach the board.');
      return;
    }
    if (shown !== this.token) return;

    if (this.resetLine) this.resetLine.textContent = countdown(board.resetAt);
    if (!board.entries.length) {
      this.render('No ranked runs yet this week.');
      return;
    }
    const value = VALUE_BY_CATEGORY[this.category];
    this.body.innerHTML = `<ol>${board.entries
      .map(
        (e, i) =>
          `<li><span class="rk">${i + 1}</span>` +
          `<span class="nm">${escapeHtml(e.name)}</span>` +
          `<span class="dv">${value(e)}</span></li>`,
      )
      .join('')}</ol>`;
  }

  private render(message: string): void {
    if (this.body) this.body.innerHTML = `<p class="empty">${message}</p>`;
    if (this.resetLine) this.resetLine.textContent = '';
  }
}
