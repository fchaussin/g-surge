/**
 * Le condensé du noyau change si et seulement si le noyau change.
 *
 * C'est la clé qu'une trace portera pour être rejouée par le bon noyau ; un
 * condensé qui ne bougerait pas sur une retouche de `step.ts` laisserait un
 * serveur rejouer une autre physique et refuser des parties honnêtes.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coreDigest } from '../scripts/core-digest.mjs';

const copies: string[] = [];
const copyTree = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'gs-core-'));
  cpSync('src/sim', join(root, 'src', 'sim'), { recursive: true });
  copies.push(root);
  return root;
};
afterEach(() => {
  for (const c of copies.splice(0)) rmSync(c, { recursive: true, force: true });
});

describe('the core digest', () => {
  it('is twelve hexadecimals, and stable', () => {
    const a = coreDigest();
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(coreDigest()).toBe(a);
    expect(coreDigest(copyTree())).toBe(a);
  });

  it('moves with the core, byte for byte, and with nothing else', () => {
    const root = copyTree();
    const before = coreDigest(root);
    // un fichier hors du noyau ne compte pas
    writeFileSync(join(root, 'src', 'sim', 'tsconfig.json'), '{}');
    expect(coreDigest(root)).toBe(before);
    // un octet dans le noyau, si
    const stepPath = join(root, 'src', 'sim', 'step.ts');
    writeFileSync(stepPath, readFileSync(stepPath, 'utf8') + ' ');
    expect(coreDigest(root)).not.toBe(before);
  });

  it('has a marker to be stamped into, so the build cannot miss it', () => {
    const core = readFileSync('src/client/core.ts', 'utf8');
    expect(core.match(/\/\* core:digest \*\/[^\n]*/)?.length).toBe(1);
    expect(core).toContain("export const CORE_DIGEST = 'DEV';");
  });
});
