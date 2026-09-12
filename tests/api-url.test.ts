/**
 * L'adresse de l'API suit l'environnement du build, et le marqueur est là.
 *
 * `main` sur Pages est la production, toute autre branche une préversion sur
 * staging, et sans Pages c'est le développement local ; `GS_API_URL` l'emporte.
 * Une erreur ici ferait classer les essais d'une branche sur le tableau de tout
 * le monde, ou pointerait la production sur un serveur de test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiUrl } from '../vite.config.js';

describe('the API url', () => {
  it('is production on main, staging on any other Pages branch, local otherwise', () => {
    expect(apiUrl({ CF_PAGES_BRANCH: 'main' })).toBe('https://gsurge-api.w23.fr');
    expect(apiUrl({ CF_PAGES_BRANCH: 'multiplayer' })).toBe(
      'https://g-surge-api-staging.fchaussin.workers.dev',
    );
    expect(apiUrl({ CF_PAGES_BRANCH: 'feat/x' })).toBe(
      'https://g-surge-api-staging.fchaussin.workers.dev',
    );
    expect(apiUrl({})).toBe('http://localhost:8787');
  });

  it('lets GS_API_URL override everything, including to nothing', () => {
    expect(apiUrl({ GS_API_URL: 'https://x.example', CF_PAGES_BRANCH: 'main' })).toBe(
      'https://x.example',
    );
    expect(apiUrl({ GS_API_URL: '' })).toBe('');
  });

  it('has its marker in api.ts, empty in source so nothing is online by accident', () => {
    const src = readFileSync('src/client/api.ts', 'utf8');
    expect(src.match(/\/\* api:url \*\/[^\n]*/)?.length).toBe(1);
    expect(src).toContain("export const API_URL = '';");
  });
});
