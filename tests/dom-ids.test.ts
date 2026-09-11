/**
 * Les identifiants d'éléments qu'`index.html` déclare et ceux que le client
 * cherche sont le même ensemble, dans les deux sens.
 *
 * TECH-DEBT §6 : une septantaine de littéraux partagés entre le balisage et les
 * modules, donc en renommer un est une recherche à deux endroits. Ça reste une
 * édition à deux endroits — ce test ne retire pas le couplage, il fait qu'en
 * oublier un échoue en quelques secondes au lieu de rendre `null` dans un
 * navigateur.
 *
 * Texte seul, pas de DOM : le balisage est lu comme un fichier, les recherches
 * sont les littéraux entre guillemets aux points d'appel plus les tables
 * d'identifiants que les modules exportent. Un identifiant bâti à l'exécution —
 * un gabarit `page${...}` — est invisible ici, ce qui est pourquoi
 * `settings.ts` écrit ses onglets en littéraux.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYERS, NAV_DEFAULT, NAV_IDS } from '../src/client/screens.js';
import { TABS } from '../src/client/settings.js';
import { ROOT } from './helpers/layout-tables.js';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const clientSources = readdirSync(join(ROOT, 'src/client'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(ROOT, 'src/client', f), 'utf8'));

const e2eSources = readdirSync(join(ROOT, 'tests/e2e'))
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => readFileSync(join(ROOT, 'tests/e2e', f), 'utf8'));

/** Chaque `id="..."` que le balisage déclare. */
function declared(): string[] {
  return [...html.matchAll(/\sid="([A-Za-z][\w-]*)"/g)].map((m) => m[1]!);
}

/**
 * Chaque identifiant que le client cherche : le littéral à chaque point d'appel,
 * et les tables. `on` est le lieur de clic de `main.ts`, `byId` l'aide de
 * `hud.ts` et `settings.ts`.
 */
function lookedUp(): string[] {
  const out = new Set<string>();
  const site = /\b(?:byId|on|getElementById)\(['"]([A-Za-z][\w-]*)['"]/g;
  const selector = /querySelector(?:All)?(?:<[^>]*>)?\(['"]#([A-Za-z][\w-]*)/g;
  for (const src of clientSources) {
    for (const m of src.matchAll(site)) out.add(m[1]!);
    for (const m of src.matchAll(selector)) out.add(m[1]!);
  }
  for (const ids of Object.values(NAV_IDS)) for (const id of ids) out.add(id);
  for (const id of Object.values(NAV_DEFAULT)) out.add(id);
  for (const id of LAYERS) out.add(id);
  for (const t of TABS) {
    out.add(t.tab);
    out.add(t.page);
  }
  return [...out].sort();
}

/**
 * Si quelque chose renvoie à un identifiant en dehors de sa propre déclaration :
 * un littéral dans le client, un `#id` dans la feuille de style ou la suite de
 * bout en bout, ou le script en ligne de l'écran de démarrage.
 */
function referenced(id: string): boolean {
  const quoted = new RegExp(`['"\`]${id}['"\`]`);
  const hash = new RegExp(`#${id}\\b`);
  if (clientSources.some((s) => quoted.test(s))) return true;
  if (e2eSources.some((s) => hash.test(s) || quoted.test(s))) return true;
  const withoutDeclaration = html.replace(new RegExp(`\\sid="${id}"`), '');
  return hash.test(withoutDeclaration) || quoted.test(withoutDeclaration);
}

describe('element ids', () => {
  it('are declared exactly once each', () => {
    const ids = declared();
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it('are looked up by the client only where the markup declares them', () => {
    const ids = new Set(declared());
    const missing = lookedUp().filter((id) => !ids.has(id));
    expect(missing, 'ids the client looks up that index.html does not declare').toEqual([]);
  });

  it('are declared by the markup only where something refers to them', () => {
    const orphans = declared().filter((id) => !referenced(id));
    expect(orphans, 'ids index.html declares that nothing refers to').toEqual([]);
  });

  /** Les expressions doivent trouver les vrais points d'appel, sinon le test au-dessus est vide. */
  it('sees the lookups it is meant to see', () => {
    const seen = lookedUp();
    expect(seen.length).toBeGreaterThan(50);
    for (const id of ['hud', 'btnStart', 'segDiff', 'tglSound', 'pageAdv', 'menu']) {
      expect(seen, id).toContain(id);
    }
  });
});
