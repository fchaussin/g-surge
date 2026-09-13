/**
 * Les comptes : OpenID Connect dans le Worker, des sessions en D1.
 *
 * Le flux est celui du code d'autorisation, sans rien d'exotique : le jeu
 * envoie le joueur sur `/auth/:provider/start`, le Worker le redirige chez le
 * fournisseur avec un `state` signé ; le fournisseur le ramène sur
 * `/auth/:provider/callback` avec un code ; le Worker échange le code contre
 * un `id_token`, en vérifie la signature sur les clés publiques du
 * fournisseur, crée ou retrouve le compte, ouvre une session, et renvoie le
 * joueur au jeu avec le jeton de session dans le fragment de l'URL.
 *
 * **Un jeton porteur, pas un cookie.** L'API et le jeu ne sont pas sur la
 * même origine — `gsurge-api.w23.fr` et `g-surge.w23.fr` en production, et
 * `*.workers.dev` face à `*.pages.dev` en préversion, où un cookie serait
 * tiers et bloqué par les navigateurs modernes. Un jeton dans
 * `Authorization` marche partout, ne connaît pas le CSRF, et se range dans
 * `localStorage` comme le reste des préférences. Le fragment d'URL ne part
 * jamais au serveur ni dans les journaux : c'est pour cela qu'il porte le
 * jeton, et le client l'efface dès qu'il l'a lu.
 *
 * **Les fournisseurs sont une table**, une ligne par émetteur ; les adresses
 * viennent de la découverte OpenID de l'émetteur, jamais d'ici. Google est la
 * première ligne. Le fournisseur `test` n'existe que sous `DEBUG=1` et pointe
 * sur l'émetteur que `OIDC_TEST_ISSUER` nomme — un faux fournisseur monté
 * par les tests, qui signe avec une clé de test.
 *
 * **Deux champs par compte** : le sujet opaque du fournisseur et un nom.
 * Rien d'autre n'est lu de l'`id_token`, et la suppression du compte retire
 * chaque ligne qui le nomme — comptes, sessions, parties et leurs octets.
 */
import type { Env } from './index.js';
import { allowedOrigin } from './origins.js';

export interface Provider {
  /** L'émetteur, tel qu'il apparaît dans `iss`. Sa découverte est à `/.well-known/openid-configuration`. */
  issuer: string;
  /** Les variables du Worker qui portent l'id et le secret du client. */
  clientIdVar: 'GOOGLE_CLIENT_ID' | 'OIDC_TEST_CLIENT_ID';
  clientSecretVar: 'GOOGLE_CLIENT_SECRET' | 'OIDC_TEST_CLIENT_SECRET';
  /** Les autres formes que `iss` peut prendre chez ce fournisseur. */
  aliases?: readonly string[];
}

const GOOGLE: Provider = {
  issuer: 'https://accounts.google.com',
  clientIdVar: 'GOOGLE_CLIENT_ID',
  clientSecretVar: 'GOOGLE_CLIENT_SECRET',
  // Google signe parfois `iss` sans le schéma, et le dit dans sa documentation.
  aliases: ['accounts.google.com'],
};

/** Ce qu'un fournisseur résolu contre l'environnement donne. `null` : inconnu ou non configuré. */
export interface Resolved {
  name: string;
  issuer: string;
  aliases: readonly string[];
  clientId: string;
  clientSecret: string;
}

export function providerFor(name: string, env: Env): Resolved | null {
  let p: Provider | null = null;
  if (name === 'google') p = GOOGLE;
  else if (name === 'test' && env.DEBUG === '1' && env.OIDC_TEST_ISSUER) {
    p = {
      issuer: env.OIDC_TEST_ISSUER,
      clientIdVar: 'OIDC_TEST_CLIENT_ID',
      clientSecretVar: 'OIDC_TEST_CLIENT_SECRET',
    };
  }
  if (!p) return null;
  const clientId = env[p.clientIdVar];
  const clientSecret = env[p.clientSecretVar];
  if (!clientId || !clientSecret) return null;
  // Sans secret de session digne de ce nom, pas de connexion du tout : le
  // `state` signé est ce qui empêche un retour forgé, et un secret court se
  // devine. `/health` ne liste alors aucun fournisseur, le menu n'offre rien.
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < MIN_SECRET) return null;
  return { name, issuer: p.issuer, aliases: p.aliases ?? [], clientId, clientSecret };
}

