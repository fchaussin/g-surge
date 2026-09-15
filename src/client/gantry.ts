/**
 * L'espacement des portiques, et rien d'autre.
 *
 * Deux modules le lisent et n'ont aucune raison de se connaître : `track-mesh.ts`
 * les dessine, `flyby.ts` les fait entendre. Le chiffre a donc un domicile à lui
 * plutôt que d'être recopié ou de forcer l'audio à importer le rendu — et avec
 * lui, three.js, que rien dans `flyby.ts` ne réclame.
 *
 * Même raison que `pan.ts` : un fait, un seul endroit.
 */

/**
 * Segments entre deux portiques. Un segment fait `SEG`, 12 m, donc un portique
 * tous les 144 m.
 *
 * C'est ce qui en fait une cadence plutôt qu'un timbre, et c'est pourquoi ils
 * sonnent là où la géométrie de la piste ne le peut pas : à 200 m/s ils
 * défilent à 1,4 Hz, à 409 m/s à 2,8 Hz, en croisière à 0,5 Hz. L'oreille
 * compte ça comme un rythme, et un rythme qui accélère **est** la vitesse.
 * Les chevrons, à 24 m, sortiraient à 8,3 Hz — un bourdon.
 */
export const GANTRY_EVERY = 12;
