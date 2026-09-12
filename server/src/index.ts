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
import { json, refuse } from './http.js';

export { Arbiter } from './arbiter.js';

export interface Env {
  ARBITER: DurableObjectNamespace;
  DB: D1Database;
  DEBUG?: string;
}

/** Une trace de trois minutes au manche fait ~300 Ko en JSON ; au-delà d'un méga-octet, ce n'en est pas une. */
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

/** Les origines qui ont le droit d'appeler : le jeu en production, en préversion et en développement. */
const ORIGINS = [
  /^https:\/\/([a-z0-9-]+\.)?g-surge\.w23\.fr$/,
  /^https:\/\/w23\.fr$/,
  /^https:\/\/([a-z0-9-]+\.)?g-surge\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  if (!ORIGINS.some((re) => re.test(origin))) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'content-type',
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

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const arbiter = () => env.ARBITER.get(env.ARBITER.idFromName('arbiter'));

  if (url.pathname === '/health') return json({ ok: true, core: __CORE_DIGEST__ });

  if (url.pathname === '/ticket') {
    if (req.method !== 'POST') return refuse(405, 'method');
    const body = await req.text();
    if (body.length > 256) return refuse(413, 'size');
    return arbiter().fetch('https://arbiter/ticket', { method: 'POST', body });
  }

  // GET /track/:ticket/:from — la tranche est immuable, le Worker ne fait que passer.
  if (url.pathname.startsWith('/track/')) {
    if (req.method !== 'GET') return refuse(405, 'method');
    return arbiter().fetch('https://arbiter' + url.pathname);
  }

  // GET /board/:difficulty?by=category — public, rien à vérifier avant de
  // transmettre. La chaîne de requête porte la catégorie, ne pas la perdre.
  if (url.pathname.startsWith('/board/')) {
    if (req.method !== 'GET') return refuse(405, 'method');
    return arbiter().fetch('https://arbiter' + url.pathname + url.search);
  }

  if (url.pathname === '/run') {
    if (req.method !== 'POST') return refuse(405, 'method');
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
    if (typeof body.trace !== 'object' || body.trace === null) return refuse(400, 'trace');
    if (body.ticket !== undefined && typeof body.ticket !== 'string') return refuse(400, 'ticket');
    const ranked = body.ticket !== undefined;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const debugNow = env.DEBUG === '1' ? req.headers.get('x-debug-now') : null;
    if (debugNow) headers['x-debug-now'] = debugNow;
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
