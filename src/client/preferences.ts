/**
 * What the player chose, kept between visits.
 *
 * Only the settings a person sets deliberately. The advanced tuning sliders
 * are not here on purpose: they are a workshop, not a preference, and a value
 * nudged once and forgotten would follow someone across every later session
 * with no obvious way back.
 *
 * Every field is validated on the way in. Storage is shared with anything else
 * on the origin and survives across versions of this code, so a value read
 * from it is untrusted input: a bad one is dropped for its default rather than
 * allowed to produce a game with a negative render scale.
 */
const KEY = 'gsurge.prefs.v1';

/** Writes are coalesced: dragging a slider would otherwise write per frame. */
const WRITE_DELAY = 250;

export interface Preferences {
  difficulty: 'easy' | 'medium' | 'hard';
  /** Stick on the right, pedals on the left. */
  lefty: boolean;
  sound: boolean;
  haptics: boolean;
  tips: boolean;
  sky: boolean;
  skyDetail: boolean;
  showFps: boolean;
  /** Wanted frames per second. Snapped to what the display can do on load. */
  frameTarget: number;
  /** Fraction of the native resolution, 0.4 to 1. */
  renderScale: number;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  difficulty: 'easy',
  lefty: false,
  sound: true,
  haptics: true,
  tips: true,
  sky: true,
  skyDetail: true,
  showFps: false,
  frameTarget: 60,
  renderScale: 1,
};

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

const number = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

function sanitise(raw: unknown): Preferences {
  const d = DEFAULT_PREFERENCES;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    difficulty:
      r.difficulty === 'easy' || r.difficulty === 'medium' || r.difficulty === 'hard'
        ? r.difficulty
        : d.difficulty,
    lefty: bool(r.lefty, d.lefty),
    sound: bool(r.sound, d.sound),
    haptics: bool(r.haptics, d.haptics),
    tips: bool(r.tips, d.tips),
    sky: bool(r.sky, d.sky),
    skyDetail: bool(r.skyDetail, d.skyDetail),
    showFps: bool(r.showFps, d.showFps),
    // 20 to 480: wider than the rates the detector knows, because the value is
    // snapped to what the display can actually do once it is measured.
    frameTarget: Math.round(number(r.frameTarget, d.frameTarget, 20, 480)),
    renderScale: number(r.renderScale, d.renderScale, 0.4, 1),
  };
}

export class PreferenceStore {
  /** Read once at construction; mutate through `set`. */
  readonly values: Preferences;

  private readonly available: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.available = PreferenceStore.probe();
    this.values = sanitise(this.read());
  }

  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.schedule();
  }

  /** Forces a pending write out, for `pagehide` where a timer will not fire. */
  flush(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.write();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, WRITE_DELAY);
  }

  private write(): void {
    if (!this.available) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      // Quota reached. The session keeps its settings in memory.
    }
  }

  private read(): unknown {
    if (!this.available) return null;
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Private browsing throws on access rather than returning null. */
  private static probe(): boolean {
    try {
      const k = '__gs_probe';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }
}
