/**
 * Les photos déjà vues, sur cet appareil et nulle part ailleurs.
 *
 * Le serveur n'en garde aucune — c'est la décision du 14 septembre 2026, et
 * `server/src/auth.ts` dit par où elles passent à la place : le fragment du
 * retour de connexion, puis le salon d'un duel, qui meurt avec la course. La
 * conséquence est qu'une liste d'amis ne peut pas les servir : elle ne les a
 * pas. Alors le seul endroit qui puisse s'en souvenir est celui qui les a
 * vues, et c'est ici — `localStorage`, comme les préférences et la session.
 *
 * La clé est la graine du visage, `face`, qui tient au compte et survit à un
 * changement de pseudo : un ami croisé en duel garde son visage dans la liste.
 *
 * Deux gardes. L'hôte est revérifié à la lecture : le stockage est celui du
 * joueur, il peut y écrire ce qu'il veut, et ce qui en sort finit dans un
 * `<img>`. Et la table est bornée — il n'y a aucune raison de se souvenir de
 * cent visages, et un stockage qui grossit sans fin finit par échouer.
 */
import { avatarSvg } from './avatar.js';

const KEY = 'gsurge.photos.v1';
/** Combien de visages on garde. Au-delà, les plus anciens partent. */
const KEEP = 40;

/** La même règle que le serveur : seul l'hôte du fournisseur est chargé. */
const fromProvider = (url: unknown): url is string =>
  typeof url === 'string' &&
  url.length <= 300 &&
  /^https:\/\/lh\d+\.googleusercontent\.com\/[A-Za-z0-9_\-./=]+$/.test(url);

type Table = Record<string, string>;

function read(): Table {
  try {
    const raw = window.localStorage.getItem(KEY);
    const table = raw ? (JSON.parse(raw) as unknown) : null;
    if (!table || typeof table !== 'object') return {};
    const out: Table = {};
    for (const [face, url] of Object.entries(table as Table)) {
      if (fromProvider(url)) out[face] = url;
    }
    return out;
  } catch {
    // navigation privée, stockage plein, JSON abîmé : on oublie, sans bruit
    return {};
  }
}

/** La photo connue pour cette graine de visage, ou `null`. */
export function photoFor(face: string | undefined): string | null {
  if (!face) return null;
  return read()[face] ?? null;
}

/**
 * Un pilote à montrer : le nom, sa graine de visage quand il en a une, et sa
 * photo quand elle vient d'arriver — c'est le cas d'un rival, que le salon
 * présente, et le nôtre juste après une connexion.
 */
export interface Facing {
  name: string;
  face?: string;
  pic?: string;
}

/**
 * La clé du magasin : la graine du visage, qui tient au compte. À défaut — un
 * serveur d'avant, une partie sans compte — le nom, faute de mieux ; c'est
 * aussi la graine des pixels, donc les deux restent d'accord.
 */
const keyOf = (who: Facing): string => who.face ?? who.name;

/**
 * **Le seul endroit qui décide quel visage montrer.** La photo qu'on vient de
 * recevoir, sinon celle que l'appareil a retenue de ce compte, sinon les
 * pixels. Le tout keyé sur le compte et non sur une clé unique : c'est ce qui
 * faisait qu'un changement de compte gardait la photo du précédent.
 */
export function faceHtml(who: Facing | null, size = 22): string {
  if (!who) return '';
  const url = who.pic ?? photoFor(keyOf(who));
  return url
    ? `<img class="photo" width="${size}" height="${size}" alt="" ` +
        `referrerpolicy="no-referrer" src="${url.replace(/"/g, '&quot;')}">`
    : avatarSvg(keyOf(who), size);
}

/** Compte les peintures par élément : une photo en retard ne recouvre pas la suivante. */
const painting = new WeakMap<HTMLElement, number>();

/**
 * Le visage d'un pilote dans un élément : ses pixels d'abord, sa photo par
 * dessus dès qu'elle charge.
 *
 * Dans cet ordre et pas l'inverse : rien ne garantit qu'une adresse donnée à
 * la connexion vaille encore trente jours plus tard — le fournisseur les fait
 * tourner — et l'échange se faisant au chargement, une photo absente ne laisse
 * jamais de trou. Le jeton écarte la course inverse : un compte qui change
 * pendant qu'une photo charge ne doit pas voir l'ancienne se poser après.
 */
export function paintFace(el: HTMLElement, who: Facing | null, size = 22): void {
  const turn = (painting.get(el) ?? 0) + 1;
  painting.set(el, turn);
  el.innerHTML = who ? avatarSvg(keyOf(who), size) : '';
  if (!who) return;
  // Ce qu'on apprend d'un pilote, on le garde : la liste d'amis n'a pas d'autre
  // source, le serveur n'en gardant aucune.
  if (who.pic) rememberPhoto(keyOf(who), who.pic);
  const url = who.pic ?? photoFor(keyOf(who));
  if (!url) return;
  const img = new Image(size, size);
  img.className = 'photo';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    if (painting.get(el) === turn) el.replaceChildren(img);
  };
  img.src = url;
}

/**
 * Se souvient de la photo d'un pilote croisé. Sans photo, la ligne est
 * effacée : une photo retirée chez le fournisseur ne doit pas survivre ici.
 */
export function rememberPhoto(face: string | undefined, url: string | undefined): void {
  if (!face) return;
  const table = read();
  if (fromProvider(url)) {
    if (table[face] === url) return;
    delete table[face];
    table[face] = url;
  } else {
    if (!(face in table)) return;
    delete table[face];
  }
  const keys = Object.keys(table);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) delete table[old];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    // rien à faire : le visage en pixels reste
  }
}
