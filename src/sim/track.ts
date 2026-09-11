/**
 * Génération de piste, en flux.
 *
 * Quatre tampons circulaires parallèles de `COUNT` entrées, une par segment de
 * `SEG` mètres. `push()` les décale d'un cran et fabrique un nœud neuf, ce qui
 * arrive chaque fois que le vaisseau parcourt `SEG`. `BACK` segments sont
 * conservés derrière le vaisseau.
 *
 * La géométrie est une fonction de la seule graine, de la difficulté et de
 * l'identifiant de segment. Rien n'y dépend de la partie en cours, ce qui rend
 * une piste rejouable, partageable, et vérifiable par un serveur.
 *
 * Ce ne fut pas toujours le cas : le générateur lisait la vitesse réelle du
 * joueur pour borner courbure et pente, si bien que deux pilotages différents
 * sur une même graine produisaient deux tracés. Voir `nominalSpeed`.
 */
import { Rng } from './rng.js';
import { atan, cos, sin } from './trig.js';
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

interface GenState {
  k: number;
  kTarget: number;
  kLeft: number;
  g: number;
  gTarget: number;
  gLeft: number;
  gLerp: number;
  crest: boolean;
  roll: number;
  rollDir: number;
  rollPhase: number;
  id: number;
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

  private readonly gen: GenState = {
    k: 0,
    kTarget: 0,
    kLeft: 0,
    g: 0,
    gTarget: 0,
    gLeft: 0,
    gLerp: 0.09,
    crest: false,
    roll: 0,
    rollDir: 1,
    rollPhase: 0,
    id: 0,
  };

  private readonly coinRun = { left: 0, lat: 0, drift: 0 };
  private trackRng: Rng;
  private itemRng: Rng;
  private extraRng: Rng;

  constructor(
    private tuning: Tuning,
    seed: string,
  ) {
    this.trackRng = Rng.fromSeed(seed, 'track');
    this.itemRng = Rng.fromSeed(seed, 'items');
    this.extraRng = Rng.fromSeed(seed, 'extras');
    this.seed(seed);
  }

  /** Le réglage change avec la difficulté ; la piste le relit à chaque nœud. */
  setTuning(tuning: Tuning): void {
    this.tuning = tuning;
  }

  /** Repart d'une piste neuve. Une même graine régénère exactement la même. */
  seed(seed: string): void {
    this.trackRng = Rng.fromSeed(seed, 'track');
    this.itemRng = Rng.fromSeed(seed, 'items');
    this.extraRng = Rng.fromSeed(seed, 'extras');

    const g = this.gen;
    g.k = g.kTarget = g.g = g.gTarget = 0;
    g.kLeft = 26;
    g.gLeft = 30;
    g.gLerp = 0.09;
    g.crest = false;
    g.roll = 0;
    g.rollPhase = 0;
    g.id = 0;

    this.items = [];
    this.extras = [];
    this.coinRun.left = 0;

    for (let i = 0; i < COUNT; i++) {
      const n = this.nextNode();
      this.nk[i] = n.k;
      this.ng[i] = n.g;
      this.nb[i] = n.b;
      this.nid[i] = n.id;
      // pas d'objet sur les premiers segments : ils sont déjà derrière ou sous
      // le vaisseau au premier rendu
      if (i > BACK + 6) {
        this.spawnItems(n.id);
        this.spawnExtras(n.id);
      }
    }
  }

