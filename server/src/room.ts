/**
 * Un salon : deux vaisseaux, une piste, en direct.
 *
 * L'objet possède la graine — que les membres ne voient jamais, comme pour
 * un ticket — et sert la piste par tranches aux deux. Chaque membre lui
 * envoie sa trace en morceaux à 10 Hz ; l'objet les rejoue sur sa propre
 * `Sim` par membre, avec autorité, et relaie à l'autre ce que le noyau
 * produit et rien d'autre : distance, décalage latéral, saut, lacet, barreau
 * de poussée, épave. Le client dessine l'autre à partir de ces six nombres ;
 * ils n'entrent jamais dans sa simulation.
 *
 * **Le rejeu est incrémental.** Un morceau est une fenêtre de trace — les
 * plages depuis le morceau précédent, `from` relatif au premier pas de la
 * fenêtre — empaquetée par `packTrace` comme une trace entière : même format,
 * même lecteur, pas de second encodage à tenir. L'objet avance la `Sim` du
 * membre d'autant de pas que la fenêtre en déclare, en lisant les plages au
 * fil des pas, exactement comme `replay` le fait d'une traite.
 *
 * **Un membre dont les morceaux divergent est éjecté.** Il envoie avec
 * chaque morceau la distance que sa propre simulation affiche ; si celle du
 * rejeu s'en écarte de plus que `DRIFT_M`, la trace ne décrit pas la partie
 * qu'il prétend jouer — trafiquée, ou dérivée — et la prise est fermée avec
 * un code qui le dit.
 *
 * **Ce qui ne survit pas à l'hibernation.** Graine, difficulté et membres
 * sont dans le stockage de l'objet ; les `Sim` du rejeu sont en mémoire. À
 * 10 Hz, l'objet ne s'endort pas pendant une course ; s'il se réveille sans
 * ses simulations — une course abandonnée des deux côtés, puis quelqu'un
 * revient — il ferme la prise avec `EXPIRED` plutôt que de reprendre une
 * partie qu'il ne saurait plus rejouer.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  BOOST,
  BRAKE,
  DT,
  MAX_TRACE_STEPS,
  Sim,
  thrustTier,
  unpackTrace,
  type Difficulty,
  type Input,
  type Trace,
} from '../../src/sim/index.js';
import type { Env } from './index.js';
import { json, refuse } from './http.js';
import { chunk } from './track.js';

/** Combien un salon tient. Deux, par décision — voir `MULTIPLAYER-ROADMAP.md`, M7. */
export const SEATS = 2;
/** Écart toléré entre la distance rejouée et celle que le membre déclare, en mètres. */
export const DRIFT_M = 0.5;
/** Pas qu'un seul morceau peut déclarer : un dixième de seconde plus une marge large. */
const MAX_CHUNK_STEPS = 720;

/** Codes de fermeture, dans la plage que le protocole laisse aux applications. */
export const CLOSE = {
  /** Les morceaux ne décrivent pas la partie déclarée. */
  DIVERGED: 4001,
  /** L'objet s'est réveillé sans ses simulations. */
  EXPIRED: 4002,
  /** Un message qui n'est pas un morceau. */
  MALFORMED: 4003,
} as const;

const DIFFICULTIES = new Set<string>(['easy', 'medium', 'hard']);
const randomHex = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** Ce que le stockage garde : ce qu'il faut pour servir la piste et reconnaître les membres. */
interface Stored {
  seed: string;
  difficulty: Difficulty;
  /** Jeton de membre → compte. L'ordre d'insertion est l'ordre d'arrivée. */
  members: Record<string, { account: number; name: string }>;
}

/** Ce qu'un membre envoie à chaque morceau. */
interface Chunk {
  /** La fenêtre de trace, `packTrace` en base64. */
  t: string;
  /** La distance que sa simulation affiche après cette fenêtre, en mètres. */
  d: number;
}

/** Ce que l'objet relaie : les six nombres du noyau, et rien d'autre. */
export interface Relay {
  who: string;
  steps: number;
  dist: number;
  lat: number;
  hop: number;
  yaw: number;
  tier: number;
  wrecked: boolean;
}

/** L'état vivant d'un membre, en mémoire seulement. */
interface Live {
  sim: Sim;
  steps: number;
  input: Input;
}

