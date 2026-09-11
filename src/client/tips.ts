/**
 * Les bulles d'aide, à l'horloge, une fois par partie.
 *
 * Au minuteur plutôt qu'à la progression : elles enseignent la boucle — drifter,
 * puis booster, puis courir après le multiplicateur — et cet ordre est ce dont
 * un joueur a besoin dans sa première minute, qu'il soit allé loin ou non. Les
 * textes sont de l'interface, donc en anglais.
 */
/** Le tactile parle manche et pads ; le clavier flèches et Espace. */
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const TIPS: readonly (readonly [number, string])[] = [
  TOUCH
    ? [1.5, 'Steer with the <b>stick</b>.<br>Hold <b>BOOST</b> on straights.']
    : [1.5, 'Steer with the <b>arrows</b>.<br>Hold <b>SPACE</b> on straights.'],
  [7.0, '<b>Drift</b> in corners.<br>Sliding <b>refills the boost</b>.'],
  [14.0, 'Coins raise your <b>multiplier</b>.<br>Higher rungs pay more.'],
  [22.0, 'Drift <b>while boosting</b> to climb<br>to a <b>super boost</b>.'],
  [31.0, 'A wall <b>halves the multiplier</b><br>and empties the climb.'],
  [40.0, 'Past <b>1000 km/h</b> the multiplier<br>holds twice as long.'],
];

/** Durée d'affichage de chaque bulle, en secondes. */
const SHOW_FOR = 4.5;

export class Tips {
  private enabled = true;
  private index = 0;
  private elapsed = 0;
  private hideAt = 0;
  private readonly toast = document.getElementById('toast');

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.hide();
  }

  reset(): void {
    this.index = 0;
    this.elapsed = 0;
    this.hideAt = 0;
    this.hide();
  }

  /** À appeler une fois par frame pendant une partie. */
  update(frameDt: number): void {
    this.elapsed += frameDt;

    if (this.enabled && this.index < TIPS.length && this.elapsed >= TIPS[this.index]![0]) {
      if (this.toast) {
        this.toast.innerHTML = TIPS[this.index]![1];
        this.toast.classList.add('on');
      }
      this.hideAt = this.elapsed + SHOW_FOR;
      this.index++;
    }
    if (this.hideAt && this.elapsed >= this.hideAt) {
      this.hideAt = 0;
      this.hide();
    }
  }

  private hide(): void {
    this.toast?.classList.remove('on');
  }
}
