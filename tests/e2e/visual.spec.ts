import { expect, test } from './fixtures.js';

/**
 * Référence visuelle des écrans d'interface.
 *
 * Le rendu 3D est écarté : en mode menu le jeu tourne en attract sur une piste
 * tirée au hasard, donc l'image de fond change à chaque exécution. Ce qui est
 * figé ici, c'est la mise en page — la partie qui casse silencieusement quand
 * une règle CSS bouge, et que personne ne revoit avant de déployer.
 *
 * On l'écarte en cachant le canvas, pas avec l'option `mask` de Playwright :
 * le canvas est en `position:fixed; inset:0`, son rectangle couvre donc la
 * fenêtre entière et un masque repeindrait tout l'écran d'un aplat uniforme.
 * Une première version de ce fichier faisait exactement cela et produisait huit
 * références rigoureusement identiques, insensibles à n'importe quel changement.
 *
 * `visibility:hidden` plutôt que `display:none` : la mise en page environnante
 * reste inchangée, et les `backdrop-filter` des voiles composent alors sur le
 * fond uni du body, ce qui est reproductible.
 *
 * Une référence pixel du rendu 3D lui-même deviendra possible quand la
 * simulation sera déterministe : il suffira de fixer la graine et de ne plus
 * cacher le canvas. Voir docs/ROADMAP.md.
 */
test.describe('rendu des écrans', () => {
  test.beforeEach(async ({ game, page }) => {
    await game.boot();

    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (canvas) canvas.style.visibility = 'hidden';

      // Deux zones bougent indépendamment de la mise en page : le compteur de
      // cadence, et l'indice de rafraîchissement qui passe de « detecting… » à
      // une valeur mesurée. On les fige plutôt que de les masquer, pour garder
      // leur encombrement réel dans l'image.
      const fps = document.getElementById('fpsVal');
      if (fps) fps.textContent = '60';

      // Et la version du build, qui porte le commit : sans cela la référence
      // du menu contiendrait un hash, donc elle casserait à chaque commit —
      // une référence qu'il faut régénérer sans arrêt finit par ne plus rien
      // protéger. Figée plutôt que masquée, pour la même raison que le
      // compteur d'images : son encombrement reste dans l'image, et il est
      // constant puisque le gabarit l'est.
      const ver = document.querySelector('#menu .ver');
      if (ver) ver.textContent = 'V0.0.0 · 0000000';
      // La cible de cadence et son groupe de boutons ont été retirés : le jeu
      // rend au rythme de l'écran, il n'y a plus rien à figer ici.
    });
  });

  test('menu', async ({ page }) => {
    await expect(page).toHaveScreenshot('menu.png');
  });

  test('aide', async ({ page }) => {
    await page.locator('#btnHelp').click();
    await expect(page.locator('#help')).toHaveClass(/on/);
    await expect(page).toHaveScreenshot('help.png');
  });

  test('réglages', async ({ page }) => {
    await page.locator('#btnSettingsMenu').click();
    await expect(page.locator('#settings')).toHaveClass(/on/);
    await expect(page).toHaveScreenshot('settings.png');
  });

  test('interface de jeu', async ({ page }) => {
    await page.locator('#btnStart').click();
    await expect(page.locator('#hud')).toHaveClass(/on/);

    // Les chiffres du HUD montent à chaque trame : `frame()` les réécrit tant
    // que le mode vaut 'run', donc les figer une fois ne tient pas. Ici le
    // masque de Playwright est le bon outil — contrairement au canvas, ce sont
    // de petits rectangles, et tout ce qui les entoure reste comparé.
    await expect(page).toHaveScreenshot('hud.png', {
      mask: [
        page.locator('#score'),
        page.locator('#dist'),
        page.locator('#spd'),
        page.locator('#mult'),
        page.locator('#coinCount'),
        page.locator('#recline'),
        page.locator('#hullBar'),
        page.locator('#boostBar'),
        page.locator('#boostFill'),
      ],
    });
  });
});

/*
 * Limite connue, vérifiée : les effets qui composent sur le rendu 3D ne sont
 * pas couverts. Le canvas caché, un `backdrop-filter: blur()` s'applique à un
 * aplat uniforme et son rayon n'a plus d'effet visible — passer le voile du
 * menu de 14 px à 2 px ne fait échouer aucune référence. Un décalage de mise
 * en page ou un élément disparu sont bien attrapés, un réglage de compositing
 * ne l'est pas. Ce sera couvert par les références plein cadre, une fois la
 * simulation déterministe.
 */
