/**
 * Ce que la simulation raconte au reste du programme.
 *
 * Avant ce découpage, `step()` appelait directement `SFX.hit`, `buzz`,
 * `flashHalo` et `pop` — quatorze appels de présentation au milieu de la
 * physique. Un serveur ne pouvait donc pas l'exécuter, et aucun test ne pouvait
 * l'isoler. La simulation émet désormais des faits ; le rendu, l'audio et
 * l'haptique décident quoi en faire.
 *
 * Les couleurs et les libellés restent chez le consommateur : `pickup` porte le
 * palier de la pièce, pas son code hexadécimal.
 */

export type SimEvent =
  /** Le vaisseau retouche la piste après un saut. */
  | { readonly type: 'land' }
  /** Réception hors piste : vitesse, coque et multiplicateur encaissent. */
  | { readonly type: 'badLanding' }
  /** Choc franc contre un mur. `force` vaut 0 à 1, elle dose le retour. */
  | { readonly type: 'wallImpact'; readonly force: number }
  /** Frottement prolongé le long d'un mur, émis à chaque pas de contact. */
  | { readonly type: 'scrape' }
  /** Pièce ramassée. `tier` vaut 0, 1 ou 2 selon le palier de vitesse. */
  | {
      readonly type: 'pickup';
      readonly kind: 'coin';
      readonly tier: 0 | 1 | 2;
      readonly gain: number;
    }
  /** Réparation ramassée. */
  | { readonly type: 'pickup'; readonly kind: 'fix' }
  /** Super boost ramassé. Le ramassage est l'activation : il n'y a pas de stock. */
  | { readonly type: 'pickup'; readonly kind: 'sup' }
  /**
   * Fin du super boost, au pas où `superT` atteint zéro.
   *
   * C'est le seul instant de la branche que le client ne peut pas retrouver
   * seul : le ramassage lui est donné, la durée lui est cachée. Émis une fois,
   * jamais répété, puisque le compteur ne redescend qu'une fois.
   */
  | { readonly type: 'supEnd' }
  /** Entrée en drift : les appuis viennent de lâcher. */
  | { readonly type: 'driftStart' }
  /**
   * Sortie de drift, réalignement compris.
   *
   * `held` porte la durée du drift en secondes, parce que le consommateur en a
   * besoin pour doser — et surtout pour se taire : un drift d'un seul pas
   * existe, mesuré à 1 ms, et son entrée et sa sortie se superposeraient en un
   * clic. Même forme que `wallImpact.force`, l'événement porte la quantité.
   */
  | { readonly type: 'driftEnd'; readonly held: number }
  /** Coque à zéro : la partie est terminée. */
  | { readonly type: 'wreck' };
