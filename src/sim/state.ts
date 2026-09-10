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
