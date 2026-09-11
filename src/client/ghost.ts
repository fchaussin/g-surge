/**
 * Le fantôme : une partie enregistrée qui court à côté de la partie vivante.
 *
 * C'est la moitié « présentation » du multijoueur, construite sans réseau :
 * un autre vaisseau, dessiné depuis les chiffres d'une autre simulation sur la
 * piste que les deux partagent. Le fantôme a sa propre `Sim`, avancée d'un pas
 * chaque fois que la partie vivante en fait un, nourrie par un `TraceCursor`
 * — le même lecteur que le rejeu serveur, donc il montre exactement ce qu'un
 * serveur compterait. Il n'entre jamais dans la simulation du joueur : pas de
 * collision, pas d'influence, une image.
 *
 * Sa position monde vient de la piste vivante : l'écart le long de la piste
 * entre les deux vaisseaux, échantillonné sur le ruban intégré comme le sont
 * les pièces. Au-delà du tampon — 1 440 m devant, 120 derrière — il n'est
 * plus dessiné et seul l'écart du HUD le situe.
 */
import { Group, MeshBasicMaterial } from 'three';
import {
  BACK,
  COUNT,
  SEG,
  Sim,
  TraceCursor,
  thrustTier,
  trackPoint,
  type Trace,
} from '../sim/index.js';
import { hullBody } from './ship.js';

/** Le cyan du drift, vu à travers : la teinte du jeu pour « la même chose, en écho ». */
const GHOST_COLOUR = 0x7fe7ff;
const GHOST_OPACITY = 0.42;
/** La caméra est 19 m derrière le vaisseau ; le fantôme s'efface sur les 8 m qui la précèdent. */
const CAMERA_BEHIND = 19;
const FADE_SPAN = 8;
/** Même hauteur de vol que `Ship.setPose`. */
const HOVER = 1.35;

export class Ghost {
  readonly group = new Group();

  private readonly sim = new Sim({ seed: 'ghost' });
  private readonly material: MeshBasicMaterial;
  private readonly body: Group;
  private readonly point = trackPoint();
  private cursor: TraceCursor | null = null;

  constructor() {
    this.material = new MeshBasicMaterial({
      color: GHOST_COLOUR,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
    });
    this.body = hullBody(this.material);
    this.group.add(this.body);
    this.group.visible = false;
  }

  /** Vrai entre `arm` et `disarm`, que la trace soit finie ou non. */
  get armed(): boolean {
    return this.cursor !== null;
  }

  /** La trace en course, pour savoir sur quelle graine et contre quel score. */
  get trace(): Trace | null {
    return this.cursor?.trace ?? null;
  }

  /** Score du fantôme là où il en est — à la fin de la trace, son score final. */
  get score(): number {
    return this.sim.state.score;
  }

  /**
   * Écart le long de la piste, en mètres, positif quand le fantôme est devant.
   * Lu par le HUD ; vaut zéro sans fantôme.
   */
  gap = 0;

  /** Met une trace en course depuis le départ. À appeler quand la partie vivante démarre sur sa graine. */
  arm(trace: Trace): void {
    this.sim.setDifficulty(trace.difficulty);
    this.sim.reset(trace.seed);
    this.cursor = new TraceCursor(trace);
    this.gap = 0;
  }

  disarm(): void {
    this.cursor = null;
    this.gap = 0;
    this.group.visible = false;
  }

  /** Un pas fixe, en même temps que celui de la partie vivante. Rien après la fin de la trace ou la casse. */
  step(dt: number): void {
    const c = this.cursor;
    if (c === null || c.done || this.sim.state.wrecked) return;
    this.sim.step(c.advance(), dt, false);
  }

  /**
   * Place le fantôme dans le monde de la partie vivante. Après `buildPath`
   * de la piste vivante, comme les pièces.
   */
  update(live: Sim): void {
    if (this.cursor === null) {
      this.group.visible = false;
      return;
    }
    const g = this.sim.state;
    const l = live.state;
    // position absolue le long de la piste : segment du vaisseau plus l'avance dans le segment
    const ghostAt = this.sim.track.nid[BACK]! * SEG + g.cursor;
    const liveAt = live.track.nid[BACK]! * SEG + l.cursor;
    const d = ghostAt - liveAt;
    this.gap = d;

    // hors du ruban intégré, ou derrière la caméra : rien à dessiner
    const behind = -(BACK * SEG + l.cursor);
    const ahead = (COUNT - 1 - BACK) * SEG - l.cursor;
    if (d <= -CAMERA_BEHIND || d <= behind || d >= ahead) {
      this.group.visible = false;
      return;
    }

    const s = live.track.sample(l.cursor, d, this.point);
    const hover = HOVER + g.hop;
    this.group.visible = true;
    this.group.position.set(
      s.x + s.rx * g.lat + s.ux * hover,
      s.y + s.ry * g.lat + s.uy * hover,
      s.z + s.rz * g.lat + s.uz * hover,
    );
    this.group.rotation.set(0, s.yaw, s.bank, 'YXZ');
    // l'attitude du joueur, sans son amortissement : un fantôme n'a pas de masse à montrer
    this.body.rotation.y = g.yaw * live.tuning.yawVisual;
    this.body.rotation.z = -g.yaw * 0.9;
    // il s'efface en approchant la caméra, et pâlit quand il n'a plus de poussée
    const near = Math.min(1, (d + CAMERA_BEHIND) / FADE_SPAN);
    const lit = g.wrecked ? 0.5 : 0.85 + thrustTier(g) * 0.05;
    this.material.opacity = GHOST_OPACITY * near * lit;
  }
}
