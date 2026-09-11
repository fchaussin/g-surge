/**
 * Le plein écran, avec ses deux réalités ingrates.
 *
 * La graphie préfixée WebKit est encore celle à laquelle Safari sur iPad
 * répond, et une demande depuis une iframe sans `allow="fullscreen"` est
 * rejetée plutôt que levée — c'est ainsi que ce jeu est le plus souvent
 * embarqué, donc le refus doit être dit tout haut au lieu d'échouer en
 * silence.
 *
 * Il porte aussi le verrou d'orientation, parce que c'est là que le navigateur
 * l'accepte : `screen.orientation.lock` est refusé hors du plein écran. Le
 * manifeste demande le paysage à une application installée ; ceci le demande
 * dans un onglet, et c'est une demande dans les deux cas — l'ordinateur la
 * refuse, iOS n'a pas cette API du tout, et ni l'un ni l'autre n'est une
 * erreur qui mérite d'être montrée.
 */
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
/** Structurel, comme les deux au-dessus : l'API manque sur plusieurs cibles. */
type LockableOrientation = {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

const root = document.documentElement as FsElement;
const doc = document as FsDocument;

export class Fullscreen {
  /** Faux là où l'API manque entièrement ; les commandes se cachent alors. */
  readonly available = !!(root.requestFullscreen || root.webkitRequestFullscreen);

  constructor(private readonly onChange: (active: boolean, blocked: boolean) => void) {
    if (!this.available) return;
    const notify = () => {
      this.applyOrientation();
      this.onChange(this.active, false);
    };
    document.addEventListener('fullscreenchange', notify);
    document.addEventListener('webkitfullscreenchange', notify);
  }

  get active(): boolean {
    return !!(document.fullscreenElement ?? doc.webkitFullscreenElement);
  }

  toggle(): void {
    if (!this.available) return;
    try {
      if (!this.active) {
        const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
        const result = request?.call(root, { navigationUI: 'hide' });
        if (result instanceof Promise) result.catch(() => this.blocked());
      } else {
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        const result = exit?.call(doc);
        if (result instanceof Promise) result.catch(() => undefined);
      }
    } catch {
      this.blocked();
    }
    // L'événement de changement ne part pas toujours sur un refus.
    setTimeout(() => this.onChange(this.active, false), 150);
  }

  /**
   * Paysage en plein écran, libre à nouveau en sortant.
   *
   * Accroché à l'événement de changement plutôt qu'à `toggle`, pour couvrir
   * aussi les façons d'entrer et de sortir du plein écran sans passer par cette
   * classe — la touche Échap, et les commandes du navigateur lui-même.
   */
  private applyOrientation(): void {
    const orientation = screen.orientation as unknown as LockableOrientation | undefined;
    if (!orientation) return;
    try {
      if (this.active) void orientation.lock?.('landscape')?.catch(() => undefined);
      else orientation.unlock?.();
    } catch {
      // Refusé, ce qui est la réponse normale sur un ordinateur. Rien à faire.
    }
  }

  private blocked(): void {
    this.onChange(false, true);
    setTimeout(() => this.onChange(this.active, false), 2200);
  }
}
