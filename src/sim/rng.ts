/**
 * Générateur pseudo-aléatoire déterministe et sérialisable.
 *
 * Le jeu tire aujourd'hui une quinzaine de `Math.random()` par nœud de piste,
 * ce qui rend une piste irreproductible d'un run à l'autre, donc intestable et
 * inarbitrable. Tout ce qui influence la simulation doit passer par ici.
 *
 * sfc32 : quatre mots de 32 bits, période supérieure à 2^128, passe PractRand.
 * Retenu plutôt qu'un LCG parce que les bits de poids faible d'un LCG sont
 * fortement corrélés, et le générateur de piste tire justement beaucoup de
 * booléens à faible probabilité (`rollChance` 0.14, `coinChance` 0.015).
 */

/** État complet du générateur. Suffisant pour reprendre une séquence à l'identique. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Étale une graine textuelle sur les quatre mots d'état (cyrb128). */
function expandSeed(seed: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return {
    a: (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    b: (h2 ^ h1) >>> 0,
    c: (h3 ^ h1) >>> 0,
    d: (h4 ^ h1) >>> 0,
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(state: RngState) {
    this.a = state.a | 0;
    this.b = state.b | 0;
    this.c = state.c | 0;
    this.d = state.d | 0;
  }

  /**
   * Crée un générateur à partir d'une graine.
   *
   * `stream` sépare deux séquences issues de la même graine. La géométrie de la
   * piste et le placement des objets en utilisent chacun une : sans cela,
   * toucher à la fréquence des pièces déplacerait aussi les virages, et aucune
   * comparaison entre deux versions ne serait lisible.
   */
  static fromSeed(seed: string, stream = 'default'): Rng {
    const rng = new Rng(expandSeed(`${seed}/${stream}`));
    // Les premiers tirages de sfc32 portent encore la structure de la graine.
    for (let i = 0; i < 12; i++) rng.next();
    return rng;
  }

  /** Reprend une séquence exactement où elle s'était arrêtée. */
  static fromState(state: RngState): Rng {
    return new Rng(state);
  }

  /** Photographie l'état courant, pour reprise ou pour un instantané de partie. */
  save(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  /** Flottant dans [0, 1). Équivalent direct de `Math.random()`. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Vrai avec la probabilité `p`. Remplace `Math.random() < p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** -1 ou 1, équiprobables. Remplace `Math.random() < 0.5 ? -1 : 1`. */
  sign(): -1 | 1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Flottant dans [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Entier dans [0, n). Remplace `Math.floor(Math.random() * n)`. */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Flottant dans [-half, half). Remplace `(Math.random() - 0.5) * 2 * half`. */
  centered(half: number): number {
    return (this.next() - 0.5) * 2 * half;
  }
}
