/**
 * `docs/GAMEPLAY.md` ne peut pas dériver de l'accord qu'il décrit.
 *
 * Le document a porté un rapport divisé par un chiffre qui n'apparaissait nulle
 * part dans le code, et il a survécu des mois parce que chaque nombre y était
 * tapé à la main. Tout ce qui se dérive est désormais généré ; ce test est ce
 * qui fait tenir cela.
 *
 * `npm run docs:tuning` réécrit les blocs générés.
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

  /** Un marqueur qui cesse de correspondre doit échouer bruyamment, pas ne rien faire en silence. */
  it('refuses a document whose markers have gone', () => {
    expect(() => render('# nothing here')).toThrow(/missing or malformed markers/);
  });
});
