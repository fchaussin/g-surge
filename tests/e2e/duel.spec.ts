/**
 * Le duel, côté navigateur. Le salon est le test : `page.route` sert
 * l'ouverture et la piste, et `page.routeWebSocket` tient la prise — il lit
 * ce que le jeu envoie et lui renvoie l'état d'un autre vaisseau. Ce qui est
 * prouvé est la moitié client de M7 : les morceaux partent à la cadence du
 * temps simulé sous une forme que le serveur décode, et l'autre se dessine.
 */
import { expect, mockFriends, signIn, test } from './fixtures.js';
import { unpackTrace } from '../../src/sim/index.js';
import { chunk } from '../../server/src/track.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ROOM = 'K7M2PQ';
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
    await mockFriends(page);
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
      ws.send(
        JSON.stringify({
          type: 'seats',
          seats: 2,
          rivals: [{ name: 'Bob B', face: '0123456789abcdef' }],
        }),
      );
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
    // le salon ne s'ouvre plus en ouvrant l'écran : c'est ce bouton qui l'ouvre
    await page.locator('#btnMakeLink').click();
    // l'autre entre : la grille de départ, avec son nom et son visage
    await expect.poll(() => game.mode(), { timeout: 15_000 }).toBe('grid');
    await expect(page.locator('#gridWho')).toHaveText('Bob B');
    await expect(page.locator('#gridFace svg')).toBeVisible();
    // puis le départ, après le décompte du salon
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
    // la carte de la partie qu'on vient de jouer, et le verdict du salon sous
    // le score — pas un retour sur l'écran d'appairage
    await expect.poll(() => game.mode(), { timeout: 10_000 }).toBe('over');
    await expect(page.locator('#overNote')).toContainText('YOU WON', { timeout: 10_000 });
    await expect(page.locator('#overNote')).toContainText('Bob B wrecked at 0.1 km');
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
    await mockFriends(page);
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
          // qui invite : le salon le donne à celui qui arrive
          rivals: [{ name: 'Ada L', face: '0123456789abcdef' }],
          chunk: chunk(SEED, 'easy', 0),
        }),
      });
    });
    await page.routeWebSocket('**/room/**/ws**', () => undefined);

    await page.goto('/#session=' + TOKEN);
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });
    await page.locator('#btnNameSkip').click();
    await page.locator('#btnDuel').click();
    await page.locator('#btnMakeLink').click();
    await expect(page.locator('#inviteLink')).toHaveValue(new RegExp(`#duel=${ROOM}$`));
    // le QR : dessiné, mesuré à sa part de noir — elle ne dépend pas de la
    // version du code, alors qu'un pixel précis en dépend, et le code de salon
    // vient de raccourcir
    const dark = await page.locator('#inviteQr').evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let black = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) black++;
      return black / (data.length / 4);
    });
    expect(dark).toBeGreaterThan(0.15);
    expect(dark).toBeLessThan(0.7);

    // coller le code seul suffit
    await page.locator('#inviteInput').fill('W8ZK3N');
    await page.locator('#btnJoinInvite').click();
    await expect.poll(() => joined).toContain('/room/W8ZK3N/join');
    expect(game.errors()).toEqual([]);
  });

  /**
   * Arriver par le lien du QR, ce que rien ne couvrait. Le salon est rejoint,
   * l'adresse est ramenée à la racine — le fragment ne se garde pas — et le
   * bloc de partage reste masqué : celui qui arrive n'a rien à partager, et il
   * voyait un champ vide, deux boutons inertes et le trou d'un QR jamais
   * dessiné, soit la moitié de l'écran d'un téléphone.
   */
  test('joins from the invite link itself, with nothing to share', async ({ game, page }) => {
    await signIn(page);
    let joined = '';
    await page.route('**/room/*/join', (route) => {
      joined = route.request().url();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          member: 'j'.repeat(32),
          difficulty: 'easy',
          seats: 2,
          // qui invite : le salon le donne à celui qui arrive
          rivals: [
            {
              name: 'Ada L',
              face: '0123456789abcdef',
              code: 'ADA234',
              pic: 'https://lh3.googleusercontent.com/a/ACg8ocKtest=s96-c',
            },
          ],
          chunk: chunk(SEED, 'easy', 0),
        }),
      });
    });
    await page.routeWebSocket('**/room/**/ws**', () => undefined);
    // un pixel transparent à la place de la photo : la suite ne sort pas du
    // conteneur, et une image qui ne charge pas prouverait le repli, pas l'échange
    await page.route('**/lh3.googleusercontent.com/**', (route) =>
      route.fulfill({
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
      }),
    );

    await game.boot('/#duel=' + ROOM);
    await expect.poll(() => joined).toContain(`/room/${ROOM}/join`);
    // la grille de départ, pas l'écran de partage : celui qui arrive par le
    // lien n'a rien à partager, il attend le départ
    await expect.poll(() => game.mode()).toBe('grid');
    await expect(page.locator('#gridWho')).toHaveText('Ada L');
    await expect(page.locator('#gridLine')).toContainText('invites you to race');
    // la photo du fournisseur remplace les pixels une fois chargée, et rien
    // n'est demandé à Google : le test la sert lui-même
    await expect(page.locator('#gridFace img.photo')).toBeVisible();
    // Et de quoi le garder : on vient de se rencontrer, le salon porte son code
    let asked = '';
    await page.route('**/friends/add', (route) => {
      asked = route.request().postData() ?? '';
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    await expect(page.locator('#btnAddRival')).toBeVisible();
    await page.locator('#btnAddRival').click();
    await expect.poll(() => asked).toContain('ADA234');
    await expect(page.locator('#gridLine')).toContainText('Friend request sent to Ada L');
    await expect(page.locator('#btnAddRival')).toBeHidden();
    expect(new URL(page.url()).hash).toBe('');
    expect(game.errors()).toEqual([]);
  });

  /**
   * Défier un ami : aucun lien ne circule. L'écran de duel montre la liste, le
   * bouton ouvre un salon côté serveur, et on atterrit sur la grille — c'est ce
   * que « sans échange de lien, directement dans l'app » veut dire.
   */
  test('challenges a friend from the list, with no link at all', async ({ game, page }) => {
    await signIn(page);
    await mockFriends(page, {
      friends: [{ name: 'Bob F', face: '0123456789abcdef', code: 'BOB234' }],
      invites: [
        {
          id: 1,
          from: { name: 'Cid F', face: 'fedcba9876543210', code: 'CID234' },
          room: 'R4TV9X',
          difficulty: 'easy',
        },
      ],
    });
    let challenged = '';
    await page.route('**/friends/challenge', (route) => {
      challenged = route.request().postData() ?? '';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          room: ROOM,
          member: 'm'.repeat(32),
          difficulty: 'easy',
          seats: 1,
          chunk: chunk(SEED, 'easy', 0),
        }),
      });
    });
    await page.routeWebSocket('**/room/**/ws**', () => undefined);

    await game.boot();
    await page.locator('#btnDuel').click();
    // ce que l'écran montre d'abord : qui me défie, puis qui je peux défier
    await expect(page.locator('#duelFriends')).toContainText('CHALLENGING YOU');
    await expect(page.locator('#duelFriends')).toContainText('Cid F');
    await expect(page.locator('#duelFriends')).toContainText('Bob F');
    await expect(page.locator('#duelFriends .mycode')).toContainText('ABC234');

    await page.locator('button[data-race="BOB234"]').click();
    await expect.poll(() => challenged).toContain('BOB234');
    // la grille de départ, avec le nom de celui qu'on vient de défier
    await expect.poll(() => game.mode()).toBe('grid');
    await expect(page.locator('#gridWho')).toHaveText('Bob F');
    expect(game.errors()).toEqual([]);
  });

  /**
   * Le QR d'amitié. Six caractères se dictent mais ne se tapent pas : le lien
   * porte le code, l'autre le scanne, la demande part sans qu'il saisisse quoi
   * que ce soit. L'acceptation reste de son côté — c'est elle qui protège.
   */
  test('offers the friend code as a QR, and adds from a scanned link', async ({ game, page }) => {
    await signIn(page);
    await mockFriends(page, { code: 'ABC234' });
    let asked = '';
    await page.route('**/friends/add', (route) => {
      asked = route.request().postData() ?? '';
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });

    // Mon code, et son QR : un module noir au cœur du repère haut-gauche
    await game.boot();
    await page.locator('#btnDuel').click();
    await expect(page.locator('#duelFriends .mycode')).toContainText('ABC234');
    await expect(page.locator('#friendQr')).toBeVisible();
    // La part de noir plutôt qu'un pixel précis : elle ne dépend pas de la
    // version du code, donc le test ne casse pas si l'adresse s'allonge.
    const dark = await page.locator('#friendQr').evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let black = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) black++;
      return black / (data.length / 4);
    });
    expect(dark).toBeGreaterThan(0.15);
    expect(dark).toBeLessThan(0.7);

    // Le lien scanné sur l'écran d'en face : la demande part, sans saisie
    await page.goto('about:blank');
    await game.boot('/#friend=XYZ789');
    await expect.poll(() => asked).toContain('XYZ789');
    expect(await game.mode()).toBe('duel');
    expect(new URL(page.url()).hash).toBe('');
    expect(game.errors()).toEqual([]);
  });

  /**
   * L'invité qui n'a pas de compte. Le fragment du lien ne survit pas à
   * l'aller-retour chez le fournisseur — le retour se fait sur l'origine seule
   * — donc le salon est mis de côté dans le stockage de l'onglet, et repris
   * une fois le pseudo passé. Sans ça, l'invitation était perdue et il fallait
   * rescanner le QR.
   */
  test('keeps the invite across a sign-in', async ({ game, page }) => {
    let joined = '';
    await page.route('**/room/*/join', (route) => {
      joined = route.request().url();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          member: 'j'.repeat(32),
          difficulty: 'easy',
          seats: 2,
          // qui invite : le salon le donne à celui qui arrive
          rivals: [{ name: 'Ada L', face: '0123456789abcdef' }],
          chunk: chunk(SEED, 'easy', 0),
        }),
      });
    });
    await page.routeWebSocket('**/room/**/ws**', () => undefined);
    await page.route('**/me', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id: 3, name: 'Ada L' }),
      }),
    );

    // sans compte : rien n'est rejoint, et l'écran offre de se connecter
    await game.boot('/#duel=' + ROOM);
    expect(await game.mode()).toBe('duel');
    await expect(page.locator('#btnDuelSignIn')).toBeVisible();
    expect(joined).toBe('');
    expect(await page.evaluate(() => sessionStorage.getItem('gsurge.duel.pending'))).toBe(ROOM);

    // le retour de chez le fournisseur : le jeton dans le fragment, l'écran du
    // pseudo, et le salon repris à sa sortie
    // Quitter l'origine puis y revenir, comme le fait l'aller-retour chez le
    // fournisseur : sans ça, `goto` ne change que le fragment, le document
    // n'est pas rechargé et rien de ce qui suit ne se produit. La marque de
    // départ est posée après, `about:blank` n'ayant pas de stockage à écrire.
    await page.goto('about:blank');
    await page.addInitScript(() => sessionStorage.setItem('gsurge.signin', '1'));
    await game.boot('/#session=' + TOKEN);
    await page.locator('#btnNameSkip').click();
    await expect.poll(() => joined).toContain(`/room/${ROOM}/join`);
    // et l'invitation aboutit là où elle doit : sur la grille de départ
    await expect.poll(() => game.mode()).toBe('grid');
    expect(await page.evaluate(() => sessionStorage.getItem('gsurge.duel.pending'))).toBeNull();
    expect(game.errors()).toEqual([]);
  });
});
