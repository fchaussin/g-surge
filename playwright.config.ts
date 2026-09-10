import { defineConfig, devices } from '@playwright/test';

const PORT = 5176;

export default defineConfig({
  testDir: 'tests/e2e',
  // Le jeu est une boucle temps réel : deux onglets qui rendent en parallèle sur
  // SwiftShader se volent le CPU et les mesures de cadence deviennent du bruit.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      // Tolérance nulle, mesurée et non supposée : deux exécutions successives
      // rendent des images identiques au bit près, le canvas étant masqué et le
      // reste étant du texte et des rectangles. Une tolérance de 0,002 laissait
      // passer un décalage de titre de plusieurs centaines de pixels.
      //
      // Corollaire : une montée de version de Playwright, donc de Chromium,
      // change l'anticrénelage du texte et fait tomber toutes les références.
      // C'est voulu — on les régénère alors sciemment, avec un commit qui ne
      // fait que ça, plutôt que de laisser un seuil large absorber en silence
      // des régressions réelles.
      maxDiffPixels: 0,
      animations: 'disabled',
    },
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      // Le piège numéro un de CLAUDE.md ne se manifeste qu'au-dessus de 1 :
      // à devicePixelRatio 2, un canvas sans width/height CSS explicites garde
      // sa taille intrinsèque et n'affiche que le quart haut gauche de l'image.
      // Ce projet n'existe que pour cette géométrie, d'où le cadrage sur boot :
      // trois jeux de références visuelles pour la même mise en page coûteraient
      // plus cher qu'ils ne rapportent.
      name: 'retina',
      testMatch: /boot\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    // Builds first: the suite tests the artefact, not the sources.
    command: `npm run build && node scripts/serve-static.mjs public ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
