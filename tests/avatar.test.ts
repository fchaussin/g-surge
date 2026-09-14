/**
 * L'avatar de pixels. Ce qui compte : une graine donne toujours le même
 * visage, deux graines voisines en donnent des différents, il est symétrique,
 * et rien de ce que le joueur tape n'en ressort — la graine ordinaire est le
 * condensé que le serveur donne, mais une partie sans compte retombe sur le
 * pseudo, et celui-là est du texte de joueur.
 */
import { describe, expect, it } from 'vitest';
import { avatarSvg } from '../src/client/avatar.js';

/** Les cellules allumées, relues dans le SVG. */
function cells(svg: string): Set<string> {
  const out = new Set<string>();
  for (const m of svg.matchAll(/<rect x="(\d)" y="(\d)"/g)) out.add(`${m[1]},${m[2]}`);
  return out;
}

describe("l'avatar d'une graine", () => {
  it('est le même à chaque fois, et change avec la graine', () => {
    expect(avatarSvg('Ada L')).toBe(avatarSvg('Ada L'));
    expect(avatarSvg('Ada L')).not.toBe(avatarSvg('Bob B'));
    expect(avatarSvg('9f2c1b7d4e5a6c80')).not.toBe(avatarSvg('9f2c1b7d4e5a6c81'));
    // la casse et les espaces de bord ne font pas deux pilotes
    expect(avatarSvg(' ada l ')).toBe(avatarSvg('Ada L'));
  });

  /** Un visage de deux pixels ne se lit pas dans une ligne de tableau. */
  it('garde une densité lisible, quelle que soit la graine', () => {
    for (let i = 0; i < 500; i++) {
      const on = cells(avatarSvg(`seed-${i}`));
      expect(on.size, `seed-${i}`).toBeGreaterThanOrEqual(4);
      // douze cellules du masque au plus, dont dix miroitées : vingt-deux
      expect(on.size, `seed-${i}`).toBeLessThanOrEqual(22);
    }
  });

  it('est symétrique, cinq colonnes sur cinq', () => {
    for (const name of ['Ada L', 'Bob B', 'Carl C', 'ZZ', '桜']) {
      const on = cells(avatarSvg(name));
      for (const key of on) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        expect(x).toBeLessThanOrEqual(4);
        expect(y).toBeLessThanOrEqual(4);
        expect(on.has(`${4 - x},${y}`), `${name} : miroir de ${key}`).toBe(true);
      }
    }
  });

  it('ne rend jamais le texte du joueur, donc rien à échapper', () => {
    const svg = avatarSvg('<script>alert(1)</script>&"');
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('&');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('a deux teintes, jamais la même deux fois, et couvre la palette', () => {
    const inks = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const stops = [...avatarSvg(`P${i}`).matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map(
        (m) => m[1]!,
      );
      expect(stops).toHaveLength(2);
      expect(stops[0], `P${i} est monochrome`).not.toBe(stops[1]);
      for (const ink of stops) inks.add(ink);
    }
    expect(inks.size).toBe(6);
  });

  /** Un dégradé se réfère à un `id` : deux avatars sur la même page ne doivent
   *  pas se voler leur définition. */
  it("nomme son dégradé d'après la graine", () => {
    const idOf = (seed: string) => /<linearGradient id="(av[0-9a-f]+)"/.exec(avatarSvg(seed))![1];
    expect(idOf('Ada L')).toBe(idOf('Ada L'));
    expect(idOf('Ada L')).not.toBe(idOf('Bob B'));
    // et le fill de la forme pointe bien sur lui
    expect(avatarSvg('Ada L')).toContain(`fill="url(#${idOf('Ada L')!})"`);
  });
});
