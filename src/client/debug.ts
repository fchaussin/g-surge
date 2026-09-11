/**
 * La surface de mise au point, `window.__gsNext`.
 *
 * Elle existe pour les tests et pour le rejeu à venir ; ce n'est pas une API du
 * jeu. Deux entrées portent la suite de bout en bout : `trace` prouve que le
 * bundle livré joue encore comme la source, `freeze` est ce qui rend une
 * référence visuelle plein cadre possible. Le reste expose l'état pour lire,
 * et l'accord pour retoucher.
 *
 * Hors de `main.ts` parce que rien ici ne câble le jeu : tout ce dont ces
 * fonctions ont besoin leur est passé, et `freeze` en particulier reste une
 * fonction du client, parce qu'elle doit connaître chaque état qui s'amortit.
 */
import { REVISION } from 'three';
import {
  atan,
  cos,
  DEFAULTS,
  sin,
  type Difficulty,
  type Sim,
  type SimState,
  type Trace,
  type Tuning,
} from '../sim/index.js';
import type { Loop } from './loop.js';
import type { Screens } from './screens.js';
import type { Sky } from './sky.js';
import type { Viewport } from './viewport.js';

/** Un segment de commande tenu depuis le pas `from` jusqu'au suivant. */
export interface TraceCommand {
  from: number;
  steer?: number;
  brake?: boolean;
  boost?: boolean;
}

export interface TraceOptions {
  seed: string;
  diff?: Difficulty;
  steps?: number;
  dt?: number;
  every?: number;
  script?: TraceCommand[];
}

export interface DebugSurface {
  seed(): string;
  revision: string;
  fixedStep(): number;
  state(): Readonly<SimState>;
  renderScale(): number;
  mode(): string;
  setSkyDetail(high: boolean): void;
  setSkyVisible(visible: boolean): void;
  freeze(seed: string, steps: number): void;
  clock(): { hz: number; dt: number };
  trig(xs: number[]): { sin: number[]; cos: number[]; atan: number[] };
  defaults(): Record<string, number>;
  tuning(): Tuning;
  nodes(): { k: number[]; g: number[]; b: number[]; id: number[] };
  items(): Array<{ id: number; lat: number; type: number }>;
  trace(opts: TraceOptions): unknown;
  /** La trace de la partie en cours ou finie — ce qu'un serveur rejouerait. */
  record(): Trace;
}

declare global {
  interface Window {
    __gsNext: DebugSurface;
  }
}

export interface DebugDeps {
  readonly sim: Sim;
  readonly loop: Loop;
  readonly viewport: Viewport;
  readonly screens: Screens;
  readonly sky: Sky;
  /**
   * Arrête la boucle, rejoue `steps` pas fixes depuis `seed` et dessine
   * exactement une frame. Fournie par le client, qui est le seul à connaître
   * tout ce qui s'amortit et doit être remis à zéro avant.
   */
  freeze(seed: string, steps: number): void;
}

/**
 * Rejoue une partie au pas fixe, hors de la boucle de rendu.
 *
 * Son rôle a changé avec la bascule. Elle prouvait que deux implémentations
 * s'accordaient ; il n'en reste qu'une, donc ce qu'elle prouve est que le
 * **bundle livré** joue encore comme la source — que rien dans la transpilation,
 * le minifieur ou le graphe de modules n'a déplacé un nombre. Les références
 * figées restent le contrat dans les deux cas.
 */
function trace(sim: Sim, loop: Loop, opts: TraceOptions): unknown {
  const steps = opts.steps === undefined ? 1200 : opts.steps;
  const dt = opts.dt === undefined ? loop.fixedStep : opts.dt;
  const every = opts.every === undefined ? 60 : opts.every;
  const script = opts.script ?? [];
  const diff = opts.diff ?? 'easy';

  loop.stop();
  sim.setDifficulty(diff);
  sim.reset(opts.seed);

  const st = sim.state;
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const snap = (i: number) => ({
    i,
    dist: r6(st.dist),
    travel: r6(st.travel),
    cursor: r6(st.cursor),
    speed: r6(st.speed),
    lat: r6(st.lat),
    latVel: r6(st.latVel),
    yaw: r6(st.yaw),
    hop: r6(st.hop),
    vyRel: r6(st.vyRel),
    energy: r6(st.energy),
    hull: r6(st.hull),
    mult: r6(st.mult),
    score: r6(st.score),
    coins: st.coins,
    air: st.air,
    drift: st.drift,
    wrecked: st.wrecked,
  });

  let si = 0;
  let cur: TraceCommand = { from: 0 };
  const frames = [snap(-1)];
  let last = -1;
  const held = { steer: 0, brake: false, boost: false };
  for (let i = 0; i < steps; i++) {
    while (si < script.length && script[si]!.from <= i) cur = script[si++]!;
    held.steer = cur.steer ?? 0;
    held.brake = !!cur.brake;
    held.boost = !!cur.boost;
    sim.step(held, dt, false);
    last = i;
    if (st.wrecked) {
      frames.push(snap(i));
      break;
    }
    if ((i + 1) % every === 0 || i === steps - 1) frames.push(snap(i));
  }
  return { seed: sim.seed, diff, steps, ran: last + 1, dt, wrecked: st.wrecked, frames };
}

export function installDebugSurface(deps: DebugDeps): void {
  const { sim, loop, viewport, screens, sky } = deps;
  window.__gsNext = {
    seed: () => sim.seed,
    revision: REVISION,
    fixedStep: () => loop.fixedStep,
    state: () => sim.state,
    renderScale: () => viewport.renderScale,
    mode: () => screens.mode,
    setSkyDetail: (high) => sky.setDetail(high),
    setSkyVisible: (visible) => sky.setVisible(visible),
    freeze: deps.freeze,
    clock: () => ({ hz: 1 / loop.fixedStep, dt: loop.fixedStep }),

    /**
     * La trigonométrie du noyau, évaluée par le bundle livré.
     *
     * `Math.cos` n'est pas identique au bit près d'un moteur à l'autre, donc le
     * noyau porte la sienne — voir `src/sim/trig.ts`. Ceci rend les résultats
     * du navigateur pour que la suite de bout en bout les compare à ceux de
     * Node, seul endroit où l'affirmation inter-moteurs se teste vraiment.
     * Voir `TECH-DEBT.md` §17.
     */
    trig: (xs) => ({ sin: xs.map(sin), cos: xs.map(cos), atan: xs.map(atan) }),
    defaults: () => ({ ...DEFAULTS }),

    /**
     * L'objet d'accord vivant, délibérément pas une copie.
     *
     * L'ancien client exposait `window.TUNING` et la doc promettait le réglage
     * en console des clés que le panneau ne porte pas ; le port n'a d'abord
     * rendu qu'une copie des défauts, ce qui l'a tué en silence. Une mutation
     * ici prend effet au pas suivant — et n'est pas plus sauvegardée qu'avant.
     */
    tuning: () => sim.tuning,
    nodes: () => ({
      k: Array.from(sim.track.nk),
      g: Array.from(sim.track.ng),
      b: Array.from(sim.track.nb),
      id: Array.from(sim.track.nid),
    }),
    items: () => sim.track.items.map((it) => ({ id: it.id, lat: it.lat, type: it.type })),
    trace: (opts) => trace(sim, loop, opts),
    record: () => sim.trace(),
  };
}
