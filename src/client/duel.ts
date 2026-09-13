/**
 * Un duel : la moitié client du salon de `server/src/room.ts`.
 *
 * Le jeu ne change pas d'un pas : la simulation du joueur est la sienne, sur
 * la piste que le salon sert par tranches — comme une partie classée, avec
 * `TrackStream` — et ce module fait deux choses à côté. Il **envoie** la
 * trace en morceaux, à 10 Hz de temps simulé : toutes les `CHUNK_STEPS`
 * pas, la fenêtre depuis le dernier envoi, empaquetée comme une trace
 * entière, avec la distance que la simulation affiche. Et il **reçoit** ce
 * que le salon relaie de l'autre — six nombres — que `Ghost.puppet` dessine.
 * Les nombres de l'autre n'entrent jamais dans la simulation du joueur.
 *
 * La cadence se compte en pas fixes, pas en frames : dix envois par seconde
 * de jeu quelle que soit la cadence d'affichage, et le serveur compte la
 * même chose. `pump` se contente de regarder si `CHUNK_STEPS` pas se sont
 * accumulés ; l'envoi est une écriture sur la prise, jamais une attente.
 *
 * L'entrée demande un compte : un duel est une partie classée à deux.
 */
import { DT, type Difficulty, type Sim, type WireChunk } from '../sim/index.js';
import { api, online, socketUrl, type Seat } from './api.js';
import { toBase64 } from './base64.js';
import { TrackStream } from './stream.js';
import { packTrace } from '../sim/index.js';

/** Un morceau tous les 72 pas : 10 Hz à 720 pas par seconde. La constante du serveur est la même cadence. */
export const CHUNK_STEPS = Math.round(0.1 / DT);

/** Ce que le salon relaie de l'autre vaisseau : les six nombres du noyau, et le pas où ils valent. */
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

/** Où en est un membre à la fin : arrivé au bout de tant de pas, ou épave à telle distance. */
export interface Standing {
  who: string;
  name: string;
  finished: boolean;
  steps: number;
  dist: number;
}

type Message =
  | ({ type: 'state' } & Relay)
  | { type: 'seats'; seats: number }
  | { type: 'start'; countdown: number; race: number }
  | { type: 'result'; race: number; ranking: Standing[] }
  | { type: string; [k: string]: unknown };

/** Pourquoi un duel n'a pas commencé, ou s'est arrêté. */
export type DuelEnd =
  'offline' | 'sign-in' | 'refused' | 'unreachable' | 'full' | 'gone' | 'diverged' | 'expired';

export const DUEL_LINK = 'duel';

export class Duel {
  /** L'identifiant du salon — celui du lien — et ma place. */
  room: string | null = null;
  private seat: Seat | null = null;
  private stream: TrackStream | null = null;
  private socket: WebSocket | null = null;
  private sentUpTo = 0;
  /** Le dernier état relayé de l'autre, s'il en est venu un. */
  other: Relay | null = null;
  /** Combien de places sont prises, d'après le salon. */
  seats = 0;
  /** Appelé quand l'autre arrive, part, ou que la prise se ferme. */
  onChange: ((why: DuelEnd | null) => void) | null = null;
  /** Le départ : le décompte en secondes, et la ligne d'arrivée en mètres. */
  onStart: ((countdown: number, race: number) => void) | null = null;
  /** La fin : le classement, tel que l'objet l'a jugé. */
  onResult: ((ranking: Standing[]) => void) | null = null;
  /** La ligne d'arrivée de cette course, connue au départ. */
  race = 0;
  /** Mon jeton de membre, pour me reconnaître dans le classement. */
  get member(): string | null {
    return this.seat?.member ?? null;
  }

  get active(): boolean {
    return this.socket !== null;
  }

  /** L'adresse à partager : le jeu lui-même, avec l'identifiant du salon en fragment. */
  inviteLink(): string {
    return `${window.location.origin}${window.location.pathname}#${DUEL_LINK}=${this.room ?? ''}`;
  }

