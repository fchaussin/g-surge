/**
 * Regarder une partie du tableau.
 *
 * Le serveur est arrêté à la porte du navigateur : les deux appels que cet
 * écran fait — le tableau et la trace — sont servis par le test. Ce qui est
 * prouvé est donc la moitié client de M4, la moitié serveur étant tenue par
 * `tests/server.test.ts`, dans workerd. La trace servie est une vraie, bâtie
 * ici avec le noyau et empaquetée comme le serveur l'empaquette, donc ce que
 * le navigateur rejoue est bien ce qu'un serveur rendrait.
 */
import { expect, signIn, test } from './fixtures.js';
import { DT, packTrace, Sim, type Trace } from '../../src/sim/index.js';

const SEED = 'watched-run';

/**
 * Une partie jouée dans Node, pour avoir une trace à servir. `scrape` la
 * tient contre le mur : de quoi provoquer un crash en cours de visionnage.
 */
function record(seconds: number, scrape = false): Trace {
  const sim = new Sim({ seed: SEED, difficulty: 'easy' });
  sim.reset(SEED);
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && !sim.state.wrecked; i++) {
    // une conduite quelconque mais tenue : de quoi avancer et tourner un peu
    const steer = scrape ? 1 : i % 480 < 240 ? 0.12 : -0.12;
    sim.step({ steer, brake: false, boost: true }, DT);
  }
  return sim.trace();
}

const ENTRY = { id: 7, name: 'WATCHED', score: 1234, dist: 900, time: 40, coins: 3, speedPeak: 80 };

test.describe('watching a board entry', () => {
  test('loads the trace, replays it, and comes back to the board', async ({ game, page }) => {
    const trace = record(20);
    const packed = Buffer.from(packTrace(trace)).toString('base64');

    await page.route('**/board/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          epoch: '2026-W37',
          resetAt: Date.now() + 86_400_000,
          entries: [ENTRY],
        }),
      }),
    );
    await page.route('**/trace/7', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trace: packed }) }),
    );

    await signIn(page);
    await game.boot();
    await page.locator('#btnBoardMenu').click();
    await expect(page.locator('#wboardBody .nm')).toHaveText('WATCHED');

    await page.locator('#wboardBody button[data-watch="7"]').click();
    await expect.poll(() => game.mode()).toBe('watch');

    // Le vaisseau court sur la piste de la trace, sans personne aux commandes.
    expect(await page.evaluate(() => window.__gsNext.seed())).toBe(SEED);
    await page.waitForFunction(() => window.__gsNext.state().travel > 60);
    // Le HUD lit cette simulation-là : la vitesse ne reste pas à zéro.
    await expect
      .poll(async () => Number(await page.locator('#spd').textContent()))
      .toBeGreaterThan(0);
    // Rien de ce qui se pilote ne s'affiche.
    await expect(page.locator('#btnPause')).toBeHidden();

    await page.locator('#btnStopWatch').click();
    await expect.poll(() => game.mode()).toBe('board');
  });

  /**
   * Regarder jusqu'au crash ne finit rien chez le joueur. Ça le faisait : la
   * fin de partie de l'autre passait par `endRun`, et le score de l'inconnu
   * entrait dans le palmarès local, sa trace devenait le fantôme du joueur.
   *
   * Le crash est provoqué : une trace qui frotte le mur, et la coque abaissée
   * par la surface de débogage pendant le visionnage — trente secondes de
   * frottement simulé coûteraient des minutes sous le plafond de frame du
   * rendu logiciel. Ce qui est testé est le routage de l'événement, pas la
   * durée de vie d'une coque.
   */
  test('watching to the wreck leaves the player’s own records untouched', async ({
    game,
    page,
  }) => {
    test.slow();
    const trace = record(60, true);
    const packed = Buffer.from(packTrace(trace)).toString('base64');
    await page.route('**/board/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ epoch: '2026-W37', resetAt: Date.now() + 1000, entries: [ENTRY] }),
      }),
    );
    await page.route('**/trace/7', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trace: packed }) }),
    );

    await signIn(page);
    await game.boot();
    await page.locator('#btnBoardMenu').click();
    await page.locator('#wboardBody button[data-watch="7"]').click();
    await expect.poll(() => game.mode()).toBe('watch');
    await page.waitForFunction(() => window.__gsNext.state().travel > 30);
    await page.evaluate(() => {
      (window.__gsNext.state() as unknown as { hull: number }).hull = 3;
    });
    // le prochain frottement fait l'épave ; l'écran garde l'onde, puis rend la main
    await page.waitForFunction(
      () => (window.__gsNext.state() as unknown as { wrecked: boolean }).wrecked,
      undefined,
      { timeout: 30_000 },
    );
    await expect.poll(() => game.mode(), { timeout: 10_000 }).toBe('board');

    // rien chez le joueur : ni score local, ni fantôme, ni carte de score
    expect(await page.evaluate(() => localStorage.getItem('gsurge.scores.v2'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('gsurge.ghost.v1.easy'))).toBeNull();
    expect(await page.locator('#over').evaluate((el) => el.classList.contains('on'))).toBe(false);
    expect(game.errors()).toEqual([]);
  });

  test('says so when the run is no longer kept, and stays on the board', async ({ game, page }) => {
    await page.route('**/board/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ epoch: '2026-W37', resetAt: Date.now() + 1000, entries: [ENTRY] }),
      }),
    );
    await page.route('**/trace/7', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"trace"}' }),
    );

    await signIn(page);
    await game.boot();
    await page.locator('#btnBoardMenu').click();
    await page.locator('#wboardBody button[data-watch="7"]').click();

    await expect(page.locator('#wboardBody .empty')).toContainText('no longer kept');
    expect(await game.mode()).toBe('board');
  });
});
