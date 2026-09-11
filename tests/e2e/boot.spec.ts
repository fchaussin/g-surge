/**
 * Recette du squelette du client.
 *
 * Volontairement étroite : le build doit démarrer, tenir un contexte WebGL
 * vivant, dimensionner correctement son canvas et prouver que le noyau de
 * simulation est bien piloté. Les écrans, le HUD et le rendu ont leurs propres
 * tests, dans les autres fichiers de cette suite.
 *
 * Tout ceci tourne contre `public/`, que le serveur de test construit d'abord.
 */
import { expect, test } from '@playwright/test';

function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Attend que le jeu soit vraiment prêt, pas seulement chargé.
 *
 * `window.__gsNext` apparaît à l'évaluation du module, bien avant que l'écran de
 * démarrage ait fini de compiler les shaders et de dessiner sa première frame.
 * Attendre dessus a laissé un test appeler `freeze` en plein démarrage, et la
 * frame d'échauffement qui a suivi a écrasé la frame figée — visible comme une
 * capture qui différait d'une quantité différente à chaque nouvel essai.
 *
 * `#boot.gone` est posé par `__gsReady`, que le client appelle en dernier.
 */
const ready = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.waitForSelector('#boot.gone', { timeout: 20_000 });
};

test.describe('new client, skeleton', () => {
  /**
   * L'écran de démarrage porte l'identité du build, écrite par un plugin Vite.
   *
   * Le plugin fait déjà échouer le build quand son marqueur disparaît, la même
   * garde que celle du service worker. Ce qu'elle ne peut pas attraper est un
   * remplacement qui tourne et produit la mauvaise chose, donc ceci vérifie la
   * forme sur la page servie plutôt que dans la source.
   *
   * La moitié commit est délibérément lâche : l'image de bout en bout n'a pas
   * de git, donc elle retombe sur DEV, et l'épingler n'épinglerait que le
   * conteneur.
   */
  test('shows the build it is, on the splash and in the menu', async ({ page }) => {
    await page.goto('/');
    const splash = (await page.locator('#boot .ver').textContent())?.trim() ?? '';
    const menu = (await page.locator('#menu .ver').textContent())?.trim() ?? '';

    expect(splash).toMatch(/^V\d+\.\d+\.\d+ \u00b7 \S+$/);
    // Le texte du marqueur non remplacé, qu'on ne doit jamais servir tel quel.
    expect(splash).not.toBe('DEV');
    // Les deux viennent du même remplacement et ne peuvent pas diverger.
    expect(menu).toBe(splash);
  });

  test('boots without errors, on a live context, pinned to r128', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await ready(page);

    const gl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!ctx) return null;
      const g = ctx as WebGLRenderingContext;
      return { lost: g.isContextLost(), w: g.drawingBufferWidth, h: g.drawingBufferHeight };
    });

    expect(gl).not.toBeNull();
    expect(gl!.lost).toBe(false);
    expect(gl!.w).toBeGreaterThan(0);
    // Le code dépend du comportement de r128 ; le bundle ne doit pas s'en écarter.
    expect(await page.evaluate(() => window.__gsNext.revision)).toBe('128');
    expect(errors).toEqual([]);
  });

  test('the canvas fills the window at any devicePixelRatio', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const m = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      return {
        cssW: r.width,
        cssH: r.height,
        bufW: c.width,
        bufH: c.height,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        dpr: window.devicePixelRatio,
      };
    });

    expect(Math.abs(m.cssW - m.innerW)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.cssH - m.innerH)).toBeLessThanOrEqual(1);
    const ratio = Math.min(m.dpr, 2);
    expect(Math.abs(m.bufW - m.innerW * ratio)).toBeLessThanOrEqual(ratio);
    expect(m.bufW).not.toBe(300);
  });

  /** Le même piège que l'ancien jeu : three.js pose des styles en ligne qui le cachent. */
  test('the canvas CSS rule stands without three.js inline styles', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const size = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      c.style.removeProperty('width');
      c.style.removeProperty('height');
      const r = c.getBoundingClientRect();
      return { w: r.width, h: r.height, innerW: window.innerWidth, innerH: window.innerHeight };
    });

    expect(Math.abs(size.w - size.innerW)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.h - size.innerH)).toBeLessThanOrEqual(1);
  });

  test('the simulation core is actually being driven, at the fixed step', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    expect(await page.evaluate(() => window.__gsNext.fixedStep())).toBeCloseTo(1 / 720, 12);

    const first = await page.evaluate(() => window.__gsNext.state().travel);

    // Le mode attract tient ~46 m/s en temps simulé. On attend que la
    // simulation ait avancé de 20 m, sans borner le temps mur que cela prend :
    // un runner CI partagé sous WebGL logiciel descend à ~7 images/s, et
    // l'anti-spirale MAX_FRAME borne alors l'avancée à 0,35 s simulée par
    // seconde réelle. Mesurer sur une seconde de mur testait la machine, pas
    // la boucle. Si des pas étaient réellement perdus, travel n'avancerait
    // jamais et le poll expirerait.
    await expect
      .poll(async () => (await page.evaluate(() => window.__gsNext.state().travel)) - first, {
        timeout: 15000,
      })
      .toBeGreaterThan(20);
  });

  test('the seed can be pinned from the URL', async ({ page }) => {
    await page.goto('/?seed=from-the-url');
    await ready(page);
    expect(await page.evaluate(() => window.__gsNext.seed())).toBe('from-the-url');

    await page.goto('/');
    await ready(page);
    expect(await page.evaluate(() => window.__gsNext.seed())).not.toBe('from-the-url');
  });
});

