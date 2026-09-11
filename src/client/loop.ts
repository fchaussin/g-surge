/**
 * La boucle de frame, et la frontière entre deux horloges.
 *
 * La simulation avance par pas fixes entiers et ne sait rien des frames.
 * L'amortissement d'affichage — retard de caméra, fumée, poussée — prend le
 * vrai delta de frame. Mélanger les deux est l'erreur que cette classe existe
 * pour rendre difficile : `simulate` ne reçoit jamais un delta de frame,
 * `render` ne reçoit jamais un pas de simulation.
 */
import { Clock, MAX_FRAME } from '../sim/clock.js';

export interface LoopHandlers {
  /** Appelé zéro fois ou plus par frame, toujours avec le pas fixe. */
  simulate(dt: number): void;
  /** Appelé une fois par frame, avec le vrai temps écoulé depuis la précédente. */
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

  /** Abandonne le temps dû. Au redémarrage d'une partie, jamais en cours. */
  reset(): void {
    this.clock.reset();
    this.last = performance.now();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.tick);

    const since = (now - this.last) / 1000;

    // Borné pour qu'une frame longue — onglet en arrière-plan, compilation de
    // shader, pause du ramasse-miettes — ralentisse le jeu au lieu de demander
    // des milliers de pas.
    const frameDt = Math.min(Math.max(since, 0), MAX_FRAME);
    this.last = now;

    const steps = this.clock.advance(frameDt);
    const dt = this.clock.dt;
    for (let i = 0; i < steps; i++) this.handlers.simulate(dt);

    this.handlers.render(frameDt);
  };
}
