/**
 * Le serveur, vu du client : trois appels et une adresse.
 *
 * L'adresse dépend de l'endroit où le jeu est servi, et se décide au build,
 * comme l'estampille : `main` sur w23.fr parle à l'API de production, une
 * branche en préversion sur *.pages.dev à celle de staging — chacune a sa
 * base, pour qu'un essai ne classe rien sur le tableau de tout le monde — et
 * le développement à `wrangler dev` sur le port 8787. `vite.config.ts` remplit
 * la ligne marquée depuis `CF_PAGES_BRANCH` ; hors build elle reste vide, et
 * vide veut dire « pas de serveur » : tout ce qui est classé se replie sur le
 * jeu hors ligne, sans erreur.
 *
 * Chaque appel a un délai borné. Un serveur qui ne répond pas n'est pas une
 * exception à afficher, c'est le mode hors ligne qui reprend la main.
 */
import {
  packTrace,
  type Difficulty,
  type Outcome,
  type Trace,
  type WireChunk,
} from '../sim/index.js';
import { toBase64 } from './base64.js';
import { CORE_DIGEST } from './core.js';

/* api:url */ export const API_URL = '';

/** Un ticket : la partie classée, sa difficulté, et la première tranche de piste. */
export interface Issued {
  ticket: string;
  difficulty: Difficulty;
  chunk: WireChunk;
}

export interface Refusal {
  error: string;
}

/** Délai d'une requête : au-delà, elle a échoué et le client décide quoi faire. */
export const TIMEOUT_MS = 4000;

export const online = (): boolean => API_URL !== '';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL + path, { ...init, signal: ctl.signal });
    const body = (await res.json()) as T | Refusal;
    if (!res.ok) throw new ApiError(res.status, (body as Refusal).error ?? 'http');
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

const post = <T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> =>
  call<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

/** Une entrée du tableau hebdomadaire, telle que le serveur la rend. */
export interface BoardEntry {
  /** La ligne en base : c'est par elle que sa trace se demande, `api.trace`. */
  id: number;
  name: string;
  score: number;
  dist: number;
  time: number;
  coins: number;
  speedPeak: number;
}

export interface Board {
  epoch: string;
  resetAt: number;
  entries: BoardEntry[];
}

/**
 * La catégorie de tri du tableau. Jamais mélangée à la difficulté : chaque
 * catégorie reste lue sur `/board/:difficulty`, une difficulté à la fois —
 * voir `CATEGORY_ORDER` côté serveur.
 */
export type BoardCategory = 'score' | 'dist' | 'speedPeak' | 'avg';

export const api = {
  ticket: (difficulty: Difficulty): Promise<Issued> => post('/ticket', { difficulty }),
  chunk: (ticket: string, from: number): Promise<WireChunk> => call(`/track/${ticket}/${from}`),
  /**
   * Une partie classée. La graine de la trace est ignorée par le serveur, qui
   * a la sienne ; `claim` est ce que le client a lui-même calculé, comparé
   * mais jamais cru — un écart est un signal, pas un refus.
   */
  run: (
    ticket: string,
    trace: Trace,
    name: string,
    claim: Outcome,
  ): Promise<{ outcome: Outcome; rank: number }> =>
    // La trace part sous sa forme compacte : mesuré, trois minutes au manche
    // font 360 Ko en JSON contre 70 ici, et une partie de dix minutes passait
    // au-dessus du méga-octet que le Worker refuse. Le serveur lit les deux.
    post('/run', { core: CORE_DIGEST, ticket, trace: toBase64(packTrace(trace)), name, claim }),
  board: (difficulty: Difficulty, category: BoardCategory = 'score'): Promise<Board> =>
    call(`/board/${difficulty}?by=${category}`),
  /** Les octets d'une partie gardée. Gardée : le serveur ne tient que les meilleures. */
  trace: (id: number): Promise<{ trace: string }> => call(`/trace/${id}`),
};
