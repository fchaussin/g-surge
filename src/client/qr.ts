/**
 * Un QR code, dessiné sur un canvas, sans bibliothèque.
 *
 * Le lien d'invitation d'un duel doit passer d'un téléphone à l'autre sans
 * clavier : on montre le code, l'autre le lit. Ce module encode une chaîne
 * en mode octets, niveau de correction M, versions 1 à 6 — jusqu'à 108
 * octets, deux fois une adresse d'invitation — et ne fait que ça. Rien du
 * reste de la norme : ni kanji, ni numérique, ni les versions hautes et leurs
 * bits de version. Un lien ne les demande pas.
 *
 * Écrit d'après ISO/IEC 18004 : la génération de galois sur x^8+x^4+x^3+x^2+1,
 * les huit masques, la pénalité d'évaluation des masques, les motifs de
 * repérage et d'alignement, les bits de format. Le test qui compte est la
 * lecture par l'appareil photo d'un téléphone ; le test automatique ne
 * vérifie que la forme — taille, motifs de repérage, zone calme.
 */

/* ---------------------------------------------------- galois GF(256) -- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0);

/** Le polynôme générateur de degré `n`. */
function generator(n: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]!;
      next[j + 1] ^= mul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  return g;
}

function ecBytes(data: Uint8Array, n: number): Uint8Array {
  const g = generator(n);
  const rest = new Uint8Array(data.length + n);
  rest.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = rest[i]!;
    if (!c) continue;
    for (let j = 0; j < g.length; j++) rest[i + j] ^= mul(g[j]!, c);
  }
  return rest.subarray(data.length);
}

/* ------------------------------------------------------ les versions -- */

/**
 * Niveau M, versions 1 à 10 : octets de données par bloc, nombre de blocs
 * du premier groupe, octets de données du second groupe, nombre de blocs du
 * second, octets de correction par bloc. Table 9 de la norme.
 */
const VERSIONS: readonly [number, number, number, number, number][] = [
  [16, 1, 0, 0, 10],
  [28, 1, 0, 0, 16],
  [44, 1, 0, 0, 26],
  [32, 2, 0, 0, 18],
  [43, 2, 0, 0, 24],
  [27, 4, 0, 0, 16],
];

/** Position des motifs d'alignement par version (table E.1), à partir de la 2. */
const ALIGN: readonly number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

/* ------------------------------------------------------- l'encodage -- */

function pickVersion(bytes: number): number {
  for (let v = 0; v < VERSIONS.length; v++) {
    const [d1, n1, d2, n2] = VERSIONS[v]!;
    const capacity = d1 * n1 + d2 * n2;
    // mode 4 bits + longueur 8 bits + les octets
    const header = 12;
    if (capacity * 8 >= header + bytes * 8) return v + 1;
  }
  throw new Error('qr: too long');
}

function encode(text: string): { size: number; modules: Uint8Array } {
  const data = new TextEncoder().encode(text);
  const version = pickVersion(data.length);
  const [d1, n1, d2, n2, ec] = VERSIONS[version - 1]!;
  const total = d1 * n1 + d2 * n2;

  // le flux de bits : mode, longueur, octets, terminateur, bourrage
  const bits: number[] = [];
  const push = (v: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
  };
  push(0b0100, 4);
  push(data.length, 8);
  for (const b of data) push(b, 8);
  push(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const words = new Uint8Array(total);
  for (let i = 0; i < bits.length / 8; i++) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i * 8 + j]!;
    words[i] = w;
  }
  for (let i = bits.length / 8, k = 0; i < total; i++, k++) words[i] = k % 2 ? 0x11 : 0xec;

  // les blocs, et leur entrelacement
  const blocks: Uint8Array[] = [];
  let at = 0;
  for (let i = 0; i < n1; i++) blocks.push(words.subarray(at, (at += d1)));
  for (let i = 0; i < n2; i++) blocks.push(words.subarray(at, (at += d2)));
  const ecs = blocks.map((b) => ecBytes(b, ec));
  const out: number[] = [];
  const longest = Math.max(d1, d2);
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]!);

  // la matrice : motifs fixes d'abord, puis les données en serpentin
  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const set = (x: number, y: number, v: number): void => {
    modules[y * size + x] = v;
    fixed[y * size + x] = 1;
  };
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const r = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, r === 2 || r === 4 ? 0 : 1);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0 ? 1 : 0);
    set(6, i, i % 2 === 0 ? 1 : 0);
  }
  const centres = ALIGN[version - 1]!;
  for (const cy of centres)
    for (const cx of centres) {
      if (fixed[cy * size + cx]) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const r = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, r === 1 ? 0 : 1);
        }
    }
  // les zones de format, réservées maintenant, écrites après le masque
  for (let i = 0; i < 9; i++) {
    set(i, 8, 0);
    set(8, i, 0);
    if (i < 8) {
      set(size - 1 - i, 8, 0);
      set(8, size - 1 - i, 0);
    }
  }
  set(8, size - 8, 1);

  // les données, colonnes par deux, de droite à gauche, en montant puis descendant
  let bit = 0;
  const total8 = out.length * 8;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (const x of [col, col - 1]) {
        if (fixed[y * size + x]) continue;
        const v = bit < total8 ? (out[bit >> 3]! >> (7 - (bit & 7))) & 1 : 0;
        modules[y * size + x] = v;
        bit++;
      }
    }
    up = !up;
  }

  // le masque : les huit essayés, le moins pénalisé gardé
  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  let best = 0;
  let bestScore = Infinity;
  let bestGrid: Uint8Array | null = null;
  for (let m = 0; m < 8; m++) {
    const grid = new Uint8Array(modules);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!fixed[y * size + x] && masks[m]!(x, y)) grid[y * size + x] ^= 1;
    writeFormat(grid, size, m);
    const score = penalty(grid, size);
    if (score < bestScore) {
      bestScore = score;
      best = m;
      bestGrid = grid;
    }
  }
  void best;
  return { size, modules: bestGrid! };
}

