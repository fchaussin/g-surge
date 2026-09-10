/**
 * Entry point of the new client.
 *
 * Wiring only: it owns no rules. The simulation core decides what happens, the
 * subsystems decide how it looks and sounds, and this file connects them and
 * runs the clock.
 *
 * The last piece missing before the switch is the end-of-run score screen.
 */
import { AmbientLight, Color, DirectionalLight, FogExp2, MathUtils, REVISION, Scene } from 'three';
import {
  BACK, coinTier, DEFAULTS, DIFF, Sim, tuningFor,
  type Difficulty, type SimEvent,
} from '../sim/index.js';
import { Audio } from './audio.js';
import { ChaseCamera } from './camera.js';
import { Fullscreen } from './fullscreen.js';
import { Haptics } from './haptics.js';
import { Hud } from './hud.js';
import { InputSource } from './input.js';
import { Loop } from './loop.js';
import { PerformanceGovernor } from './performance.js';
import { Pickups, COIN_COLOURS } from './pickups.js';
import { ScoreScreen } from './score-screen.js';
import { Scores } from './scores.js';
import { Screens } from './screens.js';
import { Settings } from './settings.js';
import { Ship } from './ship.js';
import { Sky } from './sky.js';
import { Tips } from './tips.js';
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
const audio = new Audio();
const haptics = new Haptics();
const scores = new Scores();
const tips = new Tips();
const scoreScreen = new ScoreScreen(() => audio.resume());

const fullscreen = new Fullscreen((active, blocked) => {
  const toggle = document.getElementById('tglFull');
  toggle?.classList.toggle('on', active);
  toggle?.setAttribute('aria-pressed', String(active));
  const button = document.getElementById('btnFullMenu');
  if (button) {
    button.textContent = blocked ? 'FULLSCREEN BLOCKED' : active ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
  }
  // Entering fullscreen changes what is on screen, so what is navigable moves.
  screens.buildNav();
});

const screens = new Screens({
  onChange(mode) {
    if (mode !== 'run') input.release();
    // Browsers only let an AudioContext start from a gesture, and every screen
    // change is one.
    audio.resume();
  },
});

const input = new InputSource({
  isPlaying: () => screens.isPlaying,
  buzz: (pattern) => haptics.buzz(pattern),
  canBoost: () => sim.state.energy >= sim.tuning.boostMin,
});

let difficulty: Difficulty = 'easy';
let showFps = false;

const perf = new PerformanceGovernor({
  isPlaying: () => screens.isPlaying,
  getSkyDetail: () => skyDetail,
  setSkyDetail: (high) => { skyDetail = high; sky.setDetail(high); },
  getRenderScale: () => sim.tuning.renderScale,
  setRenderScale: (v) => {
    sim.tuning.renderScale = v;
    viewport.setRenderScale(v);
    settings.syncRow('renderScale');
  },
});
let skyDetail = true;

const settings = new Settings({
  tuning: () => sim.tuning,
  difficulty: () => difficulty,
  scoreMultiplier: (d) => DIFF[d].mul,
  setDifficulty: (d) => {
    difficulty = d;
    // Keep the display value: it belongs to the machine, not to the level.
    const scale = sim.tuning.renderScale;
    sim.setDifficulty(d);
    sim.tuning.renderScale = scale;
  },
  setTuning: (key, value) => {
    (sim.tuning as unknown as Record<string, number>)[key] = value;
    if (key === 'renderScale') viewport.setRenderScale(value);
  },
  resetTuning: () => {
    const scale = sim.tuning.renderScale;
    Object.assign(sim.tuning, tuningFor(difficulty));
    sim.tuning.renderScale = scale;
  },
  setSound: (on) => { audio.setMuted(!on); if (on) audio.resume(); },
  setHaptics: (on) => { haptics.setEnabled(on); if (on) haptics.buzz(20); },
  hapticsAvailable: haptics.available,
  setTips: (on) => tips.setEnabled(on),
  setSky: (on) => sky.setVisible(on),
  setSkyDetail: (high) => { skyDetail = high; sky.setDetail(high); },
  setShowFps: (on) => { showFps = on; },
  setFrameTarget: (hz) => { perf.setTarget(hz); loop.frameMin = perf.frameMin; },
  frameTargets: () => perf.targetOptions(),
  refreshHz: () => perf.refreshHz,
  redetect: () => perf.redetect(),
  clearScores: () => scores.clear(),
  rebuildNav: () => screens.buildNav(),
});

