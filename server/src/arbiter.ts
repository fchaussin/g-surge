/**
 * L'arbitre : l'objet qui tient les tickets, sert la piste et rejoue.
 *
 * Le rejeu vit ici et non dans le Worker, parce que le plan gratuit borne un
 * Worker à 10 ms de CPU par requête et qu'une partie de trois minutes en
 * prend soixante ; un Durable Object en a trente secondes sur tous les plans.
 * Le Worker vérifie l'enveloppe et transmet ; l'objet valide, rejoue avec le
 * même `src/sim/` que le client, et écrit l'issue — la sienne, jamais celle
 * que le client annonce.
 *
 * Un seul objet pour l'instant, `arbiter`. Les tableaux et les salles en
 * feront un par semaine ou par course ; le rejeu, lui, ne bouge pas.
 */
import { DurableObject } from 'cloudflare:workers';
import { DT, replay, validTrace, type Outcome, type Trace } from '../../src/sim/index.js';
import type { Env } from './index.js';
import { json, refuse } from './http.js';
import { Tickets } from './tickets.js';
import { chunk } from './track.js';

/** Ce que le Worker transmet pour une partie classée : le ticket et la trace sans sa graine. */
export interface RankedRun {
  ticket: string;
  trace: Trace;
}

const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

export class Arbiter extends DurableObject<Env> {
  private readonly tickets = new Tickets(this.ctx.storage);

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'ticket' && req.method === 'POST') return this.ticket(req);
    if (parts[0] === 'track' && parts.length === 3) return this.track(parts[1]!, parts[2]!);
    if (parts[0] === 'run' && req.method === 'POST') return this.run(req);
    if (parts[0] === 'replay' && req.method === 'POST') return this.replayOnly(req);
    return refuse(404, 'not-found');
  }

  /** Un ticket et la première tranche : la partie démarre sans deuxième aller-retour. */
  private async ticket(req: Request): Promise<Response> {
    const { difficulty } = (await req.json()) as { difficulty?: string };
    if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty))
      return refuse(400, 'difficulty');
    const d = difficulty as 'easy' | 'medium' | 'hard';
    const { id, ticket } = await this.tickets.issue(d, Date.now());
    return json({ ticket: id, difficulty: d, chunk: chunk(ticket.seed, d, 0) });
  }

  private async track(id: string, fromText: string): Promise<Response> {
    const ticket = await this.tickets.get(id);
    if (!ticket) return refuse(404, 'ticket');
    const c = chunk(ticket.seed, ticket.difficulty, Number(fromText));
    if (!c) return refuse(400, 'from');
    // immuable pour un ticket donné : le client et tout cache intermédiaire peuvent le garder
    return json(c, 200, { 'cache-control': 'private, max-age=3600' });
  }

  /** Une partie classée : le ticket donne la graine et la fenêtre, le rejeu donne le score. */
  private async run(req: Request): Promise<Response> {
    const body = (await req.json()) as RankedRun;
    const ticket = await this.tickets.get(body.ticket);
    if (!ticket) return refuse(404, 'ticket');
    const trace: Trace = { ...body.trace, seed: ticket.seed };
    if (!validTrace(trace) || trace.difficulty !== ticket.difficulty) return refuse(400, 'trace');
    const late = Tickets.window(ticket, trace.steps * DT * 1000, this.now(req));
    if (late) return refuse(409, late);
    await this.tickets.consume(body.ticket);
    const outcome = replay(trace);
    await this.record(trace, outcome);
    return json({ outcome });
  }

  /**
   * L'heure de l'objet — ou, sous `DEBUG=1` seulement, celle que le test
   * prétend : la fenêtre du ticket se mesure en minutes, et un test ne les
   * attend pas. Hors débogage l'en-tête n'existe pas.
   */
  private now(req: Request): number {
    const faked = this.env.DEBUG === '1' ? req.headers.get('x-debug-now') : null;
    return faked ? Number(faked) : Date.now();
  }

  /** Une trace avec sa graine, rejouée sans ticket ni tableau : la voie des tests et des fantômes. */
  private async replayOnly(req: Request): Promise<Response> {
    const trace = (await req.json()) as Trace;
    if (!validTrace(trace)) return refuse(400, 'trace');
    return json({ outcome: replay(trace) });
  }

  private async record(trace: Trace, o: Outcome): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO runs (core, difficulty, seed, steps, score, dist, time, coins, mult, wrecked, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        __CORE_DIGEST__,
        trace.difficulty,
        trace.seed,
        o.steps,
        o.score,
        o.dist,
        o.time,
        o.coins,
        o.multPeak,
        o.wrecked ? 1 : 0,
        Date.now(),
      )
      .run();
  }
}
