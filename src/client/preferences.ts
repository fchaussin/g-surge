/**
 * Ce que le joueur a choisi, gardé entre deux visites.
 *
 * Seulement les réglages qu'une personne pose délibérément. Les curseurs
 * d'accord avancés n'y sont pas, à dessein : c'est un atelier, pas une
 * préférence, et une valeur poussée une fois puis oubliée suivrait quelqu'un
 * dans toutes ses sessions sans retour évident.
 *
 * Chaque champ est validé à l'entrée. Le stockage est partagé avec tout ce qui
 * tourne sur l'origine et survit aux versions de ce code, donc une valeur qui
 * en sort est une entrée non fiable : une mauvaise est remplacée par son défaut
 * plutôt que laissée produire un jeu à l'échelle de rendu négative.
 */
const KEY = 'gsurge.prefs.v1';

/** Les écritures sont regroupées : glisser un curseur écrirait sinon à chaque frame. */
const WRITE_DELAY = 250;

export interface Preferences {
  difficulty: 'easy' | 'medium' | 'hard';
  /** Manche à droite, pédales à gauche. */
  lefty: boolean;
  sound: boolean;
  haptics: boolean;
  tips: boolean;
  sky: boolean;
  skyDetail: boolean;
  showFps: boolean;
  /** Fraction de la résolution native, de 0,4 à 1. */
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
  renderScale: 1,
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const number = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

/** Exporté pour ses tests seuls : le stockage est une entrée non fiable, et ceci est la porte. */
export function sanitise(raw: unknown): Preferences {
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
    // Un frameTarget stocké par une version antérieure est simplement ignoré :
    // sanitise reconstruit l'objet champ par champ, les clés inconnues tombent.
    renderScale: number(r.renderScale, d.renderScale, 0.4, 1),
  };
}

export class PreferenceStore {
  /** Lu une fois à la construction ; modifier par `set`. */
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

  /** Force une écriture en attente, pour `pagehide` où un minuteur ne partira pas. */
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
      // Quota atteint. La session garde ses réglages en mémoire.
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

  /** La navigation privée lève à l'accès au lieu de rendre null. */
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
