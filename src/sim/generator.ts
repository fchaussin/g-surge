/**
 * D'où viennent les nœuds de la piste.
 *
 * Un nœud est quatre nombres — courbure, pente, dévers, identifiant de
 * segment — et les objets que le segment porte. `Track` les consomme un par
 * un et ne sait pas qui les fabrique. Deux sources :
 *
 * - `SeededNodes`, le générateur semé : la géométrie est une fonction de la
 *   seule graine, de la difficulté et de l'identifiant de segment. Rien n'y
 *   dépend de la partie en cours, ce qui rend une piste rejouable, partageable
 *   et vérifiable par un serveur. Ce ne fut pas toujours le cas : le
 *   générateur lisait la vitesse réelle du joueur pour borner courbure et
 *   pente, si bien que deux pilotages sur une même graine produisaient deux
 *   tracés. Voir `nominalSpeed`. C'est la source du jeu hors ligne, et celle
 *   du serveur.
 * - `QueuedNodes`, une file remplie de l'extérieur : en partie classée, le
 *   serveur garde la graine et sert les nœuds par tranches devant le
 *   vaisseau. Le noyau joue alors une piste qu'il n'a pas tirée, au bit près
 *   la même que celle que le serveur rejouera — voir `docs/NETWORK.md`.
 */
import { Rng } from './rng.js';
import {
  BACK,
  clamp,
  HALF,
  ITEM_COIN,
  ITEM_FIX,
  ITEM_FUEL,
  ITEM_RIDE,
  ITEM_SUP,
  SEG,
  type Item,
  type ItemType,
} from './track.js';
import { atan } from './trig.js';
import type { Tuning } from './tuning.js';

export interface Node {
  /** Courbure, rad/m. */
  k: number;
  /** Pente, dy/ds. */
  g: number;
  /** Dévers, rad. Non borné : les vrilles y ajoutent des tours. */
  b: number;
  /** Identifiant absolu de segment. */
  id: number;
  /** Les objets du segment, dans l'ordre où la piste les liste. */
  items: Item[];
  /** Ceux de la liste à part, `Track.extras`. */
  extras: Item[];
}

export interface NodeSource {
  /** Le nœud suivant, ou `null` si la source n'en a plus pour l'instant. */
  next(): Node | null;
  /** Le réglage a changé avec la difficulté. */
  setTuning(tuning: Tuning): void;
}

/** Partagé par les nœuds sans objet : un nœud par segment, pas un tableau de plus. */
const NONE: Item[] = [];

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

export class SeededNodes implements NodeSource {
  private readonly gen: GenState = {
    k: 0,
    kTarget: 0,
    kLeft: 26,
    g: 0,
    gTarget: 0,
    gLeft: 30,
    gLerp: 0.09,
    crest: false,
    roll: 0,
    rollDir: 1,
    rollPhase: 0,
    id: 0,
  };
  private readonly coinRun = { left: 0, lat: 0, drift: 0 };
  private readonly trackRng: Rng;
  private readonly itemRng: Rng;
  private readonly extraRng: Rng;
  /* Remplis par `spawnItems` et `spawnExtras`, vidés à chaque nœud. */
  private items: Item[] = NONE;
  private extras: Item[] = NONE;

  constructor(
    private tuning: Tuning,
    seed: string,
  ) {
    this.trackRng = Rng.fromSeed(seed, 'track');
    this.itemRng = Rng.fromSeed(seed, 'items');
    this.extraRng = Rng.fromSeed(seed, 'extras');
  }

  setTuning(tuning: Tuning): void {
    this.tuning = tuning;
  }

  next(): Node {
    const n = this.nextNode();
    this.items = NONE;
    this.extras = NONE;
    // Pas d'objet sur les premiers segments : déjà derrière ou sous le vaisseau
    // au premier rendu. Calculé ici et non en constante de module : ce module
    // et track.ts s'importent l'un l'autre, et une constante lue à
    // l'évaluation y vaudrait `undefined + 7` — les pièces disparaissaient
    // sans une erreur.
    if (n.id > BACK + 6) {
      this.spawnItems(n.id);
      this.spawnExtras(n.id);
    }
    return { k: n.k, g: n.g, b: n.b, id: n.id, items: this.items, extras: this.extras };
  }

