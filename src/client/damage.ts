/**
 * Le voile rouge de dégâts : plein écran, au-dessus du canvas et sous le HUD.
 *
 * Même piste que `overlay.ts` — un élément DOM plutôt qu'une passe de rendu,
 * quantifié pour n'écrire dans le style que lorsque la valeur affichée change.
 * L'intensité suit la coque directement : invisible à `HULL_START` % ou plus,
 * plein à 0. En dessous de `HULL_BLINK` % elle clignote, pour qu'une coque au
 * bord de la casse se sente même quand le joueur ne regarde pas sa jauge.
 *
 * **Le clignotement est une animation CSS, pas une oscillation écrite depuis
 * la boucle.** Il l'a été : une sinusoïde sur l'horloge d'affichage qui
 * réécrivait `--sev` quatre fois par seconde, donc quatre invalidations par
 * seconde d'un dégradé radial plein écran. Mesuré, le voile fixe ne coûte
 * rien — allumé, éteint ou retiré du DOM, la cadence est la même — et le voile
 * clignotant coûtait un quart de la cadence. Ici le JS ne pose qu'une classe,
 * et `prefers-reduced-motion` éteint l'animation en CSS, où le voile reste
 * plein plutôt que de pulser.
 */

const STEPS = 32;

/**
 * Coque restante, en pourcents, entre laquelle le voile va de rien à plein.
 *
 * 30 d'abord, et jamais vu en jeu : mesuré, un frottement de mur tenu sans
 * interruption coûte environ 3 % de coque par seconde, donc il fallait plus de
 * vingt secondes contre la paroi pour passer la barre, et un choc franc tue
 * bien avant. Le teintage commence maintenant là où la coque est vraiment
 * entamée plutôt qu'au dernier tiers.
 */
const HULL_START = 55;

/** Coque restante sous laquelle le voile clignote plutôt que de tenir. */
const HULL_BLINK = 15;

export class DamageOverlay {
  private readonly element = document.getElementById('damage');
  private last = -1;
  private blinking = false;

  /**
   * @param hull la coque restante, 0 à 100.
   * @param playing hors partie le voile est éteint, quoi que vaille la coque.
   *   Sans ce drapeau la remise à zéro de la fin de partie était réécrite à la
   *   frame suivante — `hull` reste à zéro après un crash, et cette fonction
   *   tourne aussi sur l'écran de score, sur le menu et pendant l'attract —
   *   donc le voile continuait de clignoter, remis à zéro ou non.
   */
  update(hull: number, playing = true): void {
    const el = this.element;
    if (!el) return;
    if (!playing) {
      if (this.last !== 0) {
        this.last = 0;
        el.style.opacity = '0';
      }
      this.setBlink(el, false);
      return;
    }

    const severity = Math.min(1, Math.max(0, (HULL_START - hull) / HULL_START));
    this.setBlink(el, severity > 0 && hull <= HULL_BLINK);

    const step = Math.round(severity * STEPS);
    if (step === this.last) return;
    this.last = step;

    if (step <= 0) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '1';
    el.style.setProperty('--sev', (step / STEPS).toFixed(3));
  }

  /** Une écriture par bascule, jamais une par frame. */
  private setBlink(el: HTMLElement, on: boolean): void {
    if (on === this.blinking) return;
    this.blinking = on;
    el.classList.toggle('blink', on);
  }

  reset(): void {
    this.last = -1;
    this.update(100);
  }
}
