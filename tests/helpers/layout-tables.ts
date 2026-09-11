/**
 * The parts of `docs/ARCHITECTURE.md` and `docs/TECH-DEBT.md` that are counts
 * on the tree.
 *
 * `ARCHITECTURE.md` stated a client of 2 100 lines while the tree held 5 200,
 * and listed nine of the fifteen entries of the debug surface: nothing in it
 * was wrong, everything was incomplete, and it stayed so through five roadmap
 * steps because nothing could contradict it. This is the "obvious next move"
 * `TECH-DEBT.md` §19 named — the counts are generated here and checked by a
 * test, and the module tables are checked for completeness.
 *
 * Deliberately not generated: the role of each module, which is prose and a
 * judgement, and the reasons a module grew past the 300-line rule.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The two source trees, in the order the documents present them. */
export const TREES = ['src/sim', 'src/client'] as const;

/** What `CLAUDE.md` asks of a module. */
export const MODULE_LIMIT = 300;

/** Source modules of one tree — `.ts` files, `tsconfig.json` and tests excluded. */
export function modules(tree: string): string[] {
  return readdirSync(join(ROOT, tree))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
    .sort();
}

/** Line count of one file, comments included: the documents count what a reader scrolls. */
export function lines(path: string): number {
  const text = readFileSync(join(ROOT, path), 'utf8');
  return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/**
 * A count rounded to the nearest hundred, written the way the documents write
 * large numbers. Rounded so that an ordinary edit does not move the document;
 * the exact figure is one `wc -l` away and belongs nowhere in prose.
 */
export function approx(n: number): string {
  const rounded = Math.round(n / 100) * 100;
  // Thousands grouped by a plain space, as in "1 345 m" elsewhere in docs/.
  return `~${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** The top table of `ARCHITECTURE.md`: where the code is and how much of it. */
export function layout(): string {
  const rows = TREES.map((tree) => {
    const files = modules(tree);
    const total = files.reduce((sum, f) => sum + lines(join(tree, f)), 0);
    return `| \`${tree}/\` | ${files.length} | ${approx(total)} |`;
  });
  rows.push(`| \`index.html\` | 1 | ${approx(lines('index.html'))} |`);
  return ['| Where | Files | Lines |', '|---|---|---|', ...rows].join('\n');
}

/** The table of `TECH-DEBT.md` §20: every module over the limit, largest first. */
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
 * Replaces each `<!-- generated:name -->` block of a document. Throws if one
 * is missing: a marker that stops matching must fail loudly, not silently
 * leave a stale table behind — that is the failure mode this exists to end.
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

/** The generated blocks of each document, by file name. */
export function documents(): Record<string, Record<string, string>> {
  return {
    'ARCHITECTURE.md': { layout: layout() },
    'TECH-DEBT.md': { oversize: oversize() },
  };
}
