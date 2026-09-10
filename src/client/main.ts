/**
 * Entry point of the new client.
 *
 * Wires the simulation core to the rendering subsystems and the frame loop.
 * The UI, the audio and the input devices arrive at roadmap step 3; until then
 * the game runs in attract mode, which is what the menu already showed.
 *
 * The shape matters more than the picture: the simulation advances in whole
 * fixed steps, is fed input as data, and never touches the DOM or three.js.
 */
import { AmbientLight, Color, DirectionalLight, FogExp2, MathUtils, REVISION, Scene } from 'three';
import { BACK, coinTier, Sim } from '../sim/index.js';
import type { Input } from '../sim/index.js';
import { ChaseCamera } from './camera.js';
import { Loop } from './loop.js';
import { Pickups } from './pickups.js';
import { Ship } from './ship.js';
import { Sky } from './sky.js';
import { TrackMesh } from './track-mesh.js';
import { Viewport } from './viewport.js';

const VOID = 0x05060a;

/** Reused every frame: one of these per step would be 720 a second. */
const input: Input = { steer: 0, brake: false, boost: false };

function seedFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('seed');
  } catch {
    return null;
  }
}

function freshSeed(): string {
  return (
    Math.floor(Math.random() * 4294967296).toString(36) +
    Math.floor(Math.random() * 4294967296).toString(36)
  );
}

const sim = new Sim({ seed: seedFromUrl() ?? freshSeed(), difficulty: 'easy' });

const scene = new Scene();
scene.background = new Color(VOID);
scene.fog = new FogExp2(VOID, 0.0017);

const viewport = new Viewport(sim.tuning.fovBase);
const camera = new ChaseCamera(viewport.camera, sim.tuning);
const sky = new Sky();
const trackMesh = new TrackMesh(viewport.renderer);
const pickups = new Pickups();
const ship = new Ship();
scene.add(sky.group, trackMesh.group, pickups.group, ship.group);

// The ship is the only lit object; everything else is unlit on purpose.
scene.add(new AmbientLight(0x2c3d59, 1.15));
const keyLight = new DirectionalLight(0xdff0ff, 1.2);
keyLight.position.set(0.45, 1, -0.5);
scene.add(keyLight);

let elapsed = 0;
let bank = 0;
/* Visual attitude, eased towards the simulation rather than snapped to it. */
let lean = 0;
let yawVisual = 0;

function renderFrame(frameDt: number): void {
  elapsed += frameDt;
  // The path has to be integrated before anything reads it: the ribbons walk
  // its buffers directly and the camera samples along it.
  sim.track.buildPath(sim.state.cursor);
  trackMesh.update(sim.track, sim.tuning.stripeEvery);

  const state = sim.state;
  const tier = coinTier(state.speed, sim.tuning);
  pickups.update(sim.track, state.cursor, tier, frameDt);

  const thrust = state.superT > 0 ? 2 : state.boosting ? 1 : 0;
  ship.setPose(state.lat, state.hop, bank);
  // Lean and yaw are shown, not simulated: they lag the state so the hull
  // reads as having mass instead of snapping between attitudes.
  const wantLean = -state.yaw * 0.9 - MathUtils.clamp(state.latVel * 0.010, -0.20, 0.20);
  lean += (wantLean - lean) * Math.min(1, frameDt * 7);
  const wantYaw =
    state.yaw * sim.tuning.yawVisual +
    MathUtils.clamp(state.slip * sim.tuning.driftYaw, -0.42, 0.42);
  yawVisual += (wantYaw - yawVisual) * Math.min(1, frameDt * 9);
  ship.setAttitude(lean, yawVisual, MathUtils.clamp(-state.vyRel * 0.018, -0.32, 0.32));
  ship.updateThrust(frameDt, thrust);
  ship.updateSmoke(frameDt, state.speed, thrust);

  camera.update(state, sim.track, sim.tuning, frameDt, state.shake);

  const position = viewport.camera.position;
  sky.update(
    elapsed,
    position.x, position.y, position.z,
    sim.track.nk[BACK]!,
    sim.state.speed,
    frameDt,
    sim.state.boosting,
  );

  viewport.render(scene);
}

const loop = new Loop({
  simulate(dt) {
    // Attract mode until the input layer lands: the autopilot recentres and
    // the track keeps streaming, which is enough to see everything render.
    bank = sim.step(input, dt, true);
  },
  render: renderFrame,
});

loop.start();

/**
 * Debug surface, mirroring the legacy `window.__gs`. For the tests and for the
 * replay features to come; not a game API.
 */
declare global {
  interface Window {
    __gsNext: {
      seed(): string;
      revision: string;
      fixedStep(): number;
      state(): Readonly<typeof sim.state>;
      renderScale(): number;
      setSkyDetail(high: boolean): void;
      setSkyVisible(visible: boolean): void;
      freeze(seed: string, steps: number): void;
    };
  }
}

window.__gsNext = {
  seed: () => sim.seed,
  revision: REVISION,
  fixedStep: () => loop.fixedStep,
  state: () => sim.state,
  renderScale: () => viewport.renderScale,
  setSkyDetail: (high) => sky.setDetail(high),
  setSkyVisible: (visible) => sky.setVisible(visible),

  /**
   * Stops the loop, replays a known number of fixed steps from a seed, and
   * draws exactly one frame. This is what makes a full-frame visual reference
   * possible at all — the project has never had one, because a frame used to
   * depend on when it happened to be taken.
   *
   * It is not perfectly reproducible and does not need to be: the exhaust
   * flicker is per-frame noise on `Math.random`, deliberately outside the
   * simulation. The reference therefore carries a small pixel tolerance.
   */
  freeze(seed, steps) {
    loop.stop();
    sim.reset(seed);
    ship.clearSmoke();
    camera.reset();
    sky.reset();
    elapsed = 0;
    lean = 0;
    yawVisual = 0;
    const dt = loop.fixedStep;
    for (let i = 0; i < steps; i++) bank = sim.step(input, dt, true);
    renderFrame(dt);
  },
};
