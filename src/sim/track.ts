/**
 * Génération de piste, en flux.
 *
 * Quatre tampons circulaires parallèles de `COUNT` entrées, une par segment de
 * `SEG` mètres. `push()` les décale d'un cran et fabrique un nœud neuf, ce qui
 * arrive chaque fois que le vaisseau parcourt `SEG`. `BACK` segments sont
 * conservés derrière le vaisseau.
 *
 * Attention, ce n'est pas encore une fonction de la seule graine : `genSpeed`
 * porte la vitesse réelle du joueur et borne courbure et pente. Deux joueurs
 * sur la même graine à des vitesses différentes obtiennent des pistes
 * différentes. Ce portage reproduit ce couplage à l'identique, sciemment : le
 * corriger est un changement de comportement, il aura son propre pas et sa
 * régénération de références. Voir docs/ROADMAP.md.
 */
import { Rng } from './rng.js';
import type { Tuning } from './tuning.js';

export const COUNT = 130;
export const SEG = 12;
export const BACK = 10;
export const HALF = 11.5;
export const SHIP = 1.9;

export const ITEM_COIN = 0;
export const ITEM_FIX = 1;
export const ITEM_SUP = 2;
export type ItemType = typeof ITEM_COIN | typeof ITEM_FIX | typeof ITEM_SUP;

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

  /** Vitesse vue par le générateur. Écrite par la simulation avant `push()`. */
  genSpeed: number;

  private readonly gen: GenState = {
    k: 0, kTarget: 0, kLeft: 0, g: 0, gTarget: 0, gLeft: 0, gLerp: 0.09,
    crest: false, roll: 0, rollDir: 1, rollPhase: 0, id: 0,
  };

  private readonly coinRun = { left: 0, lat: 0, drift: 0 };
  private trackRng: Rng;
  private itemRng: Rng;

  constructor(
    private tuning: Tuning,
    seed: string,
  ) {
    this.genSpeed = tuning.speedStart;
    this.trackRng = Rng.fromSeed(seed, 'track');
    this.itemRng = Rng.fromSeed(seed, 'items');
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

    const g = this.gen;
    g.k = g.kTarget = g.g = g.gTarget = 0;
    g.kLeft = 26;
    g.gLeft = 30;
    g.gLerp = 0.09;
    g.crest = false;
    g.roll = 0;
    g.rollPhase = 0;
    g.id = 0;

    this.genSpeed = this.tuning.speedStart;
    this.items = [];
    this.coinRun.left = 0;

    for (let i = 0; i < COUNT; i++) {
      const n = this.nextNode();
      this.nk[i] = n.k;
      this.ng[i] = n.g;
      this.nb[i] = n.b;
      this.nid[i] = n.id;
      // pas d'objet sur les premiers segments : ils sont déjà derrière ou sous
      // le vaisseau au premier rendu
      if (i > BACK + 6) this.spawnItems(n.id);
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
    const oldest = this.nid[0]!;
    if (this.items.length && this.items[0]!.id < oldest - 2) {
      this.items = this.items.filter((it) => it.id >= oldest - 2);
    }
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

  private nextNode(): { k: number; g: number; b: number; id: number } {
    const T = this.tuning;
    const gen = this.gen;
    const rng = this.trackRng;

    const v2 = Math.max(3600, this.genSpeed * this.genSpeed);
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
        gen.kTarget = rng.chance(0.20) ? 0 : rng.range(0.35, 1) * kMax * rng.sign();
        gen.kLeft = 10 + rng.int(26);
      }
    }
    gen.kLeft--;
    gen.k += (clamp(gen.kTarget, -kMax, kMax) - gen.k) * 0.11;

    // pente : bosses douces, plus des tremplins suivis d'une bascule franche
    const gMax = T.climbRate / Math.max(60, this.genSpeed);
    if (gen.gLeft <= 0) {
      if (gen.crest) {
        gen.gTarget = -gMax * rng.range(0.75, 1);
        gen.gLerp = 0.55;
        gen.gLeft = 4 + rng.int(3);
        gen.crest = false;
      } else if (gen.roll <= 0 && rng.chance(0.26)) {
        gen.gTarget = gMax * rng.range(0.75, 1);
        gen.gLerp = 0.30;
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
    let b = clamp(-Math.atan(load / 9.81) * T.bankScale, -1.25, 1.25);
    if (gen.roll > 0) {
      gen.rollPhase += gen.rollDir * ((Math.PI * 2) / Math.max(6, Math.round(T.rollNodes)));
      gen.roll--;
    }
    b += gen.rollPhase;

    return { k: gen.k, g: gen.g, b, id: gen.id++ };
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
      this.items.push({ id, lat: rng.centered(HALF - 3.5), type: ITEM_SUP, done: false, taken: false });
    } else if (r < T.supChance + T.fixChance) {
      this.items.push({ id, lat: rng.centered(HALF - 3.5), type: ITEM_FIX, done: false, taken: false });
    } else if (r < T.supChance + T.fixChance + T.coinChance) {
      run.left = 5 + rng.int(6);
      run.lat = rng.centered(HALF - 4);
      run.drift = rng.centered(0.8);
    }
  }
}
