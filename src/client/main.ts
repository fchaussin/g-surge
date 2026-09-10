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
import { Color, FogExp2, REVISION, Scene } from 'three';
import { BACK, Sim } from '../sim/index.js';
import type { Input } from '../sim/index.js';
import { ChaseCamera } from './camera.js';
import { Loop } from './loop.js';
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
scene.add(sky.group, trackMesh.group);

let elapsed = 0;

const loop = new Loop({
  simulate(dt) {
    // Attract mode until the input layer lands: the autopilot recentres and
    // the track keeps streaming, which is enough to see everything render.
    sim.step(input, dt, true);
  },
  render(frameDt) {
    elapsed += frameDt;

    // The path has to be integrated before anything reads it: the ribbons walk
    // its buffers directly and the camera samples along it.
    sim.track.buildPath(sim.state.cursor);
    trackMesh.update(sim.track, sim.tuning.stripeEvery);
    camera.update(sim.state, sim.track, sim.tuning, frameDt, sim.state.shake);

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
  },
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
};
