import { test as base, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** L'URL exacte du tag <script> de index.html et de la liste ASSETS de sw.js. */
const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

export interface GameHarness {
  /** Charge la page et attend la fin de l'écran de démarrage. */
  boot(path?: string): Promise<void>;
  /** Erreurs console et exceptions non rattrapées observées depuis le chargement. */
  errors(): string[];
  /** Déduit le mode courant (`menu`, `run`, `pause`, ...) de l'état du DOM. */
  mode(): Promise<string>;
}

/**
 * `mode` est un `let` de haut niveau dans un script classique : il n'existe pas
 * sur `window` et n'est donc pas lisible depuis un test. On le relit là où
 * `setMode` l'écrit, c'est-à-dire dans les classes des calques — ce qui a
 * l'avantage de vérifier au passage que setMode a bien été appelé, et pas
 * seulement que la variable a changé.
 */
async function readMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const layers = ['menu', 'pause', 'over', 'help', 'fpsinfo', 'settings'];
    for (const id of layers) {
      if (document.getElementById(id)?.classList.contains('on')) return id;
    }
    if (document.getElementById('hud')?.classList.contains('on')) return 'run';
    return 'unknown';
  });
}

export const test = base.extend<{ game: GameHarness; page: Page }>({
  page: async ({ page }, use) => {
    // three.js est servi depuis cdnjs en production. Le rejouer depuis une copie
    // locale rend la suite exécutable hors ligne et fige la version : un test qui
    // échoue le jour où le CDN bouge ne dit rien sur le jeu.
    await page.route(THREE_CDN, (route) =>
      route.fulfill({
        path: join(HERE, 'vendor', 'three.r128.min.js'),
        contentType: 'text/javascript; charset=utf-8',
      }),
    );
    await use(page);
  },

  game: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await use({
      async boot(path = '/') {
        await page.goto(path);
        // L'écran de démarrage se retire au bout de 2 s minimum, par
        // construction : c'est __gsReady qui pose la classe.
        await expect(page.locator('#boot')).toHaveClass(/gone/, { timeout: 15_000 });
      },
      errors: () => errors.slice(),
      mode: () => readMode(page),
    });
  },
});

export { expect };
