/**
 * Les amis, et les défis.
 *
 * `MULTIPLAYER-ROADMAP.md` avait écarté les listes d'amis « jusqu'à ce qu'un
 * duel prouve qu'on en veut » ; le duel joué, l'auteur les a demandées le
 * 13 septembre 2026. Ce module est la moitié serveur.
 *
 * **Une amitié se demande et s'accepte.** Le code d'ami suffit à demander,
 * pas à lier : sans acceptation, quiconque a croisé un code pourrait remplir
 * la liste de quelqu'un et le défier. La demande inverse d'une demande en
 * attente vaut acceptation — deux personnes qui se donnent leur code en même
 * temps ne restent pas bloquées.
 *
 * **Un défi ne notifie personne.** Il n'y a ni présence ni push : le salon est
 * ouvert, la ligne est écrite, et l'ami la trouve en ouvrant le jeu. Elle
 * expire, parce qu'un salon que personne ne rejoint n'a pas à traîner —
 * `NETWORK.md` dit pourquoi la présence coûterait cher au plan gratuit, et
 * pourquoi elle n'est pas là.
 *
 * Ce qui sort d'ici sur un ami est ce que la grille de départ montre déjà :
 * un nom, un visage, un code. Jamais l'identifiant du compte ni son ULID.
 */
import type { Env } from './index.js';
import { faceOf } from './auth.js';

/** Durée d'un défi, en millisecondes. Dix minutes : le temps d'ouvrir le jeu. */
export const CHALLENGE_MS = 10 * 60 * 1000;

/** L'alphabet du code : ni O ni 0, ni I ni 1 — il se dicte à voix haute. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 6;

export function friendCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]!).join('');
}

/** Un pilote tel que son ami le voit. */
export interface Friend {
  name: string;
  face: string;
  code: string;
}

/** Un défi reçu : qui, quel salon, quelle difficulté. */
export interface Invite {
  id: number;
  from: Friend;
  room: string;
  difficulty: string;
}

interface Row {
  id: number;
  name: string;
  subject: string;
  code: string | null;
}

const asFriend = async (row: Row): Promise<Friend> => ({
  name: row.name,
  face: await faceOf(row.subject),
  code: row.code ?? '',
});

/**
 * Le code du compte, posé s'il n'en a pas encore — les comptes d'avant cette
 * migration en reçoivent un à leur première visite, comme pour l'ULID. La
 * collision est traitée en réessayant : l'index est unique, et six caractères
 * sur trente-deux en font un milliard.
 */
export async function codeOf(env: Env, accountId: number): Promise<string> {
  const row = await env.DB.prepare('SELECT code FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ code: string | null }>();
  if (row?.code) return row.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = friendCode();
    try {
      await env.DB.prepare('UPDATE accounts SET code = ? WHERE id = ?').bind(code, accountId).run();
      return code;
    } catch {
      // index unique : le tirage suivant
    }
  }
  return '';
}

/** Le compte derrière un code, ou `null`. */
async function byCode(env: Env, code: unknown): Promise<Row | null> {
  if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/.test(code.toUpperCase())) return null;
  return env.DB.prepare('SELECT id, name, subject, code FROM accounts WHERE code = ?')
    .bind(code.toUpperCase())
    .first<Row>();
}

