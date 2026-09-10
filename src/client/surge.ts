/**
 * L'intensité du G-SURGE, qui se mérite pendant l'état et pas seulement avant.
 *
 * L'état dure cinq secondes, et sans cela il se joue tout seul : la secousse
 * frappe à l'entrée, s'éteint en 0,42 s, et les quatre secondes suivantes ne
 * demandent rien. Ici l'intensité monte tant que le pilotage tient et retombe
 * vite dès qu'il lâche, ce qui fait de la fenêtre une expression de conduite
 * plutôt qu'une récompense passive.
 *
 * C'est de la présentation : la simulation ne lit rien d'ici, et l'état ne
 * s'écourte pas parce qu'on touche un mur — seul son *rendu* recule. Comme
 * `Sky` et `ChaseCamera`, la valeur s'amortit sur plusieurs frames, donc elle
 * doit être remise à zéro pour une capture.
 */
import type { SimState, Tuning } from '../sim/index.js';

/** Secondes pour atteindre le plein, et pour tout perdre. */
const RISE = 2.2;
const FALL = 0.5;

/**
 * Sous quelle fraction de la vitesse visée l'intensité cesse de monter.
 *
 * Pendant l'état la cible est celle d'un super boost, donc freiner ou racler un
 * mur est la seule façon de tomber en dessous — ce qui est exactement la
 * « bonne conduite » que la montée récompense.
 */
const SPEED_FLOOR = 0.94;

export class SurgeMeter {
  private level = 0;

  /** 0 à 1. Tout ce qui doit croître pendant l'état lit ça. */
  get value(): number {
    return this.level;
  }

  reset(): void {
    this.level = 0;
  }

  /** @param frameDt vrai delta de frame : c'est un lissage d'affichage. */
  update(frameDt: number, state: SimState, tuning: Tuning): void {
    const target = tuning.speedMax * tuning.boostFactor * tuning.supFactor;
    const clean = state.surgeT > 0 && !state.contact && state.speed >= target * SPEED_FLOOR;
    const rate = clean ? frameDt / RISE : -(frameDt / FALL);
    this.level = Math.min(1, Math.max(0, this.level + rate));
  }
}
