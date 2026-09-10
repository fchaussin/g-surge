/**
 * Entry point of the new client.
 *
 * Wiring only: it owns no rules. The simulation core decides what happens, the
 * subsystems decide how it looks and sounds, and this file connects them and
 * runs the clock.
 *
 * Settings, audio and the leaderboard are still to come; see roadmap step 3.
 */
import { AmbientLight, Color, DirectionalLight, FogExp2, MathUtils, REVISION, Scene } from 'three';
import { BACK, coinTier, Sim, type SimEvent } from '../sim/index.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';
import { InputSource } from './input.js';
import { Loop } from './loop.js';
import { Pickups, COIN_COLOURS } from './pickups.js';
import { Screens } from './screens.js';
import { Ship } from './ship.js';
import { Sky } from './sky.js';
import { TrackMesh } from './track-mesh.js';
import { Viewport } from './viewport.js';

const VOID = 0x05060a;

/** How long a pickup glow takes to fade, in seconds. */
const HALO_TIME = 0.45;

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

const pinnedSeed = seedFromUrl();
const sim = new Sim({ seed: pinnedSeed ?? freshSeed(), difficulty: 'easy' });

/* ---------------------------------------------------------------- scene -- */

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

/* ------------------------------------------------------------- ui, loop -- */

const hud = new Hud();
const screens = new Screens({
  onChange(mode) {
    if (mode !== 'run') input.release();
  },
});
const input = new InputSource({
  isPlaying: () => screens.isPlaying,
  canBoost: () => sim.state.energy >= sim.tuning.boostMin,
});

let elapsed = 0;
let bank = 0;
/* Visual attitude, eased towards the simulation rather than snapped to it. */
let lean = 0;
let yawVisual = 0;
/* Pickup and impact glow. It left the simulation with the events refactor. */
let halo = 0;
let haloPower = 1;
let haloColour = 0xffffff;

function flashHalo(colour: number, power = 1): void {
  haloColour = colour;
  halo = 1;
  haloPower = power;
}

/** A scrape holds the glow up rather than restarting it every step. */
function holdHalo(colour: number, level: number, power: number): void {
  haloColour = colour;
  if (halo < level) halo = level;
  haloPower = power;
}

function consume(events: readonly SimEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'badLanding':
        flashHalo(0xff3b30, 1.1);
        break;
      case 'wallImpact':
        flashHalo(0xff3b30, 0.75 + e.force * 0.6);
        break;
      case 'scrape':
        holdHalo(0xff3b30, 0.70, 0.7);
        break;
      case 'pickup':
        if (e.kind === 'coin') {
          hud.showPop(`× +${e.gain.toFixed(1)}`, `#${COIN_COLOURS[e.tier].toString(16)}`);
          flashHalo(COIN_COLOURS[e.tier], 0.75 + e.gain * 0.9);
        } else if (e.kind === 'fix') {
          hud.showPop('REPAIRED', '#35e08a');
          flashHalo(0x35e08a);
        } else {
          hud.showPop('SUPER BOOST', '#ff2f9a');
          flashHalo(0xff2f9a);
        }
        break;
      case 'wreck':
        endRun();
        break;
      default:
        break;
    }
  }
}

function startRun(): void {
  sim.reset(pinnedSeed ?? freshSeed());
  ship.clearSmoke();
  pickups.reset();
  camera.reset();
  hud.reset();
  halo = 0;
  lean = 0;
  yawVisual = 0;
  loop.reset();
  screens.setMode('run');
}

function endRun(): void {
  screens.setMode('over');
}

function renderFrame(frameDt: number): void {
  elapsed += frameDt;

  // The path has to be integrated before anything reads it: the ribbons walk
  // its buffers directly and the camera samples along it.
  const state = sim.state;
  sim.track.buildPath(state.cursor);
  trackMesh.update(sim.track, sim.tuning.stripeEvery);

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

  if (halo > 0) halo = Math.max(0, halo - frameDt / HALO_TIME);
  ship.setHalo(haloColour, halo, haloPower);

  camera.update(state, sim.track, sim.tuning, frameDt, state.shake);

  const position = viewport.camera.position;
  sky.update(
    elapsed,
    position.x, position.y, position.z,
    sim.track.nk[BACK]!,
    state.speed,
    frameDt,
    state.boosting,
  );

  if (screens.isPlaying) hud.update(state, sim.tuning, frameDt);

  viewport.render(scene);
}

const loop = new Loop({
  simulate(dt) {
    const mode = screens.mode;
    // Only two modes advance the world: a run, and the attract loop behind
    // the menu. Pause, settings and the rest freeze it deliberately.
    if (mode === 'run') {
      bank = sim.step(input.sample(), dt, false);
      consume(sim.events);
    } else if (mode === 'menu') {
      bank = sim.step(input.value, dt, true);
    }
  },
  render: renderFrame,
});

/* --------------------------------------------------------------- screens -- */

const on = (id: string, handler: () => void) =>
  document.getElementById(id)?.addEventListener('click', handler);

on('btnStart', startRun);
on('btnPause', () => screens.setMode('pause'));
on('btnResume', () => screens.setMode('run'));
on('btnRestart', startRun);
on('btnQuit', () => screens.setMode('menu'));
on('btnAgain', startRun);
on('btnOverMenu', () => screens.setMode('menu'));
on('btnHelp', () => screens.setMode('help'));
on('btnCloseHelp', () => screens.setMode('menu'));
on('btnSettingsMenu', () => screens.openSettings());
on('btnSettingsPause', () => screens.openSettings());
on('btnCloseSettings', () => screens.setMode('menu'));
on('btnFpsInfo', () => screens.setMode('fpsinfo'));
on('btnCloseFps', () => screens.setMode('settings'));

// The start state is set by calling setMode, not by a class in the HTML: the
// class alone would show the right screen with an empty navigation list.
screens.setMode('menu');
screens.revealCursorOnPrecisePointer();

loop.start();
requestAnimationFrame(() => window.__gsReady?.());

/* ----------------------------------------------------------------- debug -- */

declare global {
  interface Window {
    __gsReady?: () => void;
    __gsNext: {
      seed(): string;
      revision: string;
      fixedStep(): number;
      state(): Readonly<typeof sim.state>;
      renderScale(): number;
      mode(): string;
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
  mode: () => screens.mode,
  setSkyDetail: (high) => sky.setDetail(high),
  setSkyVisible: (visible) => sky.setVisible(visible),

  /**
   * Stops the loop, replays a known number of fixed steps from a seed, and
   * draws exactly one frame. This is what makes a full-frame visual reference
   * possible: a frame used to depend on when it happened to be taken.
   */
  freeze(seed, steps) {
    loop.stop();
    sim.reset(seed);
    ship.clearSmoke();
    pickups.reset();
    camera.reset();
    sky.reset();
    elapsed = 0;
    lean = 0;
    yawVisual = 0;
    halo = 0;
    const dt = loop.fixedStep;
    for (let i = 0; i < steps; i++) bank = sim.step(input.value, dt, true);
    renderFrame(dt);
    // The plumes ease over many frames, so one frame after a reset lands
    // wherever the previous run left them. Snap them, then draw again.
    ship.snapThrust(sim.state.superT > 0 ? 2 : sim.state.boosting ? 1 : 0);
    viewport.render(scene);
  },
};
