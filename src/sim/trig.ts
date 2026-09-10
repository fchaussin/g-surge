/**
 * Trigonométrie déterministe, propriété du noyau.
 *
 * `Math.cos` est pure mais pas *spécifiée* : ECMAScript n'exige pas l'arrondi
 * correct pour les transcendantes, chaque moteur choisit son implémentation, et
 * deux moteurs peuvent rendre un dernier bit différent sur le même argument.
 * Mesuré ici même — voir `TECH-DEBT.md` §17. C'est exactement la même fuite que
 * `Math.random` et `Date.now`, que `src/sim/` s'interdit déjà : une dépendance
 * implicite à la plateforme, dans un noyau dont le déterminisme est la propriété
 * qui le rend rejouable et arbitrable côté serveur.
 *
 * La réponse est la même que pour l'aléatoire : le noyau porte sa propre
 * implémentation au lieu d'emprunter celle de l'hôte. `rng.ts` pour le hasard,
 * `clock.ts` pour le temps, ce module pour les transcendantes.
 *
 * **Pourquoi ce code-ci est déterministe, lui.** Il n'emploie que `+ - * /`, des
 * comparaisons et de la lecture de bits. ECMAScript spécifie ces opérations
 * comme IEEE 754 binary64, arrondi au plus proche pair, sans FMA ni précision
 * étendue : leur résultat est identique au bit près sur tout moteur conforme.
 * La transcendante est ramenée à une suite d'opérations qui, elles, ne varient
 * pas.
 *
 * **Provenance.** Portage de fdlibm (`s_sin.c`, `s_cos.c`, `s_atan.c`,
 * `e_rem_pio2.c`), qui est aussi ce dont V8 dérive `Math`. Ce n'est pas un
 * hasard, c'est le but : sur les 480 000 arguments qu'une partie produit
 * réellement, ce module rend le même bit que `Math` sous Node, donc les
 * références gelées ne bougent pas. Voir `tests/trig.test.ts`.
 *
 * **Domaine.** Fidèle au chemin « medium » de fdlibm, soit |x| < 2^20·π/2
 * ≈ 1,6e6 rad. Au-delà, fdlibm bascule sur une réduction de Payne-Hanek qui
 * n'est pas portée ici : le résultat y reste parfaitement déterministe, il
 * perd seulement en exactitude. Le jeu plafonne à 44 rad, quatre ordres de
 * grandeur en dessous, et un lacet de piste n'a pas de raison de croître : il
 * est reconstruit à chaque image depuis le vaisseau.
 */

// Lecture du mot de poids fort d'un double. `DataView` est explicitement
// gros-boutiste, contrairement à une vue Uint32Array dont l'ordre dépendrait de
// la machine — ce qui réintroduirait exactement la variabilité qu'on retire.
const BITS = new DataView(new ArrayBuffer(8));

function hiWord(x: number): number {
  BITS.setFloat64(0, x);
  return BITS.getUint32(0);
}

/** |x|/4, mantisse tronquée aux 20 bits de poids fort, depuis son mot haut. */
function quarterTrunc(ix: number): number {
  BITS.setUint32(0, ix - 0x00200000);
  BITS.setUint32(4, 0);
  return BITS.getFloat64(0);
}

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

/**
 * sin sur [-π/4, π/4]. `y` est la queue de la réduction d'argument : la partie
 * de x que le double du reste ne peut pas porter, et sans laquelle la précision
 * s'effondre près des multiples de π/2.
 */
function kernelSin(x: number, y: number, withTail: boolean): number {
  // Sous 2^-27 le polynôme ne peut plus rien ajouter, et le renvoi direct est
  // aussi ce qui préserve le signe de zéro : sin(-0) vaut -0, alors que le
  // polynôme rendrait +0.
  if (Math.abs(x) < 7.450580596923828e-9) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (!withTail) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748e-9;
const C6 = -1.13596475577881948265e-11;

/**
 * cos sur [-π/4, π/4], même convention de queue.
 *
 * Le détour par `qx` au-dessus de 0,3 rad n'est pas décoratif : il retire de
 * `1 - z/2` une constante exacte avant la soustraction, ce qui évite d'annuler
 * les bits de poids fort du polynôme.
 */
function kernelCos(x: number, y: number): number {
  if (Math.abs(x) < 7.450580596923828e-9) return 1;
  const ix = hiWord(x) & 0x7fffffff;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y)); // |x| < 0,3
  const qx = ix > 0x3fe90000 ? 0.28125 : quarterTrunc(ix); // |x| > 0,78125
  const hz = 0.5 * z - qx;
  return 1 - qx - (hz - (z * r - x * y));
}

