/**
 * The frame loop, and the boundary between two clocks.
 *
 * The simulation advances in whole fixed steps and knows nothing of frames.
 * Display smoothing — camera lag, smoke, thrust — uses the real frame delta.
 * Mixing the two is the mistake this class exists to make hard: `simulate`
 * never receives a frame delta, `render` never receives a simulation step.
 */
import { Clock, MAX_FRAME } from '../sim/clock.js';

export interface LoopHandlers {
  /** Called zero or more times per frame, always with the fixed step. */
  simulate(dt: number): void;
  /** Called once per frame, with the real elapsed time since the last one. */
  render(frameDt: number): void;
}

export class Loop {
  private readonly clock = new Clock();
  private handle = 0;
  private last = 0;
  private running = false;

  constructor(private readonly handlers: LoopHandlers) {}

  get fixedStep(): number {
    return this.clock.dt;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
    this.clock.reset();
  }

  /** Drops any time owed. Use when a run restarts, never mid-run. */
  reset(): void {
    this.clock.reset();
    this.last = performance.now();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.tick);

    const since = (now - this.last) / 1000;

    // Clamped so a long frame — backgrounded tab, shader compile, collection
    // pause — slows the game down instead of asking for thousands of steps.
    const frameDt = Math.min(Math.max(since, 0), MAX_FRAME);
    this.last = now;

    const steps = this.clock.advance(frameDt);
    const dt = this.clock.dt;
    for (let i = 0; i < steps; i++) this.handlers.simulate(dt);

    this.handlers.render(frameDt);
  };
}
