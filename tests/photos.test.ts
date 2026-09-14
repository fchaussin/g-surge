/**
 * Les photos gardées sur l'appareil.
 *
 * Ce qui compte est la relecture : le stockage appartient au joueur, il peut y
 * écrire ce qu'il veut, et ce qui en sort finit dans un `<img>`. L'hôte est
 * donc revérifié à la lecture et pas seulement à l'écriture.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { faceHtml, photoFor, rememberPhoto } from '../src/client/photos.js';

const KEY = 'gsurge.photos.v1';
const REAL = 'https://lh3.googleusercontent.com/a/ACg8ocKphoto=s96-c';

/** Le stockage d'un navigateur, en trois lignes : c'est tout ce que le module touche. */
function stubStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k),
    },
  };
  return map;
}

let store: Map<string, string>;
beforeEach(() => {
  store = stubStorage();
});

describe('les photos vues', () => {
  it('se souvient de ce qui vient du fournisseur', () => {
    rememberPhoto('abcdef0123456789', REAL);
    expect(photoFor('abcdef0123456789')).toBe(REAL);
    expect(photoFor('0000000000000000')).toBeNull();
    expect(photoFor(undefined)).toBeNull();
  });

  it("n'écrit ni ne relit une adresse d'ailleurs", () => {
    rememberPhoto('face1', 'https://evil.example/beacon.png');
    expect(photoFor('face1')).toBeNull();
    // et un stockage trafiqué à la main ne ressort pas non plus
    store.set(KEY, JSON.stringify({ face2: 'https://evil.example/beacon.png' }));
    expect(photoFor('face2')).toBeNull();
    store.set(KEY, 'pas du JSON');
    expect(photoFor('face2')).toBeNull();
  });

  it('oublie un pilote qui n’a plus de photo', () => {
    rememberPhoto('face3', REAL);
    rememberPhoto('face3', undefined);
    expect(photoFor('face3')).toBeNull();
  });

  /**
   * Le getter unique. Deux écrans lisaient la même question par deux chemins —
   * le menu une clé unique sans identité de compte, les réglages les pixels
   * seuls — et se contredisaient après un changement de compte.
   */
  it('rend la photo du compte, ou ses pixels, jamais celle d’un autre', () => {
    rememberPhoto('faceA', REAL);
    const a = faceHtml({ name: 'Ada', face: 'faceA' });
    expect(a).toContain('<img');
    expect(a).toContain(REAL);
    expect(a).toContain('referrerpolicy="no-referrer"');

    // un autre compte : ses pixels, pas la photo du premier
    const b = faceHtml({ name: 'Bob', face: 'faceB' });
    expect(b).toContain('<svg');
    expect(b).not.toContain(REAL);

    // une photo qu'on vient de recevoir l'emporte sur le magasin
    const fresh = `${REAL}2`;
    expect(faceHtml({ name: 'Ada', face: 'faceA', pic: fresh })).toContain(fresh);

    expect(faceHtml(null)).toBe('');
  });

  it('reste borné, les plus anciens partant les premiers', () => {
    for (let i = 0; i < 50; i++) rememberPhoto(`face-${i}`, `${REAL}${i}`);
    const kept = Object.keys(JSON.parse(store.get(KEY)!) as Record<string, string>);
    expect(kept).toHaveLength(40);
    expect(kept).toContain('face-49');
    expect(kept).not.toContain('face-0');
    expect(photoFor('face-49')).toBe(`${REAL}49`);
  });
});
