/**
 * Ce qui fait qu'une partie compte. Le texte du tableau vide promet « crash,
 * restart or quit » ; RESTART se presse depuis la pause, et c'est le cas que
 * la revue du 13 septembre 2026 a trouvé faux : une partie relancée depuis
 * la pause ne laissait rien au palmarès ni de fantôme.
 */
import { expect, test } from './fixtures.js';

const SCORES = 'gsurge.scores.v2';

test.describe('a run counts', () => {
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
