/**
 * Le panneau des réglages : onglets, interrupteurs, curseurs, difficulté.
 *
 * Il ne possède aucun état propre au-delà de ce qu'un contrôle a besoin pour se
 * dessiner. Chaque interrupteur appelle vers l'extérieur puis reflète ce qu'on
 * lui dit, pour que le panneau ne puisse jamais contredire le jeu — une classe
 * basculée localement, c'est ainsi qu'une case à cocher finit par mentir sur ce
 * qu'elle commande.
 *
 * `aria-pressed` et `aria-checked` sont tenus au pas des classes ici, et pas
 * seulement dans le balisage : une technologie d'assistance lit l'attribut, et
 * un réglage qui change sans s'annoncer est pire qu'un réglage inatteignable.
 */
import { DEFAULTS, type Difficulty, type Tuning } from '../sim/index.js';
import type { Preferences } from './preferences.js';
import { SLIDERS } from './sliders.js';

/** Libellés et notes vivent avec l'interface, pas avec les tables d'accord. En anglais : c'est de l'interface. */
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
  /** D'où chaque contrôle part, restauré de la dernière visite. */
  initial: Preferences;
  tuning: () => Tuning;
  difficulty: () => Difficulty;
  scoreMultiplier: (d: Difficulty) => number;

  setDifficulty: (d: Difficulty) => void;
  setTuning: (key: keyof Tuning, value: number) => void;
  resetTuning: () => void;

  /** `byUser` est faux quand une valeur stockée est restaurée au démarrage. */
  setSound: (on: boolean, byUser: boolean) => void;
  setHaptics: (on: boolean, byUser: boolean) => void;
  hapticsAvailable: boolean;
  setTips: (on: boolean) => void;
  setLefty: (on: boolean) => void;
  setSky: (on: boolean) => void;
  setSkyDetail: (high: boolean) => void;
  setShowFps: (on: boolean) => void;
  clearScores: () => void;
  /** La liste de navigation doit être rebâtie quand le contenu du panneau change. */
  rebuildNav: () => void;
}

const byId = (id: string) => document.getElementById(id);

/**
 * Les onglets du panneau et la page que chacun montre.
 *
 * Des littéraux plutôt qu'un gabarit `page${...}`, à dessein : `tests/dom-ids`
 * rapproche chaque identifiant que le client cherche d'`index.html`, et un
 * identifiant bâti à l'exécution lui est invisible.
 */
export const TABS = [
  { tab: 'tabGen', page: 'pageGen' },
  { tab: 'tabAdv', page: 'pageAdv' },
] as const;

/** Tient ensemble la classe d'un interrupteur et son état annoncé. */
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
    this.bindClear();
    this.paintDifficulty();
  }

  /** Repousse les valeurs d'accord courantes dans chaque curseur. */
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
    const show = (which: (typeof TABS)[number]) => {
      for (const t of TABS) {
        const on = t === which;
        byId(t.page)?.classList.toggle('on', on);
        const tab = byId(t.tab);
        tab?.classList.toggle('on', on);
        tab?.setAttribute('aria-selected', String(on));
      }
      // La page visible décide de ce qui est navigable.
      this.options.rebuildNav();
    };
    for (const t of TABS) byId(t.tab)?.addEventListener('click', () => show(t));
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
      note.innerHTML = `${DIFF_UI[current].note} Score <b>×${this.options.scoreMultiplier(current).toFixed(2)}</b>.`;
    }
  }

  private bindToggles(): void {
    const initial = this.options.initial;

    // Chaque interrupteur est peint depuis la valeur stockée puis appliqué,
    // pour que le contrôle et ce qu'il commande ne puissent pas partir en
    // désaccord.
    //
    // `byUser` sépare restaurer un réglage de le choisir. Tout ce qui répond —
    // une vibration de confirmation, le démarrage du graphe audio — n'est
    // permis que sur une vraie pression : les navigateurs refusent les deux
    // sans geste, et à raison.
    const simple = (id: string, start: boolean, apply: (on: boolean, byUser: boolean) => void) => {
      const el = byId(id);
      let on = start;
      paintToggle(el, on);
      apply(on, false);
      el?.addEventListener('click', () => {
        on = !on;
        paintToggle(el, on);
        apply(on, true);
      });
    };

    simple('tglTips', initial.tips, (on) => this.options.setTips(on));
    simple('tglSky', initial.sky, (on) => this.options.setSky(on));
    simple('tglSkyHi', initial.skyDetail, (on) => this.options.setSkyDetail(on));
    simple('tglFps', initial.showFps, (on) => {
      byId('fps')?.classList.toggle('on', on);
      this.options.setShowFps(on);
    });
    // La disposition gaucher est de la pure présentation, donc elle reste ici.
    simple('tglLefty', initial.lefty, (on) => {
      document.body.classList.toggle('lefty', on);
      this.options.setLefty(on);
    });

    // Le son a un second contrôle dans le coin, donc les deux sont peints ensemble.
    const sound = byId('tglSound');
    let soundOn = initial.sound;
    this.paintSound(soundOn);
    this.options.setSound(soundOn, false);
    const flipSound = () => {
      soundOn = !soundOn;
      this.paintSound(soundOn);
      this.options.setSound(soundOn, true);
    };
    sound?.addEventListener('click', flipSound);
    byId('btnMute')?.addEventListener('click', flipSound);

    // Absent sur iOS, où l'interrupteur ne ferait rien du tout.
    if (!this.options.hapticsAvailable) {
      const row = byId('rowHaptics');
      if (row) row.style.display = 'none';
    } else {
      simple('tglHaptics', initial.haptics, (on, byUser) => this.options.setHaptics(on, byUser));
    }
  }

  /** Deux pressions pour effacer : c'est le seul contrôle irréversible du panneau. */
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
