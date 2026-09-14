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
import {
  DT,
  packTrace,
  replay,
  validTrace,
  type Outcome,
  type Trace,
} from '../../src/sim/index.js';
import { epoch, nextReset } from './epoch.js';
import type { Env } from './index.js';
import { json, refuse } from './http.js';
import { Tickets } from './tickets.js';
import { chunk, CHUNK } from './track.js';
import { Limits } from './limits.js';
import { faceOf } from './auth.js';
import { sanitiseName } from './names.js';
import { asTrace } from './wire.js';

/** Ce que le Worker transmet pour une partie classée : le ticket et la trace sans sa graine. */
export interface RankedRun {
  ticket: string;
  /** Compacte en base64, ou la forme JSON d'un bundle d'avant. Voir `wire.ts`. */
  trace: string | Trace;
  /** Facultatif : une partie sans nom choisi entre encore, sous un nom générique. */
  name?: string;
  /** Ce que le client a lui-même calculé — jamais ce qui compte, seulement ce qui est comparé. */
  claim?: Outcome;
}

/** Deux à seize caractères, sans quoi le nom générique du client tient lieu. */

/** Le meilleur score de l'entrée, un de plus que ce qui la bat déjà. */
async function rankOf(db: D1Database, epochKey: string, difficulty: string, score: number) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM runs WHERE epoch = ? AND difficulty = ? AND score > ?')
    .bind(epochKey, difficulty, score)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

/**
 * Le tableau se lit par catégorie, jamais mélangée avec la difficulté : une
 * partie difficile au score faible ne rencontre une partie facile au score
 * énorme sur aucun classement, parce qu'aucune requête ne les mélange —
 * `difficulty` reste toujours dans le `WHERE`, quelle que soit la colonne du
 * `ORDER BY`.
 *
 * La colonne de tri vient toujours de cette table, jamais interpolée
 * directement depuis ce que le client envoie : une clé absente est un refus,
 * pas une injection. La vitesse moyenne n'a pas de colonne — `dist` et
 * `time` suffisent, gardée contre une division par zéro qu'une partie
 * normale ne produit pas mais qu'une trace forgée pourrait.
 */
const CATEGORY_ORDER: Record<string, string> = {
  score: 'score DESC',
  dist: 'dist DESC',
  speedPeak: 'speed_peak DESC',
  avg: 'dist / max(time, 0.001) DESC',
};

/**
 * Combien de parties une difficulté garde par semaine.
 *
 * Le tableau n'accumule pas : il garde les meilleures et jette le reste, à
 * chaque soumission. Vingt, quand le tableau en montre dix, laisse de quoi
 * départager sans que la base grossisse d'une partie jouée.
 *
 * **Vingt par catégorie, et non vingt en tout.** Le tableau classe sur quatre
 * critères, et une partie première à la vitesse de pointe peut être
 * quatre-centième au score — c'est tout l'intérêt des filtres. Ce qui est
 * gardé est donc l'union des vingt premières de chacune : au plus quatre-vingts
 * lignes, en pratique bien moins, les mêmes parties revenant souvent en tête
 * de plusieurs colonnes.
 */
const KEEP = 20;

/** Le plafond de vitesse du jeu, m/s — le super boost — et la longueur d'un segment, m. */
const CEILING_MPS = 409;
const SEG_M = 12;
/**
 * Le segment le plus loin qu'une partie de `ageMs` ait pu demander. Le client
 * garde deux tranches d'avance et demande la suivante dès qu'il passe
 * dessous ; mesuré, ses demandes dans la seconde du ticket sont 256, 512,
 * 768 puis 1024 — quatre tranches, parce que l'avance se compte en nœuds
 * restants et non en tranches reçues. D'où quatre à l'âge zéro.
 */
export const reachable = (ageMs: number): number =>
  4 * CHUNK + Math.ceil((Math.max(0, ageMs) / 1000) * (CEILING_MPS / SEG_M));

