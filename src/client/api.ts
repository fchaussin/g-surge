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
import type { Difficulty, Outcome, Trace, WireChunk } from '../sim/index.js';
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

export const api = {
  ticket: (difficulty: Difficulty): Promise<Issued> => post('/ticket', { difficulty }),
  chunk: (ticket: string, from: number): Promise<WireChunk> => call(`/track/${ticket}/${from}`),
  /** Une partie classée. La graine de la trace est ignorée par le serveur, qui a la sienne. */
  run: (ticket: string, trace: Trace): Promise<{ outcome: Outcome }> =>
    post('/run', { core: CORE_DIGEST, ticket, trace }),
};
