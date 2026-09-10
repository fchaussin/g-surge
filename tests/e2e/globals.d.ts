/**
 * Surface de mise au point exposée par legacy/engine.js et legacy/game.js.
 * Elle n'existe que pour les tests et le futur rejeu de partie ; elle n'est pas
 * une API du jeu. Voir la section « 1b. Aléatoire déterministe » d'engine.js.
 */
interface GsRng {
  next(): number;
  chance(p: number): boolean;
  sign(): -1 | 1;
  range(min: number, max: number): number;
  int(n: number): number;
  centered(half: number): number;
}

interface GsTraceFrame {
  i: number;
  dist: number;
  travel: number;
  cursor: number;
  speed: number;
  lat: number;
  latVel: number;
  yaw: number;
  hop: number;
  vyRel: number;
  energy: number;
  hull: number;
  mult: number;
  score: number;
  coins: number;
  air: boolean;
  drift: boolean;
  wrecked: boolean;
}

interface GsTraceOptions {
  seed?: string;
  diff?: 'easy' | 'medium' | 'hard';
  steps?: number;
  dt?: number;
  every?: number;
  script?: Array<{ from: number; steer?: number; brake?: boolean; boost?: boolean }>;
}

interface GsDebug {
  seed(): string;
  setSeed(v: string | null): void;
  makeRng(seed: string, stream: string): GsRng;
  defaults(): Record<string, number>;
  diff(): Record<string, { mul: number; set: Record<string, number> }>;
  clock(): { hz: number; dt: number; maxFrame: number; eps: number };
  nodes(): { k: number[]; g: number[]; b: number[]; id: number[] };
  items(): Array<{ id: number; lat: number; type: number }>;
  path(cursor: number): {
    cursor: number;
    px: number[]; py: number[]; pz: number[]; pyaw: number[];
    samples: Array<{
      d: number; x: number; y: number; z: number; yaw: number; bank: number;
      rx: number; ry: number; rz: number; ux: number; uy: number; uz: number;
    }>;
    grades: number[];
  };
  trace(opts?: GsTraceOptions): {
    seed: string;
    diff: string;
    steps: number;
    dt: number;
    frames: GsTraceFrame[];
  };
}

interface GsNextDebug {
  seed(): string;
  revision: string;
  fixedStep(): number;
  state(): { travel: number; dist: number; lat: number; speed: number; hop: number; yaw: number };
  renderScale(): number;
  setSkyDetail(high: boolean): void;
  setSkyVisible(visible: boolean): void;
  freeze(seed: string, steps: number): void;
}

declare global {
  interface Window {
    __gs: GsDebug;
    __gsNext: GsNextDebug;
  }
}

export {};
