import { expect, test } from './fixtures.js';

test.describe('machine à états et navigation', () => {
  /**
   * CLAUDE.md : « setMode builds keyboard navigation. The start state must be
   * set by calling setMode('menu'), not by classes in the HTML alone. » Poser la
   * classe `on` à la main dans le HTML donnerait le bon écran mais une liste de
   * navigation vide. On vérifie donc les deux : l'écran, et le fait qu'il soit
   * navigable au clavier.
   */
  test('démarre en mode menu, avec la navigation clavier construite', async ({ game, page }) => {
    await game.boot();
    expect(await game.mode()).toBe('menu');

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#menu .nav-sel')).toHaveCount(1);
  });

  test('le menu mène à une partie, la pause et la reprise', async ({ game, page }) => {
    await game.boot();

    await page.locator('#btnStart').click();
    expect(await game.mode()).toBe('run');
    await expect(page.locator('#hud')).toHaveClass(/on/);

    await page.keyboard.press('Escape');
    expect(await game.mode()).toBe('pause');

    await page.keyboard.press('Escape');
    expect(await game.mode()).toBe('run');

    expect(game.errors()).toEqual([]);
  });

  test("les écrans secondaires s'ouvrent et se referment", async ({ game, page }) => {
    await game.boot();

    await page.locator('#btnHelp').click();
    expect(await game.mode()).toBe('help');
    await page.keyboard.press('Escape');
    expect(await game.mode()).toBe('menu');

    await page.locator('#btnSettingsMenu').click();
    expect(await game.mode()).toBe('settings');
    await page.keyboard.press('Escape');
    expect(await game.mode()).toBe('menu');

    expect(game.errors()).toEqual([]);
  });

  test('le sélecteur de difficulté répond au clavier comme un groupe', async ({ game, page }) => {
    await game.boot();

    await expect(page.locator('#diffEasy')).toHaveClass(/on/);

    // Le repère clavier n'est actif d'emblée que sur un pointeur précis
    // (game.js : `matchMedia('(pointer: fine)')`), et gauche/droite sur un
    // groupe exige qu'il le soit. Une première flèche l'active donc, ce que
    // ferait aussi un utilisateur au clavier sur un terminal tactile. Depuis
    // btnStart, présélectionné, ArrowUp remonte sur segDiff.
    const seg = page.locator('#segDiff');
    await page.keyboard.press('ArrowUp');
    await expect(seg).toHaveClass(/nav-sel/);

    // Sur un groupe de boutons, ArrowRight change la valeur au lieu de naviguer.
    await seg.press('ArrowRight');
    await expect(page.locator('#diffMedium')).toHaveClass(/on/);
    await seg.press('ArrowRight');
    await expect(page.locator('#diffHard')).toHaveClass(/on/);
    await seg.press('ArrowLeft');
    await expect(page.locator('#diffMedium')).toHaveClass(/on/);

    // La note de difficulté suit la sélection : c'est applyDifficulty qui l'écrit.
    await expect(page.locator('#diffNote')).not.toBeEmpty();
  });

  test('une partie fait avancer le score et la vitesse', async ({ game, page }) => {
    await game.boot();
    await page.locator('#btnStart').click();

    // Le vaisseau accélère seul : distance et vitesse doivent monter sans entrée.
    //
    // Délai généreux et assumé : ce test a lâché une fois sur une exécution
    // complète de la suite, jamais isolément ni sur vingt-cinq répétitions.
    // Trois profils qui rendent en SwiftShader pendant quatre minutes finissent
    // par ralentir la machine, et le jeu ralentit avec elle — c'est le
    // comportement voulu du plafond de rattrapage, pas une régression.
    await expect
      .poll(() => page.locator('#spd').innerText().then(Number), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page
            .locator('#dist')
            .innerText()
            .then((t) => Number(t.replace(/\D/g, ''))),
        {
          timeout: 30_000,
        },
      )
      .toBeGreaterThan(0);

    expect(game.errors()).toEqual([]);
  });
});