perf.onRefresh = () => {
  settings.rebuildFrameTargets();
  // The chosen target may not exist on this display; take the nearest.
  const targets = perf.targetOptions();
  const nearest = targets.reduce((best, v) =>
    Math.abs(v - perf.targetHz) < Math.abs(best - perf.targetHz) ? v : best, targets[0]!);
  perf.setTarget(nearest);
  loop.frameMin = perf.frameMin;
  settings.paintFrameTarget(nearest);
};

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
  audio.play(events);
  for (const e of events) {
    switch (e.type) {
      case 'land':
        haptics.buzz(18, 120);
        break;
      case 'badLanding':
        flashHalo(0xff3b30, 1.1);
        haptics.buzz([40, 50, 120]);
        break;
      case 'wallImpact':
        flashHalo(0xff3b30, 0.75 + e.force * 0.6);
        haptics.buzz(e.force > 0.6 ? [35, 40, 110] : [25 + Math.round(e.force * 60)]);
        break;
      case 'scrape':
        holdHalo(0xff3b30, 0.70, 0.7);
        // Spaced: restarting the motor every step cancels it before it is felt.
        haptics.buzz(9, 190);
        break;
      case 'pickup':
        if (e.kind === 'coin') {
          hud.showPop(`× +${e.gain.toFixed(1)}`, `#${COIN_COLOURS[e.tier].toString(16)}`);
          flashHalo(COIN_COLOURS[e.tier], 0.75 + e.gain * 0.9);
          haptics.buzz(10 + Math.round(e.gain * 22));
        } else if (e.kind === 'fix') {
          hud.showPop('REPAIRED', '#35e08a');
          flashHalo(0x35e08a);
          haptics.buzz([22, 40, 22]);
        } else {
          hud.showPop('SUPER BOOST', '#ff2f9a');
          flashHalo(0xff2f9a);
          haptics.buzz([30, 30, 70]);
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
  if (screens.mode === 'run') submit();
  sim.reset(pinnedSeed ?? freshSeed());
  tips.reset();
  ship.clearSmoke();
  pickups.reset();
  camera.reset(sim.tuning);
  hud.reset();
  halo = 0;
  lean = 0;
  yawVisual = 0;
  loop.reset();
  screens.setMode('run');
}

function endRun(): void {
  haptics.buzz([90, 60, 200]);
  const { wasBest, previousBest } = submit();
  screens.setMode('over');
  scoreScreen.show({
    distance: sim.state.dist,
    coins: sim.state.coins,
    peakMultiplier: sim.state.multPeak,
    total: sim.state.score,
    wasBest,
    previousBest,
  });
}

/** A run counts when it ends, however it ends: crash, restart or quit. */
function submit(): { wasBest: boolean; previousBest: number } {
  const result = scores.submit(sim.state.score, sim.state.coins, difficulty, Date.now());
  if (result.accepted) hud.setBest(scores.bestLabel);
  return result;
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

  perf.detect(frameDt);
  perf.update(frameDt);
  if (showFps) {
    const el = document.getElementById('fpsVal');
    if (el) el.textContent = String(Math.round(perf.fps));
  }

  audio.update(screens.isPlaying, state.speed, sim.tuning.speedMax, state.boosting, state.drift);

  if (screens.isPlaying) {
    hud.update(state, sim.tuning, frameDt);
    tips.update(frameDt);
  }

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
on('btnPause', () => {
  const el = document.getElementById('pauseDist');
  if (el) el.textContent = Math.round(sim.state.score).toLocaleString('en-GB');
  screens.setMode('pause');
});
on('btnResume', () => screens.setMode('run'));
on('btnRestart', startRun);
on('btnQuit', () => { submit(); screens.setMode('menu'); });
on('btnAgain', startRun);
on('btnOverMenu', () => screens.setMode('menu'));
on('btnHelp', () => screens.setMode('help'));
on('btnCloseHelp', () => screens.setMode('menu'));
on('btnSettingsMenu', () => screens.openSettings());
on('btnSettingsPause', () => screens.openSettings());
on('btnCloseSettings', () => screens.setMode('menu'));
on('btnFpsInfo', () => screens.setMode('fpsinfo'));
on('btnCloseFps', () => screens.setMode('settings'));
on('tglFull', () => fullscreen.toggle());
on('btnFullMenu', () => fullscreen.toggle());

// Both controls disappear where the API does not exist rather than sitting
// there doing nothing.
if (!fullscreen.available) {
  const group = document.getElementById('grpDisplay');
  if (group) group.style.display = 'none';
  const button = document.getElementById('btnFullMenu');
  if (button) button.style.display = 'none';
}

// The start state is set by calling setMode, not by a class in the HTML: the
// class alone would show the right screen with an empty navigation list.
screens.setMode('menu');
screens.revealCursorOnPrecisePointer();
settings.rebuildFrameTargets();
settings.paintFrameTarget(perf.targetHz);
hud.setBest(scores.bestLabel);
// Built ahead of the first crash: its impulse response is 288 000 samples and
// generating it on the impact lands as a hitch at the worst possible moment.
window.addEventListener('pointerdown', () => { audio.resume(); audio.warmUp(); }, { once: true });
window.addEventListener('keydown', () => { audio.resume(); audio.warmUp(); }, { once: true });

/**
 * Holds the splash until the game can actually run, rather than for a fixed
 * time.
 *
 * Two things cost a visible hitch on the first frame if they are left to
 * happen during play. Shader programs are compiled lazily by three.js the
 * first time a material is drawn — the sky shader especially — which is what
 * the performance governor's "the first seconds are shader compilation" guard
 * is working around. And the road's canvas texture is uploaded on first use.
 *
 * `compile` handles the first, drawing one frame handles the second.
 */
async function boot(): Promise<void> {
  window.__gsProgress?.(45, 'COMPILING SHADERS');
  // Two frames, so the label is actually painted before the main thread is
  // blocked by the compile.
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
  );

  sim.track.buildPath(sim.state.cursor);
  trackMesh.update(sim.track, sim.tuning.stripeEvery);
  viewport.renderer.compile(scene, viewport.camera);

  window.__gsProgress?.(80, 'WARMING UP');
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  // One full frame: uploads the road texture and walks every path the loop
  // will take, so the first frame the player sees is not the expensive one.
  renderFrame(loop.fixedStep);

  loop.start();
  window.__gsReady?.();
}

void boot();

/**
 * Offline shell.
 *
 * Only over https, which leaves localhost alone: a service worker caching the
 * bundle during development is a stale reload waiting to happen, and the
 * benefit there is nil.
 *
 * Registration lived in the legacy page's footer script and was lost when the
 * markup was ported — the file shipped and nothing activated it. Caught by
 * looking for it rather than by a test, which is the gap.
 *
 * Content-hashed asset names make the cache-first path safe by construction: a
 * changed file has a different URL, so it can never be served stale. What is
 * still missing is the precache list, which cannot name a hashed bundle and so
 * only covers an offline reload, not an offline first open. Roadmap step 5.
 */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => undefined);
  });
}

