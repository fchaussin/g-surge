/**
 * Les couches de la jauge de poussée, calculées sans DOM.
 *
 * La jauge est l'échelle : en bas la réserve, en or ; par-dessus la montée vers
 * le super boost puis, une fois dedans, son décompte, en blanc ; par-dessus
 * encore la montée vers le G-SURGE puis le sien, en blanc chaud. Un palier qui
 * s'éteint vide sa couche et découvre celle du dessous.
 *
 * Extrait de `hud.ts` pour être testé en Node : c'est la seule lecture de
 * l'échelle que le joueur a sous les yeux, et une jauge qui mentirait d'un
 * barreau ne serait vue par aucune référence figée — les traces ne contiennent
 * ni drift ni super boost. Écrit dans un objet fourni, jamais alloué : la
 * fonction tourne à chaque frame.
 */
import type { SimState, Tuning } from '../sim/index.js';

export interface LadderLayers {
  /** Hauteurs en pour cent entiers, 0 à 100, de bas en haut. */
  l1: number;
  l2: number;
  l3: number;
  /** La couche que le drift fait monter en ce moment : 0 aucune, sinon 1 à 3. */
  up: 0 | 1 | 2 | 3;
  sup: boolean;
  surging: boolean;
}

export function createLayers(): LadderLayers {
  return { l1: 0, l2: 0, l3: 0, up: 0, sup: false, surging: false };
}

const pct = (ratio: number): number => Math.min(100, Math.max(0, Math.round(ratio * 100)));

/**
 * Tout est borné à 100, parce qu'un second ramassage peut porter une durée au
 * double. Au sommet la montée ne compte plus, donc rien ne monte.
 */
export function ladderLayers(state: SimState, tuning: Tuning, out: LadderLayers): LadderLayers {
  const surging = state.surgeT > 0;
  const sup = state.superT > 0;
  out.surging = surging;
  out.sup = sup;
  out.l1 = sup || surging ? 100 : pct(state.energy / 100);
  out.l2 = surging
    ? 100
    : sup
      ? pct(state.superT / tuning.supTime)
      : pct(state.climb / tuning.climbSup);
  out.l3 = surging
    ? pct(state.surgeT / tuning.surgeTime)
    : sup
      ? pct(state.climb / tuning.climbSurge)
      : 0;
  out.up = !state.drift || surging ? 0 : sup ? 3 : state.boosting ? 2 : 1;
  return out;
}
