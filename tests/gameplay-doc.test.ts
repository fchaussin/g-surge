/**
 * `docs/GAMEPLAY.md` may not drift from the tuning it describes.
 *
 * The document once carried a ratio divided by a figure that appeared nowhere
 * in the code, and it survived for months because every number in it was typed
 * by hand. Everything derivable is now generated; this test is what makes that
 * stick.
 *
 * `npm run docs:tuning` rewrites the generated blocks.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, sections } from './helpers/gameplay-tables.js';

const DOC = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'GAMEPLAY.md');

describe('docs/GAMEPLAY.md', () => {
  it('matches what the tuning tables say', () => {
    const current = readFileSync(DOC, 'utf8');
    const expected = render(current);

    if (process.env.UPDATE_DOCS) {
      if (expected !== current) writeFileSync(DOC, expected);
      return;
    }

    expect(
      expected,
      'docs/GAMEPLAY.md is out of date with src/sim/tuning.ts — run `npm run docs:tuning`',
    ).toBe(current);
  });

  it('generates every block the document declares', () => {
    const current = readFileSync(DOC, 'utf8');
    const declared = [...current.matchAll(/<!-- generated:([\w-]+) -->/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(Object.keys(sections()).sort());
  });

  /** A marker that stops matching must fail loudly, not silently do nothing. */
  it('refuses a document whose markers have gone', () => {
    expect(() => render('# nothing here')).toThrow(/missing or malformed markers/);
  });
});
