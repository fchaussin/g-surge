/**
 * L'état de la simulation, et lui seul.
 *
 * Tout est en espace piste : `dist` le long du ruban, `lat` en travers, `yaw`
 * relatif à la piste. Aucun champ monde, ce qui est ce qui rend l'architecture
 * compatible avec plusieurs vaisseaux sur une même piste — le « vaisseau à
 * l'origine » n'est qu'une convention de rendu.
 *
 * `halo` et `haloPow` de l'ancien objet ont disparu : c'était de la
 * présentation, remplacée par les événements de events.ts.
 */
import type { Tuning } from './tuning.js';

export interface SimState {
  /* Progression */
  dist: number;
  travel: number;
  cursor: number;

  /* Vitesse et réserve */
  speed: number;
  energy: number;
  boosting: boolean;
  superT: number;

  /* Latéral */
  lat: number;
  latVel: number;
  yaw: number;
  slip: number;
  drift: boolean;
  /** Durée du drift en cours, en secondes. Lue par personne dans la physique. */
  driftHeld: number;
  /**
   * La montée : drift propre cumulé vers le barreau suivant, en mètres. Ne
   * compte qu'en poussée — en boost vers le super boost, en super boost vers le
   * G-SURGE — se vide hors drift, s'annule contre un mur.
   */
  climb: number;
  /** Temps restant de G-SURGE, en secondes. */
  surgeT: number;
  /** Drifts propres enchaînés, le combo du Perfect Drift. Zéro hors combo. */
  combo: number;
  /** Secondes restantes pour rouvrir un drift avant que le combo tombe. */
  comboLeft: number;
  /** Near Miss : dans la bande près du mur, et sans contact depuis l'entrée. */
  near: boolean;
  nearClean: boolean;
  /** Secondes passées dans la bande, et proximité maximale atteinte, 0 à 1. */
  nearHeld: number;
  nearPeak: number;

  /* Saut */
  air: boolean;
  hop: number;
  vyRel: number;
  airTime: number;

  /* Intégrité */
  hull: number;
  contact: boolean;
  shake: number;
  scrape: number;
  wrecked: boolean;

  /* Score */
  coins: number;
  mult: number;
  multPeak: number;
  score: number;
}

/** 0 croisière, 1 boost, 2 super boost, 3 G-SURGE. */
export type ThrustTier = 0 | 1 | 2 | 3;

/**
 * Le barreau de l'échelle de poussée.
 *
 * Il vivait dans `src/client/` tant qu'il ne servait qu'à doser des effets.
 * Depuis que le palier des pièces en dépend, il décide du score : il appartient
 * donc au noyau, et le client le lit d'ici plutôt que de le recalculer.
 *
 * L'ordre des tests départage des drapeaux levés ensemble — `step()` force
 * `boosting` pendant un super boost comme pendant un G-SURGE, et les deux
 * derniers roulent à la même vitesse.
 */
export function thrustTier(state: SimState): ThrustTier {
  if (state.surgeT > 0) return 3;
  if (state.superT > 0) return 2;
  return state.boosting ? 1 : 0;
}

/**
 * Les mètres de drift que le barreau courant demande pour passer au suivant,
 * ou zéro s'il n'y a rien à gravir : en croisière le barreau se gagne par la
 * réserve, pas par la montée, et au sommet il n'y a plus rien au-dessus.
 *
 * C'est la seule échelle que la jauge et la lueur de drift doivent lire, pour
 * la raison que `drift.ts` donne pour `SLIP_CEILING` : deux effets qui
 * normaliseraient différemment se contrediraient à l'écran.
 */
export function climbGoal(state: SimState, tuning: Tuning): number {
  if (state.surgeT > 0) return 0;
  if (state.superT > 0) return tuning.climbSurge;
  return state.boosting ? tuning.climbSup : 0;
}

/**
 * Ce que le drift remplit en ce moment, de 0 à 1 : la réserve en croisière, la
 * montée vers le barreau suivant en poussée, rien au sommet. La lueur de la
 * coque et la voix de recharge lisent toutes deux cette valeur — une seule
 * échelle, celle que la jauge dessine — plutôt que d'en tenir chacune la
 * sienne.
 */
export function driftFill(state: SimState, tuning: Tuning): number {
  const goal = climbGoal(state, tuning);
  if (goal > 0) return Math.min(1, state.climb / goal);
  if (state.surgeT > 0) return 1;
  return Math.min(1, state.energy / 100);
}

export function createState(tuning: Tuning): SimState {
  const state = {} as SimState;
  resetState(state, tuning);
  return state;
}

export function resetState(state: SimState, tuning: Tuning): void {
  state.dist = 0;
  state.travel = 0;
  state.cursor = 0;

  state.speed = tuning.speedStart;
  state.energy = 100;
  state.boosting = false;
  state.superT = 0;

  state.lat = 0;
  state.latVel = 0;
  state.yaw = 0;
  state.slip = 0;
  state.drift = false;
  state.driftHeld = 0;
  state.climb = 0;
  state.surgeT = 0;
  state.combo = 0;
  state.comboLeft = 0;
  state.near = false;
  state.nearClean = false;
  state.nearHeld = 0;
  state.nearPeak = 0;

  state.air = false;
  state.hop = 0;
  state.vyRel = 0;
  state.airTime = 0;

  state.hull = 100;
  state.contact = false;
  state.shake = 0;
  state.scrape = 0;
  state.wrecked = false;

  state.coins = 0;
  state.mult = 1;
  state.multPeak = 1;
  state.score = 0;
}
