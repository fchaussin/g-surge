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

const KEY = 'gsurge.session.v1';
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
    this.onChange?.();
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
    if (started) storage()?.setItem(KEY, token);
    // Effacé sans recharger : l'adresse redevient celle du jeu.
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
  }
}
