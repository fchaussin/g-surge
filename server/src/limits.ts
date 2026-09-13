/**
 * Ce qu'une adresse peut demander par minute.
 *
 * Deux routes coûtent cher et une seule chose les rend chères : le rejeu.
 * `/ticket` en arme un, `/run` en dépense un — mesuré, de l'ordre de 0,06 µs
 * par pas, donc quelques dizaines de millisecondes pour une partie normale et
 * jusqu'à deux dixièmes de seconde pour la plus longue qu'une trace puisse
 * déclarer, `MAX_STEPS`. Le reste — le tableau, une trace servie — est une
 * lecture D1 et ne passe pas par ici.
 *
 * Le compteur vit dans la mémoire du Durable Object et non en base, pour deux
 * raisons : l'objet est unique, donc il voit tout, et une limite de débit
 * n'est pas une donnée à garder. Une éviction remet les compteurs à zéro, ce
 * qui est acceptable — le pire est qu'un abus reparte d'une fenêtre propre,
 * jamais qu'un joueur soit refusé à tort.
 *
 * **Une adresse n'est pas un joueur.** Derrière un opérateur mobile, une
 * école ou un foyer, plusieurs joueurs partagent la même. Les plafonds sont
 * donc larges pour un humain — qui lance une partie par minute au plus — et
 * serrés pour une boucle. Le vrai découpage par joueur attend les comptes,
 * `M6` de `MULTIPLAYER-ROADMAP.md`.
 */

/** La fenêtre glissante, en millisecondes. */
const WINDOW = 60_000;

/** Ce qu'une adresse peut faire dans une fenêtre, par route. */
export const PER_MINUTE: Record<string, number> = {
  ticket: 12,
  run: 12,
};

/** Au-delà, la table est purgée de ses fenêtres mortes. Borne la mémoire. */
const SWEEP_AT = 4096;

interface Window {
  /** Fin de la fenêtre en cours. */
  until: number;
  used: number;
}

export class Limits {
  private readonly seen = new Map<string, Window>();

  /**
   * Compte un appel et dit s'il passe.
   *
   * @param key la route, telle qu'elle apparaît dans `PER_MINUTE`.
   * @param ip ce que `cf-connecting-ip` portait. Vide en développement local
   *   et dans les tests : tout le monde partage alors la même fenêtre, ce qui
   *   est exactement ce qu'un test veut pouvoir provoquer.
   * @param now l'horloge de l'appelant, jamais `Date.now` ici — un test doit
   *   pouvoir avancer d'une minute sans l'attendre.
   * @returns les secondes à attendre, ou 0 si l'appel passe.
   */
  take(key: string, ip: string, now: number): number {
    const cap = PER_MINUTE[key];
    if (cap === undefined) return 0;
    if (this.seen.size > SWEEP_AT) this.sweep(now);
    const id = `${key}:${ip}`;
    const window = this.seen.get(id);
    if (!window || window.until <= now) {
      this.seen.set(id, { until: now + WINDOW, used: 1 });
      return 0;
    }
    if (window.used < cap) {
      window.used++;
      return 0;
    }
    return Math.max(1, Math.ceil((window.until - now) / 1000));
  }

  private sweep(now: number): void {
    for (const [id, window] of this.seen) if (window.until <= now) this.seen.delete(id);
  }
}
