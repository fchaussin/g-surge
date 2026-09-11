/**
 * La seule affirmation sur `src/sim/trig.ts` que Node seul ne peut pas vérifier.
 *
 * La dette 17 est un énoncé sur deux moteurs qui divergent, donc un test pour
 * elle a besoin de deux moteurs. `tests/trig.test.ts` épingle ce que le noyau
 * rend, dans Node, contre des motifs de bits figés. Celui-ci fait tourner le
 * bundle livré dans Chromium et demande s'il rend les mêmes bits — la propriété
 * sur laquelle la validation côté serveur, les fantômes et les pistes partagées
 * reposeraient tous.
 *
 * Il mesure aussi le problème lui-même au lieu de le répéter : les mêmes
 * arguments passent par le `Math` du navigateur, et les désaccords avec le
 * `Math` de Node sont comptés et rapportés. Ce compte n'est délibérément pas
 * vérifié. Il dépend de deux versions de moteur et pourrait légitimement
 * atteindre zéro sur un appariement ; le point n'est pas qu'ils divergent
 * toujours, c'est que le noyau ne se soucie plus de savoir s'ils le font.
 *
 * Les nombres traversent le pont en JSON, qui fait l'aller-retour d'un double
 * fini exactement — `Number::toString` est spécifié pour produire la plus courte
 * représentation qui se relit à l'identique — donc une comparaison de motifs de
 * bits de ce côté est valide.
 */
import { expect, test } from '@playwright/test';
import { atan, cos, sin } from '../../src/sim/index.js';

const BITS = new DataView(new ArrayBuffer(8));
const bits = (x: number): string => {
  BITS.setFloat64(0, x);
  return BITS.getBigUint64(0).toString(16).padStart(16, '0');
};

/**
 * Des arguments couvrant ce que le jeu produit vraiment, et au-delà.
 *
 * Mesuré sur une partie dans les trois difficultés : le lacet atteint 44 rad et
 * le dévers reste sous 13. Le balayage va jusqu'à 1000 pour que la réduction
 * soit exercée bien au-delà de ce qu'une piste peut plier, et les multiples
 * exacts de π/2 sont ajoutés à la main parce qu'un balayage aléatoire ne tombe
 * jamais dessus — ce sont les arguments où la réduction annule ses bits hauts
 * et où les implémentations se séparent.
 */
function bands(): Array<{ label: string; xs: number[] }> {
  let state = 20260910;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const sweep = (n: number, half: number): number[] =>
    Array.from({ length: n }, () => (next() - 0.5) * 2 * half);

  const corners: number[] = [];
  for (let k = -40; k <= 40; k++)
    for (const off of [-1e-8, -1e-13, 0, 1e-13, 1e-8]) corners.push((k * Math.PI) / 2 + off);

  return [
    { label: "the game's own range, |x| < 45", xs: sweep(4000, 45) },
    { label: 'well past it, |x| < 1000', xs: sweep(2000, 1000) },
    { label: 'exact multiples of pi/2', xs: corners },
  ];
}

const allArguments = (): number[] => bands().flatMap((b) => b.xs);

test.describe('the core carries its own trigonometry across engines', () => {
  test('returns bit-identical results in Chromium and in Node', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });

    const xs = allArguments();
    const browser = await page.evaluate((values) => window.__gsNext.trig(values), xs);

    expect(browser.sin).toHaveLength(xs.length);
    const disagreements: string[] = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!;
      if (bits(browser.sin[i]!) !== bits(sin(x))) disagreements.push(`sin(${x})`);
      if (bits(browser.cos[i]!) !== bits(cos(x))) disagreements.push(`cos(${x})`);
      if (bits(browser.atan[i]!) !== bits(atan(x))) disagreements.push(`atan(${x})`);
    }
    expect(disagreements.slice(0, 10)).toEqual([]);
  });

  test("measures how far the two engines' own Math drifts apart", async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot.gone', { timeout: 20_000 });

    let total = 0;
    for (const { label, xs } of bands()) {
      const browser = await page.evaluate(
        (values) => ({
          sin: values.map((x: number) => Math.sin(x)),
          cos: values.map((x: number) => Math.cos(x)),
          atan: values.map((x: number) => Math.atan(x)),
        }),
        xs,
      );
      const counts = { sin: 0, cos: 0, atan: 0 };
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]!;
        if (bits(browser.sin[i]!) !== bits(Math.sin(x))) counts.sin++;
        if (bits(browser.cos[i]!) !== bits(Math.cos(x))) counts.cos++;
        if (bits(browser.atan[i]!) !== bits(Math.atan(x))) counts.atan++;
      }
      const pc = (n: number) => `${((n / xs.length) * 100).toFixed(1)} %`;
      console.log(
        `${label} (${xs.length} arguments): ` +
          `sin ${counts.sin} (${pc(counts.sin)}), ` +
          `cos ${counts.cos} (${pc(counts.cos)}), ` +
          `atan ${counts.atan} (${pc(counts.atan)})`,
      );
      total += counts.sin + counts.cos + counts.atan;
    }

    // Délibérément pas vérifié ; voir la note en tête de ce fichier. Ce que la
    // suite garde est le test au-dessus, qui dit que le noyau s'accorde avec
    // lui-même.
    expect(total).toBeGreaterThanOrEqual(0);
  });
});
