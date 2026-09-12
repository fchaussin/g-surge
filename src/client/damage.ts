/**
 * Le voile rouge de dégâts : plein écran, au-dessus du canvas et sous le HUD.
 *
 * Même piste que `overlay.ts` — un élément DOM plutôt qu'une passe de rendu,
 * quantifié pour n'écrire dans le style que lorsque la valeur affichée change.
 * L'intensité suit la coque directement : invisible à `HULL_START` % ou plus,
 * plein à 0. En dessous de `HULL_BLINK` % elle clignote, pour qu'une coque au
 * bord de la casse se sente même quand le joueur ne regarde pas sa jauge —
 * coupé sous `prefers-reduced-motion`, où le voile reste plein plutôt que de
 * pulser.
 */

const STEPS = 32;

/** Coque restante, en pourcents, entre laquelle le voile va de rien à plein. */
const HULL_START = 30;

/** Coque restante sous laquelle le voile clignote plutôt que de tenir. */
const HULL_BLINK = 10;

const BLINK_HZ = 4;

export class DamageOverlay {
  private readonly element = document.getElementById('damage');
  private readonly damped =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private last = -1;

  /**
   * @param hull la coque restante, 0 à 100.
   * @param elapsed horloge d'affichage : seule l'oscillation du clignotement
   *   la lit, jamais la simulation.
   * @param playing hors partie le voile est éteint, quoi que vaille la coque.
   *   Sans ce drapeau la remise à zéro de la fin de partie était réécrite à la
   *   frame suivante — `hull` reste à zéro après un crash, et cette fonction
   *   tourne aussi sur l'écran de score, sur le menu et pendant l'attract —
   *   donc le voile continuait de clignoter, remis à zéro ou non.
   */
  update(hull: number, elapsed: number, playing = true): void {
    const el = this.element;
    if (!el) return;
    if (!playing) {
      if (this.last !== 0) {
        this.last = 0;
        el.style.opacity = '0';
      }
      return;
    }

    const severity = Math.min(1, Math.max(0, (HULL_START - hull) / HULL_START));
    let level = severity;
    if (!this.damped && severity > 0 && hull <= HULL_BLINK) {
      const wave = Math.sin(elapsed * BLINK_HZ * Math.PI * 2);
      level = severity * (wave > 0 ? 1 : 0.25);
    }

    const step = Math.round(level * STEPS);
    if (step === this.last) return;
    this.last = step;

    if (step <= 0) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '1';
    el.style.setProperty('--sev', (step / STEPS).toFixed(3));
  }

  reset(): void {
    this.last = -1;
    this.update(100, 0);
  }
}
