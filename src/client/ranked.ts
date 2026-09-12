/**
 * Une partie classée, du ticket à la soumission.
 *
 * Le jeu hors ligne ne passe pas par ici. Une partie classée demande un
 * ticket, joue sur la piste que le serveur sert par tranches — la graine ne
 * quitte jamais le serveur — et envoie sa trace à la fin ; le score affiché
 * est alors celui que le serveur a rejoué. À chaque étape, l'échec est le
 * mode hors ligne qui reprend : pas de ticket, la partie démarre sur une
 * graine locale et n'est pas classée ; piste à sec, la partie finit non
 * classée avec un mot ; pas de réponse à la soumission, le score local reste.
 *
 * L'interrupteur « RANKED » du menu vient au jalon M3 ; d'ici là la voie
 * s'ouvre par `startRanked()` sur la surface de débogage.
 */
import { outcomeOf, type Difficulty, type Outcome, type Sim } from '../sim/index.js';
import { api, online, type Issued } from './api.js';
import { TrackStream } from './stream.js';

/** Pourquoi une partie classée ne l'est finalement pas. */
export type Unranked = 'offline' | 'no-ticket' | 'dry' | 'refused' | 'unreachable';

export class Ranked {
  private stream: TrackStream | null = null;
  /** Vrai entre `begin` et la fin de la partie, tant que rien n'a déclassé. */
  get active(): boolean {
    return this.stream !== null;
  }
  get ticket(): string | null {
    return this.stream?.ticket ?? null;
  }

  /**
   * Demande un ticket. Résout la première tranche à brancher sur la piste, ou
   * la raison pour laquelle la partie sera hors ligne. Ne lève jamais.
   */
  async request(difficulty: Difficulty): Promise<Issued | Unranked> {
    if (!online()) return 'offline';
    try {
      return await api.ticket(difficulty);
    } catch {
      return 'no-ticket';
    }
  }

  /** Branche la piste servie sur la simulation. Après `sim.reset`, avant le premier pas. */
  begin(sim: Sim, issued: Issued): boolean {
    const stream = TrackStream.from(issued);
    if (!stream) return false;
    stream.attach(sim);
    this.stream = stream;
    return true;
  }

  /** À chaque frame d'une partie classée : garde la file pleine. */
  pump(): void {
    this.stream?.pump();
  }

  /** Rend la raison si la partie vient de perdre son classement, sinon `null`. */
  check(sim: Sim): Unranked | null {
    if (this.stream && sim.track.dry) {
      this.stream = null;
      return 'dry';
    }
    return null;
  }

  /** Le rang de la dernière soumission acceptée, ou nul avant toute partie classée. */
  rank: number | null = null;

  /**
   * Soumet la partie finie sous `name`. Résout l'issue du serveur, ou la
   * raison pour laquelle le score reste local. Détache la partie dans tous
   * les cas. `claim` est ce que le client a lui-même calculé — envoyé pour
   * être comparé, jamais pour compter : le serveur rejoue et n'en croit rien.
   */
  async submit(sim: Sim, name: string): Promise<Outcome | Unranked> {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return 'offline';
    try {
      const trace = sim.trace();
      const claim = outcomeOf(sim.state, trace.steps);
      const { outcome, rank } = await api.run(stream.ticket, trace, name, claim);
      this.rank = rank;
      return outcome;
    } catch (e) {
      return e instanceof Error && 'status' in e ? 'refused' : 'unreachable';
    }
  }

  abandon(): void {
    this.stream = null;
  }
}
