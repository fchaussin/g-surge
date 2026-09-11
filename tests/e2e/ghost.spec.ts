/**
 * Le fantôme : la meilleure partie court à côté de la suivante.
 *
 * Le tour complet, dans le vrai jeu : une partie jouée puis quittée est gardée
 * comme fantôme ; le réglage allumé, la partie suivante se joue sur sa graine
 * et le fantôme est en course et dessiné ; le réglage éteint, la graine est
 * de nouveau tirée au sort. Pas de capture : les références visuelles ont le
 * fantôme éteint, et doivent le rester.
 */
import { expect, test } from './fixtures.js';

const GHOST_KEY = 'gsurge.ghost.v1.easy';

test.describe('le fantôme', () => {
  test('une partie quittée devient le fantôme, et la suivante court contre lui', async ({
    game,
    page,
  }) => {
    await game.boot();
    expect(await page.evaluate((k) => localStorage.getItem(k), GHOST_KEY)).toBeNull();

    // une première partie, courte, quittée depuis la pause
    await page.locator('#btnStart').click();
    const seed = await page.evaluate(() => window.__gsNext.seed());
    expect(await page.evaluate(() => window.__gsNext.ghost().armed)).toBe(false);
    await page.waitForFunction(() => window.__gsNext.state().travel > 60);
    await page.keyboard.press('Escape');
    await page.locator('#btnQuit').click();
    expect(await game.mode()).toBe('menu');
    expect(await page.evaluate((k) => localStorage.getItem(k), GHOST_KEY)).not.toBeNull();

    // le réglage allumé : la partie suivante est sur la même graine, le fantôme en course
    await page.locator('#btnSettingsMenu').click();
    await page.locator('#tglGhost').click();
    await page.keyboard.press('Escape');
    expect(await game.mode()).toBe('menu');
    await page.locator('#btnStart').click();
    expect(await page.evaluate(() => window.__gsNext.seed())).toBe(seed);
    await page.waitForFunction(() => window.__gsNext.state().travel > 20);
    const ghost = await page.evaluate(() => window.__gsNext.ghost());
    expect(ghost.armed).toBe(true);
    // même piste, mêmes entrées nulles : il roule dans le vaisseau, à portée du ruban
    expect(ghost.visible).toBe(true);
    expect(Math.abs(ghost.gap)).toBeLessThan(30);
    await expect(page.locator('#recline')).toHaveText(/ghost [+−]\d+ m/);

    // le réglage éteint : la graine repart au hasard
    await page.keyboard.press('Escape');
    await page.locator('#btnQuit').click();
    await page.locator('#btnSettingsMenu').click();
    await page.locator('#tglGhost').click();
    await page.keyboard.press('Escape');
    await page.locator('#btnStart').click();
    expect(await page.evaluate(() => window.__gsNext.seed())).not.toBe(seed);
    expect(await page.evaluate(() => window.__gsNext.ghost().armed)).toBe(false);

    expect(game.errors()).toEqual([]);
  });
});
