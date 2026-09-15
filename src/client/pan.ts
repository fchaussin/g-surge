/**
 * De quel côté sort un son, et rien d'autre.
 *
 * Un module pour une fonction de trois lignes, parce que ce qu'elle porte n'est
 * pas un calcul mais une convention de repère — et qu'une convention n'a de
 * valeur que si elle a **un seul domicile**. `audio.ts` la lit pour les couches
 * de bord, `flyby.ts` pour les objets qui passent ; si chacun refaisait
 * l'inversion chez lui, il suffirait d'un oubli pour que la moitié de la scène
 * sorte à l'envers, sans que rien ne plante ni ne se voie.
 *
 * C'est aussi ce qui casse le cycle d'import entre les deux.
 */

/**
 * Le panoramique d'une position latérale du monde, −1 à 1.
 *
 * **Le signe est inversé, et ce n'est pas une erreur.** Le monde a `+X` à
 * gauche de l'écran — la convention du jeu, celle qui fait que la direction est
 * inversée exprès dans `step()`. Un son posé au signe de `lat` sortirait donc
 * systématiquement du mauvais côté, ce qui est pire que le centre : le centre
 * n'affirme rien, l'inverse ment.
 *
 * **Aucune borne, et aucune connaissance du matériel.** On suppose une stéréo
 * équilibrée : un bord de piste sonne au bord du champ. Si un montage restitue
 * ses deux canaux avec des forces différentes, ce n'est pas au jeu de le
 * compenser, et il n'a aucun moyen honnête de le savoir. Rabattre « au cas où »
 * dégraderait le casque, seul endroit où l'on sait ce qui sort.
 *
 * Le bornage qui reste est celui de l'intervalle : `lat` dépasse la limite de
 * piste en l'air, `airOverhang` l'y autorise, et `pan` n'accepte que −1 à 1.
 *
 * @param lateral position latérale en espace monde, normalisée : −1 à un bord,
 *   1 à l'autre.
 */
export function panOf(lateral: number): number {
  const v = lateral < -1 ? -1 : lateral > 1 ? 1 : lateral;
  return -v;
}
