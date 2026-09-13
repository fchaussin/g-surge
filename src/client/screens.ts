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
 *
 * `wreck` est le seul mode sans calque : entre l'explosion et la carte de
 * score, l'écran ne montre que la scène. Il gèle le monde comme `over` et
 * cache le HUD comme lui, mais ne pose rien par-dessus — c'est là que l'onde de
 * choc est vue. Mesuré avant qu'il existe : la carte et son voile flou
 * montaient dans les 80 ms du crash et la recouvraient entière.
 *
 * `watch` rejoue la trace d'une entrée du tableau : le monde avance comme en
 * partie et le HUD lit les mêmes chiffres, mais les entrées viennent de la
 * trace et non du joueur. D'où un mode à part et non un drapeau sur `run` :
 * ce qui se pilote n'a rien à faire à l'écran, et le retour ramène au tableau
 * d'où l'on vient, pas au menu.
 */
export type Mode =
  'menu' | 'run' | 'watch' | 'wreck' | 'pause' | 'over' | 'settings' | 'help' | 'board' | 'quit';

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
    'btnBoardMenu',
    'btnFullMenu',
    'btnInstall',
    'btnInstallLater',
  ],
  help: ['btnCloseHelp'],
  pause: ['btnResume', 'btnRestart', 'btnSettingsPause', 'btnQuit'],
  over: ['btnAgain', 'btnOverMenu'],
  board: ['segBoardDiff', 'btnCloseBoard'],
  quit: ['btnStay', 'btnLeave'],
};

/** L'élément présélectionné à l'ouverture d'un écran. */
export const NAV_DEFAULT: Partial<Record<Mode, string>> = {
  menu: 'btnStart',
  pause: 'btnResume',
  over: 'btnAgain',
  help: 'btnCloseHelp',
  board: 'btnCloseBoard',
  quit: 'btnStay',
};

/** Les écrans qui sont aussi des identifiants. `run` n'en est pas un : il montre le HUD. */
export const LAYERS: readonly Mode[] = [
  'menu',
  'pause',
  'over',
  'help',
  'settings',
  'board',
  'quit',
];

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

  /** Le joueur tient les commandes. Ce que l'entrée et le gouverneur lisent. */
  get isPlaying(): boolean {
    return this.current === 'run';
  }

  /**
   * Le monde avance et la présentation doit suivre : HUD, son, secousse,
   * voile, lueurs. Vrai en partie **et** pendant un visionnage, où personne ne
   * pilote mais où tout le reste se passe exactement pareil. La distinction
   * vaut d'être nommée : confondre les deux fait un HUD figé sur une partie
   * qui court, ce qui est arrivé à l'écriture de `watch`.
   */
  get isLive(): boolean {
    return this.current === 'run' || this.current === 'watch';
  }

  setMode(mode: Mode): void {
    const previous = this.current;
    this.current = mode;

    for (const layer of LAYERS) {
      document.getElementById(layer)?.classList.toggle('on', layer === mode);
    }
    // Le HUD sert la partie et le visionnage : dans les deux cas il lit une
    // simulation qui avance. `watch` le marque, pour que ce qui ne se pilote
    // pas — les pads, le manche, la pause — ne s'y montre pas.
    const hud = document.getElementById('hud');
    hud?.classList.toggle('on', mode === 'run' || mode === 'watch');
    hud?.classList.toggle('watch', mode === 'watch');
    // Le bouton de son se poserait sur ces deux écrans ; et pendant une partie
    // il se décale à droite, pour que la pause ait le coin.
    const mute = document.getElementById('btnMute');
    mute?.classList.toggle('hide', mode === 'settings' || mode === 'help' || mode === 'board');
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
        this.back();
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

  /**
   * Reculer d'un écran : Échap, le bouton de pause et le bouton retour du
   * système arrivent tous ici.
   *
   * @returns vrai si le recul a été consommé. Faux veut dire qu'il n'y a rien
   *   à quitter — le menu est la racine — et c'est ce que `history.ts` lit
   *   pour décider s'il propose de sortir du jeu. Pendant l'explosion, `wreck`,
   *   il n'y a rien à reculer non plus : l'écran de score arrive tout seul.
   */
  back(): boolean {
    switch (this.current) {
      case 'run':
        this.setMode('pause');
        return true;
      case 'pause':
        this.setMode('run');
        return true;
      case 'settings':
        this.setMode(this.settingsBack);
        return true;
      case 'watch':
        // On revient d'où l'on est parti : le tableau, pas le menu.
        this.setMode('board');
        return true;
      case 'help':
      case 'board':
      case 'over':
      case 'quit':
        this.setMode('menu');
        return true;
      default:
        return false;
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
