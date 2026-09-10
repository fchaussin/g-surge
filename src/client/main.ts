/**
 * Entry point of the new client.
 *
 * Skeleton only: it wires the simulation core to a renderer and a frame loop,
 * and draws a placeholder so that the wiring is visible and testable. The
 * actual scene, track meshes, ship and UI arrive at roadmap steps 2 and 3.
 *
 * What matters here is the shape, not the picture: the simulation is driven by
 * whole fixed steps, it is fed input as data, and it is never asked to touch
 * the DOM or three.js.
 */
import * as THREE from 'three';
import { Sim } from '../sim/index.js';
import type { Input } from '../sim/index.js';
import { Loop } from './loop.js';
import { Viewport } from './viewport.js';

const VOID = 0x05060a;

/** Reused every frame: allocating one of these per step is 720 a second. */
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

const scene = new THREE.Scene();
scene.background = new THREE.Color(VOID);
scene.fog = new THREE.FogExp2(VOID, 0.0017);

const viewport = new Viewport(74);
viewport.camera.position.set(0, 5, -19);
viewport.camera.lookAt(0, 2.6, 46);

// Placeholder standing in for the ship until step 2 ports the real model. It
// is driven from the simulation so that a rendered frame proves the whole
// chain, not just that three.js starts.
const marker = new THREE.Mesh(
  new THREE.BoxGeometry(3.8, 0.9, 6),
  new THREE.MeshBasicMaterial({ color: 0x25e2ff, wireframe: true }),
);
scene.add(marker);

const loop = new Loop({
  simulate(dt) {
    sim.step(input, dt, true);
  },
  render() {
    marker.position.set(sim.state.lat, 1.35 + sim.state.hop, 0);
    marker.rotation.y = sim.state.yaw;
    viewport.render(scene);
  },
});

loop.start();

/**
 * Debug surface, mirroring the legacy `window.__gs`. It exists for the tests
 * and for the replay features to come; it is not a game API.
 */
declare global {
  interface Window {
    __gsNext: {
      seed(): string;
      revision: string;
      fixedStep(): number;
      state(): Readonly<typeof sim.state>;
      renderScale(): number;
    };
  }
}

window.__gsNext = {
  seed: () => sim.seed,
  revision: THREE.REVISION,
  fixedStep: () => loop.fixedStep,
  state: () => sim.state,
  renderScale: () => viewport.renderScale,
};
