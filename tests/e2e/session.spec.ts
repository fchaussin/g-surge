/**
 * La session côté jeu. Le serveur est arrêté à la porte du navigateur — ses
 * réponses sont servies par le test — et ce qui est prouvé est la moitié
 * client de M6 : le jeton lu dans le fragment et effacé de l'adresse, `/me`
 * qui nomme le compte dans les réglages, la sortie qui l'oublie, et une
 * partie classée demandée sans compte qui dit pourquoi elle ne l'est pas.
 */
import { expect, test } from './fixtures.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

test.describe('the session', () => {
  test('reads the token from the fragment, erases it, and names the account', async ({
    game,
    page,
  }) => {
    let seenBearer = '';
    await page.route('**/me', (route) => {
      seenBearer = route.request().headers()['authorization'] ?? '';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id: 7, name: 'Ada L' }),
      });
    });
    await page.route('**/logout', (route) =>
      route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }),
    );

    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    // l'adresse ne porte plus le jeton, le stockage si
    expect(new URL(page.url()).hash).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('gsurge.session.v1'))).toBe(TOKEN);
    await expect.poll(() => seenBearer).toBe(`Bearer ${TOKEN}`);

    await page.locator('#btnSettingsMenu').click();
    await expect(page.locator('#accountLine')).toHaveText('Signed in as Ada L');
    await expect(page.locator('#btnSignIn')).toBeHidden();
    await expect(page.locator('#btnDeleteAccount')).toBeVisible();

    await page.locator('#btnSignOut').click();
    await expect(page.locator('#accountLine')).toContainText('Not signed in');
    await expect(page.locator('#btnSignIn')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('gsurge.session.v1'))).toBeNull();
    expect(await game.mode()).toBe('settings');
  });

  test('a ranked run without an account starts unranked and says so', async ({ game, page }) => {
    await game.boot();
    await page.locator('#btnSettingsMenu').click();
    await page.locator('#tglRanked').click();
    await page.keyboard.press('Escape');
    await page.locator('#btnStart').click();
    await expect.poll(() => game.mode()).toBe('run');
    await expect(page.locator('#recline')).toHaveText('unranked · sign in to play ranked');
    expect(game.errors()).toEqual([]);
  });
});
