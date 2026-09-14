/**
 * La session côté jeu. Le serveur est arrêté à la porte du navigateur — ses
 * réponses sont servies par le test — et ce qui est prouvé est la moitié
 * client de M6 : le jeton lu dans le fragment et effacé de l'adresse, `/me`
 * qui nomme le compte dans les réglages, la sortie qui l'oublie, et une
 * partie classée demandée sans compte qui dit pourquoi elle ne l'est pas.
 */
import { expect, test } from './fixtures.js';
import { replay, unpackTrace, validTrace } from '../../src/sim/index.js';
import { chunk } from '../../server/src/track.js';

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

    let renamed = '';
    await page.route('**/me/name', (route) => {
      renamed = (JSON.parse(route.request().postData() ?? '{}') as { name: string }).name;
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });

    // parti d'ici : la marque que `signIn` pose avant de naviguer
    await page.addInitScript(() => sessionStorage.setItem('gsurge.signin', '1'));
    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    // de retour de chez le fournisseur : le pseudo est proposé, pré-rempli du nom du compte
    await expect.poll(() => game.mode()).toBe('name');
    await expect(page.locator('#nameInput')).toHaveValue('Ada L');
    await page.locator('#nameInput').fill('Ada Lovelace');
    await page.locator('#btnNameSave').click();
    await expect.poll(() => game.mode()).toBe('menu');
    expect(renamed).toBe('Ada Lovelace');
    // l'adresse ne porte plus le jeton, le stockage si
    expect(new URL(page.url()).hash).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('gsurge.session.v1'))).toBe(TOKEN);
    await expect.poll(() => seenBearer).toBe(`Bearer ${TOKEN}`);

    await page.locator('#btnSettingsMenu').click();
    await page.locator('#tabProfile').click();
    await expect(page.locator('#accountLine')).toHaveText('Signed in as Ada Lovelace');
    await expect(page.locator('#btnSignIn')).toBeHidden();
    await expect(page.locator('#btnDeleteAccount')).toBeVisible();

    await page.locator('#btnSignOut').click();
    await expect(page.locator('#accountLine')).toContainText('Not signed in');
    await expect(page.locator('#btnSignIn')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('gsurge.session.v1'))).toBeNull();
    expect(await game.mode()).toBe('settings');
  });

  /** Entre le splash et le menu : sans session, la porte ; « play offline » mène au menu, une fois pour l'onglet. */
  test('shows the sign-in gate before the menu, and lets you play offline', async ({
    game,
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.removeItem('gsurge.gate'));
    await page.goto('/');
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    expect(await game.mode()).toBe('signin');
    await page.locator('#btnGateOffline').click();
    expect(await game.mode()).toBe('menu');
  });

  /** Un lien reçu avec un fragment ne connecte pas : il faut être parti d'ici. */
  test('ignores a session fragment that did not start from here', async ({ page }) => {
    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    expect(new URL(page.url()).hash).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('gsurge.session.v1'))).toBeNull();
  });

  /**
   * Le chemin qu'une vraie partie classée prend depuis le navigateur — le
   * ticket sous le porteur, la piste par tranches, la trace en octets sur
   * `/run` — n'était exercé nulle part : le test workerd bâtit le corps
   * avec `Buffer`. Ici le serveur est le test, et il lit ce que le jeu envoie
   * avec les mêmes fonctions que le vrai.
   */
  test('a signed-in ranked run sends the bearer and a trace the server can replay', async ({
    game,
    page,
  }) => {
    test.slow();
    const seed = 'browser-ranked';
    const seen: { auth: string; body: string }[] = [];
    await page.addInitScript(() => sessionStorage.setItem('gsurge.signin', '1'));
    await page.route('**/me', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id: 3, name: 'Ada L' }),
      }),
    );
    await page.route('**/ticket', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ticket: 'a'.repeat(32),
          difficulty: 'easy',
          chunk: chunk(seed, 'easy', 0),
        }),
      }),
    );
    await page.route('**/track/**', (route) => {
      const from = Number(route.request().url().split('/').pop());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(chunk(seed, 'easy', from)),
      });
    });
    await page.route('**/run', (route) => {
      seen.push({
        auth: route.request().headers()['authorization'] ?? '',
        body: route.request().postData() ?? '',
      });
      const trace = unpackTrace(Buffer.from(JSON.parse(seen[0]!.body).trace, 'base64'))!;
      const outcome = replay({ ...trace, seed });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ outcome, rank: 1 }),
      });
    });

    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    await page.locator('#btnNameSkip').click();
    // Rien à allumer : le classé l'est d'entrée, `DEFAULT_PREFERENCES`.
    await page.locator('#btnStart').click();
    await expect.poll(() => game.mode()).toBe('run');
    await expect(page.locator('#recline')).toHaveText('ranked');
    await page.waitForFunction(() => window.__gsNext.state().travel > 40);
    await page.evaluate(() => {
      (window.__gsNext.state() as unknown as { hull: number }).hull = -1000;
    });
    await page.waitForSelector('#over.on', { timeout: 10_000 });
    await expect(page.locator('#overNote')).toHaveText(/ranked · [\d,]+ on the board · #1/);

    expect(seen.length).toBe(1);
    expect(seen[0]!.auth).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(seen[0]!.body) as { core: string; ticket: string; trace: string };
    expect(body.ticket).toBe('a'.repeat(32));
    const trace = unpackTrace(Buffer.from(body.trace, 'base64'));
    expect(trace).not.toBeNull();
    expect(validTrace({ ...trace!, seed })).toBe(true);
    expect(trace!.steps).toBeGreaterThan(0);
    expect(game.errors()).toEqual([]);
  });

  /** Un 401 sur `/me` — session close, compte supprimé — oublie le jeton. */
  /**
   * Le visage suit le compte, et les deux écrans disent la même chose.
   *
   * La photo était rangée sous une clé unique, sans identité : après un
   * changement de compte le menu montrait encore celle du précédent, pendant
   * que les réglages montraient les pixels du nouveau. Tout passe maintenant
   * par `photos.ts`, keyé sur la graine de visage du compte.
   */
  test('shows the account’s own face, and changes it with the account', async ({ game, page }) => {
    const PIC = 'https://lh3.googleusercontent.com/a/ACg8ocKtest=s96-c';
    await page.route('**/lh3.googleusercontent.com/**', (route) =>
      route.fulfill({
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
      }),
    );
    // Gardée : ce script tourne aussi sur `about:blank`, où le stockage de
    // session jette — et l'exception compterait comme une erreur de page.
    const started = () => {
      try {
        sessionStorage.setItem('gsurge.signin', '1');
      } catch {
        /* about:blank */
      }
    };
    await page.addInitScript(started);
    let who = { id: 1, name: 'Ada L', face: 'aaaaaaaaaaaaaaaa' };
    await page.route('**/me', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(who) }),
    );

    // Compte A, avec photo : le menu la montre une fois chargée
    await game.boot(`/#session=${TOKEN}&pic=${encodeURIComponent(PIC)}`);
    await page.locator('#btnNameSkip').click();
    await expect(page.locator('#menuFace img.photo')).toBeVisible();
    // et les réglages disent la même chose, ce qui n'était pas le cas
    await page.locator('#btnAccount').click();
    await expect(page.locator('#accountFace img.photo')).toBeVisible();
    await page.keyboard.press('Escape');

    // Compte B, sans photo : ses pixels, et surtout pas ceux d'à côté
    who = { id: 2, name: 'Bob B', face: 'bbbbbbbbbbbbbbbb' };
    await page.goto('about:blank');
    await game.boot(`/#session=${TOKEN}2`);
    await page.locator('#btnNameSkip').click();
    await expect(page.locator('#menuFace svg')).toBeVisible();
    await expect(page.locator('#menuFace img.photo')).toHaveCount(0);
    await page.locator('#btnAccount').click();
    await expect(page.locator('#accountFace img.photo')).toHaveCount(0);
    expect(game.errors()).toEqual([]);
  });

  test('forgets the token when the server says 401', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('gsurge.signin', '1'));
    await page.route('**/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"sign-in"}' }),
    );
    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('gsurge.session.v1')))
      .toBeNull();
  });

  test('a ranked run without an account starts unranked and says so', async ({ game, page }) => {
    await game.boot();
    await page.locator('#btnStart').click();
    await expect.poll(() => game.mode()).toBe('run');
    await expect(page.locator('#recline')).toHaveText('unranked · sign in to play ranked');
    expect(game.errors()).toEqual([]);
  });
});