/** Durée d'une session, et d'un `state` en attente. */
export const SESSION_MS = 30 * 24 * 3600 * 1000;
const STATE_MS = 10 * 60 * 1000;
/** Longueur minimale de `SESSION_SECRET`, en caractères. */
export const MIN_SECRET = 32;
/**
 * Le cookie qui lie le retour au navigateur qui a commencé. Posé sur
 * l'origine de l'API au départ, exigé au retour : une URL de retour
 * interceptée et envoyée à quelqu'un d'autre ne vaut rien chez lui, il n'a
 * pas le cookie. `SameSite=Lax` suffit — le retour du fournisseur est une
 * navigation de premier niveau, et celles-là portent les cookies Lax.
 */
export const BIND_COOKIE = 'gs_auth';

/* ------------------------------------------------------------ encodage -- */

const enc = new TextEncoder();

function toB64u(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const randomB64u = (bytes: number): string => toB64u(crypto.getRandomValues(new Uint8Array(bytes)));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toB64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* --------------------------------------------------------------- state -- */

interface State {
  /** Le fournisseur, pour que le retour ne puisse pas être rejoué chez un autre. */
  p: string;
  /** L'origine du jeu à laquelle renvoyer. */
  r: string;
  /** Le nonce attendu dans l'`id_token`. */
  n: string;
  /** Expiration. */
  e: number;
}

async function signState(env: Env, state: State): Promise<string> {
  const payload = toB64u(enc.encode(JSON.stringify(state)));
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

/** Comparaison à temps constant : la durée ne dit pas où deux condensés divergent. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readState(env: Env, token: string, now: number): Promise<State | null> {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  if (!sameDigest(await hmac(env.SESSION_SECRET, payload), token.slice(dot + 1))) return null;
  try {
    const state = JSON.parse(new TextDecoder().decode(fromB64u(payload))) as State;
    if (typeof state.e !== 'number' || state.e < now) return null;
    return state;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- découverte -- */

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
}

/** Découverte et clés, gardées le temps de vie de l'isolat. Une clé inconnue relit. */
const discoveries = new Map<string, Discovery>();
const keyStores = new Map<string, Jwk[]>();

async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveries.get(issuer);
  if (cached) return cached;
  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error('discovery');
  const d = (await res.json()) as Discovery;
  discoveries.set(issuer, d);
  return d;
}

async function keysOf(issuer: string, kid: string | undefined, retry = true): Promise<Jwk | null> {
  let keys = keyStores.get(issuer);
  if (!keys) {
    const { jwks_uri } = await discover(issuer);
    const res = await fetch(jwks_uri);
    if (!res.ok) throw new Error('jwks');
    keys = ((await res.json()) as { keys: Jwk[] }).keys;
    keyStores.set(issuer, keys);
  }
  const found = keys.find((k) => k.kty === 'RSA' && (kid === undefined || k.kid === kid));
  if (found || !retry) return found ?? null;
  // Une rotation de clés : on relit une fois, pas plus.
  keyStores.delete(issuer);
  return keysOf(issuer, kid, false);
}

/* ------------------------------------------------------------ id_token -- */

interface Claims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  nonce?: string;
  name?: string;
}

/** Vérifie signature, émetteur, audience, expiration et nonce. `null` si l'un manque. */
async function verifyIdToken(
  provider: Resolved,
  jwt: string,
  nonce: string,
  now: number,
): Promise<Claims | null> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: Claims;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64u(h))) as { alg?: string; kid?: string };
    claims = JSON.parse(new TextDecoder().decode(fromB64u(p))) as Claims;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  const jwk = await keysOf(provider.issuer, header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    fromB64u(s),
    enc.encode(`${h}.${p}`),
  );
  if (!ok) return null;
  const issuers = [provider.issuer, ...provider.aliases];
  if (!issuers.includes(claims.iss)) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(provider.clientId)) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
  if (claims.nonce !== nonce) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  return claims;
}

/* ---------------------------------------------------------------- flux -- */

