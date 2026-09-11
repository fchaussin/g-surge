/**
 * La trace d'une partie, et son rejeu.
 *
 * Une partie est entièrement décrite par sa graine, sa difficulté et la suite
 * des entrées reçues par `step()` — rien d'autre n'entre dans la simulation.
 * Cette trace est ce qu'un client envoie à un serveur à la place d'un score :
 * le serveur la rejoue avec ce même module et calcule le score lui-même. Un
 * score forgé n'existe donc pas comme donnée ; une trace forgée est une partie
 * réellement jouable, dont le score est celui qu'elle vaut.
 *
 * Le format est par plages : une entrée est retenue jusqu'à la suivante, si
 * bien qu'une partie de trois minutes tient en quelques milliers d'entrées
 * plutôt qu'en cent trente mille pas. `steer` est gardé en double précision,
 * parce que le rejeu doit reproduire la partie au bit près et qu'un manche
 * livre des flottants quelconques.
 *
 * Le mode hors ligne ne passe jamais par ici : il joue exactement comme avant
 * et la trace s'accumule à côté, sans rien coûter de plus qu'une comparaison
 * par pas.
 */
import { DT } from './clock.js';
import type { SimEvent } from './events.js';
import { createState, type SimState } from './state.js';
import { step, type Input } from './step.js';
import { Track } from './track.js';
import { DIFF, tuningFor, type Difficulty } from './tuning.js';

/** Bit du frein et bit du boost dans `flags`. */
const BRAKE = 1;
const BOOST = 2;

/**
 * Plafond du nombre de plages. Au-delà, l'enregistrement s'arrête et la trace
 * se déclare tronquée : un rejeu ne pourrait plus reproduire la partie, et un
 * serveur doit la refuser. 2^20 plages, c'est plus d'une heure de manche
 * remué à chaque frame de 240 Hz — hors de toute partie classée.
 */
export const MAX_SPANS = 1 << 20;

/** Ce qui circule sur le réseau, sérialisable en JSON tel quel. */
export interface Trace {
  readonly seed: string;
  readonly difficulty: Difficulty;
  /** Pas joués, à `DT` chacun. */
  readonly steps: number;
  /** Indices de pas où l'entrée change, strictement croissants, le premier vaut 0. */
  readonly from: readonly number[];
  /** Braquage tenu depuis ce pas, -1 à 1. */
  readonly steer: readonly number[];
  /** Frein et boost tenus depuis ce pas, `BRAKE | BOOST`. */
  readonly flags: readonly number[];
  /** Vrai si `MAX_SPANS` a été atteint : la trace ne reproduit plus la partie. */
  readonly truncated: boolean;
}

/** Ce qu'un rejeu rapporte — les mêmes chiffres que l'écran de fin. */
export interface Outcome {
  readonly steps: number;
  readonly wrecked: boolean;
  readonly score: number;
  readonly dist: number;
  readonly time: number;
  readonly coins: number;
  readonly multPeak: number;
}

/**
 * Accumule les entrées d'une partie, sans allocation tant que l'entrée ne
 * change pas, et par doublement de tampon sinon — un par frame au pire, avec
 * un manche analogique, et jamais un par pas.
 */
export class Recorder {
  private from = new Int32Array(256);
  private steer = new Float64Array(256);
  private flags = new Uint8Array(256);
  private spans = 0;
  private count = 0;
  private lastSteer = 0;
  private lastFlags = -1;

  /** Pas enregistrés depuis le dernier `reset`. */
  get steps(): number {
    return this.count;
  }

  get truncated(): boolean {
    return this.spans >= MAX_SPANS;
  }

  reset(): void {
    this.spans = 0;
    this.count = 0;
    this.lastSteer = 0;
    this.lastFlags = -1;
  }