  private spawn(list: 'items' | 'extras', it: Item): void {
    if (this[list] === NONE) this[list] = [];
    this[list].push(it);
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

    // L'ouverture : `openingStraight` mètres droits et plats devant le vaisseau,
    // qui est à BACK segments du premier nœud. Les virages viennent ensuite,
    // les vrilles à partir de `rollFrom` — une piste qui s'apprend avant de
    // se retourner.
    const ahead = (gen.id - BACK) * SEG;
    const opening = ahead < T.openingStraight;
    if (opening) {
      gen.kTarget = 0;
      gen.kLeft = 1;
      gen.gTarget = 0;
      gen.gLeft = 1;
      gen.crest = false;
    }

    if (gen.kLeft <= 0) {
      if (ahead >= T.rollFrom && rng.chance(T.rollChance)) {
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
      this.spawn('extras', {
        id,
        lat: rng.centered(HALF - 3.5),
        type: ITEM_RIDE,
        done: false,
        taken: false,
      });
    } else if (r < T.rideChance + T.fuelCanChance) {
      this.spawn('extras', {
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
      this.spawn('items', { id, lat: run.lat, type: ITEM_COIN, done: false, taken: false });
      return;
    }

    const r = rng.next();
    if (r < T.supChance) {
      this.spawn('items', {
        id,
        lat: rng.centered(HALF - 3.5),
        type: ITEM_SUP,
        done: false,
        taken: false,
      });
    } else if (r < T.supChance + T.fixChance) {
      this.spawn('items', {
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

/**
 * Une file de nœuds remplie de l'extérieur, par tranches.
 *
 * Les tranches sont adressées par identifiant absolu de segment, donc une
 * requête rejouée ou une tranche reçue deux fois ne fait rien : on ne garde
 * que ce qui prolonge la file. C'est ce qui rend le raccord sans couture et
 * les nouvelles tentatives gratuites. Quand la file est vide, `next()` rend
 * `null` et la piste se déclare sèche.
 */
export class QueuedNodes implements NodeSource {
  private readonly queue: Node[] = [];
  private head = 0;
  private nextId = 0;

  /** Nœuds encore en réserve. Le client demande la tranche suivante en dessous d'un seuil. */
  get ahead(): number {
    return this.queue.length - this.head;
  }

  /** Identifiant du prochain nœud attendu — où la prochaine tranche doit commencer. */
  get wanted(): number {
    return this.nextId;
  }

  /** Ajoute ce qui prolonge la file ; ignore le reste. Rend le nombre gardé. */
  feed(nodes: readonly Node[]): number {
    let kept = 0;
    for (const n of nodes) {
      if (n.id !== this.nextId) continue;
      this.queue.push(n);
      this.nextId++;
      kept++;
    }
    // la partie consommée est abandonnée par blocs, jamais nœud par nœud
    if (this.head > 1024) {
      this.queue.splice(0, this.head);
      this.head = 0;
    }
    return kept;
  }

  next(): Node | null {
    if (this.head >= this.queue.length) return null;
    return this.queue[this.head++]!;
  }

  setTuning(): void {
    /* la géométrie vient d'ailleurs ; le réglage n'y change rien */
  }
}

/* ------------------------------------------------------------- sur le fil -- */

/**
 * Une tranche de nœuds telle qu'elle voyage : les trois courbes en tableaux
 * parallèles, l'identifiant du premier seul — les autres suivent — et les
 * objets à plat, trois nombres chacun. Sérialisable en JSON tel quel ; une
 * tranche de 256 segments pèse une vingtaine de kilo-octets. `done` et
 * `taken` ne voyagent pas : un objet servi n'est ni passé ni pris.
 */
export interface WireChunk {
  readonly from: number;
  readonly k: readonly number[];
  readonly g: readonly number[];
  readonly b: readonly number[];
  /** `[id, lat, type, id, lat, type, …]` */
  readonly items: readonly number[];
  readonly extras: readonly number[];
}

export function packNodes(nodes: readonly Node[]): WireChunk {
  const k: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const items: number[] = [];
  const extras: number[] = [];
  for (const n of nodes) {
    k.push(n.k);
    g.push(n.g);
    b.push(n.b);
    for (const it of n.items) items.push(it.id, it.lat, it.type);
    for (const it of n.extras) extras.push(it.id, it.lat, it.type);
  }
  return { from: nodes[0]?.id ?? 0, k, g, b, items, extras };
}

/**
 * Un type d'objet est un entier de `ITEM_COIN` à `ITEM_FUEL`. Testé par bornes
 * et non par une table de module : ce module et track.ts s'importent l'un
 * l'autre, et une table construite à l'évaluation depuis les constantes de
 * track.ts se remplirait d'`undefined` — le même piège que le seuil des objets
 * dans `next()`.
 */
const isItemType = (v: number): v is ItemType =>
  Number.isInteger(v) && v >= ITEM_COIN && v <= ITEM_FUEL;

/**
 * L'inverse de `packNodes`. `null` si la tranche n'a pas la forme attendue —
 * elle vient du réseau, et une tranche mal formée doit rendre la piste sèche
 * plutôt que planter le pas de simulation.
 */
export function unpackNodes(c: WireChunk): Node[] | null {
  const n = c.k.length;
  if (!Number.isInteger(c.from) || c.from < 0) return null;
  if (c.g.length !== n || c.b.length !== n) return null;
  if (c.items.length % 3 !== 0 || c.extras.length % 3 !== 0) return null;
  const nodes: Node[] = [];
  for (let i = 0; i < n; i++) {
    const k = c.k[i]!;
    const g = c.g[i]!;
    const b = c.b[i]!;
    if (!Number.isFinite(k) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    nodes.push({ k, g, b, id: c.from + i, items: NONE, extras: NONE });
  }
  const place = (flat: readonly number[], list: 'items' | 'extras'): boolean => {
    for (let i = 0; i < flat.length; i += 3) {
      const id = flat[i]!;
      const lat = flat[i + 1]!;
      const type = flat[i + 2]!;
      const node = nodes[id - c.from];
      if (!node || !Number.isFinite(lat) || !isItemType(type)) return false;
      if (node[list] === NONE) node[list] = [];
      node[list].push({ id, lat, type, done: false, taken: false });
    }
    return true;
  };
  if (!place(c.items, 'items') || !place(c.extras, 'extras')) return null;
  return nodes;
}
