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
  probe,
  sin,
  type ProbeOptions,
  type Sim,
  type SimState,
  type Trace,
  type Tuning,
} from '../sim/index.js';
import { CORE_DIGEST } from './core.js';
import type { Ghost } from './ghost.js';
import type { Loop } from './loop.js';
import type { Screens } from './screens.js';
import type { Sky } from './sky.js';
import type { Viewport } from './viewport.js';

/** Les options de `probe`, le pas en option : celui de la boucle par défaut. */
export type TraceOptions = Omit<ProbeOptions, 'dt'> & { dt?: number };

export interface DebugSurface {
  seed(): string;
  revision: string;
  /** Le condensé du noyau estampillé au build ; `DEV` hors build. */
  core: string;
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
  /** Le fantôme : en course, dessiné, son écart et son score. */
  ghost(): { armed: boolean; visible: boolean; gap: number; score: number };
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
  readonly ghost: Ghost;
  /**
   * Arrête la boucle, rejoue `steps` pas fixes depuis `seed` et dessine
   * exactement une frame. Fournie par le client, qui est le seul à connaître
   * tout ce qui s'amortit et doit être remis à zéro avant.
   */
  freeze(seed: string, steps: number): void;
}

/**
 * Rejoue une partie hors de la boucle de rendu, sur la simulation vivante.
 *
 * Son rôle a changé avec la bascule. Elle prouvait que deux implémentations
 * s'accordaient ; il n'en reste qu'une, donc ce qu'elle prouve est que le
 * **bundle livré** joue encore comme la source — que rien dans la transpilation,
 * le minifieur ou le graphe de modules n'a déplacé un nombre. La sonde
 * elle-même est celle du noyau, `probe`, la même que Node et le serveur.
 */
function trace(sim: Sim, loop: Loop, opts: TraceOptions): unknown {
  loop.stop();
  return probe(sim, { ...opts, dt: opts.dt ?? loop.fixedStep });
}

export function installDebugSurface(deps: DebugDeps): void {
  const { sim, loop, viewport, screens, sky } = deps;
  window.__gsNext = {
    seed: () => sim.seed,
    revision: REVISION,
    core: CORE_DIGEST,
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
    ghost: () => ({
      armed: deps.ghost.armed,
      visible: deps.ghost.group.visible,
      gap: deps.ghost.gap,
      score: deps.ghost.score,
    }),
  };
}
