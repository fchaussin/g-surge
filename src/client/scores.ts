/**
 * Le tableau des scores local.
 *
 * Les cinq meilleures parties, dans `localStorage`. L'accès est gardé par une
 * sonde d'écriture parce que la navigation privée lève au premier contact au
 * lieu de rendre null, et un jeu qui plante au chargement dans une fenêtre
 * privée est pire qu'un jeu qui oublie ses scores.
 */
import type { Difficulty } from '../sim/index.js';

/**
 * Où vit le tableau.
 *
 * Le suffixe suit **la compatibilité des scores, pas la version du jeu**. Il
 * bouge quand un changement rend les anciens scores incomparables aux
 * nouveaux, et reste en place à travers toute fonctionnalité qui ne le fait
 * pas — sinon chaque version effacerait le tableau sans raison.
 *
 * v2 existe parce que 1.1.0 a calé l'échelle des pièces sur le barreau de
 * poussée, ce qui a déplacé le multiplicateur atteignable de 26 / 21 / 11 à
 * 22 / 29 / 17 selon la difficulté. Un tableau tenant les deux classerait deux
 * jeux différents l'un contre l'autre, ce qui est pire qu'un tableau qui
 * repart.
 *
 * Les entrées v1 sont laissées où elles sont, ni migrées ni supprimées. Migrer
 * porterait les scores incomparables plus loin, ce qui est tout l'intérêt de
 * bouger ; supprimer détruirait le record de quelqu'un pour récupérer quelques
 * centaines d'octets. Même chose pour `voidrunner.scores.v1`, plus vieux
 * encore, dont la migration est retirée ici : il appartenait à la même ère de
 * score que v1.
 */
const KEY = 'gsurge.scores.v2';

const KEEP = 5;
/** Sous ce score une partie ne vaut pas une ligne ; c'est d'ordinaire un faux clic. */
const MIN_SCORE = 50;

export interface ScoreEntry {
  /** Le score, pas la distance. Le nom du champ précède le changement et reste par compatibilité. */
  d: number;
  /** Pièces ramassées. */
  c: number;
  /** Horodatage. */
  t: number;
  /** Première lettre de la difficulté. */
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

  /** Le plus haut score conservé, ou zéro. */
  get best(): number {
    return this.entries[0]?.d ?? 0;
  }

  get bestLabel(): string {
    return `best ${fmt(this.best)}`;
  }

  /**
   * Ajoute une partie et dit si elle a pris la première place, plus ce que la
   * première place valait avant — l'écran de score montre les deux.
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

  /** La navigation privée lève à l'accès au lieu de rendre null. */
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
      // Quota atteint. Le tableau reste juste en mémoire pour cette session.
    }
  }
}
