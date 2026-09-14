/**
 * La session du joueur : le jeton que le serveur a rendu, et le compte qu'il
 * désigne.
 *
 * Le jeton arrive dans le fragment de l'URL au retour de la connexion —
 * `#session=…` — parce qu'un fragment ne part jamais au serveur ni dans un
 * journal. Il est lu au démarrage, rangé dans `localStorage` comme les
 * préférences, et effacé de l'URL dans le même geste : une adresse copiée
 * ensuite ne le contient pas.
 *
 * Le compte n'est jamais deviné depuis le jeton : c'est `/me` qui le dit, à
 * chaque démarrage. Un 401 efface le jeton — session close, compte supprimé,
 * ou jeton d'une autre base — et le jeu redevient hors ligne sans rien
 * demander.
 */
import { api, API_URL, ApiError, setAuthToken, type Account } from './api.js';
import { photoFor, rememberPhoto } from './photos.js';

const KEY = 'gsurge.session.v1';
/**
 * La photo du fournisseur, en transit.
 *
 * Elle arrive dans le fragment du retour de connexion, comme le jeton et pour
 * la même raison. Mais elle ne reste pas ici : dès que `/me` dit qui l'on est,
 * elle passe dans `photos.ts`, **rangée sous la graine de visage du compte**
 * comme celle de n'importe quel pilote croisé, et cette clé-ci est effacée.
 *
 * C'est ce transfert qui répare le changement de compte : une clé unique sans
 * identité gardait la photo du compte précédent, et le menu la montrait encore
 * pendant que les réglages montraient les pixels du nouveau. Un seul magasin,
 * une seule clé par compte, un seul getter — `faceHtml` et `paintFace`.
 */
const PIC = 'gsurge.picture.v1';
/**
 * Posé dans `sessionStorage` juste avant de partir chez le fournisseur, et
 * exigé pour lire `#session=` au retour : un lien reçu avec un fragment ne
 * connecte pas — il faut être parti d'ici. `sessionStorage` vit dans l'onglet
 * et survit à la navigation aller-retour, ce qui est exactement sa portée.
 */
const STARTED = 'gsurge.signin';

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export class Session {
  account: Account | null = null;
  /** Appelé à chaque changement — connexion lue, compte confirmé, sortie. */
  onChange: (() => void) | null = null;
  /**
   * Vrai quand le jeton vient d'être lu dans l'adresse, donc que le joueur
   * arrive de chez le fournisseur : c'est là qu'on lui propose son pseudo.
   * Consommé par celui qui le lit.
   */
  fresh = false;

  constructor() {
    this.readFragment();
    setAuthToken(this.token());
  }

  get token(): () => string | null {
    return () => storage()?.getItem(KEY) ?? null;
  }

  /** Vrai si un jeton est là — le serveur reste seul juge de ce qu'il vaut. */
  get signedIn(): boolean {
    return this.token() !== null;
  }

  /**
   * La photo du fournisseur en attente d'un compte, s'il y en a une. Lue par le
   * duel, qui l'envoie au salon ; le reste du client la lit dans `photos.ts`,
   * où elle est rangée dès que `/me` répond.
   */
  get picture(): string | null {
    return storage()?.getItem(PIC) ?? photoFor(this.account?.face ?? this.account?.name);
  }

  /** L'adresse chez le serveur qui ouvre la connexion : une navigation, pas un `fetch`. */
  signInUrl(provider: string): string {
    return `${API_URL}/auth/${provider}/start?return=${encodeURIComponent(window.location.origin)}`;
  }

  /** Part se connecter : marque le départ, puis navigue. Le fournisseur veut la page entière. */
  signIn(provider: string): void {
    try {
      window.sessionStorage.setItem(STARTED, '1');
    } catch {
      // sans stockage de session, le retour ne sera pas lu ; mieux que l'inverse
    }
    window.location.assign(this.signInUrl(provider));
  }

  /** Demande au serveur qui l'on est. Sans jeton ne fait rien ; sur 401, oublie. */
  async refresh(): Promise<void> {
    if (!this.token() || !API_URL) return;
    try {
      this.account = await api.me();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.forget();
      // un serveur muet ne déconnecte pas : le jeton vaut encore
      return;
    }
    // Le compte connu, la photo en transit trouve sa clé et quitte la sienne.
    const pending = storage()?.getItem(PIC);
    if (pending) {
      rememberPhoto(this.account.face ?? this.account.name, pending);
      storage()?.removeItem(PIC);
    }
    this.onChange?.();
  }

  /** Le pseudo choisi. Faux si le serveur le refuse — la règle du tableau. */
  async rename(name: string): Promise<boolean> {
    try {
      await api.setName(name);
    } catch {
      return false;
    }
    if (this.account) this.account = { ...this.account, name };
    this.onChange?.();
    return true;
  }

  async signOut(): Promise<void> {
    try {
      await api.logout();
    } catch {
      // la session mourra d'elle-même ; ce qui compte est d'oublier ici
    }
    this.forget();
  }

  async deleteAccount(): Promise<boolean> {
    try {
      await api.deleteAccount();
    } catch {
      return false;
    }
    this.forget();
    return true;
  }

  private forget(): void {
    storage()?.removeItem(KEY);
    // La photo s'en va avec la session : elle vient du fournisseur, elle ne
    // survit pas à une déconnexion.
    storage()?.removeItem(PIC);
    setAuthToken(null);
    this.account = null;
    this.onChange?.();
  }

  private readFragment(): void {
    const hash = window.location.hash;
    if (!hash.startsWith('#')) return;
    const token = new URLSearchParams(hash.slice(1)).get('session');
    if (!token) return;
    let started = false;
    try {
      started = window.sessionStorage.getItem(STARTED) === '1';
      window.sessionStorage.removeItem(STARTED);
    } catch {
      started = false;
    }
    // Un fragment sans départ d'ici est un lien reçu : effacé, jamais rangé.
    if (started) {
      storage()?.setItem(KEY, token);
      const pic = new URLSearchParams(hash.slice(1)).get('pic');
      if (pic) storage()?.setItem(PIC, pic);
      else storage()?.removeItem(PIC);
      this.fresh = true;
    }
    // Effacé sans recharger : l'adresse redevient celle du jeu.
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
  }
}
