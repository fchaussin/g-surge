/**
 * Vibration feedback.
 *
 * `navigator.vibrate` does not exist on iOS, so the setting hides itself
 * rather than offering a switch that does nothing.
 */
export class Haptics {
  /** False on iOS and on desktop, where the API is absent. */
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
   * @param minGap milliseconds below which a repeat is dropped. A scrape fires
   *   every step, and restarting the motor that often cancels it before it is
   *   felt, so the continuous cases pass a gap.
   */
  buzz(pattern: number | number[], minGap = 0): void {
    if (!this.enabled || !this.available) return;
    const now = performance.now();
    if (minGap && now - this.last < minGap) return;
    this.last = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers throw when the page is not visible. Nothing to do.
    }
  }
}