/**
 * Les quinze bits de format — niveau M et masque, codés BCH(15,5), masqués
 * par 0x5412 — posés deux fois, aux emplacements de la figure 25 de la
 * norme : autour du repère haut-gauche, et le long des deux autres.
 */
function writeFormat(grid: Uint8Array, size: number, mask: number): void {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) & 1 ? 0x537 : 0);
  const bitsv = ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  const bit = (i: number): number => (bitsv >> i) & 1;
  const put = (x: number, y: number, v: number): void => {
    grid[y * size + x] = v;
  };
  // première copie, autour du repère haut-gauche
  for (let i = 0; i <= 5; i++) put(8, i, bit(i));
  put(8, 7, bit(6));
  put(8, 8, bit(7));
  put(7, 8, bit(8));
  for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
  // seconde copie, sous le repère haut-droit et à droite du repère bas-gauche
  for (let i = 0; i <= 7; i++) put(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
  put(8, size - 8, 1);
}

/** La pénalité de la norme : suites, blocs 2×2, faux motifs de repérage, déséquilibre. */
function penalty(g: Uint8Array, n: number): number {
  let p = 0;
  const at = (x: number, y: number): number => g[y * n + x]!;
  for (let y = 0; y < n; y++) {
    let run = 1;
    for (let x = 1; x < n; x++) {
      if (at(x, y) === at(x - 1, y)) {
        run++;
        if (run === 5) p += 3;
        else if (run > 5) p++;
      } else run = 1;
    }
  }
  for (let x = 0; x < n; x++) {
    let run = 1;
    for (let y = 1; y < n; y++) {
      if (at(x, y) === at(x, y - 1)) {
        run++;
        if (run === 5) p += 3;
        else if (run > 5) p++;
      } else run = 1;
    }
  }
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3;
    }
  const pat = [1, 0, 1, 1, 1, 0, 1];
  const check = (get: (i: number) => number, len: number): void => {
    for (let i = 0; i + 7 <= len; i++) {
      let ok = true;
      for (let k = 0; k < 7; k++) if (get(i + k) !== pat[k]) ok = false;
      if (!ok) continue;
      let before = true;
      let after = true;
      for (let k = 1; k <= 4; k++) {
        if (i - k < 0 || get(i - k) !== 0) before = false;
        if (i + 6 + k >= len || get(i + 6 + k) !== 0) after = false;
      }
      if (before || after) p += 40;
    }
  };
  for (let y = 0; y < n; y++) check((i) => at(i, y), n);
  for (let x = 0; x < n; x++) check((i) => at(x, i), n);
  let dark = 0;
  for (let i = 0; i < g.length; i++) dark += g[i]!;
  const ratio = Math.abs((dark * 100) / g.length - 50);
  p += Math.floor(ratio / 5) * 10;
  return p;
}

/** Dessine `text` en QR sur le canvas, avec une marge de quatre modules, à la taille du canvas. */
export function drawQr(canvas: HTMLCanvasElement, text: string): void {
  const { size, modules } = encode(text);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const quiet = 4;
  const cells = size + quiet * 2;
  const px = Math.max(1, Math.floor(canvas.width / cells));
  canvas.width = cells * px;
  canvas.height = cells * px;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (modules[y * size + x]) ctx.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
}
