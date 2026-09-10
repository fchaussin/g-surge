/**
 * Horloge à pas fixe.
 *
 * La simulation tournait sur le delta brut entre deux images, borné à 50 ms.
 * Deux machines ne jouaient donc pas au même jeu : à 30 images par seconde
 * l'adhérence, l'entrée en dérive et la détection de saut s'intègrent
 * autrement qu'à 144, et le classement comparait des parties qui n'avaient pas
 * été simulées pareil. Mesuré sur quinze secondes, un écart de 6,6 m entre 60
 * et 144 Hz, et à 30 Hz la trajectoire dévie assez pour ramasser d'autres
 * pièces.
 *
 * `HZ` vaut 720 et ce n'est pas un excès : c'est le plus petit entier divisible
 * par 60, 72, 90, 120, 144 et 240. Le rendu tombe donc toujours sur un état de
 * simulation exact, jamais entre deux — c'est cela qui rend l'interpolation
 * inutile — et sur ces cadences le nombre de pas par image est constant : douze
 * à 60 Hz, cinq à 144. Un pas coûte 0,45 µs mesuré, soit 0,03 % d'un cœur à
 * cette cadence ; le coût n'est pas l'argument.
 *
 * Sur les rares cadences qui ne divisent pas 720, 75 et 165 Hz, le nombre de
 * pas par image alterne entre deux entiers voisins. Le résidu vaut alors ±11 %
 * du déplacement d'une image, contre ±120 % qu'aurait donné une simulation à
 * 120 Hz sur un écran 144 : c'est précisément ce qui permet de se passer
 * d'interpolation.
 */

/** Pas de simulation, en hertz. */
export const HZ = 720;

/** Durée d'un pas, en secondes. */
export const DT = 1 / HZ;

/**
 * Borne du temps consommé par image, en secondes.
 *
 * Sans elle, une image longue — onglet en arrière-plan, compilation de shader,
 * ramasse-miettes — demanderait des milliers de pas d'un coup, chacun rendant
 * l'image suivante plus tardive encore. C'est la « spirale de la mort ». Passé
 * cette borne le jeu ralentit au lieu de s'effondrer, ce que le joueur pardonne
 * et que la boucle survit.
 */
export const MAX_FRAME = 0.05;

/** Nombre de pas maximal par image, conséquence directe de `MAX_FRAME`. */
export const MAX_STEPS = Math.ceil(MAX_FRAME * HZ);

/**
 * Tolérance sur l'accumulateur, en secondes.
 *
 * 1/72 et 1/144 ne sont pas représentables en binaire. Sans cette marge,
 * l'accumulateur passe régulièrement un cheveu sous le pas et rend neuf pas au
 * lieu de dix, ce qui suffit à réintroduire le saccadement qu'on cherche
 * justement à éviter. Un test le vérifiait, et échouait.
 *
 * 0,1 µs est cinq ordres de grandeur sous un pas de 1,4 ms, et dix ordres au
 * dessus de l'erreur de représentation : assez large pour l'absorber, assez
 * étroit pour n'avancer aucun pas qui ne soit dû.
 */
const EPSILON = 1e-7;

export class Clock {
  private accumulator = 0;

  constructor(
    readonly hz: number = HZ,
    readonly maxFrame: number = MAX_FRAME,
  ) {}

  get dt(): number {
    return 1 / this.hz;
  }

  /** Temps pas encore consommé, en secondes. Toujours inférieur à un pas. */
  get pending(): number {
    return this.accumulator;
  }

  /** Repart de zéro. À appeler avec toute remise à zéro de partie. */
  reset(): void {
    this.accumulator = 0;
  }

  /**
   * Encaisse `elapsed` secondes de temps réel et renvoie le nombre de pas de
   * simulation à exécuter. Le reste est conservé pour l'image suivante.
   */
  advance(elapsed: number): number {
    if (!(elapsed > 0)) return 0; // NaN et valeurs négatives comprises
    this.accumulator += Math.min(elapsed, this.maxFrame);
    const dt = this.dt;
    const steps = Math.floor((this.accumulator + EPSILON) / dt);
    this.accumulator -= steps * dt;
    return steps;
  }
}