export class Arbiter extends DurableObject<Env> {
  private readonly tickets = new Tickets(this.ctx.storage);
  /** Ce qu'une adresse peut demander par minute sur les deux routes qui rejouent. */
  private readonly limits = new Limits();

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    // Les deux routes qui arment ou dépensent un rejeu sont comptées ; les
    // lectures ne le sont pas, elles ne coûtent qu'une requête D1.
    const limited =
      parts[0] === 'ticket'
        ? 'ticket'
        : parts[0] === 'run' || parts[0] === 'replay'
          ? 'run'
          : parts[0] === 'track'
            ? 'track'
            : null;
    if (limited) {
      const wait = this.limits.take(limited, req.headers.get('x-gs-ip') ?? '', this.now(req));
      if (wait) return refuse(429, 'rate', { retryAfter: wait });
    }
    if (parts[0] === 'ticket' && req.method === 'POST') return this.ticket(req);
    if (parts[0] === 'track' && parts.length === 3)
      return this.track(parts[1]!, parts[2]!, this.now(req));
    if (parts[0] === 'run' && req.method === 'POST') return this.run(req);
    if (parts[0] === 'replay' && req.method === 'POST') return this.replayOnly(req);
    if (parts[0] === 'board' && parts.length === 2 && req.method === 'GET')
      return this.board(parts[1]!, url.searchParams.get('by') ?? 'score');
    if (parts[0] === 'trace' && parts.length === 2 && req.method === 'GET')
      return this.traceOf(parts[1]!);
    return refuse(404, 'not-found');
  }

  /** Un ticket et la première tranche : la partie démarre sans deuxième aller-retour. */
  private async ticket(req: Request): Promise<Response> {
    const { difficulty } = (await req.json()) as { difficulty?: string };
    if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty))
      return refuse(400, 'difficulty');
    const d = difficulty as 'easy' | 'medium' | 'hard';
    // Le compte vient du Worker, qui a résolu la session ; l'arbitre ne voit
    // jamais un jeton. Sans compte, pas de ticket : le classé se joue connecté.
    const account = Number(req.headers.get('x-gs-account') ?? 0);
    if (!Number.isInteger(account) || account <= 0) return refuse(401, 'sign-in');
    const { id, ticket } = await this.tickets.issue(d, Date.now(), account);
    return json({ ticket: id, difficulty: d, chunk: chunk(ticket.seed, d, 0) });
  }

  private async track(id: string, fromText: string, now: number): Promise<Response> {
    const ticket = await this.tickets.get(id);
    if (!ticket) return refuse(404, 'ticket');
    const from = Number(fromText);
    // Pas plus loin que la partie n'a pu aller : l'âge du ticket au plafond
    // de vitesse, plus deux tranches d'avance. Chaque tranche se régénère
    // depuis le premier segment, et `from` était sinon le prix que l'appelant
    // choisissait de faire payer.
    if (from > reachable(now - ticket.issued)) return refuse(400, 'from');
    const c = chunk(ticket.seed, ticket.difficulty, from);
    if (!c) return refuse(400, 'from');
    // immuable pour un ticket donné : le client et tout cache intermédiaire peuvent le garder
    return json(c, 200, { 'cache-control': 'private, max-age=3600' });
  }

  /** Une partie classée : le ticket donne la graine et la fenêtre, le rejeu donne le score. */
  private async run(req: Request): Promise<Response> {
    const body = (await req.json()) as RankedRun;
    const ticket = await this.tickets.get(body.ticket);
    if (!ticket) return refuse(404, 'ticket');
    // Le ticket est à celui qui l'a demandé : soumis sous une autre session,
    // la ligne porterait le nom de l'un et le compte de l'autre, et la
    // suppression de l'un laisserait le nom de l'autre au tableau.
    if (Number(req.headers.get('x-gs-account') ?? 0) !== ticket.account)
      return refuse(403, 'ticket');
    const sent = asTrace(body.trace);
    if (!sent) return refuse(400, 'trace');
    const trace: Trace = { ...sent, seed: ticket.seed };
    if (!validTrace(trace) || trace.difficulty !== ticket.difficulty) return refuse(400, 'trace');
    const now = this.now(req);
    const late = Tickets.window(ticket, trace.steps * DT * 1000, now);
    if (late) return refuse(409, late);
    await this.tickets.consume(body.ticket);
    const outcome = replay(trace);
    const epochKey = epoch(now);
    // Le nom est celui du compte, transmis par le Worker ; ce que le corps
    // porte n'est plus lu — un nom tapé n'a plus d'entrée au tableau.
    const rawName = req.headers.get('x-gs-name');
    const name = sanitiseName(rawName ? decodeURIComponent(rawName) : undefined);
    const mismatch =
      body.claim !== undefined && JSON.stringify(body.claim) !== JSON.stringify(outcome);
    const id = await this.record(
      trace,
      outcome,
      epochKey,
      name,
      body.claim,
      mismatch,
      ticket.account,
    );
    await this.keepTrace(id, trace);
    // Jeter tout de suite : la base ne doit jamais porter plus que ce que le
    // tableau de la semaine peut montrer.
    await this.prune(epochKey, ticket.difficulty);
    const rank = await rankOf(this.env.DB, epochKey, ticket.difficulty, outcome.score);
    return json({ outcome, rank });
  }

  /** Les dix premières de la semaine en cours, pour une difficulté et une catégorie. */
  private async board(difficulty: string, category: string): Promise<Response> {
    if (!DIFFICULTIES.has(difficulty)) return refuse(400, 'difficulty');
    // `hasOwn`, pas une lecture nue : `?by=constructor` atteignait sinon
    // `ORDER BY` avec le source d'une fonction native — une erreur SQL, un 500.
    const orderBy = Object.hasOwn(CATEGORY_ORDER, category) ? CATEGORY_ORDER[category] : undefined;
    if (!orderBy) return refuse(400, 'category');
    const now = Date.now();
    const epochKey = epoch(now);
    // La jointure ne sert qu'au visage : le sujet du fournisseur est lu ici et
    // ne sort jamais tel quel — `faceOf` le hache, et c'est le condensé qui
    // part. Une partie sans compte, ou dont le compte est parti, n'a pas de
    // visage ; le client retombe alors sur le pseudo.
    const rows = await this.env.DB.prepare(
      `SELECT r.id AS id, r.name AS name, r.score AS score, r.dist AS dist,
              r.time AS time, r.coins AS coins, r.speed_peak AS speedPeak,
              a.subject AS subject
       FROM runs r LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.epoch = ? AND r.difficulty = ? ORDER BY ${orderBy} LIMIT 10`,
    )
      .bind(epochKey, difficulty)
      .all<Record<string, unknown> & { subject: string | null }>();
    const entries = await Promise.all(
      rows.results.map(async (row) => {
        const { subject, ...entry } = row;
        return subject ? { ...entry, face: await faceOf(subject) } : entry;
      }),
    );
    return json({ epoch: epochKey, resetAt: nextReset(now), entries });
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
    const trace = asTrace(await req.json());
    if (!trace || !validTrace(trace)) return refuse(400, 'trace');
    return json({ outcome: replay(trace) });
  }

  private async record(
    trace: Trace,
    o: Outcome,
    epochKey: string,
    name: string,
    claim: Outcome | undefined,
    mismatch: boolean,
    account: number,
  ): Promise<number> {
    const written = await this.env.DB.prepare(
      `INSERT INTO runs (core, difficulty, seed, steps, score, dist, time, coins, mult, wrecked,
                          submitted_at, name, epoch, claim, mismatch, speed_peak, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        name,
        epochKey,
        claim ? JSON.stringify(claim) : '',
        mismatch ? 1 : 0,
        o.speedPeak,
        account,
      )
      .run();
    return Number(written.meta.last_row_id);
  }

  /**
   * Les octets de la partie, gardés tant qu'elle est au tableau.
   *
   * La trace est ce qui prouve le score — le serveur l'a rejouée pour
   * l'obtenir — donc la garder est ce qui rend la preuve regardable, `M4` de
   * `MULTIPLAYER-ROADMAP.md`.
   */
  private async keepTrace(runId: number, trace: Trace): Promise<void> {
    await this.env.DB.prepare('INSERT OR REPLACE INTO traces (run_id, bytes) VALUES (?, ?)')
      .bind(runId, packTrace(trace))
      .run();
  }

  /**
   * Ne garder que les meilleures : l'union des `KEEP` premières de chaque
   * catégorie, pour cette semaine et cette difficulté. Tout le reste de la
   * semaine sort, et avec lui les octets — ceux des semaines passées aussi,
   * dont les lignes restent pour le palmarès mais que plus personne ne
   * regarde, le tableau ne montrant que la semaine en cours.
   */
  private async prune(epochKey: string, difficulty: string): Promise<void> {
    const db = this.env.DB;
    const keep = new Set<number>();
    for (const orderBy of Object.values(CATEGORY_ORDER)) {
      const top = await db
        .prepare(
          `SELECT id FROM runs WHERE epoch = ? AND difficulty = ?
           ORDER BY ${orderBy} LIMIT ${KEEP}`,
        )
        .bind(epochKey, difficulty)
        .all<{ id: number }>();
      for (const row of top.results) keep.add(row.id);
    }
    if (!keep.size) return;
    const ids = [...keep].join(',');
    await db
      .prepare(`DELETE FROM runs WHERE epoch = ? AND difficulty = ? AND id NOT IN (${ids})`)
      .bind(epochKey, difficulty)
      .run();
    // Les octets suivent les lignes de la semaine en cours, et rien d'autre
    // n'en garde : une seule instruction nettoie les deux cas.
    await db
      .prepare('DELETE FROM traces WHERE run_id NOT IN (SELECT id FROM runs WHERE epoch = ?)')
      .bind(epochKey)
      .run();
  }

  /** Les octets d'une partie gardée, pour la regarder. */
  private async traceOf(idText: string): Promise<Response> {
    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) return refuse(400, 'id');
    const row = await this.env.DB.prepare('SELECT bytes FROM traces WHERE run_id = ?')
      .bind(id)
      .first<{ bytes: ArrayBuffer | Uint8Array }>();
    if (!row) return refuse(404, 'trace');
    const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return json({ trace: btoa(binary) }, 200, { 'cache-control': 'public, max-age=86400' });
  }
}