  /** Décale les tampons d'un cran et fabrique le nœud suivant. */
  push(): void {
    this.nk.copyWithin(0, 1);
    this.ng.copyWithin(0, 1);
    this.nb.copyWithin(0, 1);
    this.nid.copyWithin(0, 1);

    const n = this.nextNode();
    this.nk[COUNT - 1] = n.k;
    this.ng[COUNT - 1] = n.g;
    this.nb[COUNT - 1] = n.b;
    this.nid[COUNT - 1] = n.id;

    this.spawnItems(n.id);
    this.spawnExtras(n.id);
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

  /**
   * Vitesse de référence pour dimensionner un segment.
   *
   * C'est le profil d'accélération du jeu évalué à la distance du segment, et
   * non la vitesse réelle du joueur. La différence est tout l'objet de cette
   * fonction : la seconde dépend de ce que fait le pilote, la première ne
   * dépend que de l'endroit où l'on est sur la piste.
   *
   * Conséquence de conception assumée : le boost ne fait plus s'élargir les
   * virages devant soi. Franchir un virage à 1,3 fois la vitesse pour laquelle
   * il a été tracé multiplie la charge latérale par 1,69 — le boost coûte
   * désormais quelque chose dans les courbes, au lieu d'être gratuit.
   */
  private nominalSpeed(id: number): number {
    const T = this.tuning;
    const ramp = Math.min(1, (id * SEG) / T.speedRamp);
    return T.speedStart + (T.speedMax - T.speedStart) * ramp;
  }

  private nextNode(): { k: number; g: number; b: number; id: number } {
    const T = this.tuning;
    const gen = this.gen;
    const rng = this.trackRng;

    const speed = this.nominalSpeed(gen.id);
    const v2 = Math.max(3600, speed * speed);
    // courbure maximale telle que la charge latérale reste constante quelle que
    // soit la vitesse : le rayon de virage croît avec le carré de la vitesse
    const kMax = clamp(T.curveLoad / (v2 * T.centri), T.curveMin, T.curveMax);

    if (gen.kLeft <= 0) {
      if (rng.chance(T.rollChance)) {
        gen.roll = Math.round(T.rollNodes);
        gen.rollDir = rng.sign();
        gen.kTarget = 0;
        gen.kLeft = gen.roll + 10; // piste droite pendant la vrille
      } else {
        gen.kTarget = rng.chance(0.2) ? 0 : rng.range(0.35, 1) * kMax * rng.sign();
        gen.kLeft = 10 + rng.int(26);
      }
    }
    gen.kLeft--;
    gen.k += (clamp(gen.kTarget, -kMax, kMax) - gen.k) * 0.11;

    // pente : bosses douces, plus des tremplins suivis d'une bascule franche
    const gMax = T.climbRate / Math.max(60, speed);
    if (gen.gLeft <= 0) {
      if (gen.crest) {
        gen.gTarget = -gMax * rng.range(0.75, 1);
        gen.gLerp = 0.55;
        gen.gLeft = 4 + rng.int(3);
        gen.crest = false;
      } else if (gen.roll <= 0 && rng.chance(0.26)) {
        gen.gTarget = gMax * rng.range(0.75, 1);
        gen.gLerp = 0.3;
        gen.gLeft = 6 + rng.int(4);
        gen.crest = true;
      } else {
        gen.gTarget = (rng.next() - 0.5) * 1.4 * gMax;
        gen.gLerp = 0.09;
        gen.gLeft = 12 + rng.int(26);
      }
    }
    gen.gLeft--;
    gen.g += (gen.gTarget - gen.g) * gen.gLerp;

    // dévers : angle d'équilibre de la charge latérale, plus la vrille en cours
    const load = gen.k * v2 * T.centri;
    let b = clamp(-atan(load / 9.81) * T.bankScale, -1.25, 1.25);
    if (gen.roll > 0) {
      gen.rollPhase += gen.rollDir * ((Math.PI * 2) / Math.max(6, Math.round(T.rollNodes)));
      gen.roll--;
    }
    b += gen.rollPhase;

    return { k: gen.k, g: gen.g, b, id: gen.id++ };
  }

  /**
   * Les objets de la liste à part. Un tirage par segment sur leur propre flux,
   * donc rien ici ne déplace un objet de `items` ; et rien avant `extrasFrom`,
   * qui est au-delà des traces figées — la piste s'ouvre d'abord.
   */
  private spawnExtras(id: number): void {
    const T = this.tuning;
    if (id * SEG < T.extrasFrom) return;
    const rng = this.extraRng;
    const r = rng.next();
    if (r < T.rideChance) {
      this.extras.push({
        id,
        lat: rng.centered(HALF - 3.5),
        type: ITEM_RIDE,
        done: false,
        taken: false,
      });
    } else if (r < T.rideChance + T.fuelCanChance) {
      this.extras.push({
        id,
        lat: rng.centered(HALF - 3.5),
        type: ITEM_FUEL,
        done: false,
        taken: false,
      });
    }
  }

  private spawnItems(id: number): void {
    const T = this.tuning;
    const run = this.coinRun;
    const rng = this.itemRng;

    if (run.left > 0) {
      run.left--;
      run.lat = clamp(run.lat + run.drift, -(HALF - 3), HALF - 3);
      this.items.push({ id, lat: run.lat, type: ITEM_COIN, done: false, taken: false });
      return;
    }

    const r = rng.next();
    if (r < T.supChance) {
      this.items.push({
        id,
        lat: rng.centered(HALF - 3.5),
        type: ITEM_SUP,
        done: false,
        taken: false,
      });
    } else if (r < T.supChance + T.fixChance) {
      this.items.push({
        id,
        lat: rng.centered(HALF - 3.5),
        type: ITEM_FIX,
        done: false,
        taken: false,
      });
    } else if (r < T.supChance + T.fixChance + T.coinChance) {
      run.left = 5 + rng.int(6);
      run.lat = rng.centered(HALF - 4);
      run.drift = rng.centered(0.8);
    }
  }
}