  /** À appeler une fois par pas, avec l'entrée exacte que `step()` reçoit. */
  push(input: Input): void {
    const flags = (input.brake ? BRAKE : 0) | (input.boost ? BOOST : 0);
    if (flags !== this.lastFlags || input.steer !== this.lastSteer) {
      if (this.spans < MAX_SPANS) {
        if (this.spans === this.from.length) this.grow();
        this.from[this.spans] = this.count;
        this.steer[this.spans] = input.steer;
        this.flags[this.spans] = flags;
        this.spans++;
      }
      this.lastSteer = input.steer;
      this.lastFlags = flags;
    }
    this.count++;
  }

  /** Fige la trace. Les tableaux sont copiés : la partie suivante réécrit les tampons. */
  trace(seed: string, difficulty: Difficulty): Trace {
    const n = this.spans;
    return {
      seed,
      difficulty,
      steps: this.count,
      from: Array.from(this.from.subarray(0, n)),
      steer: Array.from(this.steer.subarray(0, n)),
      flags: Array.from(this.flags.subarray(0, n)),
      truncated: this.truncated,
    };
  }

  private grow(): void {
    const size = this.from.length * 2;
    const from = new Int32Array(size);
    const steer = new Float64Array(size);
    const flags = new Uint8Array(size);
    from.set(this.from);
    steer.set(this.steer);
    flags.set(this.flags);
    this.from = from;
    this.steer = steer;
    this.flags = flags;
  }
}

/**
 * Une trace est bien formée quand elle peut être rejouée sans ambiguïté. Un
 * serveur la vérifie avant de dépenser un rejeu ; un client n'a pas à le
 * faire, sa propre trace l'est par construction.
 */
export function validTrace(t: Trace): boolean {
  if (t.truncated || !(t.steps >= 0) || !Number.isInteger(t.steps)) return false;
  if (!(t.difficulty in DIFF)) return false;
  const n = t.from.length;
  if (t.steer.length !== n || t.flags.length !== n) return false;
  if (n === 0) return t.steps === 0;
  if (t.from[0] !== 0) return false;
  for (let i = 0; i < n; i++) {
    const f = t.from[i]!;
    if (!Number.isInteger(f) || f >= t.steps) return false;
    if (i > 0 && f <= t.from[i - 1]!) return false;
    const s = t.steer[i]!;
    if (!(s >= -1 && s <= 1)) return false;
    const fl = t.flags[i]!;
    if (fl !== (fl & (BRAKE | BOOST))) return false;
  }
  return true;
}

/**
 * Rejoue une trace depuis une simulation neuve et rapporte l'issue.
 *
 * Le pas est `DT`, sans exception : le réglage est celui de la difficulté,
 * jamais celui d'un client — une partie jouée avec les curseurs de l'onglet
 * avancé rejoue donc un autre score, et c'est voulu. S'arrête au pas de la
 * casse, comme le jeu.
 */
export function replay(t: Trace): Outcome {
  const tuning = tuningFor(t.difficulty);
  const diffMul = DIFF[t.difficulty].mul;
  const state = createState(tuning);
  const track = new Track(tuning, t.seed);
  const input: Input = { steer: 0, brake: false, boost: false };
  const events: SimEvent[] = [];
  let span = 0;
  let steps = 0;
  for (let i = 0; i < t.steps; i++) {
    while (span < t.from.length && t.from[span]! <= i) {
      input.steer = t.steer[span]!;
      const flags = t.flags[span]!;
      input.brake = (flags & BRAKE) !== 0;
      input.boost = (flags & BOOST) !== 0;
      span++;
    }
    step(state, track, tuning, diffMul, input, DT, false, events);
    events.length = 0;
    steps++;
    if (state.wrecked) break;
  }
  return outcomeOf(state, steps);
}

/** Les chiffres de fin d'un état, sous la forme que `replay` rapporte. */
export function outcomeOf(state: SimState, steps: number): Outcome {
  return {
    steps,
    wrecked: state.wrecked,
    score: state.score,
    dist: state.dist,
    time: state.time,
    coins: state.coins,
    multPeak: state.multPeak,
  };
}
