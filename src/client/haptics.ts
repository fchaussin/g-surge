/**
 * Le retour par vibration.
 *
 * `navigator.vibrate` n'existe pas sur iOS, donc le réglage se cache lui-même
 * plutôt que d'offrir un interrupteur qui ne fait rien.
 */
export class Haptics {
  /** Faux sur iOS et sur ordinateur, où l'API est absente. */
  readonly available = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  private enabled = true;
  private last = 0;

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * @param minGap millisecondes sous lesquelles une répétition est ignorée. Un
   *   frottement tire à chaque pas, et relancer le moteur si souvent l'annule
   *   avant qu'il soit senti ; les cas continus passent donc un écart.
   */
  buzz(pattern: number | number[], minGap = 0): void {
    if (!this.enabled || !this.available) return;
    const now = performance.now();
    if (minGap && now - this.last < minGap) return;
    this.last = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Certains navigateurs lèvent quand la page n'est pas visible. Rien à faire.
    }
  }
}
