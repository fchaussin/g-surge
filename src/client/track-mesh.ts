/**
 * The track itself: five ribbons and the gantries that punctuate it.
 *
 * Ribbons are `BufferGeometry` whose positions are rewritten every frame,
 * `COUNT × 2` vertices each — road, two edges, two skirts. Nothing is
 * allocated here after construction; the loop writes into the typed arrays it
 * already owns.
 *
 * The road carries a procedural canvas texture whose V coordinate is driven by
 * the absolute segment id, so the chevrons are attached to the track and
 * scroll with it rather than sliding along it.
 *
 * The trap to respect: **chevron period must stay above twice the per-frame
 * travel.** At 335 m/s and 60 fps that is 11.2 m, hence `stripeEvery: 2` for a
 * 24 m period. Below it the markings alias and the track appears to decompose,
 * which reads as a frame rate problem and is not one.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide,
  Group, Mesh, MeshBasicMaterial, Object3D, RepeatWrapping, type Texture,
  type WebGLRenderer,
} from 'three';
import { COUNT, HALF, type Track } from '../sim/index.js';

const ROAD_A = new Color(0x3d4a61);
const ROAD_B = new Color(0x333e52);
const NEON_A = new Color(0x25e2ff);
const NEON_B = new Color(0x0b4a63);
const HOT = new Color(0xff2f9a);

/** Width of the neon lip either side of the road, and how far the skirt drops. */
const LIP = 1.4;
const DROP = 3.2;

const GANTRY_COUNT = 14;
/** Gantries and hot lip stripes both land on this multiple of the segment id. */
const GANTRY_EVERY = 12;

function setPair(
  a: ArrayLike<number> & { [i: number]: number },
  i: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): void {
  const o = i * 6;
  a[o] = ax; a[o + 1] = ay; a[o + 2] = az;
  a[o + 3] = bx; a[o + 4] = by; a[o + 5] = bz;
}

function setColorPair(
  a: ArrayLike<number> & { [i: number]: number },
  i: number,
  c: Color,
): void {
  const o = i * 6;
  a[o] = c.r; a[o + 1] = c.g; a[o + 2] = c.b;
  a[o + 3] = c.r; a[o + 4] = c.g; a[o + 5] = c.b;
}

/**
 * One transverse stripe per repeat, plus the centre chevron and the kerbs.
 *
 * The map can only darken, so the vertex colours underneath are deliberately
 * lighter than the intended result.
 */
function roadTexture(renderer: WebGLRenderer): Texture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d')!;

  g.fillStyle = '#4a4a4a';
  g.fillRect(0, 0, S, S);

  // chevron pointing towards the front of the circuit
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = S * 0.17;
  g.beginPath();
  g.moveTo(-S * 0.02, S * 0.10);
  g.lineTo(S * 0.5, S * 0.46);
  g.lineTo(S * 1.02, S * 0.10);
  g.stroke();

  g.strokeStyle = '#ffffff';
  g.lineWidth = S * 0.10;
  g.beginPath();
  g.moveTo(-S * 0.02, S * 0.08);
  g.lineTo(S * 0.5, S * 0.42);
  g.lineTo(S * 1.02, S * 0.08);
  g.stroke();

  g.fillStyle = '#dcdcdc';
  g.fillRect(0, 0, S * 0.03, S);
  g.fillRect(S * 0.97, 0, S * 0.03, S);

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

function makeRibbon(material: MeshBasicMaterial, withColor: boolean, withUv: boolean): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 2 * 3), 3));
  if (withColor) g.setAttribute('color', new BufferAttribute(new Float32Array(COUNT * 2 * 3), 3));
  if (withUv) g.setAttribute('uv', new BufferAttribute(new Float32Array(COUNT * 2 * 2), 2));

  const index: number[] = [];
  for (let i = 0; i < COUNT - 1; i++) {
    const k = i * 2;
    index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  g.setIndex(index);

  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  return mesh;
}

export class TrackMesh {
  readonly group = new Group();

  private readonly road: Mesh;
  private readonly edgeL: Mesh;
  private readonly edgeR: Mesh;
  private readonly skirtL: Mesh;
  private readonly skirtR: Mesh;
  private readonly gantries: Object3D[] = [];

  constructor(renderer: WebGLRenderer) {
    this.road = makeRibbon(
      new MeshBasicMaterial({ vertexColors: true, map: roadTexture(renderer) }),
      true,
      true,
    );
    this.edgeL = makeRibbon(new MeshBasicMaterial({ vertexColors: true }), true, false);
    this.edgeR = makeRibbon(new MeshBasicMaterial({ vertexColors: true }), true, false);
    this.skirtL = makeRibbon(
      new MeshBasicMaterial({ color: 0x0a0d14, side: DoubleSide }),
      false,
      false,
    );
    this.skirtR = makeRibbon(
      new MeshBasicMaterial({ color: 0x0a0d14, side: DoubleSide }),
      false,
      false,
    );
    this.group.add(this.road, this.edgeL, this.edgeR, this.skirtL, this.skirtR);

    this.buildGantries();
  }

