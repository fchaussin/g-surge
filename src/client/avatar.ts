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

/**
 * La bande où vivent les accents du jeu, mesurée sur les six qui la portaient.
 *
 * `#25e2ff`, `#ff2f9a`, `#ffc24a`, `#7cf7c4`, `#a98cff`, `#ff7a59` : leurs
 * teintes vont de 12° à 329° — c'est-à-dire partout — mais leur saturation tient
 * entre 88 et 100 %, et leur clarté entre 57 et 77 %. **La signature du jeu
 * n'est donc pas une liste de teintes, c'est « très saturé et clair ».** La
 * teinte peut se tirer librement sans que l'avatar cesse d'avoir l'air d'en
 * être ; la saturation et la clarté, non.
 *
 * C'est ce qui a permis de remplacer la palette de six par un tirage : elle ne
 * donnait que trente couples, dont certains voisins se distinguaient mal, et
 * deux pilotes sur trente partageaient leurs deux couleurs.
 */
const SAT_MIN = 88;
const SAT_SPAN = 13;
const LIGHT_MIN = 58;
const LIGHT_SPAN = 10;

/**
 * Ce qui sépare les deux clartés du dégradé.
 *
 * La teinte complémentaire donne déjà l'écart maximal de couleur ; celui-ci
 * ajoute un écart de luminosité, pour que le dégradé se lise aussi là où la
 * teinte ne suffit pas — un écran pâle, un œil qui distingue mal les couleurs,
 * une vignette de vingt-deux pixels. La seconde est toujours la plus claire,
 * donc tous les visages s'éclairent du même côté : ce n'est pas un hasard qu'on
 * subit, c'est une lumière commune.
 */
const LIGHT_LIFT = 12;
const LIGHT_MAX = 78;

/**
 * Le quart de tour par lequel le dégradé passe.
 *
 * **Deux complémentaires ne peuvent pas se rejoindre directement.** Un
 * `linearGradient` SVG interpole en sRGB, composante par composante, et deux
 * teintes opposées s'y annulent : le milieu du dégradé tombe sur un gris. Vu
 * sur une planche de contact — une bonne moitié des visages était éclatante
 * aux angles et boueuse au centre, et cette incohérence-là est pire que l'une
 * ou l'autre.
 *
 * Une étape à mi-chemin sur la roue — un quart de tour, donc perpendiculaire
 * aux deux — tient la saturation tout du long : le dégradé contourne le gris
 * au lieu de le traverser. Le sens du contour sort du hachage, ce qui fait une
 * variation de plus sans rien coûter.
 */
const QUARTER = 90;

/**
 * Un `#rrggbb` minuscule depuis une teinte, une saturation et une clarté.
 *
 * Écrit ici plutôt qu'emprunté à three.js : ce module ne dépend de rien, et
 * c'est ce qui le rend testable en Node comme le reste de l'avatar.
 */
function hsl(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const byte = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

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
  // Deux teintes et non une, et la seconde est la complémentaire de la
  // première : un demi-tour sur la roue, donc l'écart de couleur le plus grand
  // qui existe, sans qu'aucun couple ait à être vérifié à la main. Saturation
  // et clarté sortent d'autres bits que la teinte, pour qu'elles varient
  // indépendamment d'elle. Le dégradé va en diagonale, ce qui se lit encore à
  // vingt-deux pixels.
  const hue = h % 360;
  const sat = SAT_MIN + ((h >>> 9) % SAT_SPAN);
  const light = LIGHT_MIN + ((h >>> 17) % LIGHT_SPAN);
  const lightTo = Math.min(LIGHT_MAX, light + LIGHT_LIFT);
  const turn = (h >>> 5) & 1 ? QUARTER : -QUARTER;
  const from = hsl(hue, sat, light);
  const via = hsl((hue + turn + 360) % 360, sat, (light + lightTo) / 2);
  const to = hsl((hue + 180) % 360, sat, lightTo);
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
    `<stop offset="0" stop-color="${from}"/>` +
    `<stop offset="0.5" stop-color="${via}"/>` +
    `<stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>${cells}</svg>`
  );
}
