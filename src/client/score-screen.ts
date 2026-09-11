/**
 * L'écran de fin de partie : quatre chiffres comptés à la suite.
 *
 * Le décalage n'est pas une décoration. Distance, pièces, multiplicateur crête
 * et total apparaissent dans l'ordre où ils se combinent, pour que l'écran
 * explique d'où vient le nombre — c'est le seul endroit où le jeu enseigne que
 * les pièces montent le multiplicateur et que les murs le divisent par deux.
 */
export interface ScoreBreakdown {
  distance: number;
  coins: number;
  peakMultiplier: number;
  total: number;
  wasBest: boolean;
  previousBest: number;
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

    for (const row of rows) {
      if (!row.el) continue;
      row.el.textContent = `${row.prefix}${row.dec ? '0.0' : '0'}${row.suffix}`;
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
        row.el.textContent = row.prefix + (row.dec ? v.toFixed(row.dec) : fmt(v)) + row.suffix;
        if (k >= 1) {
          done++;
          if (!rung[i]) {
            rung[i] = true;
            this.onRowDone?.(i === rows.length - 1);
          }
        }
      });

      if (done < rows.length) requestAnimationFrame(tick);
      else if (tag) {
        tag.textContent =
          breakdown.total < 50
            ? ''
            : breakdown.wasBest
              ? 'NEW BEST'
              : `best ${fmt(breakdown.previousBest)}`;
      }
    };
    requestAnimationFrame(tick);
  }
}
