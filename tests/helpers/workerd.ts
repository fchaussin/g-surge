/**
 * Le serveur dans workerd, monté pour un test.
 *
 * Le bundle est celui de `scripts/build-server.mjs` — le même qui sert
 * `wrangler dev` et le déploiement — chargé sous Miniflare avec les liaisons
 * que `server/wrangler.jsonc` déclare : l'objet durable en SQLite, seul
 * stockage du plan gratuit, la base D1 avec ses migrations jouées dans
 * l'ordre, `DEBUG=1` pour que l'heure feinte des tests soit lue, et les
 * secrets que le déploiement pose par `wrangler secret`, ici des valeurs de
 * test.
 *
 * **Un faux fournisseur OpenID vit à côté**, second Worker du même montage,
 * et tout ce que le serveur `fetch` vers l'extérieur arrive chez lui — c'est
 * `outboundService`. Il publie une découverte, une clé RSA de test et signe
 * des `id_token` : le flux de connexion se prouve de bout en bout dans
 * workerd, sans Google et sans réseau. Le vrai fournisseur n'est qu'une
 * ligne de configuration de plus, pas un chemin de code différent.
 *
 * Trois usages : `tests/server.test.ts`, qui vérifie ; `measure-server`, qui
 * mesure ; et `flare(extra)` seul quand un test veut une variable en plus.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { buildServer } from '../../scripts/build-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'server', 'dist', 'index.js');

const MIGRATIONS = [
  '0001_runs.sql',
  '0002_board.sql',
  '0003_speed_peak.sql',
  '0004_traces.sql',
  '0005_accounts.sql',
];

export type Vars = Record<string, { type: 'text'; value: string }>;

/** Ce que le faux fournisseur est, vu du serveur. */
export const IDP = {
  issuer: 'https://idp.test',
  clientId: 'gsurge-test',
  clientSecret: 'not-a-secret',
};

/**
 * Le faux fournisseur : un module ESM de quelques lignes. Il génère sa paire
 * de clés au premier appel, tient les codes en mémoire — un seul isolat — et
 * signe ce que `/token` rend. `sub` et `name` viennent du `login_hint` de
 * l'autorisation, pour qu'un test choisisse qui se connecte.
 */
const IDP_MODULE = `
let keys = null;
const codes = new Map();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();
async function keyPair() {
  if (keys) return keys;
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  keys = { priv: pair.privateKey, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid: 'test-1', alg: 'RS256', use: 'sig' } };
  return keys;
}
async function sign(claims) {
  const { priv } = await keyPair();
  const head = b64u(enc.encode(JSON.stringify({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, enc.encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const issuer = '${IDP.issuer}';
    if (url.pathname === '/.well-known/openid-configuration')
      return json({ issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks' });
    if (url.pathname === '/jwks') return json({ keys: [(await keyPair()).jwk] });
    if (url.pathname === '/authorize') {
      const code = crypto.randomUUID();
      const hint = url.searchParams.get('login_hint') ?? 'someone';
      codes.set(code, { nonce: url.searchParams.get('nonce'), aud: url.searchParams.get('client_id'), sub: hint, name: hint });
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state'));
      return Response.redirect(back.toString(), 302);
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(await req.text());
      const c = codes.get(form.get('code'));
      if (!c || form.get('client_secret') !== '${IDP.clientSecret}') return json({ error: 'invalid_grant' }, 400);
      codes.delete(form.get('code'));
      const now = Math.floor(Date.now() / 1000);
      const id_token = await sign({ iss: issuer, aud: c.aud, sub: c.sub, name: c.name, nonce: c.nonce, iat: now, exp: now + 300 });
      return json({ id_token, token_type: 'Bearer' });
    }
    return json({ error: 'not-found' }, 404);
  },
};
`;

/** Construit le bundle une fois ; rend l'empreinte du noyau qu'il porte. */
export async function buildOnce(): Promise<string> {
  return buildServer(SCRIPT);
}

/**
 * Le serveur sous Miniflare, sans base migrée, avec le faux fournisseur en
 * sortie. La forme de Miniflare 5 : la configuration d'un Worker telle que
 * Cloudflare la décrit, le bundle en manifeste, les liaisons sous `env`,
 * l'objet sous `exports`.
 */
export function flare(extra: Vars = {}): Miniflare {
  const text = (value: string) => ({ type: 'text' as const, value });
  return new Miniflare({
    workers: [
      {
        config: {
          name: 'api',
          type: 'worker',
          compatibilityDate: '2026-09-01',
          manifest: {
            mainModule: 'index.js',
            modules: { 'index.js': { type: 'esm', contents: readFileSync(SCRIPT, 'utf8') } },
          },
          env: {
            ARBITER: { type: 'durable-object', worker: 'api', exportName: 'Arbiter' },
            DB: { type: 'd1', id: 'gsurge' },
            DEBUG: text('1'),
            SESSION_SECRET: text('test-session-secret'),
            OIDC_TEST_ISSUER: text(IDP.issuer),
            OIDC_TEST_CLIENT_ID: text(IDP.clientId),
            OIDC_TEST_CLIENT_SECRET: text(IDP.clientSecret),
            ...extra,
          },
          exports: { Arbiter: { type: 'durable-object', storage: 'sqlite' } },
        },
        // Tout `fetch` sortant du serveur arrive chez le faux fournisseur. Sous
        // `dev`, à côté de la configuration : c'est là que Miniflare le lit.
        dev: { outboundService: { type: 'worker', worker: 'idp' } },
      },
      {
        config: {
          name: 'idp',
          type: 'worker',
          compatibilityDate: '2026-09-01',
          manifest: {
            mainModule: 'idp.js',
            modules: { 'idp.js': { type: 'esm', contents: IDP_MODULE } },
          },
        },
      },
    ],
  });
}

/** Joue les migrations de `server/migrations/`, dans l'ordre, sur la base de ce serveur. */
export async function migrate(mf: Miniflare): Promise<void> {
  const db = await mf.getD1Database('DB');
  for (const migration of MIGRATIONS) {
    const schema = readFileSync(join(ROOT, 'server', 'migrations', migration), 'utf8');
    // les commentaires d'abord, les instructions ensuite : un point-virgule dans
    // une phrase française couperait sinon une instruction en deux
    const statements = schema
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';');
    for (const stmt of statements) if (stmt.trim()) await db.prepare(stmt).run();
  }
}

/** Le serveur prêt à servir : bundle construit, base migrée. */
export async function bootServer(extra: Vars = {}): Promise<{ mf: Miniflare; core: string }> {
  const core = await buildOnce();
  const mf = flare(extra);
  await migrate(mf);
  return { mf, core };
}
