/**
 * Le bundle livré joue comme la source.
 *
 * Ce test a remplacé un jeu qui comparait deux implémentations l'une à l'autre,
 * du temps où l'ancien jeu et `src/sim/` existaient tous deux. Il n'en reste
 * qu'une, donc ce qui reste à prouver est différent et vaut encore la peine :
 * que rien entre le TypeScript et le fichier déployé — la transpilation, le
 * minifieur, le graphe de modules, la cible `es2020` — n'a déplacé un nombre.
 *
 * Les références figées de `fixtures/` restent le contrat. `tests/sim-parity`
 * les rejoue contre la source dans Node ; ceci les rejoue contre le bundle
 * compilé dans un navigateur.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { coreDigest } from '../../scripts/core-digest.mjs';
import { DEFAULTS, HZ, outcomeOf, replay, type SimState, type Trace } from '../../src/sim/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

/** Le même script que celui avec lequel les références ont été capturées. */
const REFERENCE_SCRIPT = [
  { from: 0, steer: 0, brake: false, boost: false },
  { from: 240, steer: 0.18, brake: false, boost: true },
  { from: 600, steer: -0.22, brake: false, boost: true },
  { from: 900, steer: 0.1, brake: false, boost: false },
  { from: 1200, steer: -0.12, brake: true, boost: false },
  { from: 1500, steer: 0.06, brake: false, boost: true },
];

/** `#boot.gone` est le vrai signal de prêt ; voir la note dans boot.spec.ts. */
const ready = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.waitForSelector('#boot.gone', { timeout: 20_000 });
};

test.describe('the shipped bundle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ready(page);
  });

  test('carries the tuning table unchanged', async ({ page }) => {
    expect(await page.evaluate(() => window.__gsNext.defaults())).toEqual(DEFAULTS);
  });

  test('runs at the fixed step', async ({ page }) => {
    const clock = await page.evaluate(() => window.__gsNext.clock());
    expect(clock.hz).toBeCloseTo(HZ, 6);
    // 720 divise les cadences de rafraîchissement courantes, ce qui permet au
    // rendu de se passer entièrement d'interpolation.
    for (const refresh of [30, 60, 72, 90, 120, 144, 240]) {
      expect(Math.round(clock.hz) % refresh, `${refresh} Hz`).toBe(0);
    }
  });

  test('regenerates the reference track from its seed', async ({ page }) => {
    const expected = load('track-reference') as { nodes: unknown; items: unknown };
    const got = await page.evaluate(() => {
      window.__gsNext.trace({ seed: 'reference', steps: 0 });
      return { nodes: window.__gsNext.nodes(), items: window.__gsNext.items() };
    });
    expect(got.nodes).toEqual(expected.nodes);
    expect(got.items).toEqual(expected.items);
  });

  for (const diff of ['easy', 'medium', 'hard'] as const) {
    test(`replays the ${diff} physics reference`, async ({ page }) => {
      const expected = load(`physics-${diff}`);
      const got = await page.evaluate(
        ([d, script]) =>
          window.__gsNext.trace({
            seed: 'reference',
            diff: d as 'easy' | 'medium' | 'hard',
            steps: 1800,
            // Les références ont été capturées à 1/120, avant que la boucle se
            // fixe sur un pas de 720 Hz. Elles épinglent ce que `step()` fait
            // pour un dt donné, la partie qui doit rester immobile ; la cadence
            // à laquelle la boucle l'appelle est une décision à part.
            dt: 1 / 120,
            every: 120,
            script: script as Array<{
              from: number;
              steer: number;
              brake: boolean;
              boost: boolean;
            }>,
          }),
        [diff, REFERENCE_SCRIPT] as const,
      );
      expect(got).toEqual(expected);
    });
  }

  test('is stamped with the digest of the core it was built from', async ({ page }) => {
    expect(await page.evaluate(() => window.__gsNext.core)).toBe(coreDigest());
  });

  /**
   * La preuve de bout en bout du rejeu : une partie jouée dans Chromium, sa
   * trace relevée telle que le client l'enverrait, rejouée ici dans Node par
   * `replay()` — la même issue au bit près. C'est ce qu'un serveur ferait.
   */
  for (const diff of ['easy', 'medium', 'hard'] as const) {
    test(`records a ${diff} run that Node replays to the same outcome`, async ({ page }) => {
      const got = await page.evaluate(
        ([d, script]) => {
          const out = window.__gsNext.trace({
            seed: 'recorded',
            diff: d as 'easy' | 'medium' | 'hard',
            steps: 7200,
            script: script as Array<{
              from: number;
              steer: number;
              brake: boolean;
              boost: boolean;
            }>,
          }) as { ran: number };
          return { ran: out.ran, trace: window.__gsNext.record(), state: window.__gsNext.state() };
        },
        [diff, REFERENCE_SCRIPT] as const,
      );
      const trace = got.trace as Trace;
      expect(trace.steps).toBe(got.ran);
      expect(trace.from.length).toBe(REFERENCE_SCRIPT.length);
      expect(replay(trace)).toEqual(outcomeOf(got.state as SimState, got.ran));
    });
  }

  test('draws a different track for a different seed', async ({ page }) => {
    const [alpha, beta] = await page.evaluate(() => {
      window.__gsNext.trace({ seed: 'alpha', steps: 0 });
      const a = window.__gsNext.nodes();
      window.__gsNext.trace({ seed: 'beta', steps: 0 });
      return [a, window.__gsNext.nodes()];
    });
    expect(beta).not.toEqual(alpha);
  });
});
