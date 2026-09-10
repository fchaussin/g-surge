import { expect, test } from './fixtures.js';

test.describe('démarrage', () => {
  test('la page démarre sans erreur et retire l\'écran de chargement', async ({ game, page }) => {
    await game.boot();
    await expect(page.locator('#bootLabel')).toHaveText('READY');
    expect(game.errors()).toEqual([]);
  });

  test('three.js est chargé et le rendu WebGL est vivant', async ({ game, page }) => {
    await game.boot();

    const gl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const ctx =
        canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl');
      if (!ctx) return null;
      const g = ctx as WebGLRenderingContext;
      return {
        lost: g.isContextLost(),
        drawW: g.drawingBufferWidth,
        drawH: g.drawingBufferHeight,
        revision: (window as unknown as { THREE?: { REVISION?: string } }).THREE?.REVISION ?? null,
      };
    });

    expect(gl).not.toBeNull();
    expect(gl!.lost).toBe(false);
    // La version est épinglée : le code dépend du comportement de r128, voir CLAUDE.md.
    expect(gl!.revision).toBe('128');
    expect(gl!.drawW).toBeGreaterThan(0);
    expect(gl!.drawH).toBeGreaterThan(0);
  });

  test('le canvas remplit la fenêtre, à tout devicePixelRatio', async ({ game, page }) => {
    await game.boot();

    const m = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const rect = canvas.getBoundingClientRect();
      return {
        cssW: rect.width,
        cssH: rect.height,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        bufW: canvas.width,
        bufH: canvas.height,
        dpr: window.devicePixelRatio,
      };
    });

    // Taille CSS : le canvas couvre la fenêtre, à un pixel de tolérance près.
    expect(Math.abs(m.cssW - m.innerW)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.cssH - m.innerH)).toBeLessThanOrEqual(1);

    // Tampon de rendu : innerWidth × pixelRatio, ce dernier plafonné à 2 par
    // applyRenderScale. Un canvas resté à 300×150 tombe ici.
    const ratio = Math.min(m.dpr, 2);
    expect(Math.abs(m.bufW - m.innerW * ratio)).toBeLessThanOrEqual(ratio);
    expect(Math.abs(m.bufH - m.innerH * ratio)).toBeLessThanOrEqual(ratio);
    expect(m.bufW).not.toBe(300);
  });

  /**
   * Le piège numéro un de CLAUDE.md, celui qui a coûté deux diagnostics faux :
   * sans `width:100%; height:100%`, un élément remplacé garde sa taille
   * intrinsèque de 300×150 et, à devicePixelRatio 2, on ne voit que le quart
   * haut gauche de l'image.
   *
   * On ne peut pas le constater tel quel : `renderer.setSize(w, h, true)` pose
   * lui-même style.width et style.height en inline, ce qui masque l'absence de
   * la règle. Ce test retire donc ces deux styles inline et vérifie que la
   * feuille de style tient seule — c'est bien elle, et rien d'autre, qui est
   * la ceinture décrite dans CLAUDE.md.
   */
  test('la règle CSS du canvas tient sans les styles inline de three.js', async ({ game, page }) => {
    await game.boot();

    const size = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
      const rect = canvas.getBoundingClientRect();
      return { w: rect.width, h: rect.height, innerW: window.innerWidth, innerH: window.innerHeight };
    });

    expect(Math.abs(size.w - size.innerW)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.h - size.innerH)).toBeLessThanOrEqual(1);
  });

  test('le canvas suit un redimensionnement de la fenêtre', async ({ game, page }) => {
    await game.boot();
    await page.setViewportSize({ width: 900, height: 600 });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = document.querySelector('canvas')!;
          return Math.round(c.getBoundingClientRect().width);
        }),
      )
      .toBe(900);
  });
});
