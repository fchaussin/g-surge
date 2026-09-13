/**
 * Le Worker : la porte, pas le juge.
 *
 * Il tient dans les 10 ms de CPU du plan gratuit parce qu'il ne rejoue rien :
 * il borne la taille, vérifie que la trace vient du noyau qu'il sait rejouer
 * — le condensé estampillé au build, le même mécanisme que `CORE_DIGEST` côté
 * client — et transmet à l'arbitre. Les routes `/debug/*` n'existent que sous
 * `DEBUG=1`, dans Miniflare : elles servent la mesure de parité, la sonde des
 * références figées exécutée dans workerd.
 */
import { probe, Sim, type ProbeOptions } from '../../src/sim/index.js';
import {
  accountOf,
  BIND_COOKIE,
  debugLogin,
  deleteAccount,
  finish,
  logout,
  providerFor,
  startUrl,
} from './auth.js';
import { json, refuse } from './http.js';
import { allowedOrigin } from './origins.js';

export { Arbiter } from './arbiter.js';

export interface Env {
  ARBITER: DurableObjectNamespace;
  DB: D1Database;
  DEBUG?: string;
  /**
   * Le coupe-circuit : à `'1'`, le mode classé est éteint. `/ticket` et
   * `/run` refusent en 503 avec `ranked-off`, que le client lit comme une
   * raison d'être hors ligne parmi les autres ; le jeu, lui, continue
   * exactement comme sans réseau. C'est une variable et non un secret, à
   * basculer depuis le tableau de bord Cloudflare sans redéployer : un
   * mauvais jour sur le serveur doit être un jour normal hors ligne.
   */
  RANKED_OFF?: string;
  /** Signe les `state` du flux de connexion. Un secret `wrangler`, jamais une variable. */
  SESSION_SECRET: string;
  /** Le client OAuth Google : l'id est une variable, le secret un secret `wrangler`. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Le faux fournisseur des tests, lu sous `DEBUG=1` seulement. */
  OIDC_TEST_ISSUER?: string;
  OIDC_TEST_CLIENT_ID?: string;
  OIDC_TEST_CLIENT_SECRET?: string;
}

/**
 * Mesuré : trois minutes au manche font ~360 Ko en JSON et ~70 Ko en forme
 * compacte, dix minutes quatre fois plus. Le méga-octet tenait donc la forme
 * JSON d'une partie courte et refusait une partie longue ; il est large pour
 * la forme compacte, qui est celle que le client envoie.
 */
const MAX_BODY = 1 << 20;

/** Ce que le client envoie : le condensé de son noyau, et la partie. */
interface Submission {
  core: string;
  /** Le ticket d'une partie classée ; absent, la trace porte sa graine et n'est que rejouée. */
  ticket?: string;
  trace: unknown;
  /** Une partie classée seulement : le nom affiché et ce que le client a lui-même calculé. */
  name?: string;
  claim?: unknown;
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  if (!allowedOrigin(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'content-type, authorization',
    vary: 'origin',
  };
}

const withCors = (res: Response, headers: Record<string, string>): Response => {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    return withCors(await route(req, env), headers);
  },
};

/**
 * Ce que l'arbitre doit savoir de l'appelant : son adresse, que `fetch` vers
 * un Durable Object ne transporte pas, et l'heure feinte sous `DEBUG=1`.
 */
/** La valeur d'un cookie dans l'en-tête, ou `null`. */
function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Le compte résolu, pour l'arbitre : il ne voit jamais un jeton, seulement qui c'est. */
const accountHeaders = (a: { id: number; name: string }): Record<string, string> => ({
  'x-gs-account': String(a.id),
  // encodé : un en-tête ne porte que de l'ASCII, un nom non
  'x-gs-name': encodeURIComponent(a.name),
});

