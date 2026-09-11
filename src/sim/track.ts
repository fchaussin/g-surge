/**
 * La piste, en flux.
 *
 * Quatre tampons circulaires parallèles de `COUNT` entrées, une par segment de
 * `SEG` mètres. `push()` les décale d'un cran et prend un nœud neuf à la
 * source, ce qui arrive chaque fois que le vaisseau parcourt `SEG`. `BACK`
 * segments sont conservés derrière le vaisseau.
 *
 * D'où vient le nœud est l'affaire de la source, `generator.ts` : le
 * générateur semé hors ligne, une file remplie par le réseau en partie
 * classée. La piste ne fait pas la différence, et c'est ce qui garantit que
 * le noyau joue au bit près la même chose dans les deux cas.
 */
import { SeededNodes, type Node, type NodeSource } from './generator.js';
import { cos, sin } from './trig.js';
import type { Tuning } from './tuning.js';

export const COUNT = 130;
export const SEG = 12;
export const BACK = 10;
export const HALF = 11.5;
export const SHIP = 1.9;

export const ITEM_COIN = 0;
export const ITEM_FIX = 1;
export const ITEM_SUP = 2;
/** L'invincibilité, et le wall riding avec elle. Un « extra », voir `Track.extras`. */
export const ITEM_RIDE = 3;
/** Un bidon de carburant. Un « extra » aussi. */
export const ITEM_FUEL = 4;
export type ItemType =
  typeof ITEM_COIN | typeof ITEM_FIX | typeof ITEM_SUP | typeof ITEM_RIDE | typeof ITEM_FUEL;

/** Repère local du ruban en un point. Réutilisé, jamais alloué par appel. */
export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  /** Cap intégré, rad. */
  yaw: number;
  /** Dévers, rad. */
  bank: number;
  /** Vecteur droite, incliné par le dévers. */
  rx: number;
  ry: number;
  rz: number;
  /** Normale à la piste. */
  ux: number;
  uy: number;
  uz: number;
}

/** Crée un point réutilisable. */
export function trackPoint(): TrackPoint {
  return { x: 0, y: 0, z: 0, yaw: 0, bank: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0 };
}

export interface Item {
  id: number;
  lat: number;
  type: ItemType;
  done: boolean;
  taken: boolean;
}