/* ----------------------------------------------------------------- debug -- */

declare global {
  interface Window {
    __gsReady?: () => void;
    __gsProgress?: (percent: number, label?: string) => void;
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
      clock(): { hz: number; dt: number };
      defaults(): Record<string, number>;
      nodes(): { k: number[]; g: number[]; b: number[]; id: number[] };
      items(): Array<{ id: number; lat: number; type: number }>;
      trace(opts: {
        seed: string;
        diff?: Difficulty;
        steps?: number;
        dt?: number;
        every?: number;
        script?: Array<{ from: number; steer?: number; brake?: boolean; boost?: boolean }>;
      }): unknown;
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
  clock: () => ({ hz: 1 / loop.fixedStep, dt: loop.fixedStep }),
  defaults: () => ({ ...DEFAULTS }),
  nodes: () => ({
    k: Array.from(sim.track.nk),
    g: Array.from(sim.track.ng),
    b: Array.from(sim.track.nb),
    id: Array.from(sim.track.nid),
  }),
  items: () => sim.track.items.map((it) => ({ id: it.id, lat: it.lat, type: it.type })),

  /**
   * Replays a run at fixed step, outside the render loop.
   *
   * Its purpose changed with the switch. It used to prove that two
   * implementations agreed; there is only one now, so what it proves is that
   * the **shipped bundle** still plays the same as the source — that nothing
   * in the transpile, the minifier or the module graph moved a number. The
   * frozen references stay the contract either way.
   */
  trace(opts) {
    const steps = opts.steps === undefined ? 1200 : opts.steps;
    const dt = opts.dt === undefined ? loop.fixedStep : opts.dt;
    const every = opts.every === undefined ? 60 : opts.every;
    const script = opts.script ?? [];
    const diff = opts.diff ?? 'easy';

    loop.stop();
    sim.setDifficulty(diff);
    sim.reset(opts.seed);

    const st = sim.state;
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    const snap = (i: number) => ({
      i,
      dist: r6(st.dist), travel: r6(st.travel), cursor: r6(st.cursor),
      speed: r6(st.speed), lat: r6(st.lat), latVel: r6(st.latVel),
      yaw: r6(st.yaw), hop: r6(st.hop), vyRel: r6(st.vyRel),
      energy: r6(st.energy), hull: r6(st.hull),
      mult: r6(st.mult), score: r6(st.score), coins: st.coins,
      air: st.air, drift: st.drift, wrecked: st.wrecked,
    });

    let si = 0;
    let cur: { from: number; steer?: number; brake?: boolean; boost?: boolean } = { from: 0 };
    const frames = [snap(-1)];
    let last = -1;
    const held = { steer: 0, brake: false, boost: false };
    for (let i = 0; i < steps; i++) {
      while (si < script.length && script[si]!.from <= i) cur = script[si++]!;
      held.steer = cur.steer ?? 0;
      held.brake = !!cur.brake;
      held.boost = !!cur.boost;
      sim.step(held, dt, false);
      last = i;
      if (st.wrecked) { frames.push(snap(i)); break; }
      if ((i + 1) % every === 0 || i === steps - 1) frames.push(snap(i));
    }
    return { seed: sim.seed, diff, steps, ran: last + 1, dt, wrecked: st.wrecked, frames };
  },

  freeze(seed, steps) {
    loop.stop();
    sim.reset(seed);
    ship.clearSmoke();
    pickups.reset();
    camera.reset(sim.tuning);
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
