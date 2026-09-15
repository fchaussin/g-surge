import { defineConfig, devices } from '@playwright/test';

const PORT = 5176;

export default defineConfig({
  testDir: 'tests/e2e',
  // Le jeu est une boucle temps réel : deux onglets qui rendent en parallèle sur
  // SwiftShader se volent le CPU et les mesures de cadence deviennent du bruit.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Pas de seconde chance : un test qui passe une fois sur deux est un bug
  // — le fantôme sur mobile en était un, un budget de 30 s sur trois parties —
  // et une reprise le maquillait en vert.
  retries: 0,
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
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      // **Le paysage, la seule orientation que le jeu demande.** Le manifeste
      // réclame `landscape` et c'est ainsi qu'on y joue ; `mobile` ci-dessus est
      // en portrait, 412 × 839, donc aucune référence ne regardait la mise en
      // page que le joueur a réellement sous les yeux. Ça s'est payé : le
      // bandeau d'alerte se posait en travers du multiplicateur et de la ligne
      // distance, et toute la suite passait.
      //
      // Ce n'est pas une largeur qui manquait, c'est une **hauteur**. `.hud`
      // porte `font-size:clamp(11px,1.55dvh,17px)` : en dessous de 710 px de
      // haut la police touche son plancher et cesse de rétrécir, pendant que
      // tout ce qui est placé en pourcentage continue de monter. Les deux
      // cessent de parler de la même échelle, et rien au-dessus de 710 px ne
      // peut le montrer.
      //
      // Cadré sur les références d'interface, comme `retina` l'est sur `boot` :
      // rejouer toute la suite une troisième fois coûterait dix minutes par
      // poussée pour des assertions de comportement que la hauteur ne change
      // pas.
      name: 'landscape',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Pixel 7 landscape'] },
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
