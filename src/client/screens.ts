/**
 * La machine à états des écrans et sa navigation au clavier.
 *
 * Une chaîne `Mode` décide quel calque est montré. **L'état de départ doit être
 * posé en appelant `setMode('menu')`, jamais en laissant une classe dans le
 * HTML** : la classe seule montrerait le bon écran avec une liste de navigation
 * vide, et le clavier n'y ferait rien.
 *
 * La navigation est une liste plate par écran, rebâtie à chaque transition, où
 * un groupe de boutons segmentés compte pour un seul arrêt — gauche et droite
 * changent alors la valeur au lieu d'avancer.
 */
export type Mode = 'menu' | 'run' | 'pause' | 'over' | 'settings' | 'help';

/**
 * Les éléments navigables par écran, dans l'ordre. Les réglages bâtissent la
 * leur.
 *
 * Exportés, avec les deux tables en dessous, pour `tests/dom-ids` seul : ce
 * sont les identifiants que ce module cherche, et le test les rapproche
 * d'`index.html`.
 */
export const NAV_IDS: Partial<Record<Mode, readonly string[]>> = {
  menu: [
    'segDiff',
    'btnStart',
    'btnHelp',
    'btnSettingsMenu',
    'btnFullMenu',
    'btnInstall',
    'btnInstallLater',
  ],
  help: ['btnCloseHelp'],
  pause: ['btnResume', 'btnRestart', 'btnSettingsPause', 'btnQuit'],
  over: ['btnAgain', 'btnOverMenu'],
};

/** L'élément présélectionné à l'ouverture d'un écran. */
export const NAV_DEFAULT: Partial<Record<Mode, string>> = {
  menu: 'btnStart',
  pause: 'btnResume',
  over: 'btnAgain',
  help: 'btnCloseHelp',
};

/** Les écrans qui sont aussi des identifiants. `run` n'en est pas un : il montre le HUD. */
export const LAYERS: readonly Mode[] = ['menu', 'pause', 'over', 'help', 'settings'];

export interface ScreensOptions {
  /** Appelé à chaque transition, pour que le reste du client réagisse. */
  onChange?: (mode: Mode, previous: Mode) => void;
}

export class Screens {
  private current: Mode = 'menu';
  /** Où Échap ramène depuis les réglages : le menu ou l'écran de pause. */
  private settingsBack: Mode = 'menu';

  private navList: HTMLElement[] = [];
  private navIndex = -1;
  /** Le curseur clavier n'est peint qu'une fois le clavier utilisé. */
  private navActive = false;

  constructor(private readonly options: ScreensOptions = {}) {
    this.bindPointer();
    this.bindKeyboard();
  }

  get mode(): Mode {
    return this.current;
  }

  get isPlaying(): boolean {
    return this.current === 'run';
  }

  setMode(mode: Mode): void {
    const previous = this.current;
    this.current = mode;

    for (const layer of LAYERS) {
      document.getElementById(layer)?.classList.toggle('on', layer === mode);
    }
    document.getElementById('hud')?.classList.toggle('on', mode === 'run');
    // Le bouton de son se poserait sur ces deux écrans ; et pendant une partie
    // il se décale à droite, pour que la pause ait le coin.
    const mute = document.getElementById('btnMute');
    mute?.classList.toggle('hide', mode === 'settings' || mode === 'help');
    mute?.classList.toggle('run', mode === 'run');

    this.buildNav();
    this.options.onChange?.(mode, previous);
  }

  openSettings(): void {
    this.settingsBack = this.current === 'pause' ? 'pause' : 'menu';
    this.setMode('settings');
  }

