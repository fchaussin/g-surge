/**
 * Un pilote scripté, pour mesurer plutôt que supposer.
 *
 * Il recentre le vaisseau sur les lignes droites, braque à fond dans les
 * virages pour décrocher, et tient le boost dès que la réserve le permet. Ce
 * n'est pas un joueur — il ne vise pas les objets et ne freine jamais — mais
 * c'est une borne basse reproductible : ce qu'il obtient, un humain l'obtient.
 *
 * Le sens du braquage dans un virage est calibré et non déduit : sur la même
 * graine, huit secondes de chaque côté, et le côté qui touche le moins de murs
 * est celui qui « rentre » dans la courbe.
 */
import { BACK, HALF, Sim, thrustTier, climbGoal, type Difficulty } from '../../src/sim/index.js';

const DT = 1 / 720;
/** Courbure sous laquelle la piste est tenue pour droite, en rad/m. */
const K_MIN = 0.0015;
/** Courbure à partir de laquelle le braquage est plein, en rad/m. */
const K_REF = 0.006;

export interface PilotOptions {
  seed: string;
  difficulty: Difficulty;
  seconds: number;
  /** 0 à 1 : la part du braquage plein engagée dans un virage. */
  aggressiveness: number;
}

export interface PilotStats {
  seconds: number;
  dist: number;
  supEarned: number;
  supFound: number;
  surges: number;
  walls: number;
  wrecked: boolean;
  drifts: number;
  driftSeconds: number;
  /** Temps passé par barreau, en secondes. */
  tierSeconds: [number, number, number, number];
  /** La plus haute fraction d'un barreau atteinte par la montée, 0 à 1. */
  climbPeak: number;
}

function steerFor(sim: Sim, side: 1 | -1, aggressiveness: number): number {
  const s = sim.state;
  const k = sim.track.nk[BACK + 2]!;
  const centring = -(s.lat * 0.1 + s.latVel * 0.55);
  const into = Math.abs(k) > K_MIN ? Math.sign(k) * side * Math.min(1, Math.abs(k) / K_REF) : 0;
  let corner = into * aggressiveness;
  // Garde de mur : passé les deux tiers de la demi-largeur, le braquage qui
  // éloigne encore du centre est coupé, et le recentrage reprend la main.
  const edge = Math.abs(s.lat) / HALF;
  if (edge > 0.66 && Math.sign(corner) === Math.sign(s.lat))
    corner *= Math.max(0, 1 - (edge - 0.66) * 4);
  return Math.max(-1, Math.min(1, centring * (1 - Math.abs(corner)) + corner));
}

function drive(sim: Sim, seconds: number, side: 1 | -1, aggressiveness: number): PilotStats {
  const st: PilotStats = {
    seconds: 0,
    dist: 0,
    supEarned: 0,
    supFound: 0,
    surges: 0,
    walls: 0,
    wrecked: false,
    drifts: 0,
    driftSeconds: 0,
    tierSeconds: [0, 0, 0, 0],
    climbPeak: 0,
  };
  const input = { steer: 0, brake: false, boost: false };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    input.steer = steerFor(sim, side, aggressiveness);
    input.boost = sim.state.energy >= sim.tuning.boostMin + 2 || sim.state.boosting;
    sim.step(input, DT, false);
    st.seconds += DT;
    for (const e of sim.events) {
      if (e.type === 'supEarned') st.supEarned++;
      else if (e.type === 'pickup' && e.kind === 'sup') st.supFound++;
      else if (e.type === 'surgeStart') st.surges++;
      else if (e.type === 'wallImpact') st.walls++;
      else if (e.type === 'driftStart') st.drifts++;
    }
    if (sim.state.drift) st.driftSeconds += DT;
    st.tierSeconds[thrustTier(sim.state)] += DT;
    const goal = climbGoal(sim.state, sim.tuning);
    if (goal > 0) st.climbPeak = Math.max(st.climbPeak, sim.state.climb / goal);
    if (sim.state.wrecked) {
      st.wrecked = true;
      break;
    }
  }
  st.dist = sim.state.dist;
  return st;
}

/** Le côté qui rentre dans les virages : celui des deux qui touche le moins. */
export function calibrateSide(seed: string, difficulty: Difficulty): 1 | -1 {
  const score = (side: 1 | -1) => {
    const sim = new Sim({ seed, difficulty });
    sim.reset(seed);
    const s = drive(sim, 8, side, 1);
    return s.walls * 10 - s.driftSeconds;
  };
  return score(1) <= score(-1) ? 1 : -1;
}

export function runPilot(opts: PilotOptions): PilotStats {
  const side = calibrateSide(opts.seed, opts.difficulty);
  const sim = new Sim({ seed: opts.seed, difficulty: opts.difficulty });
  sim.reset(opts.seed);
  return drive(sim, opts.seconds, side, opts.aggressiveness);
}
