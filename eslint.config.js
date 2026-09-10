import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // legacy/ reste en scripts classiques jusqu'à sa suppression : deux fichiers
    // partagent une portée globale, ce qu'aucune configuration de module ne sait
    // décrire honnêtement. Le garde-fou y reste « node --check » sur la concaténation.
    ignores: [
      'dist/',
      'dist-codepen/',
      'public/',
      'node_modules/',
      'legacy/**',
      'scripts/**',
      // Copie de three.js r128 rejouée aux tests à la place du CDN : ce n'est
      // pas notre source, et minifiée elle produit 1800 faux positifs.
      'tests/e2e/vendor/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      // Le déterminisme est la propriété qui rend le noyau testable, rejouable
      // et arbitrable côté serveur. Il se perd en une ligne, donc il est vérifié.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'sim/ doit être déterministe : passer par le PRNG injecté (rng.ts).' },
        { object: 'Date', property: 'now', message: 'sim/ doit être déterministe : le temps est un paramètre, pas une lecture d\'horloge.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'sim/ ne doit pas dépendre de three.js : il doit tourner sans WebGL.' },
            { group: ['**/client/**'], message: 'La dépendance va client → sim, jamais l\'inverse.' },
          ],
        },
      ],
    },
  },
);
