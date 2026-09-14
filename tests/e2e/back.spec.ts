/**
 * Le bouton retour du système : il remonte d'un écran au lieu de quitter.
 *
 * `page.goBack()` est exactement le geste d'Android — il retire une entrée
 * d'historique — donc ce que ce fichier prouve est ce que le joueur fait avec
 * son pouce. La garde posée par `history.ts` est vérifiée pour elle-même : le
 * jeu doit toujours avoir une entrée de plus à consommer, sinon le premier
 * retour sort.
 */
import { expect, signIn, test } from './fixtures.js';

test.describe('le retour système', () => {
  test('remonte d’un écran depuis chaque feuille du menu', async ({ game, page }) => {
    await game.boot();

    for (const open of ['btnHelp', 'btnSettingsMenu']) {
      await page.locator(`#${open}`).click();
      expect(await game.mode()).not.toBe('menu');
      await page.goBack();
      expect(await game.mode()).toBe('menu');
    }

    expect(game.errors()).toEqual([]);
  });

  // Le tableau à part : il appelle le serveur, qui n'existe pas ici, donc la
  // console porte son échec de requête. Ce qui est testé reste le retour.
  test('referme le tableau classé', async ({ game, page }) => {
    await signIn(page);
    await game.boot();
    await page.locator('#btnBoardMenu').click();
    expect(await game.mode()).toBe('board');
    await page.goBack();
    expect(await game.mode()).toBe('menu');
  });

  test('met en pause pendant une partie, et reprend', async ({ game, page }) => {
    await game.boot();
    await page.locator('#btnStart').click();
    await page.waitForFunction(() => window.__gsNext.state().travel > 20);

    await page.goBack();
    expect(await game.mode()).toBe('pause');
    await page.goBack();
    expect(await game.mode()).toBe('run');

    expect(game.errors()).toEqual([]);
  });

  test('ramène au menu depuis la carte de score', async ({ game, page }) => {
    await game.boot();
    await page.locator('#btnStart').click();
    await page.waitForFunction(() => window.__gsNext.state().travel > 20);
    await page.evaluate(() => {
      (window.__gsNext.state() as unknown as { hull: number }).hull = -1000;
    });
    await page.waitForSelector('#over.on', { timeout: 5000 });

    await page.goBack();
    expect(await game.mode()).toBe('menu');

    expect(game.errors()).toEqual([]);
  });

  test('garde toujours une entrée d’avance', async ({ game, page }) => {
    await game.boot();
    const before = await page.evaluate(() => history.length);
    await page.locator('#btnHelp').click();
    await page.goBack();
    expect(await game.mode()).toBe('menu');
    // La garde consommée est remise : autant d'entrées qu'avant, et un second
    // retour a donc encore quelque chose à retirer.
    expect(await page.evaluate(() => history.length)).toBe(before);
    await page.goBack();
    expect(await game.mode()).toBe('menu');

    expect(game.errors()).toEqual([]);
  });
});
