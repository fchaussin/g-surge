/**
 * Entry point of the new client.
 *
 * Wiring only: it owns no rules. The simulation core decides what happens, the
 * subsystems decide how it looks and sounds, and this file connects them and
 * runs the clock. What the simulation reports is answered in `feedback.ts`,
 * and what the tests need to reach is exposed by `debug.ts`.
 */
import { AmbientLight, Color, DirectionalLight, FogExp2, MathUtils, Scene } from 'three';
import { BACK, DIFF, Sim, thrustTier, tuningFor, type Difficulty } from '../sim/index.js';
import { Audio } from './audio.js';
import { ChaseCamera } from './camera.js';
import { installDebugSurface } from './debug.js';
import { driftIntensity } from './drift.js';
import { DriftSpray } from './drift-spray.js';
import { Feedback } from './feedback.js';
import { Fullscreen } from './fullscreen.js';
import { Haptics } from './haptics.js';
import { Hud } from './hud.js';
import { InputSource } from './input.js';
import { Loop } from './loop.js';
import { PerformanceGovernor } from './performance.js';
import { Pickups } from './pickups.js';
import { PreferenceStore } from './preferences.js';
import { ScoreScreen } from './score-screen.js';
import { Scores } from './scores.js';
import { Screens } from './screens.js';
import { Settings } from './settings.js';
import { Ship } from './ship.js';
import { SurgeOverlay } from './overlay.js';
import { Sky } from './sky.js';
import { SurgeMeter } from './surge.js';
import { Tips } from './tips.js';
import { TrackMesh } from './track-mesh.js';
import { Viewport } from './viewport.js';

const VOID = 0x05060a;

/**
 * Secousse tenue au plein du G-SURGE, en plus du coup porté à l'entrée.
 *
 * Volontairement sous ce qu'un choc de mur produit : la §10 veut une secousse
 * « forte mais contrôlée », et une image aussi agitée qu'un crash pendant cinq
 * secondes est illisible plutôt qu'intense.
 */
const SURGE_SHAKE = 0.45;

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

const prefs = new PreferenceStore();
const pinnedSeed = seedFromUrl();
const sim = new Sim({ seed: pinnedSeed ?? freshSeed(), difficulty: prefs.values.difficulty });

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
const surgeMeter = new SurgeMeter();
const surgeOverlay = new SurgeOverlay();
// Parentée au vaisseau, comme la fumée : dans le monde, une particule lâchée
// ici croiserait la caméra 19 m derrière.
const spray = new DriftSpray();
ship.group.add(spray.group);
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

let difficulty: Difficulty = prefs.values.difficulty;
let showFps = prefs.values.showFps;

const perf = new PerformanceGovernor({
  isPlaying: () => screens.isPlaying,
  getSkyDetail: () => skyDetail,
  setSkyDetail: (high) => {
    skyDetail = high;
    sky.setDetail(high);
  },
  getRenderScale: () => sim.tuning.renderScale,
  setRenderScale: (v) => {
    sim.tuning.renderScale = v;
    viewport.setRenderScale(v);
    settings.syncRow('renderScale');
    prefs.set('renderScale', v);
  },
});
let skyDetail = prefs.values.skyDetail;

const settings = new Settings({
  initial: prefs.values,
  tuning: () => sim.tuning,
  difficulty: () => difficulty,
  scoreMultiplier: (d) => DIFF[d].mul,
  setDifficulty: (d) => {
    difficulty = d;
    // Keep the display value: it belongs to the machine, not to the level.
    const scale = sim.tuning.renderScale;
    sim.setDifficulty(d);
    sim.tuning.renderScale = scale;
    prefs.set('difficulty', d);
  },
  setTuning: (key, value) => {
    (sim.tuning as unknown as Record<string, number>)[key] = value;
    // Render scale is the one tuning value that is also a preference: it
    // describes the machine, not the game.
    if (key === 'renderScale') {
      viewport.setRenderScale(value);
      prefs.set('renderScale', value);
    }
  },
  resetTuning: () => {
    const scale = sim.tuning.renderScale;
    Object.assign(sim.tuning, tuningFor(difficulty));
    sim.tuning.renderScale = scale;
  },
  setSound: (on, byUser) => {
    audio.setMuted(!on);
    // A press is a gesture, so it may open the audio; a restore may not.
    if (on && byUser) audio.unlock();
    prefs.set('sound', on);
  },
  setHaptics: (on, byUser) => {
    haptics.setEnabled(on);
    // The confirmation buzz is an answer to a press, not to a restore.
    if (on && byUser) haptics.buzz(20);
    prefs.set('haptics', on);
  },
  hapticsAvailable: haptics.available,
  setTips: (on) => {
    tips.setEnabled(on);
    prefs.set('tips', on);
  },
  setLefty: (on) => prefs.set('lefty', on),
  setSky: (on) => {
    sky.setVisible(on);
    prefs.set('sky', on);
  },
  setSkyDetail: (high) => {
    skyDetail = high;
    sky.setDetail(high);
    prefs.set('skyDetail', high);
  },
  setShowFps: (on) => {
    showFps = on;
    prefs.set('showFps', on);
  },
  clearScores: () => scores.clear(),
  rebuildNav: () => screens.buildNav(),
});

let elapsed = 0;
let bank = 0;
/* Visual attitude, eased towards the simulation rather than snapped to it. */
let lean = 0;
let yawVisual = 0;

// The observer end of the event union: sound, vibration, glow, shake, pops.
const feedback = new Feedback({ audio, haptics, hud, camera, ship, onWreck: () => endRun() });

