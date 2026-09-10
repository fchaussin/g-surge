/**
 * The one claim about `src/sim/trig.ts` that Node alone cannot check.
 *
 * Debt 17 is a statement about two engines disagreeing, so a test for it needs
 * two engines. `tests/trig.test.ts` pins what the core returns, in Node, against
 * frozen bit patterns. This one runs the shipped bundle in Chromium and asks
 * whether it returns the same bits — which is the property server-side
 * validation, ghosts and shared tracks would all rest on.
 *
 * It also measures the problem itself rather than restating it: the same
 * arguments go through the browser's own `Math`, and the disagreements with
 * Node's `Math` are counted and reported. That count is deliberately not
 * asserted. It depends on two engine versions and could legitimately reach zero
 * on some pairing; the point is not that they always differ, it is that the
 * core no longer cares whether they do.
 *
 * Numbers cross the bridge as JSON, which round-trips a finite double exactly —
 * `Number::toString` is specified to produce the shortest representation that
 * reads back identically — so a comparison of bit patterns on this side is
 * sound.
 */
import { expect, test } from '@playwright/test';
import { atan, cos, sin } from '../../src/sim/index.js';

const BITS = new DataView(new ArrayBuffer(8));
const bits = (x: number): string => {
  BITS.setFloat64(0, x);
  return BITS.getBigUint64(0).toString(16).padStart(16, '0');
};

/**
 * Arguments spanning what the game actually produces, and then some.
 *
 * Measured over a run on all three difficulties: yaw reaches 44 rad and bank
 * stays under 13. The sweep goes to 1000 so the reduction is exercised well
 * past anything a track can bend to, and the exact multiples of π/2 are added
 * by hand because a random sweep never lands on them — those are the arguments
 * where the reduction cancels its high bits and implementations part company.
 */
function bands(): Array<{ label: string; xs: number[] }> {
  let state = 20260910;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const sweep = (n: number, half: number): number[] =>
    Array.from({ length: n }, () => (next() - 0.5) * 2 * half);

  const corners: number[] = [];
  for (let k = -40; k <= 40; k++)
    for (const off of [-1e-8, -1e-13, 0, 1e-13, 1e-8]) corners.push((k * Math.PI) / 2 + off);

  return [
    { label: "the game's own range, |x| < 45", xs: sweep(4000, 45) },
    { label: 'well past it, |x| < 1000', xs: sweep(2000, 1000) },
    { label: 'exact multiples of pi/2', xs: corners },
  ];
}

const allArguments = (): number[] => bands().flatMap((b) => b.xs);

test.describe('the core carries its own trigonometry across engines', () => {
  test('returns bit-identical results in Chromium and in Node', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });

    const xs = allArguments();
    const browser = await page.evaluate((values) => window.__gsNext.trig(values), xs);

    expect(browser.sin).toHaveLength(xs.length);
    const disagreements: string[] = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!;
      if (bits(browser.sin[i]!) !== bits(sin(x))) disagreements.push(`sin(${x})`);
      if (bits(browser.cos[i]!) !== bits(cos(x))) disagreements.push(`cos(${x})`);
      if (bits(browser.atan[i]!) !== bits(atan(x))) disagreements.push(`atan(${x})`);
    }
    expect(disagreements.slice(0, 10)).toEqual([]);
  });

  test("measures how far the two engines' own Math drifts apart", async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });

    let total = 0;
    for (const { label, xs } of bands()) {
      const browser = await page.evaluate(
        (values) => ({
          sin: values.map((x: number) => Math.sin(x)),
          cos: values.map((x: number) => Math.cos(x)),
          atan: values.map((x: number) => Math.atan(x)),
        }),
        xs,
      );
      const counts = { sin: 0, cos: 0, atan: 0 };
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]!;
        if (bits(browser.sin[i]!) !== bits(Math.sin(x))) counts.sin++;
        if (bits(browser.cos[i]!) !== bits(Math.cos(x))) counts.cos++;
        if (bits(browser.atan[i]!) !== bits(Math.atan(x))) counts.atan++;
      }
      const pc = (n: number) => `${((n / xs.length) * 100).toFixed(1)} %`;
      console.log(
        `${label} (${xs.length} arguments): ` +
          `sin ${counts.sin} (${pc(counts.sin)}), ` +
          `cos ${counts.cos} (${pc(counts.cos)}), ` +
          `atan ${counts.atan} (${pc(counts.atan)})`,
      );
      total += counts.sin + counts.cos + counts.atan;
    }

    // Deliberately not asserted; see the note at the top of this file. What the
    // suite guards is the test above, which says the core agrees with itself.
    expect(total).toBeGreaterThanOrEqual(0);
  });
});
