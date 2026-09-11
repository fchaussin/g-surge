/**
 * L'invitation à installer l'application, sur la version web.
 *
 * Trois cas, et l'invitation change de forme selon le navigateur :
 *
 * - Chromium et dérivés émettent `beforeinstallprompt` quand la page remplit
 *   les critères. On retient l'événement et l'invitation porte un bouton ; au
 *   clic il appelle `prompt()`, que le navigateur refuse hors d'un geste. Après
 *   un refus Chromium ne réémet l'événement qu'à une navigation ultérieure.
 * - Safari n'émet rien et n'a pas d'API : l'invitation dit le geste, Partager
 *   puis Sur l'écran d'accueil, sans bouton — rien n'est plus honnête qu'un
 *   bouton absent.
 * - La page tourne déjà installée, ce que `display-mode` dit : aucune
 *   invitation, ni sur `appinstalled`.
 *
 * « Lancer l'application installée » depuis un onglet n'existe dans aucun
 * navigateur — il n'y a pas d'API pour ouvrir une PWA depuis une page — donc
 * l'hybride installer/lancer se réduit à installer quand c'est possible et à
 * se taire quand c'est fait.
 *
 * L'invitation se ferme, et la fermeture est une préférence : une carte qui
 * revient à chaque visite chez quelqu'un qui a dit non est du harcèlement.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Ce que l'invitation doit montrer. */
export type InstallOffer =
  /** Rien : installée, fermée, ou aucun moyen d'installer connu. */
  | { kind: 'none' }
  /** Un bouton qui ouvre la boîte du navigateur. */
  | { kind: 'prompt' }
  /** Un mode d'emploi, là où le navigateur n'offre pas de boîte. */
  | { kind: 'manual'; hint: string };

/** Vrai si la page tourne déjà comme une application installée. */
export function installed(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches
  );
}

/** Safari sur iPhone et iPad : `standalone` existe là et nulle part ailleurs. */
export function isIos(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone !== undefined;
}

export const IOS_HINT = 'On iPhone and iPad: tap Share, then Add to Home Screen.';

export class InstallPrompt {
  private pending: BeforeInstallPromptEvent | null = null;
  private dismissed: boolean;
  private done = false;

  /**
   * @param dismissed la préférence : l'invitation a déjà été fermée.
   * @param onChange appelé chaque fois que ce qu'il faut montrer change.
   */
  constructor(
    dismissed: boolean,
    private readonly onChange: (offer: InstallOffer) => void,
  ) {
    this.dismissed = dismissed;
    this.done = installed();
    if (this.done) return;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.pending = e as BeforeInstallPromptEvent;
      this.onChange(this.offer);
    });
    window.addEventListener('appinstalled', () => {
      this.pending = null;
      this.done = true;
      this.onChange(this.offer);
    });
  }

  get offer(): InstallOffer {
    if (this.done || this.dismissed) return { kind: 'none' };
    if (this.pending) return { kind: 'prompt' };
    if (isIos()) return { kind: 'manual', hint: IOS_HINT };
    return { kind: 'none' };
  }

  get available(): boolean {
    return this.offer.kind !== 'none';
  }

  /** L'utilisateur a dit non : l'invitation se tait, et la préférence le retient. */
  dismiss(): void {
    this.dismissed = true;
    this.onChange(this.offer);
  }

  /** Ouvre la boîte du navigateur. Refusée ou non, la proposition a été faite : l'invitation se tait. */
  async prompt(): Promise<void> {
    const e = this.pending;
    if (!e) return;
    this.pending = null;
    this.onChange(this.offer);
    try {
      await e.prompt();
      await e.userChoice;
    } catch {
      /* la boîte a été refusée par le navigateur : rien à dire de plus */
    }
  }
}
