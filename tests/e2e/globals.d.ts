/**
 * Surface de mise au point exposée par legacy/engine.js et legacy/game.js.
 * Elle n'existe que pour les tests et le futur rejeu de partie ; elle n'est pas
 * une API du jeu. Voir la section « 1b. Aléatoire déterministe » d'engine.js.
 */
interface GsNextDebug {
  seed(): string;
  revision: string;
  core: string;
  fixedStep(): number;
  state(): { travel: number; dist: number; lat: number; speed: number; hop: number; yaw: number };
  renderScale(): number;
  mode(): string;
  setSkyDetail(high: boolean): void;
  setSkyVisible(visible: boolean): void;
  freeze(seed: string, steps: number): void;
  clock(): { hz: number; dt: number };
  trig(xs: number[]): { sin: number[]; cos: number[]; atan: number[] };
  defaults(): Record<string, number>;
  tuning(): { [key: string]: number };
  nodes(): { k: number[]; g: number[]; b: number[]; id: number[] };
  items(): Array<{ id: number; lat: number; type: number }>;
  trace(opts: {
    seed: string;
    diff?: 'easy' | 'medium' | 'hard';
    steps?: number;
    dt?: number;
    every?: number;
    script?: Array<{ from: number; steer?: number; brake?: boolean; boost?: boolean }>;
  }): unknown;
  record(): unknown;
  ghost(): { armed: boolean; visible: boolean; gap: number; score: number };
  startRanked(): Promise<string | null>;
}

declare global {
  interface Window {
    __gsNext: GsNextDebug;
  }
}

export {};
