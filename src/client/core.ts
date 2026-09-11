/**
 * L'identité du noyau, telle que le build l'a estampillée.
 *
 * Une trace ne se rejoue qu'avec le noyau qui l'a produite, et la version du
 * paquet est la mauvaise clé : elle bouge pour une retouche visuelle aussi.
 * `vite.config.ts` réécrit la ligne marquée avec le condensé de `src/sim/`,
 * calculé par `scripts/core-digest.mjs`, et fait échouer le build si le
 * marqueur a disparu — le même mécanisme que la liste du service worker. Hors
 * build, dans les tests Node, la valeur reste `DEV`.
 */

/* core:digest */ export const CORE_DIGEST = 'DEV';
