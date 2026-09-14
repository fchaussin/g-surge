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
    const layers = [
      'signin',
      'name',
      'menu',
      'pause',
      'over',
      'help',
      'settings',
      'board',
      'quit',
      'duel',
      'grid',
    ];
    for (const id of layers) {
      if (document.getElementById(id)?.classList.contains('on')) return id;
    }
    const hud = document.getElementById('hud');
    // Le HUD est allumé dans les deux modes où une simulation avance ; la
    // classe `watch` est ce qui les sépare.
    if (hud?.classList.contains('on')) return hud.classList.contains('watch') ? 'watch' : 'run';
    return 'unknown';
  });
}

/**
 * Un pilote déjà connecté sur cet appareil : le jeton rangé là où la session
 * le range, et `/me` répondu. À poser avant le chargement, et exigé par tout
 * écran que le menu ne montre qu'avec un compte — le tableau de la semaine et
 * le duel.
 */
export async function signIn(page: Page, name = 'Ada L'): Promise<void> {
  // Gardé : ce script tourne sur chaque document, `about:blank` compris — où
  // le stockage jette, et où l'exception compterait comme une erreur de page
  // pour le test qui passe par là pour simuler un aller-retour hors du site.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('gsurge.session.v1', t);
    } catch {
      /* about:blank */
    }
  }, 'abcdefghijklmnopqrstuvwxyz0123456789');
  await page.route('**/me', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 3, name }) }),
  );
  await mockFriends(page);
}

/**
 * La liste d'amis, servie. L'écran de duel la demande à chaque ouverture :
 * sans cette route, un test qui ouvre l'écran voit une erreur réseau.
 */
export async function mockFriends(
  page: Page,
  list: Partial<{
    code: string;
    friends: unknown[];
    requests: unknown[];
    invites: unknown[];
  }> = {},
): Promise<void> {
  await page.route('**/friends', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'ABC234',
        friends: [],
        requests: [],
        invites: [],
        ...list,
      }),
    }),
  );
}

export const test = base.extend<{ game: GameHarness; page: Page }>({
  page: async ({ page }, use) => {
    // La porte « qui vole ? » ne se représente pas dans un onglet qui l'a
    // vue : le harnais l'a vue, sauf le test qui la teste et qui retire la
    // marque dans son propre script d'initialisation, exécuté après celui-ci.
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('gsurge.gate'))
          sessionStorage.setItem('gsurge.gate', 'offline');
      } catch {
        /* sans stockage de session, la porte se montrera */
      }
    });
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
