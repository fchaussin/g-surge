/**
 * The settings panel: tabs, toggles, sliders, difficulty and frame rate.
 *
 * It owns no state of its own beyond what a control needs to draw itself. Every
 * switch calls out and then reflects what it is told, so the panel can never
 * disagree with the game — a class toggled locally is how a checkbox ends up
 * lying about what it controls.
 *
 * `aria-pressed` and `aria-checked` are kept in step with the classes here, not
 * only in the markup: an assistive technology reads the attribute, and a
 * setting that changes without announcing itself is worse than one that cannot
 * be reached at all.
 */
import { DEFAULTS, type Difficulty, type Tuning } from '../sim/index.js';
import { SLIDERS } from './sliders.js';

/** Labels and blurbs live with the UI, not with the tuning tables. */
const DIFF_UI: Record<Difficulty, { label: string; note: string }> = {
  easy: {
    label: 'EASY',
    note: 'Wide corners, slow damage, plenty of repairs. The reference setting.',
  },
  medium: {
    label: 'MEDIUM',
    note: 'Tighter corners, top speed reached sooner, impacts cost more and the multiplier fades faster.',
  },
  hard: {
    label: 'HARD',
    note: 'Severe corners, full speed in four kilometres, heavy damage, scarce repairs and a multiplier that melts.',
  },
};

export interface SettingsOptions {
  tuning: () => Tuning;
  difficulty: () => Difficulty;
  scoreMultiplier: (d: Difficulty) => number;

  setDifficulty: (d: Difficulty) => void;
  setTuning: (key: keyof Tuning, value: number) => void;
  resetTuning: () => void;

  setSound: (on: boolean) => void;
  setHaptics: (on: boolean) => void;
  hapticsAvailable: boolean;
  setTips: (on: boolean) => void;
  setSky: (on: boolean) => void;
  setSkyDetail: (high: boolean) => void;
  setShowFps: (on: boolean) => void;
  setFrameTarget: (hz: number) => void;
  frameTargets: () => number[];
  refreshHz: () => number;
  redetect: () => void;
  clearScores: () => void;
  /** The navigation list has to be rebuilt when the panel's contents change. */
  rebuildNav: () => void;
}

const byId = (id: string) => document.getElementById(id);

/** Keeps a toggle's class and its announced state together. */
function paintToggle(el: HTMLElement | null, on: boolean): void {
  if (!el) return;
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', String(on));
}

export class Settings {
  private readonly rows = new Map<keyof Tuning, { input: HTMLInputElement; out: HTMLElement }>();
  private clearArmed = false;

  constructor(private readonly options: SettingsOptions) {
    this.buildSliders();
    this.bindTabs();
    this.bindDifficulty();
    this.bindToggles();
    this.bindFrameRate();
    this.bindClear();
    this.paintDifficulty();
  }

  /** Pushes current tuning values back into every slider. */
  syncAll(): void {
    for (const key of this.rows.keys()) this.syncRow(key);
  }

  syncRow(key: keyof Tuning): void {
    const row = this.rows.get(key);
    if (!row) return;
    const value = this.options.tuning()[key];
    row.input.value = String(value);
    row.out.textContent = String(value);
  }

  /** Rebuilds the frame rate choices from what the display can do. */
  rebuildFrameTargets(): void {
    const seg = byId('segFps');
    if (!seg) return;
    const targets = this.options.frameTargets();
    seg.innerHTML = '';
    for (const hz of targets) {
      const b = document.createElement('button');
      b.dataset.hz = String(hz);
      b.textContent = String(hz);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      seg.appendChild(b);
    }
    this.options.rebuildNav();
    this.updateHzHint();
  }

  paintFrameTarget(hz: number): void {
    for (const b of document.querySelectorAll<HTMLElement>('#segFps button')) {
      const on = Number(b.dataset.hz) === hz;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    this.updateHzHint();
  }

  updateHzHint(): void {
    const hint = byId('hzHint');
    if (!hint) return;
    const hz = this.options.refreshHz();
    hint.textContent = hz
      ? `display runs at ${hz} Hz. Tap to re-detect.`
      : 'detecting display refresh…';
  }

  paintSound(on: boolean): void {
    paintToggle(byId('tglSound'), on);
    byId('btnMute')?.classList.toggle('off', !on);
  }

  private buildSliders(): void {
    const host = byId('slidersAdv');
    if (!host) return;

    for (const spec of SLIDERS) {
      const value = this.options.tuning()[spec.key];
      const row = document.createElement('div');
      row.className = 't-row';
      row.innerHTML =
        `<label>${spec.label}<span><b>${value}</b>` +
        `<button class="rst" title="reset" aria-label="Reset ${spec.label}">↺</button>` +
        `</span></label>` +
        `<input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" ` +
        `value="${value}" aria-label="${spec.label}">` +
        `<div class="hint">${spec.hint}</div>`;

      const input = row.querySelector('input')!;
      const out = row.querySelector('b')!;
      this.rows.set(spec.key, { input, out });

      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        this.options.setTuning(spec.key, v);
        out.textContent = String(v);
      });
      row.querySelector('.rst')!.addEventListener('click', () => {
        this.options.setTuning(spec.key, DEFAULTS[spec.key]);
        this.syncRow(spec.key);
      });

      host.appendChild(row);
    }

