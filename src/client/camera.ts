/**
 * The chase camera.
 *
 * It rides the track rather than the ship: both its position and its aim come
 * from `sample`, offset laterally by a fraction of the ship's own offset. That
 * is what keeps a corner readable — the camera leads into it instead of being
 * dragged sideways.
 *
 * Two details worth keeping:
 *
 * - **Roll is partial in a corner and total in a corkscrew.** Following the
 *   bank completely in every turn is nauseating; ignoring it entirely makes a
 *   corkscrew unreadable. The blend crosses over around 0.5 rad.
 * - **Lag is in frame time, not simulation time.** It is a display smoothing,
 *   so it takes the real frame delta like every other easing here.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { trackPoint, type SimState, type Track, type Tuning } from '../sim/index.js';

/** Fraction of the ship's lateral offset applied behind and ahead. */
const OFFSET_BEHIND = 0.55;
const OFFSET_AHEAD = 0.25;

/** Bank below which the camera only partly follows, and the width of the blend. */
const FOLLOW_FROM = 0.5;
const FOLLOW_SPAN = 0.7;

export class ChaseCamera {
  /* Reused every frame. See the no-allocation rule in CLAUDE.md. */
  private readonly behind = trackPoint();
  private readonly ahead = trackPoint();
  private readonly want = new Vector3();
  private readonly position = new Vector3();
  private readonly target = new Vector3();

  private fov: number;
  private placed = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    tuning: Tuning,
  ) {
    this.fov = tuning.fovBase;
  }

  /** Drops the lag, so the next frame snaps instead of sweeping in. */
  reset(): void {
    this.placed = false;
  }

  /**
   * @param shake 0 to 1, decayed by the simulation. Applied as positional
   *   noise, which is why it is passed rather than read: the jitter is
   *   presentation and must not reach the simulation.
   */
  update(state: SimState, track: Track, tuning: Tuning, frameDt: number, shake: number): void {
    const behind = track.sample(state.cursor, -tuning.camDist, this.behind);
    const ahead = track.sample(state.cursor, tuning.lookAhead, this.ahead);

    const offBehind = state.lat * OFFSET_BEHIND;
    const offAhead = state.lat * OFFSET_AHEAD;
    const height = tuning.camHeight + state.hop * 0.6;

    this.want.set(
      behind.x + behind.rx * offBehind + behind.ux * height,
      behind.y + behind.ry * offBehind + behind.uy * height,
      behind.z + behind.rz * offBehind + behind.uz * height,
    );
    if (!this.placed) {
      this.position.copy(this.want);
      this.placed = true;
    }
    this.position.lerp(this.want, Math.min(1, frameDt * tuning.camLag));
    this.camera.position.copy(this.position);

    if (shake > 0) {
      const a = shake * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }

    // Wrapped back into [-pi, pi]: bank is unbounded, a corkscrew adds turns.
    const bank = Math.atan2(Math.sin(behind.bank), Math.cos(behind.bank));
    const follow = MathUtils.clamp((Math.abs(bank) - FOLLOW_FROM) / FOLLOW_SPAN, 0, 1);
    const roll = bank * (tuning.camRoll + (1 - tuning.camRoll) * follow);
    this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);

    this.target.set(
      ahead.x + ahead.rx * offAhead + ahead.ux * tuning.lookHeight,
      ahead.y + ahead.ry * offAhead + ahead.uy * tuning.lookHeight,
      ahead.z + ahead.rz * offAhead + ahead.uz * tuning.lookHeight,
    );
    this.camera.lookAt(this.target);

    this.updateFov(state, tuning, frameDt);
  }

  /** Widens with speed, and a little more under boost or against a wall. */
  private updateFov(state: SimState, tuning: Tuning, frameDt: number): void {
    const wanted =
      tuning.fovBase +
      Math.min(1, state.speed / tuning.speedMax) * tuning.fovSpeed +
      (state.boosting ? 7 : 0) +
      (state.scrape > 0 ? 3 : 0);
    this.fov += (wanted - this.fov) * Math.min(1, frameDt * (state.boosting ? 6 : 3));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }
}