/** Le départ : l'URL chez le fournisseur et le cookie de liaison à poser. `null` si l'origine de retour n'est pas la nôtre. */
export async function startUrl(
  env: Env,
  provider: Resolved,
  returnTo: string,
  callbackUrl: string,
  now: number,
): Promise<{ url: string; bind: string } | null> {
  if (!allowedOrigin(returnTo)) return null;
  const nonce = randomB64u(16);
  const state = await signState(env, {
    p: provider.name,
    r: returnTo,
    n: nonce,
    e: now + STATE_MS,
  });
  const { authorization_endpoint } = await discover(provider.issuer);
  const url = new URL(authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  return { url: url.toString(), bind: await hmac(env.SESSION_SECRET, `bind:${state}`) };
}

export type Finished = { returnTo: string; token: string } | { error: string };

/** Le retour du fournisseur : le code devient une session. */
export async function finish(
  env: Env,
  provider: Resolved,
  url: URL,
  callbackUrl: string,
  bind: string | null,
  now: number,
): Promise<Finished> {
  const code = url.searchParams.get('code');
  const stateToken = url.searchParams.get('state');
  if (!code || !stateToken) return { error: 'callback' };
  // Le navigateur qui revient est celui qui est parti, ou rien ne se passe.
  if (!bind || !sameDigest(bind, await hmac(env.SESSION_SECRET, `bind:${stateToken}`)))
    return { error: 'bind' };
  const state = await readState(env, stateToken, now);
  if (!state || state.p !== provider.name) return { error: 'state' };
  // La signature ne suffit pas : l'origine de retour est revérifiée ici, où
  // le jeton part. Un `state` forgé avec un secret deviné y enverrait sinon
  // la session d'une victime.
  if (!allowedOrigin(state.r)) return { error: 'state' };

  const { token_endpoint } = await discover(provider.issuer);
  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
    }),
  });
  if (!res.ok) return { error: 'token' };
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) return { error: 'token' };
  const claims = await verifyIdToken(provider, id_token, state.n, now);
  if (!claims) return { error: 'id_token' };

  const name = displayName(claims.name);
  const account = await upsertAccount(env, provider.name, claims.sub, name, now);
  const token = await openSession(env, account, now);
  return { returnTo: state.r, token };
}

/** Le nom que le fournisseur donne, borné ; `PILOT` s'il n'en donne pas. */
function displayName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, 16) : '';
  return s.length >= 2 ? s : 'PILOT';
}

/* ------------------------------------------------------------ comptes -- */

export interface Account {
  id: number;
  name: string;
}

async function upsertAccount(
  env: Env,
  provider: string,
  subject: string,
  name: string,
  now: number,
): Promise<number> {
  await env.DB.prepare(
    `INSERT INTO accounts (provider, subject, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (provider, subject) DO UPDATE SET name = excluded.name`,
  )
    .bind(provider, subject, name, now)
    .run();
  const row = await env.DB.prepare('SELECT id FROM accounts WHERE provider = ? AND subject = ?')
    .bind(provider, subject)
    .first<{ id: number }>();
  if (!row) throw new Error('account');
  return row.id;
}

/** Ouvre une session et rend le jeton. En base, seul son condensé : une fuite de la base ne fuit pas les jetons. */
async function openSession(env: Env, accountId: number, now: number): Promise<string> {
  const token = randomB64u(32);
  await env.DB.prepare('INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), accountId, now + SESSION_MS)
    .run();
  return token;
}

/** Le compte derrière `Authorization: Bearer …`, ou `null`. */
export async function accountOf(env: Env, req: Request, now: number): Promise<Account | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT a.id AS id, a.name AS name FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), now)
    .first<Account>();
  return row ?? null;
}

/** Ferme la session que la requête porte. Sans session, ne fait rien. */
export async function logout(env: Env, req: Request): Promise<void> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
    .bind(await sha256Hex(auth.slice(7).trim()))
    .run();
}

/** Supprime le compte et chaque ligne qui le nomme : sessions, parties, et leurs octets. */
export async function deleteAccount(env: Env, accountId: number): Promise<void> {
  const db = env.DB;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(accountId),
    db.prepare('DELETE FROM runs WHERE account_id = ?').bind(accountId),
    db.prepare('DELETE FROM traces WHERE run_id NOT IN (SELECT id FROM runs)'),
    db.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId),
  ]);
}

/**
 * Une session sans fournisseur, sous `DEBUG=1` seulement : le développement
 * local et les tests ont besoin d'un compte sans passer par une redirection.
 * Jamais en production, où `DEBUG` n'est pas posé.
 */
export async function debugLogin(env: Env, name: string, now: number): Promise<string> {
  const account = await upsertAccount(env, 'debug', name, displayName(name), now);
  return openSession(env, account, now);
}