  /** Rewrites every ribbon vertex from the integrated path. Once per frame. */
  update(track: Track, stripeEvery: number): void {
    const { px, py, pz, pyaw, nb, nid } = track;

    const rp = this.road.geometry.attributes.position!.array as Float32Array;
    const rc = this.road.geometry.attributes.color!.array as Float32Array;
    const ru = this.road.geometry.attributes.uv!.array as Float32Array;
    const lp = this.edgeL.geometry.attributes.position!.array as Float32Array;
    const lc = this.edgeL.geometry.attributes.color!.array as Float32Array;
    const qp = this.edgeR.geometry.attributes.position!.array as Float32Array;
    const qc = this.edgeR.geometry.attributes.color!.array as Float32Array;
    const sl = this.skirtL.geometry.attributes.position!.array as Float32Array;
    const sr = this.skirtR.geometry.attributes.position!.array as Float32Array;

    const inv = 1 / Math.max(0.4, stripeEvery);

    for (let i = 0; i < COUNT; i++) {
      const yaw = pyaw[i]!;
      const b = nb[i]!;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cb = Math.cos(b), sb = Math.sin(b);
      const rx = cy * cb, ry = sb, rz = -sy * cb;
      const ux = -cy * sb, uy = cb, uz = sy * sb;
      const X = px[i]!, Y = py[i]!, Z = pz[i]!;
      const id = nid[i]!;

      setPair(rp, i, X - rx * HALF, Y - ry * HALF, Z - rz * HALF,
                     X + rx * HALF, Y + ry * HALF, Z + rz * HALF);
      setColorPair(rc, i, id % 8 < 4 ? ROAD_A : ROAD_B);

      // V driven by the absolute segment id, so the markings ride the track
      const v = id * inv;
      const o4 = i * 4;
      ru[o4] = 0; ru[o4 + 1] = v; ru[o4 + 2] = 1; ru[o4 + 3] = v;

      const l1 = -HALF - LIP, l2 = -HALF, r1 = HALF, r2 = HALF + LIP;
      setPair(lp, i, X + rx * l1, Y + ry * l1, Z + rz * l1,
                     X + rx * l2, Y + ry * l2, Z + rz * l2);
      setPair(qp, i, X + rx * r1, Y + ry * r1, Z + rz * r1,
                     X + rx * r2, Y + ry * r2, Z + rz * r2);

      const c = id % GANTRY_EVERY === 0 ? HOT : id % 6 < 3 ? NEON_A : NEON_B;
      setColorPair(lc, i, c);
      setColorPair(qc, i, c);

      setPair(sl, i, X + rx * l1, Y + ry * l1, Z + rz * l1,
                     X + rx * l1 - ux * DROP, Y + ry * l1 - uy * DROP, Z + rz * l1 - uz * DROP);
      setPair(sr, i, X + rx * r2, Y + ry * r2, Z + rz * r2,
                     X + rx * r2 - ux * DROP, Y + ry * r2 - uy * DROP, Z + rz * r2 - uz * DROP);
    }

    for (const m of [this.road, this.edgeL, this.edgeR]) {
      m.geometry.attributes.position!.needsUpdate = true;
      m.geometry.attributes.color!.needsUpdate = true;
    }
    this.road.geometry.attributes.uv!.needsUpdate = true;
    this.skirtL.geometry.attributes.position!.needsUpdate = true;
    this.skirtR.geometry.attributes.position!.needsUpdate = true;

    this.updateGantries(track);
  }

  private buildGantries(): void {
    const dark = new MeshBasicMaterial({ color: 0x11161f });
    const glow = new MeshBasicMaterial({ color: 0xff2f9a });
    const leg = new BoxGeometry(0.7, 9, 0.7);
    const beamGeo = new BoxGeometry((HALF + 2.6) * 2, 1.1, 0.8);
    const barGeo = new BoxGeometry((HALF + 2.2) * 2, 0.22, 0.9);

    for (let i = 0; i < GANTRY_COUNT; i++) {
      const grp = new Group();
      const left = new Mesh(leg, dark);
      const right = new Mesh(leg, dark);
      left.position.set(-(HALF + 2.2), 4.5, 0);
      right.position.set(HALF + 2.2, 4.5, 0);
      const beam = new Mesh(beamGeo, dark);
      beam.position.y = 9.2;
      const bar = new Mesh(barGeo, glow);
      bar.position.y = 8.5;
      grp.add(left, right, beam, bar);
      grp.visible = false;
      this.group.add(grp);
      this.gantries.push(grp);
    }
  }

  /** Pooled: the same fourteen groups are moved, never created or destroyed. */
  private updateGantries(track: Track): void {
    const { px, py, pz, pyaw, nb, nid } = track;
    let n = 0;
    for (let i = 0; i < COUNT && n < GANTRY_COUNT; i++) {
      if (nid[i]! % GANTRY_EVERY !== 0) continue;
      const g = this.gantries[n++]!;
      g.visible = true;
      g.position.set(px[i]!, py[i]!, pz[i]!);
      g.rotation.set(0, pyaw[i]!, nb[i]!, 'YXZ');
    }
    for (let i = n; i < GANTRY_COUNT; i++) this.gantries[i]!.visible = false;
  }
}