  /** Rebâtit la liste de navigation. À appeler après un changement de ce qui est affiché. */
  buildNav(): void {
    // Un changement d'onglet dans les réglages ne doit pas perdre la sélection.
    const previous = this.navList[this.navIndex];

    if (this.current === 'settings') {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '#settings .close, #settings .navgroup, ' +
            '#settings .page.on button, #settings .page.on input[type=range]',
        ),
      );
      // Un groupe compte pour un arrêt, donc ses propres boutons sont écartés.
      // Les boutons de remise à zéro sont sautés : une commodité par ligne, pas
      // un arrêt.
      this.navList = nodes.filter(
        (el) =>
          el.classList.contains('navgroup') ||
          (!el.classList.contains('rst') && !el.closest('.navgroup')),
      );
    } else {
      this.navList = (NAV_IDS[this.current] ?? [])
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null && el.offsetParent !== null);
    }

    let i = previous ? this.navList.indexOf(previous) : -1;
    if (i < 0) {
      const wanted = NAV_DEFAULT[this.current];
      if (wanted) {
        const el = document.getElementById(wanted);
        i = el ? this.navList.indexOf(el as HTMLElement) : -1;
      }
    }
    this.navIndex = i >= 0 ? i : this.navList.length ? 0 : -1;
    this.paintNav();
  }

  private paintNav(): void {
    document.querySelector('.nav-sel')?.classList.remove('nav-sel');
    if (!this.navActive || this.navIndex < 0) return;
    const el = this.navList[this.navIndex];
    if (!el) return;
    el.classList.add('nav-sel');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }

  private move(step: number): void {
    if (!this.navList.length) return;
    this.navActive = true;
    this.navIndex = (this.navIndex + step + this.navList.length) % this.navList.length;
    this.paintNav();
  }

  /** Fait tourner un contrôle segmenté par un clic, pour que son gestionnaire tourne. */
  private stepGroup(group: HTMLElement, dir: number): void {
    const buttons = Array.from(group.querySelectorAll('button'));
    if (!buttons.length) return;
    let i = buttons.findIndex((b) => b.classList.contains('on'));
    if (i < 0) i = 0;
    buttons[(i + dir + buttons.length) % buttons.length]!.click();
  }

  private bindPointer(): void {
    // Tactile ou souris : le curseur clavier cesse d'être pertinent.
    window.addEventListener(
      'pointerdown',
      () => {
        if (!this.navActive) return;
        this.navActive = false;
        this.paintNav();
      },
      true,
    );
    // Si le navigateur déplace le focus ailleurs, l'index le suit.
    window.addEventListener('focusin', (e) => {
      const i = this.navList.indexOf(e.target as HTMLElement);
      if (i >= 0) this.navIndex = i;
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onBack();
        e.preventDefault();
        return;
      }
      if (this.current === 'run') return; // les touches de conduite sont à InputSource

      if (e.code === 'ArrowDown' || e.code === 'KeyS' || (e.code === 'Tab' && !e.shiftKey)) {
        this.move(1);
        e.preventDefault();
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW' || (e.code === 'Tab' && e.shiftKey)) {
        this.move(-1);
        e.preventDefault();
        return;
      }

      const current = this.navActive ? this.navList[this.navIndex] : undefined;
      if (current?.classList.contains('navgroup')) {
        if (e.code === 'ArrowLeft') {
          this.stepGroup(current, -1);
          e.preventDefault();
          return;
        }
        if (['ArrowRight', 'Space', 'Enter', 'NumpadEnter'].includes(e.code)) {
          this.stepGroup(current, 1);
          e.preventDefault();
          return;
        }
      }

      if (['Enter', 'NumpadEnter', 'Space'].includes(e.code)) {
        if (current) current.click();
        else {
          // La première touche ne fait que révéler le curseur ; elle n'active pas.
          this.navActive = true;
          this.paintNav();
        }
        e.preventDefault();
      }
      // Les curseurs prennent gauche et droite eux-mêmes ; on les laisse au navigateur.
    });
  }

  /** Échap et le bouton de pause arrivent tous deux ici. */
  private onBack(): void {
    switch (this.current) {
      case 'run':
        this.setMode('pause');
        break;
      case 'pause':
        this.setMode('run');
        break;
      case 'settings':
        this.setMode(this.settingsBack);
        break;
      case 'help':
        this.setMode('menu');
        break;
      default:
        break;
    }
  }

  /**
   * Montre le curseur clavier d'emblée avec un pointeur précis, et le laisse
   * caché au tactile, où il ne serait que du bruit visuel.
   */
  revealCursorOnPrecisePointer(): void {
    if (window.matchMedia?.('(pointer: fine)').matches) {
      this.navActive = true;
      this.paintNav();
    }
  }
}
