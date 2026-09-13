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
    let finishedAt = 0;
    await page.routeWebSocket(`**/room/${ROOM}/ws**`, (ws) => {
      // l'autre arrive tout de suite : deux places prises, et le départ — un
      // décompte d'une seconde, une ligne à 400 m pour que le test finisse
      ws.send(JSON.stringify({ type: 'seats', seats: 2 }));
      ws.send(JSON.stringify({ type: 'start', countdown: 1, race: 400 }));
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
        // la ligne passée par le joueur : le salon juge, l'autre est épave
        if (m.d >= 400 && !finishedAt) {
          finishedAt = sent.reduce((a, s) => a + s.steps, 0);
          ws.send(
            JSON.stringify({
              type: 'result',
              race: 400,
              ranking: [
                {
                  who: 'm'.repeat(32),
                  name: 'Ada L',
                  finished: true,
                  steps: finishedAt,
                  dist: m.d,
                },
                { who: 'other', name: 'Bob B', finished: false, steps: 900, dist: 120 },
              ],
            }),
          );
          return;
        }
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
    await page.locator('#btnNameSkip').click();
    await page.locator('#btnDuel').click();
    // le départ vient du salon, après son décompte
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

    // la ligne à 400 m : la partie s'arrête d'elle-même, le reste de la trace
    // part, et le classement du salon s'affiche — gagné, l'autre est épave
    await page.waitForFunction(() => window.__gsNext.state().dist >= 400, undefined, {
      timeout: 60_000,
    });
    await expect.poll(() => game.mode(), { timeout: 10_000 }).toBe('duel');
    await expect(page.locator('#duelLine')).toContainText('YOU WON', { timeout: 10_000 });
    await expect(page.locator('#duelLine')).toContainText('Bob B — wrecked at 0.1 km');
    expect(finishedAt).toBeGreaterThan(0);
    expect(game.errors()).toEqual([]);
  });

  /** Le lien collé — entier ou son seul code — rejoint le salon ; et le QR est dessiné. */
  test('joins from a pasted link, and draws the invite as a QR code', async ({ game, page }) => {
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
    let joined = '';
    await page.route('**/room/*/join', (route) => {
      joined = route.request().url();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          member: 'j'.repeat(32),
          difficulty: 'easy',
          seats: 2,
          chunk: chunk(SEED, 'easy', 0),
        }),
      });
    });
    await page.routeWebSocket('**/room/**/ws**', () => undefined);

    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    await page.locator('#btnNameSkip').click();
    await page.locator('#btnDuel').click();
    await expect(page.locator('#inviteLink')).toHaveValue(new RegExp(`#duel=${ROOM}$`));
    // le QR : dessiné, un module noir au cœur du repère haut-gauche, après la zone calme
    const dark = await page.locator('#inviteQr').evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const px = canvas.width / (21 + 8); // au moins la version 1, plus la zone calme
      const p = ctx.getImageData(Math.round(px * 7.5), Math.round(px * 7.5), 1, 1).data;
      return p[0]! < 128;
    });
    expect(dark).toBe(true);

    // coller le code seul suffit
    await page.locator('#inviteInput').fill('fedcba9876543210');
    await page.locator('#btnJoinInvite').click();
    await expect.poll(() => joined).toContain('/room/fedcba9876543210/join');
    expect(game.errors()).toEqual([]);
  });
});
