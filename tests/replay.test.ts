/**
 * La trace d'une partie la reproduit au bit près.
 *
 * C'est le contrat sur lequel repose tout classement en ligne : le client
 * n'envoie pas un score, il envoie ses entrées, et le serveur rejoue. Ce test
 * enregistre une partie pilotée par un joueur pseudo-aléatoire, la rejoue à
 * froid depuis la trace, et exige l'état final exact — puis vérifie que la
 * trace est bien ce qui décide, en la falsifiant.
 */
import { describe, expect, it } from 'vitest';
import {
  DT,
  Recorder,
  Rng,
  Sim,
  outcomeOf,
  replay,
  validTrace,
  type Difficulty,
  type Input,
  type Trace,
} from '../src/sim/index.js';

/** Pas de simulation par frame à 60 Hz : l'entrée ne change qu'à la frame. */
const PER_FRAME = 12;

/**
 * Un joueur qui remue le manche à chaque frame, avec des flottants quelconques
 * comme un vrai manche, freine rarement et booste souvent. Il n'a pas à être
 * bon : il doit produire une trace dense et des valeurs non triviales.
 */
function play(sim: Sim, seconds: number, rng: Rng): void {
  const input: Input = { steer: 0, brake: false, boost: false };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    if (i % PER_FRAME === 0) {
      const s = sim.state;
      const centring = -(s.lat * 0.1 + s.latVel * 0.55);
      input.steer = Math.max(-1, Math.min(1, centring + rng.centered(0.6)));
      input.brake = rng.chance(0.02);
      input.boost = rng.chance(0.7);
    }
    sim.step(input, DT, false);
    if (sim.state.wrecked) break;
  }
}

function record(seed: string, difficulty: Difficulty, seconds = 45): { sim: Sim; trace: Trace } {
  const sim = new Sim({ seed, difficulty });
  sim.reset(seed);
  play(sim, seconds, Rng.fromSeed(seed, 'player'));
  return { sim, trace: sim.trace() };
}

describe('replay', () => {
  it('reproduces a recorded run exactly, on every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const { sim, trace } = record('replay-' + difficulty, difficulty);
      expect(validTrace(trace)).toBe(true);
      expect(trace.steps).toBeGreaterThan(1000);
      const out = replay(trace);
      expect(out).toEqual(outcomeOf(sim.state, trace.steps));
      expect(out.score).toBeGreaterThan(0);
    }
  });

  it('survives the wire: a JSON round trip replays to the same outcome', () => {
    const { sim, trace } = record('wire', 'medium');
    const back = JSON.parse(JSON.stringify(trace)) as Trace;
    expect(replay(back)).toEqual(outcomeOf(sim.state, trace.steps));
  });

  it('is compact: one span per frame at most, not one per step', () => {
    const { trace } = record('compact', 'easy');
    expect(trace.from.length).toBeLessThanOrEqual(trace.steps / PER_FRAME + 1);
    expect(trace.from.length).toBeGreaterThan(100);
  });

  it('decides the outcome: a tampered trace scores differently', () => {
    const { sim, trace } = record('tamper', 'easy');
    const honest = outcomeOf(sim.state, trace.steps);
    // le boost tenu partout : plus vite, donc plus loin — un autre score
    const forged: Trace = { ...trace, flags: trace.flags.map((f) => f | 2) };
    expect(validTrace(forged)).toBe(true);
    const out = replay(forged);
    expect(out.dist).not.toBe(honest.dist);
  });

  it('records the run and nothing else: attract steps leave no trace', () => {
    const sim = new Sim({ seed: 'attract', difficulty: 'easy' });
    sim.reset('attract');
    const idle: Input = { steer: 0, brake: false, boost: false };
    for (let i = 0; i < 300; i++) sim.step(idle, DT, true);
    expect(sim.trace().steps).toBe(0);
    for (let i = 0; i < 300; i++) sim.step(idle, DT, false);
    expect(sim.trace()).toMatchObject({ steps: 300, from: [0], steer: [0], flags: [0] });
    sim.reset();
    expect(sim.trace().steps).toBe(0);
  });

  it('stops at the wreck, as the game does', () => {
    // un joueur qui braque à fond sans jamais lâcher finit dans le mur
    const sim = new Sim({ seed: 'wreck', difficulty: 'hard' });
    sim.reset('wreck');
    const input: Input = { steer: 1, brake: false, boost: true };
    let steps = 0;
    while (!sim.state.wrecked && steps < 720 * 120) {
      sim.step(input, DT, false);
      steps++;
    }
    expect(sim.state.wrecked).toBe(true);
    const trace = sim.trace();
    expect(trace.steps).toBe(steps);
    // la trace annonce plus de pas que la casse n'en laisse jouer : le rejeu s'arrête au même
    const longer: Trace = { ...trace, steps: trace.steps + 5000 };
    expect(replay(longer)).toEqual(outcomeOf(sim.state, steps));
  });

  it('rejects what it could not replay unambiguously', () => {
    const { trace } = record('valid', 'easy');
    const bad = (patch: Partial<Trace>): boolean => validTrace({ ...trace, ...patch });
    expect(bad({})).toBe(true);
    expect(bad({ truncated: true })).toBe(false);
    expect(bad({ steps: -1 })).toBe(false);
    expect(bad({ steps: 1.5 })).toBe(false);
    expect(bad({ difficulty: 'insane' as Difficulty })).toBe(false);
    expect(bad({ from: trace.from.slice(1) })).toBe(false);
    expect(bad({ from: [5, ...trace.from.slice(1)] })).toBe(false);
    expect(bad({ from: trace.from.map((f, i) => (i === 3 ? f - 100 : f)) })).toBe(false);
    expect(bad({ from: trace.from.map((f, i) => (i === 3 ? f + 0.5 : f)) })).toBe(false);
    expect(bad({ steer: trace.steer.map((s, i) => (i === 3 ? 1.5 : s)) })).toBe(false);
    expect(bad({ steer: trace.steer.map((s, i) => (i === 3 ? NaN : s)) })).toBe(false);
    expect(bad({ flags: trace.flags.map((f, i) => (i === 3 ? 4 : f)) })).toBe(false);
    expect(bad({ steps: trace.from[trace.from.length - 1]! })).toBe(false);
    expect(validTrace({ ...trace, steps: 0, from: [], steer: [], flags: [] })).toBe(true);
    expect(validTrace({ ...trace, steps: 1, from: [], steer: [], flags: [] })).toBe(false);
  });

  it('grows its buffers past 256 spans without losing one', () => {
    const rec = new Recorder();
    const input: Input = { steer: 0, brake: false, boost: false };
    for (let i = 0; i < 1000; i++) {
      input.steer = (i % 2) * 0.5;
      rec.push(input);
    }
    const t = rec.trace('grow', 'easy');
    expect(t.from.length).toBe(1000);
    expect(t.from[999]).toBe(999);
    expect(t.steer[999]).toBe(0.5);
    expect(t.truncated).toBe(false);
  });
});
