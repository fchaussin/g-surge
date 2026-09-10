/**
 * Acceptance for the new client's skeleton.
 *
 * Deliberately narrow: at this point the build only has to start, hold a live
 * WebGL context, size its canvas correctly and prove that the simulation core
 * is actually being driven. Screens, HUD and rendering arrive at roadmap steps
 * 2 and 3, and their tests come with them.
 *
 * These run against `dist/`, so `npm run test:e2e:next` builds first.
 */
import { expect, test } from '@playwright/test';

function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Waits for the game to be genuinely ready, not merely loaded.
 *
 * `window.__gsNext` appears when the module is evaluated, which is well before
 * the splash finishes compiling shaders and drawing its first frame. Waiting
 * on it let a test call `freeze` mid-startup, and the warm-up frame that
 * followed then overwrote the frozen one — visible as a screenshot that
 * differed by a different amount on every retry.
 *
 * `#boot.gone` is set by `__gsReady`, which the client calls last.
 */
const ready = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.waitForSelector('#boot.gone', { timeout: 20_000 });
};

test.describe('new client, skeleton', () => {
  test('boots without errors, on a live context, pinned to r128', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await ready(page);

    const gl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!ctx) return null;
      const g = ctx as WebGLRenderingContext;
      return { lost: g.isContextLost(), w: g.drawingBufferWidth, h: g.drawingBufferHeight };
    });

    expect(gl).not.toBeNull();
    expect(gl!.lost).toBe(false);
    expect(gl!.w).toBeGreaterThan(0);
    // The code depends on r128 behaviour; the bundle must not drift off it.
    expect(await page.evaluate(() => window.__gsNext.revision)).toBe('128');
    expect(errors).toEqual([]);
  });

  test('the canvas fills the window at any devicePixelRatio', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const m = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      return {
        cssW: r.width,
        cssH: r.height,
        bufW: c.width,
        bufH: c.height,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        dpr: window.devicePixelRatio,
      };
    });

    expect(Math.abs(m.cssW - m.innerW)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.cssH - m.innerH)).toBeLessThanOrEqual(1);
    const ratio = Math.min(m.dpr, 2);
    expect(Math.abs(m.bufW - m.innerW * ratio)).toBeLessThanOrEqual(ratio);
    expect(m.bufW).not.toBe(300);
  });

  /** The same trap as the legacy: three.js sets inline styles that hide it. */
  test('the canvas CSS rule stands without three.js inline styles', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const size = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      c.style.removeProperty('width');
      c.style.removeProperty('height');
      const r = c.getBoundingClientRect();
      return { w: r.width, h: r.height, innerW: window.innerWidth, innerH: window.innerHeight };
    });

    expect(Math.abs(size.w - size.innerW)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.h - size.innerH)).toBeLessThanOrEqual(1);
  });

  test('the simulation core is actually being driven, at the fixed step', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    expect(await page.evaluate(() => window.__gsNext.fixedStep())).toBeCloseTo(1 / 720, 12);

    const first = await page.evaluate(() => window.__gsNext.state().travel);
    await page.waitForTimeout(1000);
    const second = await page.evaluate(() => window.__gsNext.state().travel);

    // Attract mode holds around 46 m/s, so a second of wall time is tens of
    // metres. Anything much below that means steps are being dropped.
    expect(second - first).toBeGreaterThan(20);
  });

  test('the seed can be pinned from the URL', async ({ page }) => {
    await page.goto('/?seed=from-the-url');
    await ready(page);
    expect(await page.evaluate(() => window.__gsNext.seed())).toBe('from-the-url');

    await page.goto('/');
    await ready(page);
    expect(await page.evaluate(() => window.__gsNext.seed())).not.toBe('from-the-url');
  });
});

/**
 * Full-frame visual references for the new client — canvas included.
 *
 * The legacy suite could never do this: a frame depended on when it happened
 * to be taken, because the simulation ran on the real frame delta. With a
 * fixed step and a seed, `freeze` replays a known number of steps and draws
 * exactly one frame, which is reproducible.
 *
 * A small tolerance remains on purpose. The exhaust flicker is per-frame noise
 * on `Math.random`, deliberately left outside the simulation; seeding it would
 * couple presentation to the core for no gain. It moves a few hundred pixels
 * around the two plumes and nothing else.
 */
test.describe('new client, rendering', () => {
  for (const [name, steps] of [
    ['start', 60],
    ['underway', 2400],
    ['far', 9000],
  ] as const) {
    test(`renders the track ${name}`, async ({ page }, testInfo) => {
      // Desktop only. The 3D scene does not change meaningfully with the
      // viewport, and three sets of references would be 1.9 MB of PNG in the
      // repository for nothing. The retina project exists for canvas geometry,
      // not for looks.
      test.skip(testInfo.project.name !== 'desktop', 'one set of scene references is enough');
      await page.goto('/');
      await ready(page);
      // The UI is hidden rather than masked: these references are about the
      // scene, and the menu covers most of it. The interface gets its own.
      //
      // `.boot` is in that list for a reason worth keeping. The splash holds
      // for 1 200 ms by design, while `ready()` resolves as soon as the module
      // runs — so without hiding it the capture raced the splash, and one of
      // these references was in fact a screenshot of the loading screen. It
      // passed whenever the timing happened to repeat.
      await page.evaluate(
        ([seed, n]) => {
          const hide = '.layer, .hud, .mutebtn, .fps, .boot';
          for (const el of document.querySelectorAll<HTMLElement>(hide)) el.style.display = 'none';
          window.__gsNext.freeze(seed as string, n as number);
        },
        ['reference', steps],
      );
      await expect(page).toHaveScreenshot(`scene-${name}.png`, {
        // Measured, not guessed: with the plumes as the only moving part, two
        // captures of the same frozen frame differ by at most 2 280 pixels.
        // The first version of this test allowed 2 % — 18 000 pixels — which
        // was loose enough to hide a banner added across the whole width.
        maxDiffPixels: 0,
      });
    });
  }

  test('actually draws a scene rather than an empty frame', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __calls: number }).__calls = 0;
      for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const de = proto.drawElements;
        proto.drawElements = function (this: WebGLRenderingContext, ...a: Parameters<typeof de>) {
          (window as unknown as { __calls: number }).__calls++;
          return de.apply(this, a);
        };
      }
    });
    await page.goto('/');
    await ready(page);
    await page.evaluate(() => {
      (window as unknown as { __calls: number }).__calls = 0;
      window.__gsNext.freeze('reference', 600);
    });
    // The legacy draws about 76 calls a frame. Anything near zero means the
    // scene is empty and the screenshots would be comparing two black frames.
    expect(
      await page.evaluate(() => (window as unknown as { __calls: number }).__calls),
    ).toBeGreaterThan(30);
  });
});