export class Room extends DurableObject<Env> {
  private stored: Stored | null = null;
  private readonly live = new Map<string, Live>();

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'open' && req.method === 'POST') return this.open(req);
    if (parts[0] === 'join' && req.method === 'POST') return this.join(req);
    if (parts[0] === 'track' && parts.length === 2) return this.track(parts[1]!);
    if (parts[0] === 'ws') return this.socket(req, url.searchParams.get('member') ?? '');
    return refuse(404, 'not-found');
  }

  /* -------------------------------------------------------------- entrée -- */

  /** Le premier membre ouvre : graine tirée, difficulté fixée, première tranche servie. */
  private async open(req: Request): Promise<Response> {
    if (await this.load()) return refuse(409, 'exists');
    const { difficulty } = (await req.json()) as { difficulty?: string };
    if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty))
      return refuse(400, 'difficulty');
    const stored: Stored = { seed: randomHex(), difficulty: difficulty as Difficulty, members: {} };
    this.stored = stored;
    return this.seat(req, stored);
  }

  /** Le second membre rejoint. Un troisième trouve la porte fermée. */
  private async join(req: Request): Promise<Response> {
    const stored = await this.load();
    if (!stored) return refuse(404, 'room');
    if (Object.keys(stored.members).length >= SEATS) return refuse(409, 'full');
    return this.seat(req, stored);
  }

  private async seat(req: Request, stored: Stored): Promise<Response> {
    const account = Number(req.headers.get('x-gs-account') ?? 0);
    if (!Number.isInteger(account) || account <= 0) return refuse(401, 'sign-in');
    const rawName = req.headers.get('x-gs-name');
    const name = rawName ? decodeURIComponent(rawName) : 'PILOT';
    const member = randomHex();
    stored.members[member] = { account, name };
    await this.ctx.storage.put('room', stored);
    return json({
      member,
      difficulty: stored.difficulty,
      seats: Object.keys(stored.members).length,
      chunk: chunk(stored.seed, stored.difficulty, 0),
    });
  }

  private async track(fromText: string): Promise<Response> {
    const stored = await this.load();
    if (!stored) return refuse(404, 'room');
    const c = chunk(stored.seed, stored.difficulty, Number(fromText));
    if (!c) return refuse(400, 'from');
    return json(c, 200, { 'cache-control': 'private, max-age=3600' });
  }

  private async load(): Promise<Stored | null> {
    if (this.stored) return this.stored;
    this.stored = (await this.ctx.storage.get<Stored>('room')) ?? null;
    return this.stored;
  }

  /* ---------------------------------------------------------------- direct -- */

  /** La prise d'un membre. Hibernable : l'objet ne paie que ce qu'il fait. */
  private async socket(req: Request, member: string): Promise<Response> {
    const stored = await this.load();
    if (!stored || !stored.members[member]) return refuse(404, 'member');
    if (req.headers.get('upgrade') !== 'websocket') return refuse(426, 'upgrade');
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Le jeton du membre est attaché à la prise : après hibernation, c'est
    // tout ce qui reste pour savoir qui parle.
    this.ctx.acceptWebSocket(server, [member]);
    this.start(member, stored);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** La simulation d'un membre, sur la graine du salon, prête au premier pas. */
  private start(member: string, stored: Stored): void {
    if (this.live.has(member)) return;
    const sim = new Sim({ seed: stored.seed, difficulty: stored.difficulty });
    sim.reset(stored.seed);
    this.live.set(member, { sim, steps: 0, input: { steer: 0, brake: false, boost: false } });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const member = this.ctx.getTags(ws)[0] ?? '';
    const stored = await this.load();
    if (!stored || !stored.members[member]) return ws.close(CLOSE.MALFORMED, 'member');
    const live = this.live.get(member);
    // Réveillé sans ses simulations : une partie en cours ne se reprend pas.
    if (!live) return ws.close(CLOSE.EXPIRED, 'expired');

    const window = parseChunk(message, stored.difficulty);
    if (!window) return ws.close(CLOSE.MALFORMED, 'chunk');
    if (live.steps + window.trace.steps > MAX_TRACE_STEPS)
      return ws.close(CLOSE.MALFORMED, 'steps');

    advance(live, window.trace);
    if (Math.abs(live.sim.state.dist - window.claim) > DRIFT_M) {
      return ws.close(CLOSE.DIVERGED, 'diverged');
    }

    const s = live.sim.state;
    const relay: Relay = {
      who: member,
      steps: live.steps,
      dist: s.dist,
      lat: s.lat,
      hop: s.hop,
      yaw: s.yaw,
      tier: thrustTier(s),
      wrecked: s.wrecked,
    };
    const text = JSON.stringify(relay);
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(text);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // Rien à défaire : la simulation du membre reste, il peut revenir tant
    // que l'objet ne s'est pas endormi.
    void ws;
  }
}

/** Le message d'un membre, lu et vérifié. `null` si ce n'en est pas un. */
function parseChunk(
  message: string | ArrayBuffer,
  difficulty: Difficulty,
): { trace: Trace; claim: number } | null {
  if (typeof message !== 'string') return null;
  let body: Chunk;
  try {
    body = JSON.parse(message) as Chunk;
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  if (typeof body.t !== 'string' || typeof body.d !== 'number' || !Number.isFinite(body.d))
    return null;
  let trace: Trace | null;
  try {
    const bin = atob(body.t);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    trace = unpackTrace(bytes);
  } catch {
    return null;
  }
  if (!trace || trace.truncated || trace.difficulty !== difficulty) return null;
  if (!Number.isInteger(trace.steps) || trace.steps < 0 || trace.steps > MAX_CHUNK_STEPS)
    return null;
  const n = trace.from.length;
  if (trace.steer.length !== n || trace.flags.length !== n) return null;
  for (let i = 0; i < n; i++) {
    const f = trace.from[i]!;
    if (!Number.isInteger(f) || f < 0 || f >= trace.steps) return null;
    if (i > 0 && f <= trace.from[i - 1]!) return null;
    const st = trace.steer[i]!;
    if (!(st >= -1 && st <= 1)) return null;
    const fl = trace.flags[i]!;
    if (fl !== (fl & (BRAKE | BOOST))) return null;
  }
  return { trace, claim: body.d };
}

/**
 * Avance la simulation d'un membre d'une fenêtre. L'entrée tenue au dernier
 * pas du morceau précédent reste tenue jusqu'à la première plage de celui-ci :
 * c'est ce que le format par plages veut dire, et ce que `TraceCursor` fait
 * d'une traite sur une trace entière.
 */
function advance(live: Live, window: Trace): void {
  let span = 0;
  for (let i = 0; i < window.steps; i++) {
    while (span < window.from.length && window.from[span]! <= i) {
      live.input.steer = window.steer[span]!;
      const flags = window.flags[span]!;
      live.input.brake = (flags & BRAKE) !== 0;
      live.input.boost = (flags & BOOST) !== 0;
      span++;
    }
    if (!live.sim.state.wrecked) live.sim.step(live.input, DT);
  }
  live.steps += window.steps;
}
