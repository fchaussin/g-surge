/**
 * La semaine du tableau, en dehors de Miniflare : une fonction pure de la
 * date, testée comme telle.
 */
import { describe, expect, it } from 'vitest';
import { epoch, nextReset } from '../server/src/epoch.js';

describe('the board week', () => {
  it('keys a known Monday and the Sunday just before it in the same week', () => {
    // Lundi 7 septembre 2026 00:00 UTC, et le dimanche qui le précède.
    const monday = Date.UTC(2026, 8, 7, 0, 0, 0);
    const sundayBefore = monday - 1;
    expect(epoch(monday)).toBe('2026-W37');
    expect(epoch(sundayBefore)).toBe('2026-W36');
  });

  it('does not key the following Monday the same as the one before it', () => {
    const monday = Date.UTC(2026, 8, 7);
    const nextMonday = monday + 7 * 86_400_000;
    expect(epoch(monday)).not.toBe(epoch(nextMonday));
  });

  it('resets at the Monday strictly after now, never on it', () => {
    const monday = Date.UTC(2026, 8, 7, 0, 0, 0);
    expect(nextReset(monday)).toBe(monday + 7 * 86_400_000);
    const mondayNoon = monday + 12 * 3_600_000;
    expect(nextReset(mondayNoon)).toBe(monday + 7 * 86_400_000);
    const fridayBefore = monday - 3 * 86_400_000;
    expect(nextReset(fridayBefore)).toBe(monday);
  });
});
