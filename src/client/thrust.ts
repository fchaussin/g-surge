/**
 * Le palier de poussée, et rien d'autre.
 *
 * Croisière, boost, superboost. La caméra, le ciel, l'audio et le vaisseau
 * s'accordent dessus. Sans ce vocabulaire commun chacun relisait
 * `state.boosting`, et le superboost était sensoriellement un boost : quatre
 * propriétés sur neuf ne distinguaient rien du tout. Voir docs/FX-PALETTE.md
 * §10, qui mesure l'écart.
 *
 * C'est de la présentation dérivée de l'état, pas de l'état : la simulation
 * ignore ce fichier, et il ne décide rien — il nomme.
 */
import type { SimState } from '../sim/index.js';

/** 0 croisière, 1 boost, 2 superboost, 3 G-SURGE. */
export type ThrustTier = 0 | 1 | 2 | 3;

/**
 * L'ordre des tests départage des drapeaux levés ensemble : `step()` force
 * `boosting` à vrai pendant un superboost comme pendant un G-SURGE, et les deux
 * derniers roulent à la même vitesse. Seul le palier les distingue.
 */
export function thrustTier(state: SimState): ThrustTier {
  if (state.surgeT > 0) return 3;
  if (state.superT > 0) return 2;
  return state.boosting ? 1 : 0;
}
