/**
 * Les amis sur l'écran de duel : qui te défie, qui tu peux défier, et comment
 * on se lie.
 *
 * L'écran de duel commençait par un lien à faire parvenir à quelqu'un par un
 * moyen que le jeu ne connaît pas. Il commence maintenant par des gens : les
 * défis reçus d'abord, puisqu'il n'y a qu'à les rejoindre, puis les amis à
 * défier, puis de quoi se lier — mon code, et celui d'en face. Le lien et son
 * QR restent en dessous, pour qui n'est pas encore un ami.
 *
 * Ce module ne connaît que son bloc de DOM et l'API ; ce qu'il faut faire d'un
 * salon ouvert ou rejoint appartient à `main.ts`, qui le lui passe.
 */
import type { Difficulty } from '../sim/index.js';
import { drawQr } from './qr.js';
import { api, ApiError, online, type Friend, type FriendList, type Seat } from './api.js';
import { faceHtml } from './photos.js';

export interface FriendsOptions {
  /** La difficulté d'un défi lancé : celle que le menu montre. */
  difficulty: () => Difficulty;
  /** Ma photo, si j'en ai une : elle voyage avec l'entrée dans le salon. */
  picture: () => string | null;
  /** Un salon ouvert pour un ami : à `main.ts` d'aller sur la grille. */
  onOpened: (seat: Seat, friend: Friend) => void;
  /** Un défi accepté : le salon d'un ami, à rejoindre. */
  onJoin: (room: string) => void;
  /** La liste a changé de taille : la navigation clavier est à rebâtir. */
  onRebuild: () => void;
}

/**
 * Le fragment d'un lien d'amitié, comme `duel` l'est d'un salon.
 *
 * Six caractères se dictent au téléphone, mais ne se tapent pas : un QR passe
 * d'un écran à l'autre sans un mot. Le lien porte donc le code, et celui qui
 * le suit envoie la demande sans rien saisir — l'acceptation reste de l'autre
 * côté, c'est elle qui protège, pas la difficulté de la saisie.
 */
export const FRIEND_LINK = 'friend';

/** L'adresse qui demande une amitié : le jeu, avec le code en fragment. */
export const friendLink = (code: string): string =>
  `${window.location.origin}${window.location.pathname}#${FRIEND_LINK}=${code}`;

