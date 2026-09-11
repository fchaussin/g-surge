/**
 * Détection du rafraîchissement et qualité automatique. Rien d'autre.
 *
 * Le jeu rend à la cadence que l'écran donne à `requestAnimationFrame` — il
 * n'y a ni cible de cadence ni bridage, par décision. Une version antérieure
 * portait les deux, plus un sélecteur dans les réglages ; la machinerie
 * existait pour dépenser moins de batterie à dessein, personne ne l'avait
 * demandé, et ses subtilités de rapport entier avaient déjà produit une fois le
 * bug de cadence canonique du projet. Ce que le joueur veut est le meilleur de
 * l'appareil, et la façon de le livrer est d'adapter le coût du rendu, pas le
 * calendrier.
 *
 * La détection reste parce que la qualité adaptative a besoin d'un étalon :
 * « le jeu tient-il ce que cet écran peut faire ». Deux pièges survivent, tous
 * deux payés :
 *
 * - **La détection prend une médiane, pas une moyenne.** Une seule frame longue
 *   au démarrage tirerait une moyenne assez loin pour caler sur la mauvaise
 *   cadence.
 * - **La qualité automatique ne coupe jamais le fond**, et exige plusieurs
 *   mauvaises mesures consécutives. Une seule baisse tuait autrefois la
 *   signature visuelle du jeu d'un coup.
 */

/** Les cadences que le détecteur reconnaît. La mesure cale sur la plus proche. */
const KNOWN_RATES = [60, 75, 90, 120, 144, 165, 240] as const;

/** Frames mesurées avant que la cadence soit décidée. */
const SAMPLES = 90;

/** Fenêtres d'une seconde consécutives dans le même sens avant d'agir. */
const WINDOWS = 3;

export interface PerformanceOptions {
  /** Vrai pendant une partie : la qualité ne s'adapte qu'en jeu. */
  isPlaying: () => boolean;
  /** Détail du fond courant, et comment le changer. */
  getSkyDetail: () => boolean;
  setSkyDetail: (high: boolean) => void;
  /** Échelle de rendu courante, et comment la changer. */
  getRenderScale: () => number;
  setRenderScale: (value: number) => void;
}

export class PerformanceGovernor {
  /** Zéro jusqu'à la fin de la détection. */
  refreshHz = 0;
  /** Dernières images par seconde mesurées. */
  fps = 60;

  private readonly samples: number[] = [];
  private frames = 0;
  private elapsed = 0;
  private runSeconds = 0;
  private hold = 0;
  private bad = 0;
  private good = 0;

  constructor(private readonly options: PerformanceOptions) {}

  /** Force une nouvelle mesure, quand l'écran ou la fenêtre a bougé. */
  redetect(): void {
    this.refreshHz = 0;
    this.samples.length = 0;
  }

  /** Alimente le détecteur. À appeler une fois par frame avec le vrai delta. */
  detect(frameDt: number): void {
    if (this.refreshHz || frameDt <= 0 || frameDt > 0.2) return;
    this.samples.push(frameDt);
    if (this.samples.length < SAMPLES) return;

    // Médiane, pas moyenne : une seule frame longue au démarrage tirerait une
    // moyenne assez loin pour caler sur la mauvaise cadence.
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const raw = 1 / sorted[Math.floor(sorted.length / 2)]!;
    this.refreshHz = KNOWN_RATES.reduce(
      (best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best),
      60,
    );
  }

  /** Fenêtre d'une seconde. Mesure, puis adapte la qualité s'il le faut. */
  update(frameDt: number): void {
    this.frames++;
    this.elapsed += frameDt;
    if (this.elapsed < 1) return;

    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    // Tourner bien au-dessus de la cadence détectée veut dire que la détection
    // était fausse, d'ordinaire parce que la fenêtre a changé d'écran.
    if (this.refreshHz && this.fps > this.refreshHz * 1.2) {
      this.redetect();
    }

    if (!this.options.isPlaying()) {
      this.runSeconds = 0;
      this.bad = this.good = 0;
      return;
    }
    this.runSeconds++;
    // Les premières secondes sont de la compilation de shaders, pas un verdict sur la machine.
    if (this.runSeconds < 4) return;
    if (this.hold > 0) {
      this.hold--;
      return;
    }

    // L'étalon est l'écran lui-même : le jeu fait son travail quand il tient
    // ce que l'appareil peut montrer.
    const reachable = this.refreshHz || 60;
    if (this.fps < reachable * 0.78) {
      this.bad++;
      this.good = 0;
    } else if (this.fps > reachable * 0.95) {
      this.good++;
      this.bad = 0;
    } else {
      this.bad = this.good = 0;
    }

    if (this.bad >= WINDOWS) {
      this.bad = 0;
      this.stepDown();
    } else if (this.good >= WINDOWS) {
      this.good = 0;
      this.stepUp();
    }
  }

  /** Le détail d'abord, la résolution ensuite : perdre le ciel est la plus grosse perte. */
  private stepDown(): void {
    if (this.options.getSkyDetail()) {
      this.options.setSkyDetail(false);
      this.hold = 3;
      return;
    }
    const scale = this.options.getRenderScale();
    if (scale > 0.7) {
      this.options.setRenderScale(Math.max(0.7, +(scale - 0.1).toFixed(2)));
      this.hold = 4;
    }
  }

  /** Récupéré dans l'ordre inverse, et plus lentement que ça n'est descendu. */
  private stepUp(): void {
    const scale = this.options.getRenderScale();
    if (scale < 1) {
      this.options.setRenderScale(Math.min(1, +(scale + 0.05).toFixed(2)));
      this.hold = 4;
      return;
    }
    if (!this.options.getSkyDetail()) {
      this.options.setSkyDetail(true);
      this.hold = 5;
    }
  }
}
