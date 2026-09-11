/**
 * Help bubbles, on a clock, once per run.
 *
 * On a timer rather than on progress: they teach the loop — drift, then boost,
 * then chase the multiplier — and that order is what a player needs in their
 * first minute, whether or not they got far.
 */
const TIPS: readonly (readonly [number, string])[] = [
  [1.5, 'Steer with the <b>stick</b>.<br>Hold <b>BOOST</b> on straights.'],
  [7.0, '<b>Drift</b> in corners.<br>Sliding <b>refills the boost</b>.'],
  [14.0, 'Coins raise your <b>multiplier</b>.<br>Higher rungs pay more.'],
  [22.0, 'Drift <b>while boosting</b> to climb<br>to a <b>super boost</b>.'],
  [31.0, 'A wall <b>halves the multiplier</b><br>and empties the climb.'],
  [40.0, 'Past <b>1000 km/h</b> the multiplier<br>holds twice as long.'],
];

/** How long each bubble stays up, in seconds. */
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

  /** Call once a frame while a run is on. */
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
