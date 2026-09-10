/**
 * The shipped bundle plays the same as the source.
 *
 * This test replaced a set that compared two implementations against each
 * other, back when the legacy and `src/sim/` both existed. There is only one
 * now, so what is left to prove is different and still worth proving: that
 * nothing between the TypeScript and the deployed file — the transpile, the
 * minifier, the module graph, the `es2020` target — moved a number.
 *
 * The frozen references in `fixtures/` remain the contract. `tests/sim-parity`
 * replays them against the source in Node; this replays them against the built
 * bundle in a browser.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { DEFAULTS, HZ } from '../../src/sim/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

/** The same script the references were captured with. */
const REFERENCE_SCRIPT = [
  { from: 0, steer: 0, brake: false, boost: false },
  { from: 240, steer: 0.18, brake: false, boost: true },
  { from: 600, steer: -0.22, brake: false, boost: true },
  { from: 900, steer: 0.1, brake: false, boost: false },
  { from: 1200, steer: -0.12, brake: true, boost: false },
  { from: 1500, steer: 0.06, brake: false, boost: true },
];

const ready = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => typeof window.__gsNext !== 'undefined', undefined, { timeout: 15_000 });

test.describe('the shipped bundle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ready(page);
  });

  test('carries the tuning table unchanged', async ({ page }) => {
    expect(await page.evaluate(() => window.__gsNext.defaults())).toEqual(DEFAULTS);
  });

  test('runs at the fixed step', async ({ page }) => {
    const clock = await page.evaluate(() => window.__gsNext.clock());
    expect(clock.hz).toBeCloseTo(HZ, 6);
    // 720 divides the common refresh rates, which is what lets the renderer
    // skip interpolation entirely.
    for (const refresh of [30, 60, 72, 90, 120, 144, 240]) {
      expect(Math.round(clock.hz) % refresh, `${refresh} Hz`).toBe(0);
    }
  });

  test('regenerates the reference track from its seed', async ({ page }) => {
    const expected = load('track-reference') as { nodes: unknown; items: unknown };
    const got = await page.evaluate(() => {
      window.__gsNext.trace({ seed: 'reference', steps: 0 });
      return { nodes: window.__gsNext.nodes(), items: window.__gsNext.items() };
    });
    expect(got.nodes).toEqual(expected.nodes);
    expect(got.items).toEqual(expected.items);
  });

  for (const diff of ['easy', 'medium', 'hard'] as const) {
    test(`replays the ${diff} physics reference`, async ({ page }) => {
      const expected = load(`physics-${diff}`);
      const got = await page.evaluate(
        ([d, script]) =>
          window.__gsNext.trace({
            seed: 'reference',
            diff: d as 'easy' | 'medium' | 'hard',
            steps: 1800,
            // The references were captured at 1/120, before the loop settled
            // on a 720 Hz step. They pin what `step()` does for a given dt,
            // which is the part that has to stay still; the rate the loop
            // happens to call it at is a separate decision.
            dt: 1 / 120,
            every: 120,
            script: script as Array<{ from: number; steer: number; brake: boolean; boost: boolean }>,
          }),
        [diff, REFERENCE_SCRIPT] as const,
      );
      expect(got).toEqual(expected);
    });
  }

  test('draws a different track for a different seed', async ({ page }) => {
    const [alpha, beta] = await page.evaluate(() => {
      window.__gsNext.trace({ seed: 'alpha', steps: 0 });
      const a = window.__gsNext.nodes();
      window.__gsNext.trace({ seed: 'beta', steps: 0 });
      return [a, window.__gsNext.nodes()];
    });
    expect(beta).not.toEqual(alpha);
  });
});
