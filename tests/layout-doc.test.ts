/**
 * `docs/ARCHITECTURE.md` ne peut pas dériver de l'arbre qu'il cartographie.
 *
 * Il l'a fait, en silence, pendant cinq étapes de la feuille de route : six
 * modules absents de ses tables et un compte de lignes du client faux d'un
 * facteur deux et demi. Rien n'était faux, donc rien ne s'est plaint. Deux
 * vérifications le font désormais — les comptes sont générés, et chaque module
 * source doit être nommé dans la carte.
 *
 * `npm run docs:layout` réécrit les blocs générés.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documents, modules, render, ROOT, TREES } from './helpers/layout-tables.js';

const doc = (name: string) => join(ROOT, 'docs', name);

describe('the documents that count the tree', () => {
  for (const [name, blocks] of Object.entries(documents())) {
    it(`docs/${name} matches what the tree measures`, () => {
      const current = readFileSync(doc(name), 'utf8');
      const expected = render(name, current, blocks);

      if (process.env.UPDATE_DOCS) {
        if (expected !== current) writeFileSync(doc(name), expected);
        return;
      }

      expect(
        expected,
        `docs/${name} is out of date with the tree — run \`npm run docs:layout\``,
      ).toBe(current);
    });

    it(`docs/${name} generates every block it declares`, () => {
      const current = readFileSync(doc(name), 'utf8');
      const declared = [...current.matchAll(/<!-- generated:([\w-]+) -->/g)].map((m) => m[1]);
      expect(declared.sort()).toEqual(Object.keys(blocks).sort());
    });
  }

  /** Un marqueur qui cesse de correspondre doit échouer bruyamment, pas ne rien faire en silence. */
  it('refuses a document whose markers have gone', () => {
    expect(() => render('X.md', '# nothing here', { layout: '' })).toThrow(
      /missing or malformed markers/,
    );
  });
});

describe('docs/ARCHITECTURE.md', () => {
  it('names every source module', () => {
    const map = readFileSync(doc('ARCHITECTURE.md'), 'utf8');
    const missing: string[] = [];
    for (const tree of TREES) {
      for (const file of modules(tree)) {
        if (!map.includes(`\`${file}\``)) missing.push(`${tree}/${file}`);
      }
    }
    expect(missing, 'modules absent from the tables of docs/ARCHITECTURE.md').toEqual([]);
  });
});
