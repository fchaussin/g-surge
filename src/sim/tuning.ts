/**
 * Toutes les valeurs réglables, et les surcharges par difficulté.
 *
 * `DEFAULTS` est le niveau facile, les autres niveaux ne posent qu'un sous
 * ensemble par-dessus. C'est la source de vérité : docs/GAMEPLAY.md doit être
 * dérivé d'ici, jamais recopié — une ligne de ce document a déjà vécu des mois
 * avec un chiffre faux faute de cette règle.
 *
 * Un test Playwright compare ces valeurs à celles de legacy/engine.js, pour que
 * la transcription ne puisse pas dériver tant que les deux coexistent.
 */

export interface Tuning {
  /* Vitesse */
  speedStart: number;
  speedMax: number;
  speedRamp: number;
  speedGain: number;
  brakeFactor: number;
  steerMaxVel: number;

  /* Lacet et adhérence */
  yawBase: number;
  yawSpeedRef: number;
  yawMin: number;
  yawResponse: number;
  yawVisual: number;
  driftYaw: number;
  gripHold: number;
  gripDrift: number;
  gripLimit: number;
  driftExit: number;
  driftCharge: number;
  chainDecay: number;
  surgeHold: number;
  surgeTime: number;
  centri: number;
  bankAssist: number;
  bankScale: number;

  /* Génération de piste */
  curveLoad: number;
  curveMin: number;
  curveMax: number;
  climbRate: number;
  rollChance: number;
  rollNodes: number;
  stripeEvery: number;

  /* Dégâts */
  hullImpact: number;
  hullScrape: number;
  hullRegen: number;
  damageSpeed: number;
  damageSteer: number;

  /* Objets et score */
  coinChance: number;
  fixChance: number;
  fixAmount: number;
  supChance: number;
  supTime: number;
  supFactor: number;
  pickRadius: number;
  haloTime: number;
  coinTier2: number;
  coinTier3: number;
  multDecay: number;
  multDecayFast: number;
  multWallCut: number;
  multMax: number;

  /* Affichage, sans effet sur la simulation */
  renderScale: number;

  /* Sauts */
  launchScale: number;
  airGravity: number;
  airThresh: number;
  airSteer: number;
  airOverhang: number;
  badLanding: number;

  /* Boost */
  boostFactor: number;
  boostDrain: number;
  boostRecharge: number;
  boostMin: number;
  boostGain: number;

  /* Murs */
  wallBounce: number;
  wallPenalty: number;
  wallDrain: number;

  /* Caméra et champ, sans effet sur la simulation */
  camDist: number;
  camHeight: number;
  camLag: number;
  camRoll: number;
  lookAhead: number;
  lookHeight: number;
  fovBase: number;
  fovSpeed: number;
}

export const DEFAULTS: Readonly<Tuning> = {
  speedStart: 70,
  speedMax: 258,
  speedRamp: 9000,
  speedGain: 0.42,
  brakeFactor: 0.62,
  steerMaxVel: 34,
  yawBase: 0.4,
  yawSpeedRef: 90,
  yawMin: 0.1,
  yawResponse: 5.0,
  yawVisual: 2.4,
  driftYaw: 0.012,
  gripHold: 1.5,
  gripDrift: 0.6,
  gripLimit: 34,
  driftExit: 12,
  driftCharge: 17,
  chainDecay: 0.25,
  surgeHold: 0.85,
  surgeTime: 5,
  centri: 0.085,
  bankAssist: 0.3,
  bankScale: 0.9,
  curveLoad: 30,
  curveMin: 0.0012,
  curveMax: 0.011,
  climbRate: 23,
  rollChance: 0.14,
  rollNodes: 44,
  stripeEvery: 2,
  hullImpact: 2.0,
  hullScrape: 15,
  hullRegen: 1.7,
  damageSpeed: 0.3,
  damageSteer: 0.28,
  coinChance: 0.015,
  fixChance: 0.003,
  fixAmount: 40,
  supChance: 0.0024,
  supTime: 2.6,
  supFactor: 1.22,
  pickRadius: 3.6,
  haloTime: 0.45,
  coinTier2: 138.9,
  coinTier3: 277.8,
  multDecay: 0.1,
  multDecayFast: 0.5,
  multWallCut: 0.5,
  multMax: 30,
  renderScale: 1,
  launchScale: 0.5,
  airGravity: 3.4,
  airThresh: 2.2,
  airSteer: 0.4,
  airOverhang: 11,
  badLanding: 0.35,
  boostFactor: 1.3,
  boostDrain: 26,
  boostRecharge: 10,
  boostMin: 14,
  boostGain: 2.2,
  wallBounce: 0.25,
  wallPenalty: 0.36,
  wallDrain: 26,
  camDist: 19,
  camHeight: 5.0,
  camLag: 7.5,
  camRoll: 0.42,
  lookAhead: 46,
  lookHeight: 2.6,
  fovBase: 74,
  fovSpeed: 22,
};

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyDef {
  /** Coefficient de score. Il compense la baisse du multiplicateur atteignable :
   *  sans lui, le niveau difficile rapporterait moins que le facile. */
  readonly mul: number;
  readonly set: Readonly<Partial<Tuning>>;
}

/**
 * Les libellés et les descriptions restent côté interface : ce sont des chaînes
 * à traduire un jour, elles n'ont rien à faire dans le noyau.
 */
export const DIFF: Readonly<Record<Difficulty, DifficultyDef>> = {
  easy: { mul: 1.0, set: {} },
  medium: {
    mul: 1.35,
    set: {
      curveLoad: 38,
      speedRamp: 6000,
      hullImpact: 2.6,
      hullRegen: 1.2,
      hullScrape: 19,
      multDecay: 0.14,
      fixChance: 0.0022,
      rollChance: 0.18,
      climbRate: 27,
      surgeHold: 1.8,
    },
  },
  hard: {
    mul: 1.8,
    set: {
      curveLoad: 46,
      speedRamp: 4000,
      hullImpact: 3.4,
      hullRegen: 0.8,
      hullScrape: 24,
      multDecay: 0.2,
      fixChance: 0.0015,
      supChance: 0.0018,
      rollChance: 0.24,
      climbRate: 31,
      gripLimit: 29,
      surgeHold: 1.4,
    },
  },
};

/** Réglage effectif d'un niveau : le facile, puis les surcharges par-dessus. */
export function tuningFor(difficulty: Difficulty): Tuning {
  return { ...DEFAULTS, ...DIFF[difficulty].set };
}
