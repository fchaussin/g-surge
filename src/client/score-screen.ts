/**
 * L'écran de fin de partie : sept chiffres comptés à la suite.
 *
 * Le décalage n'est pas une décoration. Distance, temps, vitesse moyenne,
 * vitesse de pointe, pièces, multiplicateur crête et total apparaissent dans
 * l'ordre où ils se combinent, pour que l'écran explique d'où vient le
 * nombre — c'est le seul endroit où le jeu enseigne que les pièces montent
 * le multiplicateur et que les murs le divisent par deux. Les deux vitesses
 * n'entrent pas dans le score : elles le qualifient — hautes avec un score
 * haut, c'est de la maîtrise. Le tableau classé lit les deux, avec la
 * distance, comme autant de catégories à côté du score — voir `board.ts`.
 */
import { formatClock } from './hud.js';

export interface ScoreBreakdown {
  distance: number;
  /** Secondes de partie, au pas fixe. */
  seconds: number;
  coins: number;
  peakMultiplier: number;
  /** m/s, la plus haute atteinte pendant la partie. */
  topSpeed: number;
  total: number;
  wasBest: boolean;
  previousBest: number;
  /** Le score du fantôme couru, s'il y en avait un. */
  ghostScore?: number | null;
  /** Une ligne sous le score : classée ou non, et pourquoi. */
  note?: string;
}

/** Délai entre deux lignes, et durée du comptage de chacune, en ms. */
const STAGGER = 260;
const COUNT_MS = 480;

const fmt = (v: number) => Math.round(v).toLocaleString('en-GB');
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class ScoreScreen {
  /** Annule une révélation encore en cours quand une nouvelle démarre. */
  private generation = 0;

  constructor(private readonly onRowDone?: (last: boolean) => void) {}

  /** La ligne de classement, réécrite quand le serveur répond. */
  note(text: string): void {
    const el = document.getElementById('overNote');
    if (el) el.textContent = text;
  }

  show(breakdown: ScoreBreakdown): void {
    const id = ++this.generation;
    const rows = [
      {
        el: document.getElementById('sDist'),
        to: Math.round(breakdown.distance),
        suffix: ' m',
        dec: 0,
        prefix: '',
      },
      {
        el: document.getElementById('sTime'),
        to: breakdown.seconds,
        suffix: '',
        dec: 0,
        prefix: '',
        format: formatClock,
      },
      {
        el: document.getElementById('sAvg'),
        to: breakdown.seconds > 0 ? (breakdown.distance / breakdown.seconds) * 3.6 : 0,
        suffix: ' km/h',
        dec: 0,
        prefix: '',
      },
      {
        el: document.getElementById('sTopSpeed'),
        to: breakdown.topSpeed * 3.6,
        suffix: ' km/h',
        dec: 0,
        prefix: '',
      },
      {
        el: document.getElementById('sCoins'),
        to: breakdown.coins,
        suffix: '',
        dec: 0,
        prefix: '',
      },
      {
        el: document.getElementById('sBonus'),
        to: breakdown.peakMultiplier,
        suffix: '',
        dec: 1,
        prefix: '×',
      },
      {
        el: document.getElementById('sTotal'),
        to: Math.round(breakdown.total),
        suffix: '',
        dec: 0,
        prefix: '',
      },
    ];

    const hint = document.getElementById('sMul');
    if (hint) hint.textContent = 'coins raise it, walls halve it';
    const tag = document.getElementById('overTag');
    if (tag) tag.textContent = '';
    const ghostTag = document.getElementById('overGhost');
    if (ghostTag) ghostTag.textContent = '';
    this.note(breakdown.note ?? '');

    for (const row of rows) {
      if (!row.el) continue;
      row.el.textContent = `${row.prefix}${row.format ? row.format(0) : row.dec ? '0.0' : '0'}${row.suffix}`;
      row.el.parentElement?.classList.add('pending');
    }

    const rung = rows.map(() => false);
    const t0 = performance.now();

    const tick = (now: number): void => {
      // Une relance pendant le comptage ne doit pas continuer d'écrire dans le DOM.
      if (id !== this.generation) return;
      const t = now - t0;
      let done = 0;

      rows.forEach((row, i) => {
        if (!row.el) {
          done++;
          return;
        }
        const k = clamp01((t - i * STAGGER) / COUNT_MS);
        if (k > 0) row.el.parentElement?.classList.remove('pending');
        const eased = 1 - Math.pow(1 - k, 3);
        const v = row.to * eased;
        row.el.textContent =
          row.prefix +
          (row.format ? row.format(v) : row.dec ? v.toFixed(row.dec) : fmt(v)) +
          row.suffix;
        if (k >= 1) {
          done++;
          if (!rung[i]) {
            rung[i] = true;
            this.onRowDone?.(i === rows.length - 1);
          }
        }
      });

      if (done < rows.length) requestAnimationFrame(tick);
      else {
        if (tag) {
          tag.textContent =
            breakdown.total < 50
              ? ''
              : breakdown.wasBest
                ? 'NEW BEST'
                : `best ${fmt(breakdown.previousBest)}`;
        }
        const raced = breakdown.ghostScore;
        if (ghostTag && raced !== undefined && raced !== null) {
          const by = Math.round(breakdown.total - raced);
          ghostTag.textContent =
            by > 0 ? `GHOST BEATEN BY ${fmt(by)}` : `ghost ahead by ${fmt(-by)}`;
        }
      }
    };
    requestAnimationFrame(tick);
  }
}
