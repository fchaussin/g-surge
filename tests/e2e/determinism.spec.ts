import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HZ, MAX_FRAME } from '../../src/sim/clock.js';
import { DEFAULTS, DIFF } from '../../src/sim/tuning.js';
import { Rng } from '../../src/sim/rng.js';
import { digest } from '../helpers/digest.js';
import { expect, test } from './fixtures.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const UPDATE = !!process.env.UPDATE_FIXTURES;

/**
 * Compare à une référence versionnée, ou l'écrit si elle manque.
 * Régénération volontaire : `npm run fixtures:update`.
 */
function matchFixture(name: string, value: unknown): void {
  const path = join(FIXTURES, `${name}.json`);
  const serialised = `${JSON.stringify(value, null, 2)}\n`;
  if (UPDATE || !existsSync(path)) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(path, serialised);
    return;
  }
  expect(JSON.parse(serialised)).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

test.describe('déterminisme de la simulation', () => {
  /**
   * Le test qui porte tout le reste.
   *
   * `makeRng` dans public/engine.js et `Rng` dans src/sim/rng.ts sont deux
   * écritures du même sfc32. Elles doivent produire une séquence identique,
   * sinon l'extraction du noyau en TypeScript changerait la piste sans que rien
   * ne le signale. Ce test est ce qui autorise l'étape 3.
   */
  test('le PRNG du jeu et celui de src/sim produisent la même séquence', async ({ game, page }) => {
    await game.boot();

    const cases = [
      { seed: 'g-surge', stream: 'track' },
      { seed: 'g-surge', stream: 'items' },
      { seed: 'trace', stream: 'track' },
      { seed: '0', stream: 'dust' },
      { seed: 'accentué — ✓', stream: 'track' },
    ];

    for (const { seed, stream } of cases) {
      const fromBrowser = await page.evaluate(
        ([s, st]) => {
          const rng = window.__gs.makeRng(s as string, st as string);
          return Array.from({ length: 300 }, () => rng.next());
        },
        [seed, stream],
      );

      const node = Rng.fromSeed(seed, stream);
      const fromNode = Array.from({ length: 300 }, () => node.next());

      expect(fromBrowser, `graine ${seed}, flux ${stream}`).toEqual(fromNode);
    }
  });

  /**
   * Soixante-dix constantes recopiées à la main dans src/sim/tuning.ts. Une
   * seule erreur de transcription déplacerait la simulation en silence, et
   * aucune trace figée ne dirait pourquoi. On compare donc les deux tables.
   */
  test('le réglage de src/sim est celui du jeu, valeur par valeur', async ({ game, page }) => {
    await game.boot();

    expect(await page.evaluate(() => window.__gs.defaults())).toEqual(DEFAULTS);

    const browserDiff = await page.evaluate(() => window.__gs.diff());
    expect(Object.keys(browserDiff).sort()).toEqual(Object.keys(DIFF).sort());
    for (const [name, def] of Object.entries(browserDiff)) {
      const mine = DIFF[name as keyof typeof DIFF];
      expect(def.mul, `coefficient de score, ${name}`).toBe(mine.mul);
      expect(def.set, `surcharges, ${name}`).toEqual(mine.set);
    }
  });

  test('le pas de simulation du jeu est celui de src/sim/clock.ts', async ({ game, page }) => {
    await game.boot();
    const clock = await page.evaluate(() => window.__gs.clock());
    expect(clock.hz).toBe(HZ);
    expect(clock.maxFrame).toBe(MAX_FRAME);
    expect(clock.dt).toBeCloseTo(1 / HZ, 15);

    // 720 divise les cadences d'écran courantes : c'est ce qui permet de rendre
    // sans interpoler, une image tombant toujours sur un état exact.
    for (const refresh of [30, 60, 72, 90, 120, 144, 240]) {
      expect(clock.hz % refresh, `${refresh} Hz`).toBe(0);
    }
  });

  test('les helpers dérivés concordent aussi', async ({ game, page }) => {
    await game.boot();

    const fromBrowser = await page.evaluate(() => {
      const rng = window.__gs.makeRng('helpers', 'track');
      return {
        chance: Array.from({ length: 50 }, () => rng.chance(0.3)),
        sign: Array.from({ length: 50 }, () => rng.sign()),
        range: Array.from({ length: 50 }, () => rng.range(0.35, 1)),
        int: Array.from({ length: 50 }, () => rng.int(26)),
        centered: Array.from({ length: 50 }, () => rng.centered(11.5)),
      };
    });

    const rng = Rng.fromSeed('helpers', 'track');
    expect(fromBrowser).toEqual({
      chance: Array.from({ length: 50 }, () => rng.chance(0.3)),
      sign: Array.from({ length: 50 }, () => rng.sign()),
      range: Array.from({ length: 50 }, () => rng.range(0.35, 1)),
      int: Array.from({ length: 50 }, () => rng.int(26)),
      centered: Array.from({ length: 50 }, () => rng.centered(11.5)),
    });
  });

  /**
   * Les nœuds sont lus dans le même bloc synchrone que la remise à zéro.
   *
   * En mode menu le jeu tourne en attract, donc `pushNode()` continue d'avancer
   * le tampon circulaire entre le chargement de la page et la lecture. Deux
   * lectures espacées d'un nombre de trames différent divergent sur les
   * derniers nœuds alors que la génération, elle, est bien déterministe. Une
   * première version de ce test échouait exactement ainsi.
   */
  const freshTrack = (page: import('@playwright/test').Page, seed: string) =>
    page.evaluate((s) => {
      window.__gs.trace({ seed: s, steps: 0 });
      return { seed: window.__gs.seed(), nodes: window.__gs.nodes(), items: window.__gs.items() };
    }, seed);

  test('une même graine régénère la même piste, deux graines diffèrent', async ({ game, page }) => {
    await game.boot();

    const alpha = await freshTrack(page, 'alpha');
    expect(await freshTrack(page, 'alpha')).toEqual(alpha);
    expect(await freshTrack(page, 'beta')).not.toEqual(alpha);
  });

  test('la graine se laisse épingler par l\'URL', async ({ game, page }) => {
    await game.boot('/?seed=depuis-l-url');
    expect(await page.evaluate(() => window.__gs.seed())).toBe('depuis-l-url');

    await game.boot();
    expect(await page.evaluate(() => window.__gs.seed())).not.toBe('depuis-l-url');
  });

  test('sans graine épinglée, deux chargements donnent des pistes différentes', async ({
    game,
    page,
  }) => {
    await game.boot();
    const first = await page.evaluate(() => ({ seed: window.__gs.seed(), nodes: window.__gs.nodes() }));
    await game.boot();
    const second = await page.evaluate(() => ({ seed: window.__gs.seed(), nodes: window.__gs.nodes() }));

    expect(second.seed).not.toBe(first.seed);
    expect(second.nodes).not.toEqual(first.nodes);
  });

  /**
   * Soixante graines, pas une seule.
   *
   * Un échantillon unique de 130 nœuds ne suffit pas à figer le générateur :
   * une branche n'est atteinte qu'environ six fois par piste, si bien que
   * changer une probabilité de 0,20 à 0,21 — une issue sur cent — passait
   * inaperçue. Soixante pistes portent le nombre de tirages à quelques
   * centaines et ramènent la probabilité de rater un tel écart sous les 3 %.
   *
   * Seules les empreintes sont versionnées, plus une piste complète pour
   * pouvoir enquêter quand l'une d'elles bouge.
   */
  test('la génération de piste est figée par une référence', async ({ game, page }) => {
    await game.boot();

    const seeds = Array.from({ length: 60 }, (_, i) => `ref-${i}`);
    const checksums: Record<string, string> = {};
    for (const seed of seeds) {
      const track = await freshTrack(page, seed);
      checksums[seed] = digest(track);
    }

    matchFixture('track-checksums', checksums);
    matchFixture('track-reference', await freshTrack(page, 'reference'));
  });

  /**
   * La géométrie du ruban, figée avant d'être portée dans le noyau.
   *
   * `buildPath` et `sample` sont des fonctions pures des tampons de piste :
   * elles descendent dans `src/sim/` à l'étape 2 de la feuille de route, et
   * cette référence est ce qui prouvera que le déplacement n'a rien changé.
   * Plusieurs curseurs, dont un juste avant la poussée d'un nœud.
   */
  test('la géométrie du ruban est figée par une référence', async ({ game, page }) => {
    await game.boot();

    const geometry = await page.evaluate(() => {
      window.__gs.trace({ seed: 'geometry', steps: 0 });
      return [0, 0.37, 4.5, 11.9].map((cursor) => window.__gs.path(cursor));
    });
    matchFixture('track-geometry', geometry);
  });

  test('une trace rejouée deux fois est identique', async ({ game, page }) => {
    await game.boot();

    const run = () =>
      page.evaluate(() =>
        window.__gs.trace({
          seed: 'rejeu',
          steps: 900,
          script: [
            { from: 0, steer: 0, brake: false, boost: false },
            { from: 200, steer: 0.8, brake: false, boost: true },
            { from: 450, steer: -1, brake: false, boost: true },
            { from: 700, steer: 0.2, brake: true, boost: false },
          ],
        }),
      );

    expect(await run()).toEqual(await run());
  });

  test('la physique est figée par une référence', async ({ game, page }) => {
    await game.boot();

    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const trace = await page.evaluate(
        (d) =>
          window.__gs.trace({
            seed: 'reference',
            diff: d,
            steps: 1800,
            every: 120,
            // Pilotage volontairement doux : il s'agit d'exercer accélération,
            // boost, dérive, sauts et ramassage sur une longue distance, pas de
            // planter le vaisseau au premier virage. Un script à plein braquage
            // faisait l'épave au pas 1100 et ne figeait presque rien.
            script: [
              { from: 0, steer: 0, brake: false, boost: false },
              { from: 240, steer: 0.18, brake: false, boost: true },
              { from: 600, steer: -0.22, brake: false, boost: true },
              { from: 900, steer: 0.1, brake: false, boost: false },
              { from: 1200, steer: -0.12, brake: true, boost: false },
              { from: 1500, steer: 0.06, brake: false, boost: true },
            ],
          }),
        diff,
      );
      matchFixture(`physics-${diff}`, trace);
    }
  });
});
