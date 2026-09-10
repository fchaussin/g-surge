/**
 * The screen state machine and its keyboard navigation.
 *
 * One `Mode` string drives which layer is shown. **The start state must be set
 * by calling `setMode('menu')`, never by leaving a class in the HTML**: the
 * class alone would show the right screen with an empty navigation list, and
 * the keyboard would do nothing on it.
 *
 * Navigation is a flat list per screen, rebuilt on every transition, with a
 * group of segmented buttons counting as a single stop — left and right then
 * change the value instead of moving on.
 */
export type Mode = 'menu' | 'run' | 'pause' | 'over' | 'settings' | 'help' | 'fpsinfo';

/** Navigable elements per screen, in order. Settings builds its own. */
const NAV_IDS: Partial<Record<Mode, readonly string[]>> = {
  menu: ['segDiff', 'btnStart', 'btnHelp', 'btnSettingsMenu', 'btnFullMenu'],
  help: ['btnCloseHelp'],
  fpsinfo: ['lnkFf', 'lnkCh', 'lnkSa', 'btnCloseFps'],
  pause: ['btnResume', 'btnRestart', 'btnSettingsPause', 'btnQuit'],
  over: ['btnAgain', 'btnOverMenu'],
};

/** Preselected element when a screen opens. */
const NAV_DEFAULT: Partial<Record<Mode, string>> = {
  menu: 'btnStart', pause: 'btnResume', over: 'btnAgain', help: 'btnCloseHelp',
};

const LAYERS: readonly Mode[] = ['menu', 'pause', 'over', 'help', 'fpsinfo', 'settings'];

export interface ScreensOptions {
  /** Called on every transition, so the rest of the client can react. */
  onChange?: (mode: Mode, previous: Mode) => void;
}

export class Screens {
  private current: Mode = 'menu';
  /** Where Escape returns from settings: the menu or the pause screen. */
  private settingsBack: Mode = 'menu';

  private navList: HTMLElement[] = [];
  private navIndex = -1;
  /** The keyboard cursor is only painted once the keyboard has been used. */
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
    // The mute button would sit on top of both of these.
    document.getElementById('btnMute')
      ?.classList.toggle('hide', mode === 'settings' || mode === 'help');

    this.buildNav();
    this.options.onChange?.(mode, previous);
  }

  openSettings(): void {
    this.settingsBack = this.current === 'pause' ? 'pause' : 'menu';
    this.setMode('settings');
  }

  /** Rebuilds the navigation list. Call after changing what is on screen. */
  buildNav(): void {
    // A tab change inside settings must not lose the selection.
    const previous = this.navList[this.navIndex];

    if (this.current === 'settings') {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '#settings .close, #settings .navgroup, ' +
            '#settings .page.on button, #settings .page.on input[type=range]',
        ),
      );
      // A group counts as one stop, so its own buttons are dropped. Reset
      // buttons are skipped: they are a per-row affordance, not a stop.
      this.navList = nodes.filter(
        (el) => el.classList.contains('navgroup') ||
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

  /** Cycles a segmented control by clicking, so its own handler runs. */
  private stepGroup(group: HTMLElement, dir: number): void {
    const buttons = Array.from(group.querySelectorAll('button'));
    if (!buttons.length) return;
    let i = buttons.findIndex((b) => b.classList.contains('on'));
    if (i < 0) i = 0;
    buttons[(i + dir + buttons.length) % buttons.length]!.click();
  }

  private bindPointer(): void {
    // Touch or mouse: the keyboard cursor stops being relevant.
    window.addEventListener(
      'pointerdown',
      () => {
        if (!this.navActive) return;
        this.navActive = false;
        this.paintNav();
      },
      true,
    );
    // If the browser moves focus elsewhere, the index follows it.
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
      if (this.current === 'run') return; // driving keys belong to InputSource

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
          // First keypress only reveals the cursor; it does not activate.
          this.navActive = true;
          this.paintNav();
        }
        e.preventDefault();
      }
      // Sliders take left and right themselves; leave those to the browser.
    });
  }

  /** Escape, and the pause button, both land here. */
  private onBack(): void {
    switch (this.current) {
      case 'run': this.setMode('pause'); break;
      case 'pause': this.setMode('run'); break;
      case 'settings': this.setMode(this.settingsBack); break;
      case 'help': this.setMode('menu'); break;
      case 'fpsinfo': this.setMode('settings'); break;
      default: break;
    }
  }

  /**
   * Shows the keyboard cursor straight away on a precise pointer, and leaves
   * it hidden on touch, where it would only be visual noise.
   */
  revealCursorOnPrecisePointer(): void {
    if (window.matchMedia?.('(pointer: fine)').matches) {
      this.navActive = true;
      this.paintNav();
    }
  }
}
