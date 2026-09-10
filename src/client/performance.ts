/**
 * Refresh detection, frame rate target, and automatic quality.
 *
 * Three traps live here, all paid for the hard way:
 *
 * - **Throttling only skips on an integer ratio of at least two.** A 144 Hz
 *   display asked for 120 would otherwise drop every other frame and land at
 *   72, which is worse than not throttling at all.
 * - **The target list is built from the detected refresh rate**, in integer
 *   divisions of it, because those are the only rates the throttle can
 *   actually produce. A fixed 60 / 120 / 240 list meant a 144 Hz display set
 *   to "120" was in fact running at 144, under a label that lied.
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
  targetHz = 60;
  /** Minimum seconds between rendered frames. Zero means no throttling. */
  frameMin = 0;
  /** Last measured frames per second. */
  fps = 60;

  private readonly samples: number[] = [];
  private frames = 0;
  private elapsed = 0;
  private runSeconds = 0;
  private hold = 0;
  private bad = 0;
  private good = 0;

  private onRefreshChange: (() => void) | null = null;

  constructor(private readonly options: PerformanceOptions) {}

  /** Called when detection completes or is restarted, to rebuild the UI. */
  set onRefresh(handler: () => void) {
    this.onRefreshChange = handler;
  }

  /** Rates the throttle can actually hit on this display. */
  targetOptions(): number[] {
    if (!this.refreshHz) return [60, 120, 240];
    const out: number[] = [];
    for (let n = 1; n <= 3; n++) {
      const hz = Math.round(this.refreshHz / n);
      // Below 30 the game is unpleasant rather than economical.
      if (hz >= 30 && !out.includes(hz)) out.push(hz);
    }
    return out;
  }

  setTarget(hz: number): void {
    this.targetHz = hz;
    this.applyThrottle();
  }

  /** Forces a fresh measurement, for when the display or window has moved. */
  redetect(): void {
    this.refreshHz = 0;
    this.samples.length = 0;
    this.frameMin = 0;
    this.onRefreshChange?.();
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
    this.refreshHz = KNOWN_RATES.reduce((best, v) =>
      Math.abs(v - raw) < Math.abs(best - raw) ? v : best, 60);

    // Detection does not choose for the player: it replaces the list of
    // reachable targets and keeps the nearest to what was selected.
    this.onRefreshChange?.();
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
    if (this.refreshHz && this.frameMin === 0 && this.fps > this.refreshHz * 1.2) {
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

    const reachable = Math.min(this.targetHz, this.refreshHz || this.targetHz);
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

  private applyThrottle(): void {
    if (!this.refreshHz) {
      this.frameMin = 0;
      return;
    }
    const n = Math.max(1, Math.round(this.refreshHz / this.targetHz));
    // Half a frame of slack, so jitter does not skip a frame that was on time.
    this.frameMin = n <= 1 ? 0 : (n - 0.5) / this.refreshHz;
  }
}