function ipHeaders(req: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'x-gs-ip': req.headers.get('cf-connecting-ip') ?? '' };
  const debugNow = env.DEBUG === '1' ? req.headers.get('x-debug-now') : null;
  if (debugNow) headers['x-debug-now'] = debugNow;
  return headers;
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const arbiter = () => env.ARBITER.get(env.ARBITER.idFromName('arbiter'));

  const rankedOff = env.RANKED_OFF === '1';
  if (url.pathname === '/health') {
    // Les fournisseurs configurés, pour que le menu n'offre que ce qui marche.
    const providers = ['google', 'test'].filter((p) => providerFor(p, env) !== null);
    return json({ ok: true, core: __CORE_DIGEST__, ranked: !rankedOff, providers });
  }

  // Les comptes. `now` est l'heure réelle, ou celle que le débogage prétend.
  const now =
    env.DEBUG === '1' && req.headers.get('x-debug-now')
      ? Number(req.headers.get('x-debug-now'))
      : Date.now();
  const auth = url.pathname.match(/^\/auth\/([a-z]+)\/(start|callback)$/);
  if (auth) {
    if (req.method !== 'GET') return refuse(405, 'method');
    const provider = providerFor(auth[1]!, env);
    if (!provider) return refuse(404, 'provider');
    const callbackUrl = `${url.origin}/auth/${provider.name}/callback`;
    if (auth[2] === 'start') {
      const returnTo = url.searchParams.get('return') ?? '';
      const started = await startUrl(env, provider, returnTo, callbackUrl, now);
      if (!started) return refuse(400, 'return');
      // Le cookie de liaison : dix minutes, l'origine de l'API seulement, et
      // le seul chemin qui le lit.
      return new Response(null, {
        status: 302,
        headers: {
          location: started.url,
          'set-cookie': `${BIND_COOKIE}=${started.bind}; Max-Age=600; Path=/auth; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    const bind = cookieValue(req.headers.get('cookie'), BIND_COOKIE);
    const done = await finish(env, provider, url, callbackUrl, bind, now);
    if ('error' in done) return refuse(400, done.error);
    // Le fragment ne quitte jamais le navigateur : c'est là que le jeton va.
    return Response.redirect(`${done.returnTo}/#session=${done.token}`, 302);
  }
  if (url.pathname === '/me') {
    if (req.method !== 'GET') return refuse(405, 'method');
    const account = await accountOf(env, req, now);
    return account ? json(account) : refuse(401, 'sign-in');
  }
  if (url.pathname === '/logout') {
    if (req.method !== 'POST') return refuse(405, 'method');
    await logout(env, req);
    return json({ ok: true });
  }
  if (url.pathname === '/me/delete') {
    if (req.method !== 'POST') return refuse(405, 'method');
    const account = await accountOf(env, req, now);
    if (!account) return refuse(401, 'sign-in');
    await deleteAccount(env, account.id);
    return json({ ok: true });
  }
  if (url.pathname === '/debug/login' && env.DEBUG === '1') {
    if (req.method !== 'POST') return refuse(405, 'method');
    const { name } = (await req.json()) as { name?: string };
    return json({ token: await debugLogin(env, typeof name === 'string' ? name : 'PILOT', now) });
  }

  if (url.pathname === '/ticket') {
    if (req.method !== 'POST') return refuse(405, 'method');
    if (rankedOff) return refuse(503, 'ranked-off');
    // Le classé se joue connecté : sans compte, pas de ticket.
    const account = await accountOf(env, req, now);
    if (!account) return refuse(401, 'sign-in');
    const body = await req.text();
    if (body.length > 256) return refuse(413, 'size');
    return arbiter().fetch('https://arbiter/ticket', {
      method: 'POST',
      body,
      headers: { ...ipHeaders(req, env), ...accountHeaders(account) },
    });
  }

  // GET /track/:ticket/:from — la tranche est immuable, le Worker ne fait que passer.
  if (url.pathname.startsWith('/track/')) {
    if (req.method !== 'GET') return refuse(405, 'method');
    return arbiter().fetch('https://arbiter' + url.pathname);
  }

  // GET /board/:difficulty?by=category — public, rien à vérifier avant de
  // transmettre. La chaîne de requête porte la catégorie, ne pas la perdre.
  if (url.pathname.startsWith('/board/') || url.pathname.startsWith('/trace/')) {
    if (req.method !== 'GET') return refuse(405, 'method');
    return arbiter().fetch('https://arbiter' + url.pathname + url.search);
  }

  if (url.pathname === '/run') {
    if (req.method !== 'POST') return refuse(405, 'method');
    // Le coupe-circuit coupe aussi la soumission : une partie commencée avant
    // la bascule finit hors ligne, ce qui est ce que l'interrupteur promet.
    if (rankedOff) return refuse(503, 'ranked-off');
    // Classée, la partie doit venir d'un compte ; rejouée seulement, non.
    const account = req.headers.get('authorization') ? await accountOf(env, req, now) : null;
    // L'en-tête d'abord, pour refuser sans lire ; le corps ensuite, parce
    // qu'un envoi en morceaux n'a pas d'en-tête et qu'un client hostile n'en
    // mettra pas non plus.
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return refuse(413, 'size');
    const text = await req.text();
    if (text.length > MAX_BODY) return refuse(413, 'size');
    let body: Submission;
    try {
      body = JSON.parse(text) as Submission;
    } catch {
      return refuse(400, 'json');
    }
    if (typeof body !== 'object' || body === null || typeof body.core !== 'string') {
      return refuse(400, 'envelope');
    }
    if (body.core !== __CORE_DIGEST__) return refuse(409, 'core', { expected: __CORE_DIGEST__ });
    // Compacte ou JSON : `asTrace`, dans l'arbitre, tranche. Ici on ne vérifie
    // que la présence, pour refuser une enveloppe vide sans réveiller l'objet.
    if (typeof body.trace !== 'string' && (typeof body.trace !== 'object' || body.trace === null)) {
      return refuse(400, 'trace');
    }
    if (body.ticket !== undefined && typeof body.ticket !== 'string') return refuse(400, 'ticket');
    const ranked = body.ticket !== undefined;
    if (ranked && !account) return refuse(401, 'sign-in');
    const headers = {
      'content-type': 'application/json',
      ...ipHeaders(req, env),
      ...(account ? accountHeaders(account) : {}),
    };
    return arbiter().fetch(ranked ? 'https://arbiter/run' : 'https://arbiter/replay', {
      method: 'POST',
      body: JSON.stringify(
        ranked
          ? { ticket: body.ticket, trace: body.trace, name: body.name, claim: body.claim }
          : body.trace,
      ),
      headers,
    });
  }

  if (env.DEBUG === '1' && url.pathname.startsWith('/debug/')) return debug(url, req);

  return refuse(404, 'not-found');
}

/** La sonde et le générateur, tels que les tests les interrogent dans le navigateur. */
async function debug(url: URL, req: Request): Promise<Response> {
  if (url.pathname === '/debug/probe' && req.method === 'POST') {
    const opts = (await req.json()) as ProbeOptions;
    const sim = new Sim({ seed: opts.seed, difficulty: opts.diff ?? 'easy' });
    return json(probe(sim, opts));
  }
  if (url.pathname === '/debug/track') {
    const seed = url.searchParams.get('seed') ?? 'reference';
    const sim = new Sim({ seed });
    sim.reset(seed);
    const t = sim.track;
    return json({
      seed,
      nodes: {
        k: Array.from(t.nk),
        g: Array.from(t.ng),
        b: Array.from(t.nb),
        id: Array.from(t.nid),
      },
      items: t.items.map((it) => ({ id: it.id, lat: it.lat, type: it.type })),
    });
  }
  return refuse(404, 'not-found');
}