/**
 * Everything that eases over frames, reset in one place.
 *
 * Shared between the start of a run and a capture on purpose: a new eased
 * state that joins one list and forgets the other is exactly how three visual
 * reference bugs were made. The sky is not here — it keeps running from the
 * menu into the run, and only a capture resets it.
 */
function resetPresentation(): void {
  ship.clearSmoke();
  spray.reset();
  pickups.reset();
  camera.reset(sim.tuning);
  surgeMeter.reset();
  surgeOverlay.reset();
  feedback.reset();
  lean = 0;
  yawVisual = 0;
}

function startRun(): void {
  if (screens.mode === 'run') submit();
  sim.reset(pinnedSeed ?? freshSeed());
  tips.reset();
  resetPresentation();
  hud.reset();
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

  const thrust = thrustTier(state);
  // Le palier de pièce est le barreau de poussée : une seule notion, celle que
  // le noyau publie, au lieu d'un seuil de vitesse qui l'approximait mal.
  pickups.update(sim.track, state.cursor, thrust, frameDt);
  ship.setPose(state.lat, state.hop, bank);
  // Lean and yaw are shown, not simulated: they lag the state so the hull
  // reads as having mass instead of snapping between attitudes.
  const wantLean = -state.yaw * 0.9 - MathUtils.clamp(state.latVel * 0.01, -0.2, 0.2);
  lean += (wantLean - lean) * Math.min(1, frameDt * 7);
  const wantYaw =
    state.yaw * sim.tuning.yawVisual +
    MathUtils.clamp(state.slip * sim.tuning.driftYaw, -0.42, 0.42);
  yawVisual += (wantYaw - yawVisual) * Math.min(1, frameDt * 9);
  ship.setAttitude(lean, yawVisual, MathUtils.clamp(-state.vyRel * 0.018, -0.32, 0.32));
  ship.updateThrust(frameDt, thrust);
  ship.updateSmoke(frameDt, state.speed, thrust);
  spray.update(frameDt, state);

  // Glow, client shake and the boost-ready hysteresis, on the display clock.
  feedback.update(frameDt, state, sim.tuning, screens.isPlaying);

  // L'intensité de l'état monte tant que le pilotage tient, et tout ce qui doit
  // croître pendant les cinq secondes la lit : la secousse et le calque.
  surgeMeter.update(frameDt, state, sim.tuning);
  surgeOverlay.update(surgeMeter.value);
  camera.update(
    state,
    sim.track,
    sim.tuning,
    frameDt,
    state.shake + feedback.shake + surgeMeter.value * SURGE_SHAKE,
  );

  const position = viewport.camera.position;
  sky.update(
    elapsed,
    position.x,
    position.y,
    position.z,
    sim.track.nk[BACK]!,
    state.speed,
    frameDt,
    thrust,
  );

  perf.detect(frameDt);
  perf.update(frameDt);
  if (showFps) {
    const el = document.getElementById('fpsVal');
    if (el) el.textContent = String(Math.round(perf.fps));
  }

  audio.update(
    screens.isPlaying,
    state.speed,
    sim.tuning.speedMax,
    thrust,
    driftIntensity(state),
    state.energy / 100,
  );

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
      feedback.consume(sim.events);
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
on('btnQuit', () => {
  submit();
  screens.setMode('menu');
});
on('btnAgain', startRun);
on('btnOverMenu', () => screens.setMode('menu'));
on('btnHelp', () => screens.setMode('help'));
on('btnCloseHelp', () => screens.setMode('menu'));
on('btnSettingsMenu', () => screens.openSettings());
on('btnSettingsPause', () => screens.openSettings());
on('btnCloseSettings', () => screens.setMode('menu'));
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
// Restored before anything reads it. There is no frame target to restore:
// the game renders at whatever the display gives, and quality adapts to it.
sim.tuning.renderScale = prefs.values.renderScale;
viewport.setRenderScale(prefs.values.renderScale);

screens.setMode('menu');
screens.revealCursorOnPrecisePointer();
settings.syncAll();

// A tab closed or hidden never runs a pending timer, and mobile browsers may
// never fire `unload` at all.
window.addEventListener('pagehide', () => prefs.flush());
hud.setBest(scores.bestLabel);
// Built ahead of the first crash: its impulse response is 288 000 samples and
// generating it on the impact lands as a hitch at the worst possible moment.
const openAudio = () => {
  audio.unlock();
  audio.warmUp();
};
window.addEventListener('pointerdown', openAudio, { once: true });
window.addEventListener('keydown', openAudio, { once: true });

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
  }
}

/**
 * Stops the loop, replays a known number of fixed steps from a seed, and draws
 * exactly one frame. This is what makes a full-frame visual reference possible:
 * a frame used to depend on when it happened to be taken.
 *
 * It lives here rather than in `debug.ts` because it has to know every state
 * that eases — which is the same list a run start needs, hence the shared
 * reset — plus the sky and the elapsed time, which a run keeps and a capture
 * must not.
 */
function freeze(seed: string, steps: number): void {
  loop.stop();
  sim.reset(seed);
  resetPresentation();
  sky.reset();
  elapsed = 0;
  const dt = loop.fixedStep;
  for (let i = 0; i < steps; i++) bank = sim.step(input.value, dt, true);
  renderFrame(dt);
  // The plumes ease over many frames, so one frame after a reset lands
  // wherever the previous run left them. Snap them, then draw again.
  ship.snapThrust(thrustTier(sim.state));
  viewport.render(scene);
}

installDebugSurface({ sim, loop, viewport, screens, sky, freeze });
