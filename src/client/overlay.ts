/**
 * Le calque plein écran du G-SURGE : voile blanc et flou périphérique.
 *
 * Pourquoi un élément DOM plutôt qu'une passe de rendu : la liste des pièges de
 * CLAUDE.md tranche déjà la question — `filter: blur` sur un élément transformé
 * en 3D rastérise en basse résolution, et il faut flouter en espace écran avec
 * `backdrop-filter`. Une vraie passe demanderait une cible de rendu, des dessins
 * supplémentaires et une interaction avec `renderScale` et la qualité
 * automatique, pour un pipeline dont le jeu n'a aucune trace.
 *
 * Le masque radial est ce qui en fait une vision tunnel plutôt qu'un flou
 * global : le centre reste net pendant que la périphérie se brouille. Le champ
 * de vision s'élargit de 26° au même moment, donc le champ réel grandit pendant
 * que le champ utile rétrécit — c'est la tension qu'on cherche.
 *
 * Deux règles de la maison s'appliquent. On n'écrit dans le DOM que si la
 * valeur a changé, d'où la quantification : une écriture de style par frame est
 * ce que `hud.ts` interdit explicitement. Et `prefers-reduced-motion` amortit
 * l'ensemble, parce qu'un voile qui enfle et une image qui tremble sont
 * exactement ce que ce réglage existe pour éviter.
 */

/** Pas de quantification : 32 crans suffisent et divisent les écritures. */
const STEPS = 32;

/** Flou maximal en périphérie, et opacité maximale du voile. */
const BLUR_PX = 7;
const VEIL = 0.3;

export class SurgeOverlay {
  private readonly element = document.getElementById('surge');
  private readonly damped =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private last = -1;

  /** Vrai à la dernière écriture ; un changement force une réécriture. */
  private lastBlur = true;

  /**
   * @param level 0 à 1, l'intensité de l'état.
   * @param blur faux quand la machine a déjà dû baisser la qualité — détail du
   *   ciel réduit ou échelle de rendu sous 1, par le gouverneur ou par le joueur.
   *   Le voile reste, le flou plein écran est le seul effet du jeu dont le
   *   coût GPU dépasse le sien propre, et la palette le voulait derrière le
   *   gouverneur dès le premier jour.
   */
  update(level: number, blur = true): void {
    const el = this.element;
    if (!el) return;

    const scaled = this.damped ? level * 0.35 : level;
    const step = Math.round(scaled * STEPS);
    if (step === this.last && blur === this.lastBlur) return;
    this.last = step;
    this.lastBlur = blur;

    const v = step / STEPS;
    if (v <= 0) {
      el.style.opacity = '0';
      // Le flou coûte même invisible : on le retire plutôt que de l'annuler.
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
      return;
    }
    el.style.opacity = '1';
    if (blur) {
      const filter = `blur(${(v * BLUR_PX).toFixed(2)}px)`;
      el.style.backdropFilter = filter;
      el.style.setProperty('-webkit-backdrop-filter', filter);
    } else {
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
    }
    el.style.setProperty('--veil', (v * VEIL).toFixed(3));
  }

  reset(): void {
    this.last = -1;
    this.lastBlur = true;
    this.update(0);
  }
}