/** `THREE.MathUtils.clamp` de r128, reproduit pour garder le noyau sans three.js. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class Track {
  /** Courbure, rad/m. */
  readonly nk = new Float32Array(COUNT);
  /** Pente, dy/ds. */
  readonly ng = new Float32Array(COUNT);
  /** Dévers, rad. Non borné : les vrilles y ajoutent des tours. */
  readonly nb = new Float32Array(COUNT);
  /** Identifiant absolu de segment. Pilote motifs et objets. */
  readonly nid = new Int32Array(COUNT);

  items: Item[] = [];
  /**
   * Les objets ajoutés après le gel des références — l'invincibilité, et ce
   * qui viendra. Une liste à part avec son propre flux aléatoire, et jamais
   * avant `extrasFrom` mètres : les références de piste enregistrent `items`
   * tel que l'ancien jeu le produisait, et les traces physiques couvrent
   * 1 345 m. Ainsi le contrat de la migration reste exactement ce qu'il était,
   * et une mécanique neuve ne demande à personne de le régénérer.
   */
  extras: Item[] = [];

  /* Ruban intégré, rempli par `buildPath`. Réécrit sur place à chaque image.
     Exposé en lecture : les rubans du rendu parcourent ces tampons directement
     plutôt que d'appeler `sample` cent trente fois par image. */
  readonly px = new Float32Array(COUNT);
  readonly py = new Float32Array(COUNT);
  readonly pz = new Float32Array(COUNT);
  readonly pyaw = new Float32Array(COUNT);

  private source: NodeSource;
  /**
   * Vrai dès que la source n'a plus rien donné. La piste continue alors tout
   * droit sur le dernier nœud pour que la simulation garde ses invariants, et
   * c'est au client d'arrêter la partie : ce qui suit ne correspond à aucune
   * piste, et un serveur ne le validerait pas.
   */
  dry = false;
  private readonly last: Node = { k: 0, g: 0, b: 0, id: 0, items: [], extras: [] };

  constructor(
    private tuning: Tuning,
    seed: string,
  ) {
    this.source = new SeededNodes(tuning, seed);
    this.attach(this.source);
  }

  /** Le réglage change avec la difficulté ; le générateur le relit à chaque nœud. */
  setTuning(tuning: Tuning): void {
    this.tuning = tuning;
    this.source.setTuning(tuning);
  }

  /** Repart d'une piste neuve. Une même graine régénère exactement la même. */
  seed(seed: string): void {
    this.attach(new SeededNodes(this.tuning, seed));
  }

  /**
   * Repart sur une autre source — la file du réseau en partie classée. Les
   * `COUNT` premiers nœuds sont pris tout de suite ; une file qui ne les a
   * pas encore est sèche avant de commencer.
   */
  attach(source: NodeSource): void {
    this.source = source;
    this.dry = false;
    this.items = [];
    this.extras = [];
    for (let i = 0; i < COUNT; i++) {
      const n = this.take();
      this.nk[i] = n.k;
      this.ng[i] = n.g;
      this.nb[i] = n.b;
      this.nid[i] = n.id;
      this.collect(n);
    }
  }

  /** Le nœud suivant, ou le dernier prolongé tout droit si la source est sèche. */
  private take(): Node {
    const n = this.source.next();
    const l = this.last;
    if (n === null) {
      this.dry = true;
      l.id++;
      return l;
    }
    l.k = n.k;
    l.g = n.g;
    l.b = n.b;
    l.id = n.id;
    return n;
  }

  private collect(n: Node): void {
    for (const it of n.items) this.items.push(it);
    for (const it of n.extras) this.extras.push(it);
  }

  /** Décale les tampons d'un cran et prend le nœud suivant. */
  push(): void {
    this.nk.copyWithin(0, 1);
    this.ng.copyWithin(0, 1);
    this.nb.copyWithin(0, 1);
    this.nid.copyWithin(0, 1);

    const n = this.take();
    this.nk[COUNT - 1] = n.k;
    this.ng[COUNT - 1] = n.g;
    this.nb[COUNT - 1] = n.b;
    this.nid[COUNT - 1] = n.id;

    this.collect(n);
    const oldest = this.nid[0]!;
    if (this.items.length && this.items[0]!.id < oldest - 2) {
      this.items = this.items.filter((it) => it.id >= oldest - 2);
    }
    if (this.extras.length && this.extras[0]!.id < oldest - 2) {
      this.extras = this.extras.filter((it) => it.id >= oldest - 2);
    }
  }

  /**
   * Intègre les positions du ruban depuis le vaisseau vers l'extérieur,
   * l'arrière d'abord puis l'avant, et remplit `px/py/pz/pyaw`.
   *
   * Le vaisseau est à l'index `BACK`, décalé de `cursor` mètres dans son
   * segment. Chaque pas avance d'un segment en utilisant le cap moyen entre
   * ses deux extrémités : intégrer avec le cap d'une seule extrémité fait
   * dériver la piste vers l'extérieur des virages.
   */
  buildPath(cursor: number): void {
    const { px, py, pz, pyaw, nk, ng } = this;

    const cy0 = -nk[BACK]! * cursor;
    px[BACK] = -sin(cy0) * cursor;
    pz[BACK] = -cos(cy0) * cursor;
    py[BACK] = -ng[BACK]! * cursor;
    pyaw[BACK] = cy0;

    for (let i = BACK - 1; i >= 0; i--) {
      const ahead = pyaw[i + 1]!;
      const y2 = ahead - nk[i]! * SEG;
      const mid = (y2 + ahead) * 0.5;
      px[i] = px[i + 1]! - sin(mid) * SEG;
      pz[i] = pz[i + 1]! - cos(mid) * SEG;
      py[i] = py[i + 1]! - ng[i]! * SEG;
      pyaw[i] = y2;
    }

    const first = SEG - cursor;
    const fy = nk[BACK]! * first;
    const midF = fy * 0.5;
    px[BACK + 1] = sin(midF) * first;
    pz[BACK + 1] = cos(midF) * first;
    py[BACK + 1] = ng[BACK]! * first;
    pyaw[BACK + 1] = fy;

    for (let i = BACK + 2; i < COUNT; i++) {
      const behind = pyaw[i - 1]!;
      const y2 = behind + nk[i - 1]! * SEG;
      const mid = (y2 + behind) * 0.5;
      px[i] = px[i - 1]! + sin(mid) * SEG;
      pz[i] = pz[i - 1]! + cos(mid) * SEG;
      py[i] = py[i - 1]! + ng[i - 1]! * SEG;
      pyaw[i] = y2;
    }
  }

  /**
   * Point du ruban à `d` mètres devant le vaisseau, `d` négatif vers
   * l'arrière. Écrit dans `out` plutôt que d'allouer : la caméra et les objets
   * l'appellent plusieurs fois par image.
   *
   * Demande un `buildPath` préalable avec le même curseur.
   */
  sample(cursor: number, d: number, out: TrackPoint): TrackPoint {
    let f = BACK + (cursor + d) / SEG;
    f = Math.max(0, Math.min(COUNT - 1.001, f));
    const i = Math.floor(f);
    const t = f - i;
    const j = i + 1;

    const x0 = this.px[i]!,
      y0 = this.py[i]!,
      z0 = this.pz[i]!;
    out.x = x0 + (this.px[j]! - x0) * t;
    out.y = y0 + (this.py[j]! - y0) * t;
    out.z = z0 + (this.pz[j]! - z0) * t;

    const yaw0 = this.pyaw[i]!;
    const yaw = yaw0 + (this.pyaw[j]! - yaw0) * t;
    const b0 = this.nb[i]!;
    const b = b0 + (this.nb[j]! - b0) * t;
    out.yaw = yaw;
    out.bank = b;

    const cy = cos(yaw),
      sy = sin(yaw);
    const cb = cos(b),
      sb = sin(b);
    out.rx = cy * cb;
    out.ry = sb;
    out.rz = -sy * cb; // droite, inclinée par le dévers
    out.ux = -cy * sb;
    out.uy = cb;
    out.uz = sy * sb; // normale à la piste
    return out;
  }

  /** Pente interpolée à `d` mètres devant le vaisseau. */
  gradeAt(cursor: number, d: number): number {
    let f = BACK + (cursor + d) / SEG;
    f = Math.max(0, Math.min(COUNT - 1.001, f));
    const i = Math.floor(f);
    const t = f - i;
    const a = this.ng[i]!;
    return a + (this.ng[i + 1]! - a) * t;
  }
}
