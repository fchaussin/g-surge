/**
 * Les parties de `docs/ARCHITECTURE.md` et `docs/TECH-DEBT.md` qui sont des
 * comptes sur l'arbre.
 *
 * `ARCHITECTURE.md` annonçait un client de 2 100 lignes quand l'arbre en tenait
 * 5 200, et listait neuf des quinze entrées de la surface de mise au point :
 * rien n'y était faux, tout était incomplet, et c'est resté ainsi pendant cinq
 * étapes de la feuille de route parce que rien ne pouvait le contredire. C'est
 * le « prochain geste évident » que `TECH-DEBT.md` §19 nommait — les comptes
 * sont générés ici et vérifiés par un test, et les tables de modules sont
 * vérifiées complètes.
 *
 * Délibérément pas généré : le rôle de chaque module, qui est de la prose et un
 * jugement, et les raisons pour lesquelles un module a dépassé la règle des
 * 300 lignes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLIDERS } from '../../src/client/sliders.js';
import { DEFAULTS } from '../../src/sim/index.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Les deux arbres source, dans l'ordre où les documents les présentent. */
export const TREES = ['src/sim', 'src/client'] as const;

/** Ce que `CLAUDE.md` demande d'un module. */
export const MODULE_LIMIT = 300;

/** Les modules source d'un arbre — fichiers `.ts`, `tsconfig.json` et tests exclus. */
export function modules(tree: string): string[] {
  return readdirSync(join(ROOT, tree))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
    .sort();
}

/** Compte de lignes d'un fichier, commentaires compris : les documents comptent ce qu'un lecteur fait défiler. */
export function lines(path: string): number {
  const text = readFileSync(join(ROOT, path), 'utf8');
  return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/**
 * Un compte arrondi à la centaine, écrit comme les documents écrivent les grands
 * nombres. Arrondi pour qu'une édition ordinaire ne déplace pas le document ;
 * le chiffre exact est à un `wc -l` de distance et n'a sa place dans aucune
 * prose.
 */
export function approx(n: number): string {
  const rounded = Math.round(n / 100) * 100;
  // Milliers groupés par une espace simple, comme « 1 345 m » ailleurs dans docs/.
  return `~${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** La table de tête d'`ARCHITECTURE.md` : où est le code et combien il y en a. */
export function layout(): string {
  const rows = TREES.map((tree) => {
    const files = modules(tree);
    const total = files.reduce((sum, f) => sum + lines(join(tree, f)), 0);
    return `| \`${tree}/\` | ${files.length} | ${approx(total)} |`;
  });
  rows.push(`| \`index.html\` | 1 | ${approx(lines('index.html'))} |`);
  return ['| Where | Files | Lines |', '|---|---|---|', ...rows].join('\n');
}

/** La table de `TECH-DEBT.md` §20 : chaque module au-dessus de la limite, le plus gros d'abord. */
export function oversize(limit = MODULE_LIMIT): string {
  const rows: Array<[string, number]> = [];
  for (const tree of TREES) {
    for (const f of modules(tree)) {
      const path = relative(ROOT, join(ROOT, tree, f));
      const n = lines(path);
      if (n > limit) rows.push([path, n]);
    }
  }
  rows.sort((a, b) => b[1] - a[1]);
  return [
    '| File | Lines |',
    '|---|---|',
    ...rows.map(([path, n]) => `| \`${path}\` | ${n} |`),
  ].join('\n');
}

/**
 * Remplace chaque bloc `<!-- generated:name -->` d'un document. Lève si l'un
 * manque : un marqueur qui cesse de correspondre doit échouer bruyamment, pas
 * laisser en silence une table périmée — c'est le mode de défaillance que ceci
 * existe pour clore.
 */
export function render(name: string, document: string, blocks: Record<string, string>): string {
  let out = document;
  for (const [block, body] of Object.entries(blocks)) {
    const open = `<!-- generated:${block} -->`;
    const close = `<!-- /generated:${block} -->`;
    const from = out.indexOf(open);
    const to = out.indexOf(close);
    if (from < 0 || to < 0 || to < from) {
      throw new Error(`${name}: missing or malformed markers for "${block}"`);
    }
    out = `${out.slice(0, from + open.length)}\n${body}\n${out.slice(to)}`;
  }
  return out;
}

/**
 * La table de `TECH-DEBT.md` §11 : quelle part de l'accord le panneau expose.
 *
 * Trois documents portaient trois paires de chiffres différentes pour cela — 69
 * et 40, 70 et 32 — et l'arbre n'était d'accord avec aucune.
 */
export function coverage(): string {
  const keys = Object.keys(DEFAULTS).length;
  const exposed = new Set(SLIDERS.map((s) => s.key)).size;
  return [
    '| | |',
    '|---|---|',
    `| Keys in \`DEFAULTS\` | ${keys} |`,
    `| Exposed as sliders | ${exposed} |`,
    `| Reachable only through \`__gsNext.tuning()\` | ${keys - exposed} |`,
  ].join('\n');
}

/** Les blocs générés de chaque document, par nom de fichier. */
export function documents(): Record<string, Record<string, string>> {
  return {
    'ARCHITECTURE.md': { layout: layout() },
    'TECH-DEBT.md': { oversize: oversize(), coverage: coverage() },
  };
}