/** Le mot de chaque refus du serveur, en interface. */
const WHY: Record<string, string> = {
  code: 'No pilot has that code.',
  self: 'That is your own code.',
  already: 'You two are already linked.',
  'not-friends': 'Not friends yet — send a request first.',
  'sign-in': 'Sign in to add friends.',
};

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export class Friends {
  private readonly host = document.getElementById('duelFriends');
  private readonly note = document.getElementById('friendsNote');
  private list: FriendList | null = null;
  /** Compte les chargements : une réponse en retard ne repeint pas la suivante. */
  private token = 0;

  constructor(private readonly options: FriendsOptions) {
    this.host?.addEventListener('click', (e) => void this.onClick(e));
    document.getElementById('btnAddFriend')?.addEventListener('click', () => void this.add());
  }

  /** À l'ouverture de l'écran : une lecture fraîche, jamais celle d'avant. */
  load(): void {
    if (!this.host) return;
    if (!online()) {
      this.render('Offline — friends need a connection.');
      return;
    }
    const mine = ++this.token;
    void api
      .friends()
      .then((list) => {
        if (mine !== this.token) return;
        this.list = list;
        this.paint();
      })
      .catch(() => {
        if (mine === this.token) this.render('Could not reach your friends.');
      });
  }

  private say(text: string): void {
    if (this.note) this.note.textContent = text;
  }

  private render(message: string): void {
    if (this.host) this.host.innerHTML = `<p class="empty">${esc(message)}</p>`;
    this.options.onRebuild();
  }

  private paint(): void {
    const list = this.list;
    if (!this.host || !list) return;
    // Le même visage que partout ailleurs : `faceHtml` décide, ici en chaîne
    // parce que la ligne est bâtie en HTML. Le serveur ne connaît aucune photo,
    // donc celles qu'on voit viennent des duels déjà joués.
    const row = (f: { name: string; face: string; code: string }, buttons: string): string =>
      `<li>${faceHtml(f)}<span class="nm">${esc(f.name)}</span>${buttons}</li>`;

    const invites = list.invites
      .map((i) => row(i.from, `<button class="wbtn hot" data-join="${esc(i.room)}">RACE</button>`))
      .join('');
    const requests = list.requests
      .map((f) =>
        row(
          f,
          `<button class="wbtn" data-accept="${esc(f.code)}">ACCEPT</button>` +
            `<button class="wbtn" data-drop="${esc(f.code)}">✕</button>`,
        ),
      )
      .join('');
    const friends = list.friends
      .map((f) => row(f, `<button class="wbtn" data-race="${esc(f.code)}">CHALLENGE</button>`))
      .join('');

    this.host.innerHTML =
      (invites ? `<h4>CHALLENGING YOU</h4><ul>${invites}</ul>` : '') +
      (requests ? `<h4>WANTS TO BE FRIENDS</h4><ul>${requests}</ul>` : '') +
      (friends
        ? `<h4>FRIENDS</h4><ul>${friends}</ul>`
        : `<p class="empty">No friends yet. Give your code, or enter theirs.</p>`) +
      `<p class="mycode">Your code <b>${esc(list.code)}</b></p>`;
    this.paintCode(list.code);
    this.options.onRebuild();
  }

  /**
   * Mon code en QR, et le bouton qui le partage. Dessiné à chaque lecture de
   * la liste : le code ne change pas, mais l'écran peut avoir été ouvert avant
   * qu'il soit connu.
   */
  private paintCode(code: string): void {
    const share = document.getElementById('btnShareCode');
    share?.toggleAttribute('hidden', !code);
    const qr = document.getElementById('friendQr') as HTMLCanvasElement | null;
    if (!qr) return;
    try {
      if (!code) throw new Error('no code');
      drawQr(qr, friendLink(code));
      qr.hidden = false;
    } catch {
      qr.hidden = true;
    }
  }

  /** L'adresse à partager, pour qui veut la feuille de partage de l'appareil. */
  get link(): string {
    return this.list?.code ? friendLink(this.list.code) : '';
  }

  /** Un clic dans la liste : les boutons portent ce qu'ils font. */
  private async onClick(e: Event): Promise<void> {
    const button = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;
    const { join, race, accept, drop } = button.dataset;
    if (join) {
      this.options.onJoin(join);
      return;
    }
    if (race) {
      const friend = this.list?.friends.find((f) => f.code === race);
      if (!friend) return;
      this.say('Opening a room…');
      try {
        const seat = await api.challengeFriend(
          race,
          this.options.difficulty(),
          this.options.picture(),
        );
        this.say('');
        this.options.onOpened(seat, friend);
      } catch (err) {
        this.say(this.whyOf(err));
      }
      return;
    }
    if (accept) await this.act(() => api.acceptFriend(accept));
    if (drop) await this.act(() => api.removeFriend(drop));
  }

  /**
   * Demande une amitié par code, d'où qu'il vienne — le champ, ou un lien
   * scanné. Le résultat se lit sous la liste.
   */
  async addByCode(code: string): Promise<void> {
    await this.act(() => api.addFriend(code.toUpperCase()), 'Request sent.');
  }

  private async add(): Promise<void> {
    const input = document.getElementById('friendCode') as HTMLInputElement | null;
    const code = input?.value.trim().toUpperCase() ?? '';
    if (code.length !== 6) {
      this.say('A code is six characters.');
      return;
    }
    await this.addByCode(code);
    if (input) input.value = '';
  }

  /** Un geste, puis la liste relue : le serveur reste seul juge de son état. */
  private async act(call: () => Promise<unknown>, done = ''): Promise<void> {
    try {
      await call();
      this.say(done);
      this.load();
    } catch (err) {
      this.say(this.whyOf(err));
    }
  }

  private whyOf(err: unknown): string {
    const code = err instanceof ApiError ? err.code : '';
    return WHY[code] ?? 'The server refused that.';
  }
}
