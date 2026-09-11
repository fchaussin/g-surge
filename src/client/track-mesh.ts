/**
 * La piste elle-même : cinq rubans et les portiques qui la ponctuent.
 *
 * Les rubans sont des `BufferGeometry` dont les positions sont réécrites à
 * chaque frame, `COUNT × 2` sommets chacun — route, deux bords, deux jupes.
 * Rien n'est alloué ici après la construction ; la boucle écrit dans les
 * tableaux typés qu'elle possède déjà.
 *
 * La route porte une texture canvas procédurale dont la coordonnée V est
 * pilotée par l'identifiant absolu du segment, si bien que les chevrons sont
 * attachés à la piste et défilent avec elle au lieu de glisser dessus.
 *
 * Le piège à respecter : **la période des chevrons doit rester au-dessus du
 * double du parcours par frame.** À 409 m/s — le super boost, le vrai plafond
 * — et 60 fps, c'est 13,6 m, d'où `stripeEvery: 2` pour une période de 24 m.
 * En dessous les marquages aliasent et la piste semble se décomposer, ce qui se
 * lit comme un problème de cadence et n'en est pas un.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RepeatWrapping,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { BACK, COUNT, HALF, type Track } from '../sim/index.js';

const ROAD_A = new Color(0x3d4a61);
const ROAD_B = new Color(0x333e52);
const NEON_A = new Color(0x25e2ff);
const NEON_B = new Color(0x0b4a63);
const HOT = new Color(0xff2f9a);

/**
 * Sous invincibilité les lèvres s'allument : un arc-en-ciel qui coule le long
 * de la piste, plein autour du vaisseau et qui s'éteint avec la distance —
 * c'est le champ du bouclier posé sur les rails, pas une piste repeinte. La
 * teinte tourne avec l'identifiant du segment et le temps, comme le prisme.
 */
/** Segments autour du vaisseau où les rails sont pleinement allumés, puis où ils s'éteignent. */
const SHIELD_FULL = 14;
const SHIELD_FADE = 40;
/** Tours de teinte par segment et par seconde. */
const SHIELD_HUE_PER_SEG = 0.03;
const SHIELD_HUE_PER_S = 0.6;
/* Deux couleurs de travail : la teinte, et le mélange. Rien d'alloué par frame. */
const SHIELD_HUE = new Color();
const SHIELD_MIX = new Color();

/** Largeur de la lèvre néon de chaque côté de la route, et chute de la jupe. */
const LIP = 1.4;
const DROP = 3.2;

const GANTRY_COUNT = 14;
/** Portiques et bandes chaudes de la lèvre tombent tous deux sur ce multiple de l'identifiant. */
const GANTRY_EVERY = 12;

function setPair(
  a: ArrayLike<number> & { [i: number]: number },
  i: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): void {
  const o = i * 6;
  a[o] = ax;
  a[o + 1] = ay;
  a[o + 2] = az;
  a[o + 3] = bx;
  a[o + 4] = by;
  a[o + 5] = bz;
}

function setColorPair(a: ArrayLike<number> & { [i: number]: number }, i: number, c: Color): void {
  const o = i * 6;
  a[o] = c.r;
  a[o + 1] = c.g;
  a[o + 2] = c.b;
  a[o + 3] = c.r;
  a[o + 4] = c.g;
  a[o + 5] = c.b;
}

/**
 * Une bande transversale par répétition, plus le chevron central et les
 * bordures.
 *
 * La texture ne peut qu'assombrir, donc les couleurs de sommet en dessous sont
 * délibérément plus claires que le résultat voulu.
 */
function roadTexture(renderer: WebGLRenderer): Texture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d')!;

  g.fillStyle = '#4a4a4a';
  g.fillRect(0, 0, S, S);

  // chevron pointé vers l'avant du circuit
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = S * 0.17;
  g.beginPath();
  g.moveTo(-S * 0.02, S * 0.1);
  g.lineTo(S * 0.5, S * 0.46);
  g.lineTo(S * 1.02, S * 0.1);
  g.stroke();

  g.strokeStyle = '#ffffff';
  g.lineWidth = S * 0.1;
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

  /**
   * Réécrit chaque sommet de ruban depuis le chemin intégré. Une fois par frame.
   *
   * @param shield intensité du bouclier, 0 à 1 ; à zéro les lèvres sont ce
   *   qu'elles ont toujours été, et une capture n'en voit jamais autre chose.
   * @param clock secondes écoulées, pour faire couler la teinte.
   */
  update(track: Track, stripeEvery: number, shield = 0, clock = 0): void {
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
      const cy = Math.cos(yaw),
        sy = Math.sin(yaw);
      const cb = Math.cos(b),
        sb = Math.sin(b);
      const rx = cy * cb,
        ry = sb,
        rz = -sy * cb;
      const ux = -cy * sb,
        uy = cb,
        uz = sy * sb;
      const X = px[i]!,
        Y = py[i]!,
        Z = pz[i]!;
      const id = nid[i]!;

      setPair(
        rp,
        i,
        X - rx * HALF,
        Y - ry * HALF,
        Z - rz * HALF,
        X + rx * HALF,
        Y + ry * HALF,
        Z + rz * HALF,
      );
      setColorPair(rc, i, id % 8 < 4 ? ROAD_A : ROAD_B);

      // V piloté par l'identifiant absolu du segment : les marquages suivent la piste
      const v = id * inv;
      const o4 = i * 4;
      ru[o4] = 0;
      ru[o4 + 1] = v;
      ru[o4 + 2] = 1;
      ru[o4 + 3] = v;

      const l1 = -HALF - LIP,
        l2 = -HALF,
        r1 = HALF,
        r2 = HALF + LIP;
      setPair(lp, i, X + rx * l1, Y + ry * l1, Z + rz * l1, X + rx * l2, Y + ry * l2, Z + rz * l2);
      setPair(qp, i, X + rx * r1, Y + ry * r1, Z + rz * r1, X + rx * r2, Y + ry * r2, Z + rz * r2);

      let c = id % GANTRY_EVERY === 0 ? HOT : id % 6 < 3 ? NEON_A : NEON_B;
      if (shield > 0) {
        const away = Math.abs(i - BACK);
        const reach = away < SHIELD_FULL ? 1 : Math.max(0, 1 - (away - SHIELD_FULL) / SHIELD_FADE);
        const mix = shield * reach;
        if (mix > 0) {
          const hue = (id * SHIELD_HUE_PER_SEG + clock * SHIELD_HUE_PER_S) % 1;
          c = SHIELD_MIX.copy(c).lerp(SHIELD_HUE.setHSL(hue, 1, 0.72), mix);
        }
      }
      setColorPair(lc, i, c);
      setColorPair(qc, i, c);

      setPair(
        sl,
        i,
        X + rx * l1,
        Y + ry * l1,
        Z + rz * l1,
        X + rx * l1 - ux * DROP,
        Y + ry * l1 - uy * DROP,
        Z + rz * l1 - uz * DROP,
      );
      setPair(
        sr,
        i,
        X + rx * r2,
        Y + ry * r2,
        Z + rz * r2,
        X + rx * r2 - ux * DROP,
        Y + ry * r2 - uy * DROP,
        Z + rz * r2 - uz * DROP,
      );
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

  /** En réservoir : les mêmes quatorze groupes sont déplacés, jamais créés ni détruits. */
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