/**
 * Références visuelles plein cadre du client — canvas compris.
 *
 * L'ancienne suite ne pouvait pas le faire : une frame dépendait du moment où on
 * la prenait, parce que la simulation tournait sur le vrai delta de frame. Avec
 * un pas fixe et une graine, `freeze` rejoue un nombre connu de pas et dessine
 * exactement une frame, reproductible.
 *
 * Le scintillement des plumes est du bruit par frame sur `Math.random`, laissé
 * hors de la simulation à dessein ; le semer couplerait la présentation au
 * noyau pour rien. `freeze` cale donc les plumes avant de dessiner, ce qui est
 * ce qui a permis de descendre la tolérance à zéro.
 */
test.describe('new client, rendering', () => {
  for (const [name, steps] of [
    ['start', 60],
    ['underway', 2400],
    ['far', 9000],
  ] as const) {
    test(`renders the track ${name}`, async ({ page }, testInfo) => {
      // Ordinateur seulement. La scène 3D ne change pas de façon significative
      // avec la fenêtre, et trois jeux de références feraient 1,9 Mo de PNG dans
      // le dépôt pour rien. Le projet retina existe pour la géométrie du canvas,
      // pas pour l'aspect.
      test.skip(testInfo.project.name !== 'desktop', 'one set of scene references is enough');
      await page.goto('/');
      await ready(page);
      // L'interface est cachée plutôt que masquée : ces références portent sur
      // la scène, et le menu en couvre l'essentiel. L'interface a les siennes.
      //
      // `.boot` est dans cette liste pour une raison qui mérite d'être gardée.
      // L'écran de démarrage tenait autrefois 1 200 ms par conception pendant
      // que `ready()` se résolvait dès que le module tournait — donc sans le
      // cacher la capture faisait la course avec lui, et l'une de ces références
      // était en fait une capture de l'écran de chargement. Elle passait chaque
      // fois que le minutage se répétait.
      await page.evaluate(
        ([seed, n]) => {
          const hide = '.layer, .hud, .mutebtn, .fps, .boot';
          for (const el of document.querySelectorAll<HTMLElement>(hide)) el.style.display = 'none';
          window.__gsNext.freeze(seed as string, n as number);
        },
        ['reference', steps],
      );
      await expect(page).toHaveScreenshot(`scene-${name}.png`, {
        // Zéro, et ce n'est pas une posture : `freeze` cale les plumes, seule
        // pièce mobile. La première version de ce test tolérait 2 % — 18 000
        // pixels — assez lâche pour cacher une bannière ajoutée sur toute la
        // largeur ; la seconde 2 280, mesurés avec les plumes libres.
        maxDiffPixels: 0,
      });
    });
  }

  test('actually draws a scene rather than an empty frame', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __calls: number }).__calls = 0;
      for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const de = proto.drawElements;
        proto.drawElements = function (this: WebGLRenderingContext, ...a: Parameters<typeof de>) {
          (window as unknown as { __calls: number }).__calls++;
          return de.apply(this, a);
        };
      }
    });
    await page.goto('/');
    await ready(page);
    await page.evaluate(() => {
      (window as unknown as { __calls: number }).__calls = 0;
      window.__gsNext.freeze('reference', 600);
    });
    // Le jeu dessine environ 76 appels par frame. Près de zéro veut dire que la
    // scène est vide et que les captures compareraient deux frames noires.
    expect(
      await page.evaluate(() => (window as unknown as { __calls: number }).__calls),
    ).toBeGreaterThan(30);
  });
});
