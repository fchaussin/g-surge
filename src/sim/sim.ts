/**
 * La simulation complète, sans navigateur ni three.js.
 *
 * Assemble le réglage, la piste et le pas de physique. C'est l'objet qu'un
 * serveur exécuterait pour arbitrer, et celui qu'un rejeu de partie rejouerait.
 */
import type { SimEvent } from './events.js';
import { createState, resetState, type SimState } from './state.js';
import { step, type Input } from './step.js';
import { Track } from './track.js';
import { DIFF, tuningFor, type Difficulty, type Tuning } from './tuning.js';

export interface SimOptions {
  seed: string;
  difficulty?: Difficulty;
}

export class Sim {
  tuning: Tuning;
  diffMul: number;
  readonly state: SimState;
  readonly track: Track;

  /** Événements du dernier pas. Remis à zéro à chaque appel de `step`. */
  readonly events: SimEvent[] = [];

  private difficulty: Difficulty;
  private currentSeed: string;

  constructor(options: SimOptions) {
    this.difficulty = options.difficulty ?? 'easy';
    this.currentSeed = options.seed;
    this.tuning = tuningFor(this.difficulty);
    this.diffMul = DIFF[this.difficulty].mul;
    this.state = createState(this.tuning);
    this.track = new Track(this.tuning, this.currentSeed);
  }

  get seed(): string {
    return this.currentSeed;
  }

  /** Rejoue le réglage complet du niveau, comme `applyDifficulty` côté jeu. */
  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.tuning = tuningFor(difficulty);
    this.diffMul = DIFF[difficulty].mul;
    this.track.setTuning(this.tuning);
  }

  /** Remet la partie à zéro. Une même graine régénère exactement la même piste. */
  reset(seed?: string): void {
    if (seed !== undefined) this.currentSeed = seed;
    resetState(this.state, this.tuning);
    this.track.seed(this.currentSeed);
    this.events.length = 0;
  }

  /** Avance d'un pas. Renvoie le dévers sous le vaisseau, pour le rendu. */
  step(input: Input, dt: number, attract = false): number {
    this.events.length = 0;
    return step(this.state, this.track, this.tuning, this.diffMul, input, dt, attract, this.events);
  }
}
