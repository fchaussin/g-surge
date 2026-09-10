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
import { thrustTier, type ThrustTier } from './thrust.js';

/** Fraction of the ship's lateral offset applied behind and ahead. */
const OFFSET_BEHIND = 0.55;
const OFFSET_AHEAD = 0.25;

/** Bank below which the camera only partly follows, and the width of the blend. */
const FOLLOW_FROM = 0.5;
const FOLLOW_SPAN = 0.7;

/**
 * Field of view, its convergence, and the positional lag, by thrust tier.
 *
 * Index 1 holds exactly what a boost used to get — `+7` degrees, converging at
 * 6, no change to the lag — so a boost looks today as it looked yesterday and
 * only the super boost is new. That is also what keeps the frozen scene
 * captures out of this: they are attract-mode frames, where the tier is 0.
 *
 * The kick at index 2 is deliberately more than double, and the lag lets go:
 * a super boost should read as a catapult rather than a stronger push, and a
 * camera that stays glued reads as a stronger push. See docs/FX-PALETTE.md §15.
 */
const FOV_KICK = [0, 7, 18] as const;
const FOV_EASE = [3, 6, 11] as const;
const LAG_SCALE = [1, 1, 0.55] as const;

/**
 * Catch-up multiplier applied to the lag after a drift, and how long it lasts.
 *
 * During a slide the ship's lateral offset moves faster than the camera
 * follows, so the frame trails behind it. Recovering that at the usual lag
 * would take the best part of a second, and read as sluggishness at exactly
 * the moment control comes back.
 */
const SNAP_GAIN = 2.4;
const SNAP_TIME = 0.32;

export class ChaseCamera {
  /* Reused every frame. See the no-allocation rule in CLAUDE.md. */
  private readonly behind = trackPoint();
  private readonly ahead = trackPoint();
  private readonly want = new Vector3();
  private readonly position = new Vector3();
  private readonly target = new Vector3();

  private fov: number;
  private placed = false;
  /** Eased, so it has to be dropped for a capture. See `reset`. */
  private snap = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    tuning: Tuning,
  ) {
    this.fov = tuning.fovBase;
  }

  /**
   * Drops everything the camera accumulates: the positional lag, and the field
   * of view, which eases over several seconds towards the current speed.
   *
   * Forgetting the field of view is not cosmetic. It leaves the projection at
   * whatever the frames before the reset had reached, which is however many
   * the page took to load — enough to move every star and every gantry in a
   * captured frame while the simulation is bit-identical. That is exactly how
   * it was found.
   */
  reset(tuning: Tuning): void {
    this.placed = false;
    this.fov = tuning.fovBase;
    this.snap = 0;
  }

  /** Called on `driftEnd`: the camera recentres instead of drifting back. */
  driftExitSnap(): void {
    this.snap = 1;
  }

  /**
   * @param shake the simulation's own shake plus whatever the client adds for
   *   an impact. Applied as positional noise, which is why it is passed rather
   *   than read: the jitter is presentation and must not reach the simulation,
   *   and the client's share must not be written back into `state.shake`.
   */
  update(state: SimState, track: Track, tuning: Tuning, frameDt: number, shake: number): void {
    const tier = thrustTier(state);
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
    if (this.snap > 0) this.snap = Math.max(0, this.snap - frameDt / SNAP_TIME);
    const lag = tuning.camLag * LAG_SCALE[tier] * (1 + this.snap * (SNAP_GAIN - 1));
    this.position.lerp(this.want, Math.min(1, frameDt * lag));
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

    this.updateFov(state, tuning, frameDt, tier);
  }

  /** Widens with speed, by tier under thrust, and a little against a wall. */
  private updateFov(state: SimState, tuning: Tuning, frameDt: number, tier: ThrustTier): void {
    const wanted =
      tuning.fovBase +
      Math.min(1, state.speed / tuning.speedMax) * tuning.fovSpeed +
      FOV_KICK[tier] +
      (state.scrape > 0 ? 3 : 0);
    this.fov += (wanted - this.fov) * Math.min(1, frameDt * FOV_EASE[tier]);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }
}
