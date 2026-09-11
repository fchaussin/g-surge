/**
 * L'arbitre : l'objet qui rejoue.
 *
 * Le rejeu vit ici et non dans le Worker, parce que le plan gratuit borne un
 * Worker à 10 ms de CPU par requête et qu'une partie de trois minutes en
 * prend soixante ; un Durable Object en a trente secondes sur tous les plans.
 * Le Worker vérifie l'enveloppe et transmet ; l'objet valide, rejoue avec le
 * même `src/sim/` que le client, et écrit l'issue — la sienne, jamais celle
 * que le client annonce.
 *
 * Un seul objet pour l'instant, `arbiter`. Les tickets et les salles en
 * feront un par tableau ou par course ; le rejeu, lui, ne bouge pas.
 */
import { DurableObject } from 'cloudflare:workers';
import { replay, validTrace, type Outcome, type Trace } from '../../src/sim/index.js';
import type { Env } from './index.js';
import { json, refuse } from './http.js';

export class Arbiter extends DurableObject<Env> {
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/run' && req.method === 'POST') return this.run(req);
    return refuse(404, 'not-found');
  }

  private async run(req: Request): Promise<Response> {
    const trace = (await req.json()) as Trace;
    if (!validTrace(trace)) return refuse(400, 'trace');
    const outcome = replay(trace);
    await this.record(trace, outcome);
    return json({ outcome });
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
