/**
 * Le duel, côté navigateur. Le salon est le test : `page.route` sert
 * l'ouverture et la piste, et `page.routeWebSocket` tient la prise — il lit
 * ce que le jeu envoie et lui renvoie l'état d'un autre vaisseau. Ce qui est
 * prouvé est la moitié client de M7 : les morceaux partent à la cadence du
 * temps simulé sous une forme que le serveur décode, et l'autre se dessine.
 */
import { expect, test } from './fixtures.js';
import { unpackTrace } from '../../src/sim/index.js';
import { chunk } from '../../server/src/track.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ROOM = '0123456789abcdef';
const SEED = 'duel-seed';

test.describe('a duel', () => {
  test('sends chunks the server can decode, and draws the other ship from relays', async ({
    game,
    page,
  }) => {
    test.slow();
    const sent: { steps: number; d: number }[] = [];
    await page.addInitScript(() => sessionStorage.setItem('gsurge.signin', '1'));
    await page.route('**/me', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id: 3, name: 'Ada L' }),
      }),
    );
    await page.route('**/room', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          room: ROOM,
          member: 'm'.repeat(32),
          difficulty: 'easy',
          seats: 1,
          chunk: chunk(SEED, 'easy', 0),
        }),
      }),
    );
    await page.route(`**/room/${ROOM}/track/**`, (route) => {
      const from = Number(route.request().url().split('/').pop());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(chunk(SEED, 'easy', from)),
      });
    });
    await page.routeWebSocket(`**/room/${ROOM}/ws**`, (ws) => {
      // l'autre arrive tout de suite : deux places prises
      ws.send(JSON.stringify({ type: 'seats', seats: 2 }));
      ws.onMessage((message) => {
        const m = JSON.parse(String(message)) as { t: string; d: number };
        const trace = unpackTrace(Uint8Array.from(Buffer.from(m.t, 'base64')))!;
        expect(trace).not.toBeNull();
        // un morceau n'est pas une trace : sa première plage n'est pas au pas
        // zéro, l'entrée est tenue depuis le morceau d'avant. Ce que le salon
        // vérifie : des plages croissantes, dans la fenêtre, sur la grille.
        for (let i = 0; i < trace.from.length; i++) {
          expect(trace.from[i]!).toBeLessThan(trace.steps);
          if (i > 0) expect(trace.from[i]!).toBeGreaterThan(trace.from[i - 1]!);
          expect(Math.abs(trace.steer[i]!)).toBeLessThanOrEqual(1);
        }
        sent.push({ steps: trace.steps, d: m.d });
        // l'autre est trente mètres devant, au même pas
        ws.send(
          JSON.stringify({
            type: 'state',
            who: 'other',
            steps: sent.reduce((a, s) => a + s.steps, 0),
            dist: m.d + 30,
            lat: 0,
            hop: 0,
            yaw: 0,
            tier: 1,
            wrecked: false,
          }),
        );
      });
    });

    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    await page.locator('#btnDuel').click();
    // l'autre est là : le duel démarre sans attendre
    await expect.poll(() => game.mode(), { timeout: 15_000 }).toBe('run');
    // « duel » jusqu'au premier relais, puis l'écart au rival
    await expect(page.locator('#recline')).toHaveText(/^(duel|rival [+−]\d+ m)$/);

    // dix morceaux par seconde de jeu : après 720 pas, au moins neuf sont partis
    await page.waitForFunction(() => window.__gsNext.state().travel > 100, undefined, {
      timeout: 60_000,
    });
    await expect.poll(() => sent.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(9);
    for (const s of sent) expect(s.steps).toBeGreaterThanOrEqual(72);
    // et la distance déclarée suit le jeu, jamais nulle une fois parti
    expect(sent[sent.length - 1]!.d).toBeGreaterThan(0);

    // l'autre vaisseau : dessiné, trente mètres devant, à un lissage près
    await expect
      .poll(() => page.evaluate(() => window.__gsNext.ghost().visible), { timeout: 10_000 })
      .toBe(true);
    const gap = await page.evaluate(() => window.__gsNext.ghost().gap);
    expect(gap).toBeGreaterThan(15);
    expect(gap).toBeLessThan(60);
    await expect(page.locator('#recline')).toHaveText(/^rival \+\d+ m$/);
    expect(game.errors()).toEqual([]);
  });
});