// π/2 découpé en trois morceaux de 33 bits utiles. Chaque produit n·PIO2_k est
// alors exact, donc la soustraction ne perd aucun bit : c'est ce découpage qui
// fait toute la précision de la réduction.
const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.0222662487111664558e-21;
const PIO2_3T = 8.47842766036889956997e-32;

/** Mots hauts de 1·π/2 … 32·π/2, pour repérer les arguments qui annulent. */
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb,
  0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb,
  0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];

/** Reste de la réduction, réutilisé d'un appel à l'autre : rien n'est alloué. */
const REM = { hi: 0, lo: 0 };

/**
 * Écrit dans `REM` le reste r tel que x = n·π/2 + r, |r| <= π/4, et renvoie n.
 *
 * Un seul tour suffit sauf quand x tombe près d'un multiple de π/2 : la
 * soustraction y annule les bits de poids fort et il faut ressortir les
 * morceaux suivants de π/2. La perte est détectée en comparant les exposants
 * avant et après, pas devinée.
 */
function remPio2(x: number, ix: number): number {
  const negative = (hiWord(x) & 0x80000000) !== 0;
  const t = Math.abs(x);
  const n = Math.round(t * INVPIO2);
  let r = t - n * PIO2_1;
  let w = n * PIO2_1T;
  let hi: number;

  if (n < 32 && ix !== NPIO2_HW[n - 1]) {
    hi = r - w; // pas d'annulation possible, un tour suffit
  } else {
    const j = ix >>> 20;
    hi = r - w;
    let lost = j - ((hiWord(hi) >>> 20) & 0x7ff);
    if (lost > 16) {
      const t2 = r;
      w = n * PIO2_2;
      r = t2 - w;
      w = n * PIO2_2T - (t2 - r - w);
      hi = r - w;
      lost = j - ((hiWord(hi) >>> 20) & 0x7ff);
      if (lost > 49) {
        const t3 = r;
        w = n * PIO2_3;
        r = t3 - w;
        w = n * PIO2_3T - (t3 - r - w);
        hi = r - w;
      }
    }
  }

  const lo = r - hi - w;
  REM.hi = negative ? -hi : hi;
  REM.lo = negative ? -lo : lo;
  return negative ? -n : n;
}

/** Quadrant dans [0, 3]. `%` garde le signe en JS, contrairement au `&` du C. */
const quadrant = (n: number): number => ((n % 4) + 4) % 4;

/** Sinus, en radians. Remplace `Math.sin` dans le noyau. */
export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, false); // |x| <= π/4
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x, ix);
  switch (quadrant(n)) {
    case 0:
      return kernelSin(REM.hi, REM.lo, true);
    case 1:
      return kernelCos(REM.hi, REM.lo);
    case 2:
      return -kernelSin(REM.hi, REM.lo, true);
    default:
      return -kernelCos(REM.hi, REM.lo);
  }
}

/** Cosinus, en radians. Remplace `Math.cos` dans le noyau. */
export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x, ix);
  switch (quadrant(n)) {
    case 0:
      return kernelCos(REM.hi, REM.lo);
    case 1:
      return -kernelSin(REM.hi, REM.lo, true);
    case 2:
      return -kernelCos(REM.hi, REM.lo);
    default:
      return kernelSin(REM.hi, REM.lo, true);
  }
}

const ATAN_HI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1,
  1.570796326794896558,
];
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1,
  -1.1111110405462355788e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2,
  -3.6531572744216915527e-2, 1.62858201153657823623e-2,
];
const PIO2 = 1.5707963267948966;

/**
 * Arc tangente, en radians. Remplace `Math.atan` dans le noyau.
 *
 * L'argument est ramené dans [0, 0,4375] par une des quatre identités
 * d'addition, puis le polynôme n'a plus qu'un petit intervalle à couvrir.
 */
export function atan(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  const negative = (hx & 0x80000000) !== 0;
  if (ix >= 0x7ff00000) return ix > 0x7ff00000 ? NaN : negative ? -PIO2 : PIO2;

  let a = Math.abs(x);
  let id: number;
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000) return x; // trop petit pour que le polynôme change quoi que ce soit
    id = -1;
  } else if (ix < 0x3ff30000) {
    if (ix < 0x3fe60000) {
      id = 0;
      a = (2 * a - 1) / (2 + a);
    } else {
      id = 1;
      a = (a - 1) / (a + 1);
    }
  } else if (ix < 0x40038000) {
    id = 2;
    a = (a - 1.5) / (1 + 1.5 * a);
  } else {
    id = 3;
    a = -1 / a;
  }

  const z = a * a;
  const w = z * z;
  const odd =
    z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const even = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return x - x * (odd + even);
  const r = ATAN_HI[id]! - (a * (odd + even) - ATAN_LO[id]! - a);
  return negative ? -r : r;
}
