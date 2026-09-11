/**
 * The element ids `index.html` declares and the ones the client looks up are
 * the same set, in both directions.
 *
 * TECH-DEBT §6: roughly seventy string literals shared between the markup and
 * the modules, so renaming one is a two-place search. It stays a two-place
 * edit — this test does not remove the coupling, it makes forgetting one of
 * the two places fail in seconds instead of returning `null` in a browser.
 *
 * Text only, no DOM: the markup is read as a file, the lookups are the quoted
 * literals at the call sites plus the id tables the modules export. An id
 * built at runtime — a `page${...}` template — is invisible here, which is why
 * `settings.ts` spells its tabs out as literals.
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

/** Every `id="..."` the markup declares. */
function declared(): string[] {
  return [...html.matchAll(/\sid="([A-Za-z][\w-]*)"/g)].map((m) => m[1]!);
}

/**
 * Every id the client looks up: the literal at each call site, and the tables.
 * `on` is the click binder in `main.ts`, `byId` the helper in `hud.ts` and
 * `settings.ts`.
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
 * Whether anything refers to an id besides its own declaration: a quoted
 * literal in the client, a `#id` in the stylesheet or the end-to-end suite, or
 * the splash's inline script.
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

  /** The regexes have to find the real call sites, or the test above is vacuous. */
  it('sees the lookups it is meant to see', () => {
    const seen = lookedUp();
    expect(seen.length).toBeGreaterThan(50);
    for (const id of ['hud', 'btnStart', 'segDiff', 'tglSound', 'pageAdv', 'menu']) {
      expect(seen, id).toContain(id);
    }
  });
});
