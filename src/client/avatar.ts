/**
 * L'avatar d'un pilote : une grille de pixels tirée de son pseudo.
 *
 * Pas de photo, pas de requête, pas de stockage. L'avatar de Google était à
 * portée — le scope `openid profile` porte déjà `picture` — mais il aurait
 * coûté une colonne en base, la promesse « deux champs seulement » de l'onglet
 * Profil, et surtout une requête vers `googleusercontent.com` par ligne du
 * tableau et par joueur qui le regarde, depuis un jeu qui se veut jouable hors
 * ligne.
 *
 * **L'exception est le duel**, décidée le 14 septembre 2026 : là on regarde
 * une personne en face, c'est une image et non dix lignes, et le chemin
 * trouvé ne garde rien — la photo va du fragment de connexion à l'appareil du
 * joueur, puis au salon, qui la relaie et meurt avec la course. Ce module
 * reste l'identité partout ailleurs, et le repli quand la photo ne charge
 * pas ; `main.ts:paintFace` fait l'échange.
 *
 * **La graine est le compte, pas le pseudo.** Le serveur la donne : le condensé
 * de l'identifiant du joueur chez le fournisseur, `faceOf` dans
 * `server/src/auth.ts`. L'identifiant lui-même ne quitte jamais le serveur, et
 * le condensé ne dit rien de plus qu'« encore lui » — le visage tient donc au
 * pilote et survit à un changement de pseudo. Une partie sans compte n'en a
 * pas ; le nom sert alors de graine, faute de mieux.
 *
 * Le rendu est une chaîne SVG, pas un canvas : elle s'insère dans une ligne de
 * liste bâtie en HTML, et elle reste nette à toute taille. Rien de ce qu'elle
 * contient ne vient du texte du joueur — seulement des nombres tirés du
 * hachage — donc elle n'a pas à être échappée.
 */

/** Les accents du jeu, et rien d'autre : un avatar doit avoir l'air d'en être. */
const INK: readonly string[] = ['#25e2ff', '#ff2f9a', '#ffc24a', '#7cf7c4', '#a98cff', '#ff7a59'];

/** FNV-1a 32 bits. Court, sans dépendance, et suffisant pour répartir des pseudos. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * L'avatar d'une graine, en SVG carré, à dessiner dans une boîte de `size`
 * pixels. Cinq colonnes sur cinq, la moitié droite étant le miroir de la
 * gauche — la symétrie est ce qui fait qu'un tirage aléatoire ressemble à un
 * visage plutôt qu'à du bruit.
 */
export function avatarSvg(seed: string, size = 22): string {
  const h = hash(seed.trim().toLowerCase());
  // Deux teintes et non une : la seconde est prise à une distance non nulle de
  // la première dans la palette, donc elles diffèrent toujours. Le dégradé va
  // en diagonale, ce qui se lit encore à vingt-deux pixels.
  const first = h % INK.length;
  const second = (first + 1 + ((h >>> 20) % (INK.length - 1))) % INK.length;
  const from = INK[first]!;
  const to = INK[second]!;
  // Une définition par graine : deux lignes du même pilote partagent l'id,
  // avec le même contenu, ce qui est sans conséquence.
  const id = `av${h.toString(16)}`;
  // 15 cellules décidées, une par bit : trois colonnes, cinq lignes.
  //
  // Le tirage nu donne parfois deux pixels allumés sur quinze, ce qui ne se
  // lit plus à vingt-deux pixels — vu sur une planche d'essai. Trop clairsemé
  // ou trop plein, on prend le négatif : la symétrie et le déterminisme sont
  // gardés, et la densité du masque reste entre quatre et douze — un négatif
  // de trois en fait douze, ce qui est plein sans être un carré.
  let mask = h & 0x7fff;
  let lit = 0;
  for (let i = 0; i < 15; i++) lit += (mask >>> i) & 1;
  if (lit < 4 || lit > 11) mask ^= 0x7fff;

  let cells = '';
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      if (!((mask >>> (col * 5 + row)) & 1)) continue;
      cells += `<rect x="${col}" y="${row}" width="1" height="1"/>`;
      if (col < 2) cells += `<rect x="${4 - col}" y="${row}" width="1" height="1"/>`;
    }
  }
  return (
    `<svg class="av" width="${size}" height="${size}" viewBox="0 0 5 5" ` +
    `aria-hidden="true" focusable="false" fill="url(#${id})">` +
    // `userSpaceOnUse` et non le défaut : sans lui le dégradé est relatif à
    // chaque `rect`, donc chaque pixel porte le dégradé entier et l'avatar n'en
    // a aucun. Ici il traverse la grille de cinq sur cinq, en diagonale.
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="0" y1="0" x2="5" y2="5">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>${cells}</svg>`
  );
}
