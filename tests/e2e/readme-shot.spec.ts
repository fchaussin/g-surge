/**
 * La capture du README, prise dans le conteneur Playwright.
 *
 * Pas un test : rien n'est vérifié, une image est écrite dans `docs/media/`.
 * Ne tourne qu'avec `README_SHOT=1`, par `npm run readme:shot`, pour ne pas
 * s'inviter dans la suite. Graine fixée et un super boost forcé
 * pour que l'image ait de la vitesse dedans — sans braquer : à fond dans un
 * virage le vaisseau finit au mur ; le moment exact de la frame
 * n'est pas reproductible et n'a pas à l'être, c'est une illustration. Les
 * astuces sont coupées par la préférence, pour qu'aucune bulle ne traîne.
 *
 * `README_SHOT_SEEDS` prend une liste de graines séparées par des virgules et
 * écrit une image par graine dans `test-results/`, pour choisir.
 */
import { test } from '@playwright/test';

test.skip(!process.env.README_SHOT, 'illustration, not a test');

const SEEDS = (process.env.README_SHOT_SEEDS ?? '').split(',').filter(Boolean);

async function shoot(page: import('@playwright/test').Page, seed: string, path: string) {
  await page.addInitScript(() => {
    localStorage.setItem('gsurge.prefs.v1', JSON.stringify({ tips: false }));
  });
  await page.goto(`/?seed=${seed}`);
  await page.locator('#boot.gone').waitFor({ timeout: 20_000 });
  await page.locator('#btnStart').click();
  await page.keyboard.down('Space');
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const s = window.__gsNext.state() as unknown as { superT: number; energy: number };
    s.superT = 5;
    s.energy = 100;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path, fullPage: false });
  await page.keyboard.up('Space');
}

test('captures a frame for the README', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one image');
  if (SEEDS.length) {
    for (const seed of SEEDS) await shoot(page, seed, `test-results/readme-${seed}.png`);
  } else {
    await shoot(page, 'readme', 'docs/media/screenshot.png');
  }
});
