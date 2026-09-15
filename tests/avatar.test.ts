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

  /** Teinte, saturation et clarté d'un `#rrggbb`, pour juger sur des angles et
   *  des pourcentages plutôt que sur des chaînes. */
  function toHsl(hex: string): { h: number; s: number; l: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  /** Les deux bouts du dégradé. L'étape du milieu contourne le gris, voir `QUARTER`. */
  const stopsOf = (seed: string): [string, string] => {
    const all = [...avatarSvg(seed).matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]!);
    expect(all, seed).toHaveLength(3);
    return [all[0]!, all[2]!];
  };

  /** L'étape du milieu, celle qui doit rester saturée. */
  const viaOf = (seed: string): string =>
    [...avatarSvg(seed).matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]!)[1]!;

  it('tire ses deux couleurs du pseudo, et les prend complémentaires', () => {
    for (let i = 0; i < 300; i++) {
      const [from, to] = stopsOf(`P${i}`);
      expect(from, `P${i} est monochrome`).not.toBe(to);
      const a = toHsl(from);
      const b = toHsl(to);
      // L'écart angulaire absolu, ramené dans [0, 180]. Complémentaire vaut
      // donc 180, à l'arrondi du passage par les octets près — mesuré, il coûte
      // moins d'un demi-degré.
      const apart = Math.abs(((b.h - a.h + 540) % 360) - 180);
      expect(apart, `P${i} : ${from} et ${to} ne sont pas complémentaires`).toBeGreaterThan(178);
    }
  });

  it('garde assez de contraste pour que le dégradé se lise', () => {
    for (let i = 0; i < 300; i++) {
      const [from, to] = stopsOf(`C${i}`);
      // La teinte ne suffit pas seule : un écran pâle ou un œil qui distingue
      // mal les couleurs ne lit qu'une différence de luminosité.
      expect(Math.abs(toHsl(to).l - toHsl(from).l), `C${i}`).toBeGreaterThan(8);
    }
  });

  it('reste dans la bande des accents du jeu, saturé et clair', () => {
    for (let i = 0; i < 300; i++) {
      for (const hex of stopsOf(`B${i}`)) {
        const { s, l } = toHsl(hex);
        // Mesurée sur les six accents d'origine : S 88 à 100, L 57 à 77. Hors
        // de là, l'avatar cesse d'avoir l'air d'appartenir au jeu, et en bas de
        // la clarté il disparaît dans une carte sombre.
        expect(s, `B${i} ${hex} : saturation`).toBeGreaterThan(85);
        expect(l, `B${i} ${hex} : clarté`).toBeGreaterThan(55);
        expect(l, `B${i} ${hex} : clarté`).toBeLessThan(80);
      }
    }
  });

  it('ne traverse jamais le gris : l’étape du milieu reste saturée', () => {
    for (let i = 0; i < 300; i++) {
      const mid = toHsl(viaOf(`M${i}`));
      // Sans elle, le milieu de deux complémentaires interpolées en sRGB tombe
      // sur un gris et le visage se délave en son centre. Vu sur planche.
      expect(mid.s, `M${i} : milieu délavé`).toBeGreaterThan(85);
      // Et elle est bien perpendiculaire aux deux bouts, pas entre elles.
      const [from, to] = stopsOf(`M${i}`);
      for (const end of [from, to]) {
        const apart = Math.abs(((mid.h - toHsl(end).h + 540) % 360) - 180);
        expect(Math.abs(apart - 90), `M${i} : le milieu n'est pas au quart`).toBeLessThan(2);
      }
    }
  });

  it('donne bien plus que les trente couples de la palette qu’il remplace', () => {
    const pairs = new Set<string>();
    for (let i = 0; i < 400; i++) pairs.add(stopsOf(`U${i}`).join('>'));
    // Les six accents n'offraient que trente couples ; deux pilotes sur trente
    // partageaient donc les leurs. Ici on attend quasiment un couple par pilote.
    expect(pairs.size).toBeGreaterThan(380);
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