/** Vrai si les deux comptes sont amis, dans un sens ou dans l'autre. */
export async function areFriends(env: Env, a: number, b: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM friends
     WHERE state = 'accepted' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))`,
  )
    .bind(a, b, b, a)
    .first<{ ok: number }>();
  return !!row;
}

/**
 * Tout ce que l'écran de duel montre, en un appel : mon code, mes amis, les
 * demandes que j'ai reçues, et les défis en cours. Un écran, une requête.
 */
export async function overview(
  env: Env,
  accountId: number,
  now: number,
): Promise<{ code: string; friends: Friend[]; requests: Friend[]; invites: Invite[] }> {
  const code = await codeOf(env, accountId);
  const accepted = await env.DB.prepare(
    `SELECT a.id AS id, a.name AS name, a.subject AS subject, a.code AS code
     FROM friends f JOIN accounts a
       ON a.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
     WHERE f.state = 'accepted' AND (f.a = ? OR f.b = ?)
     ORDER BY a.name`,
  )
    .bind(accountId, accountId, accountId)
    .all<Row>();
  const asked = await env.DB.prepare(
    `SELECT a.id AS id, a.name AS name, a.subject AS subject, a.code AS code
     FROM friends f JOIN accounts a ON a.id = f.a
     WHERE f.state = 'pending' AND f.b = ? ORDER BY f.created_at`,
  )
    .bind(accountId)
    .all<Row>();
  const challenges = await env.DB.prepare(
    `SELECT c.id AS cid, c.room AS room, c.difficulty AS difficulty,
            a.id AS id, a.name AS name, a.subject AS subject, a.code AS code
     FROM challenges c JOIN accounts a ON a.id = c.from_account
     WHERE c.to_account = ? AND c.expires_at > ? ORDER BY c.created_at DESC`,
  )
    .bind(accountId, now)
    .all<Row & { cid: number; room: string; difficulty: string }>();

  return {
    code,
    friends: await Promise.all(accepted.results.map(asFriend)),
    requests: await Promise.all(asked.results.map(asFriend)),
    invites: await Promise.all(
      challenges.results.map(async (row) => ({
        id: row.cid,
        from: await asFriend(row),
        room: row.room,
        difficulty: row.difficulty,
      })),
    ),
  };
}

/** Pourquoi un geste sur une amitié n'a pas abouti. */
export type FriendError = 'code' | 'self' | 'already' | 'not-friends';

/**
 * Demande une amitié par code. Une demande déjà reçue de l'autre côté est
 * acceptée plutôt que doublée.
 */
export async function request(
  env: Env,
  accountId: number,
  code: unknown,
  now: number,
): Promise<FriendError | null> {
  const other = await byCode(env, code);
  if (!other) return 'code';
  if (other.id === accountId) return 'self';
  const back = await env.DB.prepare('SELECT state FROM friends WHERE a = ? AND b = ?')
    .bind(other.id, accountId)
    .first<{ state: string }>();
  if (back) {
    if (back.state === 'accepted') return 'already';
    await env.DB.prepare(`UPDATE friends SET state = 'accepted' WHERE a = ? AND b = ?`)
      .bind(other.id, accountId)
      .run();
    return null;
  }
  const mine = await env.DB.prepare('SELECT state FROM friends WHERE a = ? AND b = ?')
    .bind(accountId, other.id)
    .first<{ state: string }>();
  if (mine) return 'already';
  await env.DB.prepare(`INSERT INTO friends (a, b, state, created_at) VALUES (?, ?, 'pending', ?)`)
    .bind(accountId, other.id, now)
    .run();
  return null;
}

/** Accepte une demande reçue. */
export async function accept(
  env: Env,
  accountId: number,
  code: unknown,
): Promise<FriendError | null> {
  const other = await byCode(env, code);
  if (!other) return 'code';
  const res = await env.DB.prepare(
    `UPDATE friends SET state = 'accepted' WHERE a = ? AND b = ? AND state = 'pending'`,
  )
    .bind(other.id, accountId)
    .run();
  return res.meta.changes ? null : 'not-friends';
}

/** Retire une amitié, ou refuse une demande : la ligne part, dans les deux sens. */
export async function remove(
  env: Env,
  accountId: number,
  code: unknown,
): Promise<FriendError | null> {
  const other = await byCode(env, code);
  if (!other) return 'code';
  await env.DB.prepare('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)')
    .bind(accountId, other.id, other.id, accountId)
    .run();
  return null;
}

/** Le compte visé par un défi, s'il est bien un ami. */
export async function challengeTarget(
  env: Env,
  accountId: number,
  code: unknown,
): Promise<{ id: number } | FriendError> {
  const other = await byCode(env, code);
  if (!other) return 'code';
  if (other.id === accountId) return 'self';
  if (!(await areFriends(env, accountId, other.id))) return 'not-friends';
  return { id: other.id };
}

/** Écrit le défi une fois le salon ouvert, et efface ceux qui ont expiré. */
export async function challenge(
  env: Env,
  from: number,
  to: number,
  room: string,
  difficulty: string,
  now: number,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM challenges WHERE expires_at <= ?').bind(now),
    env.DB.prepare(
      `INSERT INTO challenges (from_account, to_account, room, difficulty, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(from, to, room, difficulty, now, now + CHALLENGE_MS),
  ]);
}

/** Ce qu'une suppression de compte emporte avec elle. */
export function cleanup(env: Env, accountId: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM friends WHERE a = ? OR b = ?').bind(accountId, accountId),
    env.DB.prepare('DELETE FROM challenges WHERE from_account = ? OR to_account = ?').bind(
      accountId,
      accountId,
    ),
  ];
}
