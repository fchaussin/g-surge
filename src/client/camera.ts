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
import {
  thrustTier,
  trackPoint,
  type SimState,
  type ThrustTier,
  type Track,
  type Tuning,
} from '../sim/index.js';
import { driftIntensity, driftSide } from './drift.js';

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
const FOV_KICK = [0, 7, 18, 26] as const;
const FOV_EASE = [3, 6, 11, 14] as const;
const LAG_SCALE = [1, 1, 0.55, 0.4] as const;

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

/**
 * What a drift does to the camera: the aim swings towards the side the ship
 * is sliding to, and the horizon rolls the same way, both lagging the slide.
 *
 * The palette's CAM_DRIFT_YAW and CAM_DRIFT_ROLL. Until now the camera read
 * neither `slip` nor `drift`, so a slide was told by the hull's yaw and the
 * spray alone and the frame itself stayed rigid. Both effects read the one
 * shared scale, `driftIntensity`, and its measured side; both are small, in
 * metres of aim offset and radians of roll, because the surge sits above and a
 * camera that swings hard on every drift would eat the rung above it.
 *
 * Eased in frame time, like the positional lag — the lag is the point, a
 * camera that snaps with the slide reads as being bolted to the hull. Zero
 * outside a drift, hence zero in every attract-mode capture.
 */
const DRIFT_AIM = 4.0;
const DRIFT_ROLL = 0.07;
const DRIFT_EASE = 3.5;

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
  /** The slide as the camera currently feels it, −1 to 1, eased. Reset too. */
  private drift = 0;

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
    this.drift = 0;
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

    // The slide, as the camera feels it: signed, eased, zero outside a drift.
    const slide = driftIntensity(state) * driftSide(state);
    this.drift += (slide - this.drift) * Math.min(1, frameDt * DRIFT_EASE);

    // Wrapped back into [-pi, pi]: bank is unbounded, a corkscrew adds turns.
    const bank = Math.atan2(Math.sin(behind.bank), Math.cos(behind.bank));
    const follow = MathUtils.clamp((Math.abs(bank) - FOLLOW_FROM) / FOLLOW_SPAN, 0, 1);
    // The drift rolls the horizon the way a bank towards the slide side would:
    // a positive bank pushes the ship towards −lat, so the sign is inverted.
    const roll = bank * (tuning.camRoll + (1 - tuning.camRoll) * follow) - this.drift * DRIFT_ROLL;
    this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);

    // The aim swings along the track's lateral axis, in lat space like the
    // offsets above, towards where the ship is actually going.
    const aim = offAhead + this.drift * DRIFT_AIM;
    this.target.set(
      ahead.x + ahead.rx * aim + ahead.ux * tuning.lookHeight,
      ahead.y + ahead.ry * aim + ahead.uy * tuning.lookHeight,
      ahead.z + ahead.rz * aim + ahead.uz * tuning.lookHeight,
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
    this.camera.fov = fitAspect(this.fov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}

/** The aspect every field of view in the tuning was chosen on. */
export const REF_ASPECT = 16 / 9;

/**
 * The vertical field of view to use on a screen wider than 16:9.
 *
 * three.js takes a vertical angle and lets the width follow the aspect, so a
 * phone in landscape — 19.5:9, 20:9 — was simply shown more world on each
 * side, and the ship, whose size on screen is set by that angle, came out the
 * same height as on a monitor a hundred times larger. On a small screen that
 * reads as a ship too far away. Holding the *horizontal* field constant
 * instead means a wider screen zooms in rather than widening: the ship grows
 * by the ratio of the aspects, 17 % at 19.5:9.
 *
 * Nothing happens at 16:9 or narrower, which is where every frozen scene
 * reference is taken, and why none of them moves.
 */
export function fitAspect(vertical: number, aspect: number): number {
  if (aspect <= REF_ASPECT) return vertical;
  const half = Math.tan(MathUtils.degToRad(vertical) / 2) * (REF_ASPECT / aspect);
  return MathUtils.radToDeg(2 * Math.atan(half));
}
