/**
 * Ce que la dérive vaut, en une seule échelle partagée.
 *
 * `state.slip` n'est pas un angle : c'est `dv`, l'écart entre la vitesse
 * latérale que le nez réclame et celle que les appuis encaissent, en m/s. Tout
 * effet qui veut une intensité doit donc choisir un plafond, et deux effets qui
 * en choisiraient deux différents se contrediraient à l'écran. Ce module est ce
 * plafond, et le seul.
 *
 * Comme `surge.ts`, c'est de la présentation dérivée de l'état : la simulation
 * ignore ce fichier.
 */
import type { SimState } from '../sim/index.js';

/**
 * Dérive, en m/s, au-delà de laquelle les effets sont à fond.
 *
 * Ce n'est pas un chiffre neuf : c'est celui auquel le lacet visuel de la coque
 * sature déjà, `driftYaw` = 0,012 contre une borne de 0,42 rad. Le reste s'y
 * aligne plutôt que d'inventer sa propre échelle. Pour référence, on décroche
 * vers 22,7 m/s au réglage par défaut — `gripLimit / gripHold` — donc un drift
 * commence déjà aux deux tiers de l'échelle.
 */
export const SLIP_CEILING = 35;

/** 0 hors drift, sinon de 0 à 1. */
export function driftIntensity(state: SimState): number {
  if (!state.drift) return 0;
  const v = Math.abs(state.slip) / SLIP_CEILING;
  return v > 1 ? 1 : v;
}

/**
 * Le côté vers lequel le vaisseau glisse, en X local : −1, 0 ou 1.
 *
 * Mesuré plutôt que déduit : manche à fond vers la gauche donne `yaw +0,397`,
 * `latVel −4,69` et `slip +23,72`. Le nez pointe à gauche et la trajectoire
 * part à droite, donc la gerbe sort du côté opposé au signe de `slip`.
 */
export function driftSide(state: SimState): -1 | 0 | 1 {
  if (!state.drift || state.slip === 0) return 0;
  return state.slip > 0 ? -1 : 1;
}