  /** Ouvre un salon. Rend la raison si ce n'est pas possible. */
  async open(difficulty: Difficulty): Promise<DuelEnd | null> {
    if (!online()) return 'offline';
    try {
      const seat = await api.openRoom(difficulty);
      this.room = seat.room;
      this.seat = seat;
      this.seats = seat.seats;
      return null;
    } catch (e) {
      return reasonOf(e);
    }
  }

  /** Rejoint le salon d'un lien. */
  async join(room: string): Promise<DuelEnd | null> {
    if (!online()) return 'offline';
    try {
      const seat = await api.joinRoom(room);
      this.room = room;
      this.seat = seat;
      this.seats = seat.seats;
      return null;
    } catch (e) {
      return reasonOf(e);
    }
  }

  /** Branche la piste du salon sur la simulation. Après `sim.reset`, avant le premier pas. */
  begin(sim: Sim): boolean {
    const seat = this.seat;
    const room = this.room;
    if (!seat || !room) return false;
    const stream = TrackStream.of(seat.chunk, (from: number): Promise<WireChunk> =>
      api.roomChunk(room, from),
    );
    if (!stream) return false;
    stream.attach(sim);
    this.stream = stream;
    this.sentUpTo = 0;
    this.other = null;
    return true;
  }

  /** Ouvre la prise. Les messages arrivent quand ils arrivent ; rien n'est attendu ici. */
  connect(): void {
    const seat = this.seat;
    const room = this.room;
    if (!seat || !room || this.socket) return;
    const ws = new WebSocket(socketUrl(`/room/${room}/ws?member=${seat.member}`));
    ws.onmessage = (ev) => {
      let m: Message;
      try {
        m = JSON.parse(String(ev.data)) as Message;
      } catch {
        return;
      }
      if (m.type === 'state') this.other = m as Relay;
      else if (m.type === 'seats') {
        this.seats = (m as { seats: number }).seats;
        this.onChange?.(null);
      } else if (m.type === 'start') {
        const { countdown, race } = m as { countdown: number; race: number };
        this.race = race;
        this.onStart?.(countdown, race);
      } else if (m.type === 'result') {
        this.onResult?.((m as { ranking: Standing[] }).ranking);
      }
    };
    ws.onclose = (ev) => {
      this.socket = null;
      this.onChange?.(ev.code === 4001 ? 'diverged' : ev.code === 4002 ? 'expired' : 'gone');
    };
    this.socket = ws;
  }

  /**
   * À chaque frame : la piste reste pleine, et un morceau part dès que
   * `CHUNK_STEPS` pas se sont accumulés depuis le dernier.
   */
  pump(sim: Sim): void {
    this.stream?.pump();
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const steps = sim.steps;
    if (steps - this.sentUpTo < CHUNK_STEPS) return;
    const window = sim.window(this.sentUpTo);
    this.sentUpTo = steps;
    ws.send(JSON.stringify({ t: toBase64(packTrace(window)), d: sim.state.dist }));
  }

  /** Le reste de la trace, tout de suite : à la ligne, il ne faut pas attendre le prochain morceau. */
  flush(sim: Sim): void {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const steps = sim.steps;
    if (steps <= this.sentUpTo) return;
    const window = sim.window(this.sentUpTo);
    this.sentUpTo = steps;
    ws.send(JSON.stringify({ t: toBase64(packTrace(window)), d: sim.state.dist }));
  }

  /** Quitte le salon : la prise fermée, la piste lâchée. */
  leave(): void {
    const ws = this.socket;
    if (ws) {
      // Une fermeture voulue n'est pas une perte : les gestionnaires sont
      // détachés d'abord, sans quoi `onclose` disait « that room is gone »
      // par-dessus le classement qui venait de s'afficher.
      ws.onmessage = null;
      ws.onclose = null;
      ws.close(1000, 'leave');
    }
    this.socket = null;
    this.stream = null;
    this.seat = null;
    this.room = null;
    this.other = null;
    this.seats = 0;
    this.race = 0;
  }
}

function reasonOf(e: unknown): DuelEnd {
  if (e instanceof Error && 'code' in e) {
    const code = (e as { code: string }).code;
    if (code === 'sign-in') return 'sign-in';
    if (code === 'full' || code === 'exists') return 'full';
    if (code === 'room' || code === 'member') return 'gone';
    return 'refused';
  }
  return 'unreachable';
}