    byId('btnDefault')?.addEventListener('click', () => {
      this.options.resetTuning();
      this.syncAll();
    });
  }

  private bindTabs(): void {
    const show = (which: 'gen' | 'adv') => {
      for (const k of ['gen', 'adv'] as const) {
        byId(`page${k === 'gen' ? 'Gen' : 'Adv'}`)?.classList.toggle('on', k === which);
        const tab = byId(`tab${k === 'gen' ? 'Gen' : 'Adv'}`);
        tab?.classList.toggle('on', k === which);
        tab?.setAttribute('aria-selected', String(k === which));
      }
      // The visible page decides what is navigable.
      this.options.rebuildNav();
    };
    byId('tabGen')?.addEventListener('click', () => show('gen'));
    byId('tabAdv')?.addEventListener('click', () => show('adv'));
  }

  private bindDifficulty(): void {
    byId('segDiff')?.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('button');
      const d = button?.dataset.d as Difficulty | undefined;
      if (!d) return;
      this.options.setDifficulty(d);
      this.paintDifficulty();
      this.syncAll();
    });
  }

  private paintDifficulty(): void {
    const current = this.options.difficulty();
    for (const b of document.querySelectorAll<HTMLElement>('#segDiff button')) {
      const on = b.dataset.d === current;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    const note = byId('diffNote');
    if (note) {
      note.innerHTML =
        `${DIFF_UI[current].note} Score <b>×${this.options.scoreMultiplier(current).toFixed(2)}</b>.`;
    }
  }

  private bindToggles(): void {
    const simple = (id: string, initial: boolean, apply: (on: boolean) => void) => {
      const el = byId(id);
      let on = initial;
      paintToggle(el, on);
      el?.addEventListener('click', () => {
        on = !on;
        paintToggle(el, on);
        apply(on);
      });
    };

    simple('tglTips', true, (on) => this.options.setTips(on));
    simple('tglSky', true, (on) => this.options.setSky(on));
    simple('tglSkyHi', true, (on) => this.options.setSkyDetail(on));
    simple('tglFps', false, (on) => {
      byId('fps')?.classList.toggle('on', on);
      this.options.setShowFps(on);
    });
    // Left-handed layout is pure presentation, so it stays here.
    simple('tglLefty', false, (on) => document.body.classList.toggle('lefty', on));

    // Sound has a second control in the corner, so both are painted together.
    const sound = byId('tglSound');
    let soundOn = true;
    this.paintSound(soundOn);
    const flipSound = () => {
      soundOn = !soundOn;
      this.paintSound(soundOn);
      this.options.setSound(soundOn);
    };
    sound?.addEventListener('click', flipSound);
    byId('btnMute')?.addEventListener('click', flipSound);

    // Absent on iOS, where the switch would do nothing at all.
    if (!this.options.hapticsAvailable) {
      const row = byId('rowHaptics');
      if (row) row.style.display = 'none';
    } else {
      simple('tglHaptics', true, (on) => this.options.setHaptics(on));
    }
  }

  private bindFrameRate(): void {
    byId('segFps')?.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('button');
      const hz = Number(button?.dataset.hz);
      if (!hz) return;
      this.options.setFrameTarget(hz);
      this.paintFrameTarget(hz);
    });

    const hint = byId('hzHint');
    if (hint) {
      hint.style.cursor = 'pointer';
      hint.addEventListener('click', (e) => {
        e.stopPropagation();
        this.options.redetect();
      });
    }
  }

  /** Two presses to clear: it is the only irreversible control on the panel. */
  private bindClear(): void {
    const button = byId('btnClear');
    button?.addEventListener('click', () => {
      if (!this.clearArmed) {
        this.clearArmed = true;
        button.textContent = 'CONFIRM';
        return;
      }
      this.options.clearScores();
      this.clearArmed = false;
      button.textContent = 'CLEARED';
      setTimeout(() => {
        button.textContent = 'CLEAR LEADERBOARD';
      }, 1600);
    });
  }
}
