/**
 * The ship: hull, wings, pods, exhaust plumes, smoke trail and pickup halo.
 *
 * The only lit object in the game. Everything else is `MeshBasicMaterial`;
 * the ship gets `MeshLambertMaterial` under one key light and a dim ambient so
 * that it reads as a solid volume and so its rotation stays legible during a
 * corkscrew.
 *
 * Two things carried over deliberately:
 *
 * - **`MeshLambertMaterial` has no `flatShading` in r128.** Non-indexed
 *   geometry is already flat shaded; setting the property only logs a warning.
 *   The hulls are built as loose triangles for exactly that reason.
 * - **The smoke trail is parented to the ship, not emitted into the world.**
 *   In world space a puff released at the ship necessarily crosses the camera
 *   19 m behind it and fills the screen. Parented, the chain stays between the
 *   two and cannot cross.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import type { ThrustTier } from './thrust.js';

/** Thrust tiers: cruising, boosting, super boost. */
const THRUST_LEVELS = [
  { len: 1.1, rad: 0.3, opacity: 0.35, colour: 0x5fd8ff },
  { len: 3.0, rad: 0.44, opacity: 0.75, colour: 0xbdf0ff },
  { len: 5.0, rad: 0.56, opacity: 0.95, colour: 0xff8ae0 },
] as const;

const SMOKE_COUNT = 18;
const TRAIL_LENGTH = 11;

type Point3 = readonly [number, number, number];

