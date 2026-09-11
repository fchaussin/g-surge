/**
 * La proposition d'installer l'application, sur la version web.
 *
 * Chromium et ses dérivés émettent `beforeinstallprompt` quand la page remplit
 * les critères d'installation. On retient l'événement et on montre un bouton ;
 * au clic il appelle `prompt()`, que le navigateur refuse hors d'un geste.
 * Safari n'émet rien : le bouton n'apparaît pas, et rien n'est plus honnête
 * qu'un bouton absent — le geste y est « Ajouter à l'écran d'accueil », et
 * c'est l'aide qui pourrait le dire, pas un bouton qui ne ferait rien.
 *
 * Absent aussi quand la page tourne déjà installée, ce que `display-mode`
 * dit, et dès `appinstalled`. Après un refus, Chromium ne réémet l'événement
 * qu'à une navigation ultérieure : le bouton reste caché jusque-là, ce qui est
 * exactement le comportement voulu pour une proposition.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Vrai si la page tourne déjà comme une application installée. */
function installed(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches
  );
}

export class InstallPrompt {
  private pending: BeforeInstallPromptEvent | null = null;

  /** @param onChange appelé quand le bouton doit apparaître ou disparaître. */
  constructor(private readonly onChange: (available: boolean) => void) {
    if (installed()) return;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.pending = e as BeforeInstallPromptEvent;
      this.onChange(true);
    });
    window.addEventListener('appinstalled', () => {
      this.pending = null;
      this.onChange(false);
    });
  }

  get available(): boolean {
    return this.pending !== null;
  }

  /** Ouvre la boîte du navigateur. Le bouton se cache aussitôt : refusée ou non, la proposition a été faite. */
  async prompt(): Promise<void> {
    const e = this.pending;
    if (!e) return;
    this.pending = null;
    this.onChange(false);
    try {
      await e.prompt();
      await e.userChoice;
    } catch {
      /* la boîte a été refusée par le navigateur : rien à dire de plus */
    }
  }
}
