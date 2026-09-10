/**
 * Refresh detection and automatic quality. Nothing else.
 *
 * The game renders at whatever rate the display gives `requestAnimationFrame`
 * — there is no frame rate target and no throttle, by decision. An earlier
 * version carried both, plus a picker in the settings; the machinery existed
 * to spend less battery on purpose, nobody had asked for that, and its
 * integer-ratio subtleties had already produced the project's canonical
 * timing bug once. What the player wants is the device's best, and the way to
 * deliver that is to adapt the rendering cost, not the schedule.
 *
 * Detection stays because adaptive quality needs a yardstick: "is the game
 * holding what this display can do". Two traps live on, both paid for:
 *
 * - **Detection takes a median, not a mean.** A single long frame during
 *   startup would drag a mean far enough to snap to the wrong rate.
 * - **Automatic quality never switches the background off**, and needs several
 *   consecutive bad measurements. A single dip used to kill the game's visual
 *   signature outright.
 */

/** Rates the detector recognises. The measurement snaps to the nearest. */
const KNOWN_RATES = [60, 75, 90, 120, 144, 165, 240] as const;

/** Frames measured before the refresh rate is decided. */
const SAMPLES = 90;

/** Consecutive one-second windows in the same direction before acting. */
const WINDOWS = 3;

export interface PerformanceOptions {
  /** True while a run is on: quality only adapts during play. */
  isPlaying: () => boolean;
  /** Current background detail, and how to change it. */
  getSkyDetail: () => boolean;
  setSkyDetail: (high: boolean) => void;
  /** Current render scale, and how to change it. */
  getRenderScale: () => number;
  setRenderScale: (value: number) => void;
}

export class PerformanceGovernor {
  /** Zero until detection completes. */
  refreshHz = 0;
  /** Last measured frames per second. */
  fps = 60;

  private readonly samples: number[] = [];
  private frames = 0;
  private elapsed = 0;
  private runSeconds = 0;
  private hold = 0;
  private bad = 0;
  private good = 0;

  constructor(private readonly options: PerformanceOptions) {}

  /** Forces a fresh measurement, for when the display or window has moved. */
  redetect(): void {
    this.refreshHz = 0;
    this.samples.length = 0;
  }

  /** Feeds the detector. Call once per frame with the real delta. */
  detect(frameDt: number): void {
    if (this.refreshHz || frameDt <= 0 || frameDt > 0.2) return;
    this.samples.push(frameDt);
    if (this.samples.length < SAMPLES) return;

    // Median, not mean: a single long frame during startup would drag a mean
    // far enough to snap to the wrong rate.
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const raw = 1 / sorted[Math.floor(sorted.length / 2)]!;
    this.refreshHz = KNOWN_RATES.reduce(
      (best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best),
      60,
    );
  }

  /** One-second window. Measures, then adapts quality if it has to. */
  update(frameDt: number): void {
    this.frames++;
    this.elapsed += frameDt;
    if (this.elapsed < 1) return;

    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    // Running well above the detected rate means the detection was wrong,
    // usually because the window moved to another display.
    if (this.refreshHz && this.fps > this.refreshHz * 1.2) {
      this.redetect();
    }

    if (!this.options.isPlaying()) {
      this.runSeconds = 0;
      this.bad = this.good = 0;
      return;
    }
    this.runSeconds++;
    // The first seconds are shader compilation, not a verdict on the machine.
    if (this.runSeconds < 4) return;
    if (this.hold > 0) {
      this.hold--;
      return;
    }

    // The yardstick is the display itself: the game is doing its job when it
    // holds what the device can show.
    const reachable = this.refreshHz || 60;
    if (this.fps < reachable * 0.78) {
      this.bad++;
      this.good = 0;
    } else if (this.fps > reachable * 0.95) {
      this.good++;
      this.bad = 0;
    } else {
      this.bad = this.good = 0;
    }

    if (this.bad >= WINDOWS) {
      this.bad = 0;
      this.stepDown();
    } else if (this.good >= WINDOWS) {
      this.good = 0;
      this.stepUp();
    }
  }

  /** Detail first, resolution second: losing the sky is the bigger loss. */
  private stepDown(): void {
    if (this.options.getSkyDetail()) {
      this.options.setSkyDetail(false);
      this.hold = 3;
      return;
    }
    const scale = this.options.getRenderScale();
    if (scale > 0.7) {
      this.options.setRenderScale(Math.max(0.7, +(scale - 0.1).toFixed(2)));
      this.hold = 4;
    }
  }

  /** Recovered in the reverse order, and more slowly than it went down. */
  private stepUp(): void {
    const scale = this.options.getRenderScale();
    if (scale < 1) {
      this.options.setRenderScale(Math.min(1, +(scale + 0.05).toFixed(2)));
      this.hold = 4;
      return;
    }
    if (!this.options.getSkyDetail()) {
      this.options.setSkyDetail(true);
      this.hold = 5;
    }
  }
}
