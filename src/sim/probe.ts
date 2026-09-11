/**
 * Rejoue un script d'entrées sur une simulation et relève l'état à intervalle.
 *
 * C'est la sonde des références figées : `physics-*.json` ont été capturées
 * avec elle dans le navigateur, avant tout portage. Elle vit dans le noyau
 * pour que les trois moteurs qui doivent s'accorder — Node dans les tests,
 * Chromium dans le bundle, workerd sur le serveur — exécutent le même code,
 * et non trois transcriptions de la même idée.
 *
 * Le pas est un paramètre : les références datent d'un `dt` de 1/120, avant
 * que la boucle se fixe à 720 Hz. Elles épinglent ce que `step()` fait pour
 * un `dt` donné ; la cadence à laquelle la boucle l'appelle est une décision à
 * part.
 */
import type { Sim } from './sim.js';
import type { Input } from './step.js';
import type { Difficulty } from './tuning.js';

/** Un segment de commande tenu depuis le pas `from` jusqu'au suivant. */
export interface ProbeCommand {
  from: number;
  steer?: number;
  brake?: boolean;
  boost?: boolean;
}

export interface ProbeOptions {
  seed: string;
  diff?: Difficulty;
  steps?: number;
  dt: number;
  every?: number;
  script?: ProbeCommand[];
}

export interface ProbeFrame {
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

export interface ProbeResult {
  seed: string;
  diff: Difficulty;
  steps: number;
  ran: number;
  dt: number;
  wrecked: boolean;
  frames: ProbeFrame[];
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Remet `sim` à zéro sur la graine et la difficulté demandées, puis joue le script. */
export function probe(sim: Sim, opts: ProbeOptions): ProbeResult {
  const steps = opts.steps ?? 1200;
  const every = opts.every ?? 60;
  const script = opts.script ?? [];
  const diff = opts.diff ?? 'easy';
  const dt = opts.dt;

  sim.setDifficulty(diff);
  sim.reset(opts.seed);

  const st = sim.state;
  const snap = (i: number): ProbeFrame => ({
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
  let cur: ProbeCommand = { from: 0 };
  const frames = [snap(-1)];
  let last = -1;
  const held: Input = { steer: 0, brake: false, boost: false };
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
