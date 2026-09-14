/**
 * Ce qui fait qu'une partie compte. Le texte du tableau vide promet « crash,
 * restart or quit » ; RESTART se presse depuis la pause, et c'est le cas que
 * la revue du 13 septembre 2026 a trouvé faux : une partie relancée depuis
 * la pause ne laissait rien au palmarès ni de fantôme.
 */
import { expect, test } from './fixtures.js';

const SCORES = 'gsurge.scores.v2';

test.describe('a run counts', () => {
  /**
   * L'épave. La coque disparaissait pour de bon après l'onde de choc, et le
   * joueur regardait du vide à l'endroit exact où il venait de se planter —
   * et l'autre pilote d'un duel aussi. Elle doit être là après l'explosion, et
   * ne pas survivre à la partie suivante.
   */
  test('leaves a wreck on the track, and clears it on the next run', async ({ game, page }) => {
    await game.boot();
    await page.locator('#btnStart').click();
    await page.waitForFunction(() => window.__gsNext.state().travel > 40);
    expect(await page.evaluate(() => window.__gsNext.wreck())).toBe(false);

    // La coque sous zéro, tenue : à zéro, la régénération la relève avant le
    // contrôle de fin de pas et la partie ne se perd jamais.
    await page.evaluate(async () => {
      const s = window.__gsNext.state() as unknown as { hull: number; wrecked: boolean };
      for (let i = 0; i < 120 && !s.wrecked; i++) {
        s.hull = -1;
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
    await expect.poll(() => game.mode(), { timeout: 15_000 }).toBe('over');
    // Elle prend la place de la coque quand l'onde s'est dissipée, ce qui est
    // un peu après que la carte soit montée : c'est une attente, pas un
    // instant.
    await expect.poll(() => page.evaluate(() => window.__gsNext.wreck())).toBe(true);

    await page.locator('#btnAgain').click();
    await expect.poll(() => game.mode()).toBe('run');
    expect(await page.evaluate(() => window.__gsNext.wreck())).toBe(false);
    expect(game.errors()).toEqual([]);
  });

  test('when restarted from the pause screen', async ({ game, page }) => {
    await game.boot();
    expect(await page.evaluate((k) => localStorage.getItem(k), SCORES)).toBeNull();

    await page.locator('#btnStart').click();
    await page.waitForFunction(() => window.__gsNext.state().travel > 60);
    await page.keyboard.press('Escape');
    expect(await game.mode()).toBe('pause');
    await page.locator('#btnRestart').click();
    await expect.poll(() => game.mode()).toBe('run');

    const stored = await page.evaluate((k) => localStorage.getItem(k), SCORES);
    expect(stored).not.toBeNull();
    expect((JSON.parse(stored!) as unknown[]).length).toBe(1);
    // et la nouvelle partie est bien une autre : la distance repart de zéro
    expect(await page.evaluate(() => window.__gsNext.state().travel)).toBeLessThan(60);
    expect(game.errors()).toEqual([]);
  });
});