/** Loose triangles, so the geometry is flat shaded without asking for it. */
function poly(
  faces: readonly (readonly [string, string, string])[],
  points: Record<string, Point3>,
): BufferGeometry {
  const v: number[] = [];
  for (const [a, b, c] of faces) v.push(...points[a]!, ...points[b]!, ...points[c]!);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Ship {
  /** Follows the track. Smoke and halo hang off it. */
  readonly group = new Group();
  /** Carries the visual lean and yaw, which the hull shows but the path does not. */
  readonly body = new Group();

  private readonly flames: Mesh[] = [];
  private readonly flameOuter: MeshBasicMaterial;
  private readonly flameCore: MeshBasicMaterial;
  private readonly halo: Mesh;
  private readonly haloMaterial: MeshBasicMaterial;
  private readonly smoke: Sprite[] = [];
  private smokePhase = 0;

  /* Scratch colours, so the per-frame lerps allocate nothing. */
  private readonly tmpA = new Color();
  private readonly tmpB = new Color();

  constructor() {
    this.group.add(this.body);
    this.buildHull();
    ({ outer: this.flameOuter, core: this.flameCore } = this.buildPlumes());

    this.haloMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new Mesh(new SphereGeometry(2.6, 14, 10), this.haloMaterial);
    this.halo.position.y = 0.8;
    this.halo.visible = false;
    this.group.add(this.halo);

    this.buildSmoke();
  }

  /** Places the ship in the track frame. `bank` comes from the simulation. */
  setPose(lat: number, hop: number, bank: number): void {
    const cb = Math.cos(bank),
      sb = Math.sin(bank);
    const hover = 1.35 + hop;
    this.group.position.set(cb * lat - sb * hover, sb * lat + cb * hover, 0);
    this.group.rotation.z = bank;
  }

  /** Visual attitude: roll into the corner, yaw with the slip. */
  setAttitude(lean: number, yaw: number, pitch: number): void {
    this.body.rotation.z = lean;
    this.body.rotation.y = yaw;
    this.body.rotation.x = pitch;
  }

  /**
   * @param level 0 cruising, 1 boosting, 2 super boost.
   * @param frameDt real frame delta: this is display easing, not simulation.
   */
  updateThrust(frameDt: number, level: ThrustTier): void {
    const lv = THRUST_LEVELS[level];
    // Deliberately still on Math.random: per-frame visual noise, outside the
    // simulation, and seeding it would couple presentation to the core.
    const flicker = 0.86 + Math.random() * 0.28;

    for (let i = 0; i < this.flames.length; i++) {
      const m = this.flames[i]!;
      const isCore = i % 2 === 1;
      const targetLen = lv.len * (isCore ? 0.62 : 1) * flicker;
      const targetRad = lv.rad * (isCore ? 0.5 : 1);
      const k = Math.min(1, frameDt * 12);
      m.scale.x += (targetRad - m.scale.x) * k;
      m.scale.y = m.scale.x;
      m.scale.z += (targetLen - m.scale.z) * k;
    }

    const ko = Math.min(1, frameDt * 8);
    this.flameOuter.opacity += (lv.opacity * 0.55 - this.flameOuter.opacity) * ko;
    this.flameCore.opacity += (lv.opacity - this.flameCore.opacity) * ko;
    const kc = Math.min(1, frameDt * 6);
    this.flameOuter.color.lerp(this.tmpA.setHex(lv.colour), kc);
    this.flameCore.color.lerp(this.tmpB.setHex(level === 2 ? 0xffe6fb : 0xffffff), kc);
  }

  /**
   * Puts the plumes straight at their steady state, with no flicker.
   *
   * Only the deterministic frame capture uses this. The plumes ease towards
   * their target over many frames, so a frame taken after an arbitrary number
   * of them is not reproducible — which showed up as a 7 000 pixel difference
   * between two captures of the same frozen simulation state.
   */
  snapThrust(level: ThrustTier): void {
    const lv = THRUST_LEVELS[level];
    for (let i = 0; i < this.flames.length; i++) {
      const m = this.flames[i]!;
      const isCore = i % 2 === 1;
      m.scale.z = lv.len * (isCore ? 0.62 : 1);
      m.scale.x = lv.rad * (isCore ? 0.5 : 1);
      m.scale.y = m.scale.x;
    }
    this.flameOuter.opacity = lv.opacity * 0.55;
    this.flameCore.opacity = lv.opacity;
    this.flameOuter.color.setHex(lv.colour);
    this.flameCore.color.setHex(level === 2 ? 0xffe6fb : 0xffffff);
  }

  updateSmoke(frameDt: number, speed: number, level: ThrustTier): void {
    if (speed < 1) {
      for (const sp of this.smoke) sp.visible = false;
      return;
    }
    this.smokePhase = (this.smokePhase + (speed * frameDt) / TRAIL_LENGTH) % 1;
    const half = SMOKE_COUNT / 2;
    const base = 0.2 + level * 0.11;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const sp = this.smoke[i]!;
      const side = i < half ? -1 : 1;
      // 0 at the nozzle, 1 at the tail. Bounded by construction, which is why
      // the sprite scale below can never go negative — a mirrored sprite
      // filling the screen is a bug this codebase has already paid for.
      const p = (this.smokePhase + (i % half) / half) % 1;
      sp.visible = true;
      sp.position.set(side * (1.15 + p * 1.05), 1.0 + p * 0.85, -2.6 - p * TRAIL_LENGTH);
      sp.scale.setScalar(0.45 + p * 1.35);
      sp.material.opacity = base * Math.pow(Math.sin(p * Math.PI), 1.3);
    }
  }

  /** Puffs hold a distance travelled, so a reset has to drop them. */
  clearSmoke(): void {
    this.smokePhase = 0;
    for (const sp of this.smoke) sp.visible = false;
  }

  /**
   * Pickup and impact glow. Driven by the client, not by simulation state:
   * `halo` and `haloPow` left the core when the events replaced them.
   *
   * @param intensity 0 to 1, decayed by the caller.
   */
  setHalo(colour: number, intensity: number, power: number): void {
    if (intensity <= 0) {
      this.halo.visible = false;
      return;
    }
    this.haloMaterial.color.setHex(colour);
    this.halo.visible = true;
    this.haloMaterial.opacity = 0.85 * intensity * intensity * power;
    this.halo.scale.setScalar(0.55 + (1 - intensity) * 2.3 * power);
  }

  /** An M seen head on: two high wings, a lower central spine, two hollows. */
  private buildHull(): void {
    const P: Record<string, Point3> = {
      N: [0, 0.52, 2.9],
      T: [0, 1.05, -0.2],
      L: [-0.62, 0.46, -0.2],
      R: [0.62, 0.46, -0.2],
      B: [0, -0.02, -0.2],
      T2: [0, 0.86, -2.4],
      L2: [-0.48, 0.46, -2.4],
      R2: [0.48, 0.46, -2.4],
      B2: [0, 0.12, -2.4],
    };
    const hull = new Mesh(
      poly(
        [
          ['N', 'T', 'R'],
          ['N', 'R', 'B'],
          ['N', 'B', 'L'],
          ['N', 'L', 'T'],
          ['T', 'L', 'L2'],
          ['T', 'L2', 'T2'],
          ['R', 'T', 'T2'],
          ['R', 'T2', 'R2'],
          ['B', 'R', 'R2'],
          ['B', 'R2', 'B2'],
          ['L', 'B', 'B2'],
          ['L', 'B2', 'L2'],
          ['T2', 'L2', 'B2'],
          ['T2', 'B2', 'R2'],
        ],
        P,
      ),
      new MeshLambertMaterial({ color: 0x36485f, side: DoubleSide }),
    );

    // swept wing, low root and raised tip
    const W: Record<string, Point3> = {
      A: [0.52, 0.44, 1.0],
      B: [0.52, 0.44, -1.9],
      K1: [1.5, 1.3, -0.15],
      K2: [1.52, 1.3, -2.15],
      T1: [1.88, 1.02, -0.8],
      T2: [1.9, 1.02, -2.35],
    };
    const WL: Record<string, Point3> = {};
    for (const k of Object.keys(W)) WL[k] = [-W[k]![0], W[k]![1], W[k]![2]];
    const wingFaces = [
      ['A', 'K1', 'K2'],
      ['A', 'K2', 'B'],
      ['K1', 'T1', 'T2'],
      ['K1', 'T2', 'K2'],
    ] as const;
    const wingMat = new MeshLambertMaterial({ color: 0x2b3b52, side: DoubleSide });
    const wingR = new Mesh(poly(wingFaces, W), wingMat);
    const wingL = new Mesh(poly(wingFaces, WL), wingMat);

    // nacelles at two thirds of the span
    const podGeo = new CylinderGeometry(0.26, 0.22, 1.15, 8);
    podGeo.rotateX(Math.PI / 2);
    const podMat = new MeshLambertMaterial({ color: 0x1d2836 });
    const pods = [-1.15, 1.15].map((x) => {
      const m = new Mesh(podGeo, podMat);
      m.position.set(x, 1.0, -1.7);
      return m;
    });

    const glowMat = new MeshBasicMaterial({ color: 0x8af4ff, transparent: true, opacity: 0.95 });
    const glowGeo = new CircleGeometry(0.23, 8);
    const glows = [-1.15, 1.15].map((x) => {
      const m = new Mesh(glowGeo, glowMat);
      m.position.set(x, 1.0, -2.29);
      m.rotation.y = Math.PI;
      return m;
    });

    const canopy = new Mesh(
      new BoxGeometry(0.44, 0.3, 1.05),
      new MeshLambertMaterial({ color: 0x0d1620 }),
    );
    canopy.position.set(0, 0.96, 0.75);
    canopy.rotation.x = -0.12;

    const spine = new Mesh(
      new BoxGeometry(0.13, 0.06, 2.0),
      new MeshBasicMaterial({ color: 0x25e2ff }),
    );
    spine.position.set(0, 1.07, -0.9);

    const strakeGeo = new BoxGeometry(0.09, 0.36, 0.72);
    const strakeMat = new MeshBasicMaterial({ color: 0xff2f9a });
    const strakes = [-1.51, 1.51].map((x) => {
      const m = new Mesh(strakeGeo, strakeMat);
      m.position.set(x, 1.46, -1.2);
      m.rotation.z = x < 0 ? 0.16 : -0.16;
      return m;
    });

    this.body.add(hull, wingL, wingR, canopy, spine, ...pods, ...glows, ...strakes);
  }

  /** A wide diffuse cone and a narrow bright core, per nozzle. */
  private buildPlumes(): { outer: MeshBasicMaterial; core: MeshBasicMaterial } {
    const geo = new ConeGeometry(1, 1, 12, 1, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -0.5);

    const outer = new MeshBasicMaterial({
      color: 0x5fd8ff,
      transparent: true,
      opacity: 0.4,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const core = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    for (const x of [-1.15, 1.15]) {
      const o = new Mesh(geo, outer);
      const c = new Mesh(geo, core);
      o.position.set(x, 1.0, -2.3);
      c.position.set(x, 1.0, -2.3);
      this.flames.push(o, c);
      this.body.add(o, c);
    }
    return { outer, core };
  }

  private buildSmoke(): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const g = canvas.getContext('2d')!;
    const grd = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.40)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 96, 96);

    const map = new CanvasTexture(canvas);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const sp = new Sprite(
        new SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false, fog: false }),
      );
      sp.visible = false;
      this.group.add(sp);
      this.smoke.push(sp);
    }
  }
}
