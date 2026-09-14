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
  HZ,
  SEG,
  Sim,
  TraceCursor,
  thrustTier,
  trackPoint,
  type Trace,
} from '../sim/index.js';
import type { Relay } from './duel.js';
import { hullBody } from './ship.js';

/** Le cyan du drift, vu à travers : la teinte du jeu pour « la même chose, en écho ». */
const GHOST_COLOUR = 0x7fe7ff;
const GHOST_OPACITY = 0.42;
/** La teinte d'une épave : la même silhouette, éteinte. */
const GHOST_WRECKED = 0x39414d;
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
  /**
   * En duel, le fantôme n'a pas de simulation : il est dessiné depuis les
   * six nombres que le salon relaie de l'autre. Entre deux relais — cent
   * millisecondes — la distance est extrapolée à la vitesse déduite des
   * deux derniers, et le reste est lissé sur l'horloge d'affichage.
   */
  private puppet: {
    at: Relay;
    speed: number;
    since: number;
    dist: number;
    lat: number;
    hop: number;
    yaw: number;
  } | null = null;

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

  /** Vrai entre `arm` et `disarm`, que la trace soit finie ou non — ou en duel. */
  get armed(): boolean {
    return this.cursor !== null || this.puppet !== null;
  }

  /**
   * Le dernier relais de l'autre vaisseau. Le premier arme le fantôme ; les
   * suivants donnent la vitesse à laquelle extrapoler jusqu'au prochain.
   */
  follow(relay: Relay, frameDt: number): void {
    const p = this.puppet;
    if (p && p.at.steps === relay.steps) {
      p.since += frameDt;
      return;
    }
    const speed =
      p && relay.steps > p.at.steps
        ? ((relay.dist - p.at.dist) / (relay.steps - p.at.steps)) * HZ
        : 0;
    this.puppet = {
      at: relay,
      speed,
      since: 0,
      dist: p ? p.dist : relay.dist,
      lat: p ? p.lat : relay.lat,
      hop: p ? p.hop : relay.hop,
      yaw: p ? p.yaw : relay.yaw,
    };
  }

  /** Quitte le duel : plus rien à suivre. */
  unfollow(): void {
    this.puppet = null;
    this.gap = 0;
    this.group.visible = false;
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
  update(live: Sim, frameDt = 0): void {
    const p = this.puppet;
    if (this.cursor === null && p === null) {
      this.group.visible = false;
      return;
    }
    const l = live.state;
    const liveAt = live.track.nid[BACK]! * SEG + l.cursor;
    let d: number;
    let g: { lat: number; hop: number; yaw: number; wrecked: boolean; tier: number };
    if (p) {
      // extrapolé à la vitesse du dernier relais, puis lissé : le relais a
      // cent millisecondes, le lissage en cache la marche d'escalier
      const target = p.at.wrecked ? p.at.dist : p.at.dist + p.speed * p.since;
      const k = Math.min(1, frameDt * 14);
      p.dist += (target - p.dist) * k;
      p.lat += (p.at.lat - p.lat) * k;
      p.hop += (p.at.hop - p.hop) * k;
      p.yaw += (p.at.yaw - p.yaw) * k;
      // Les deux distances comptent les mêmes mètres depuis le départ, donc
      // leur différence est l'écart le long de la piste — sans passer par la
      // position absolue du ruban, qui porte l'origine du tampon.
      d = p.dist - l.dist;
      g = { lat: p.lat, hop: p.hop, yaw: p.yaw, wrecked: p.at.wrecked, tier: p.at.tier };
    } else {
      const s = this.sim.state;
      // position absolue le long de la piste : segment du vaisseau plus l'avance dans le segment
      const ghostAt = this.sim.track.nid[BACK]! * SEG + s.cursor;
      d = ghostAt - liveAt;
      g = { lat: s.lat, hop: s.hop, yaw: s.yaw, wrecked: s.wrecked, tier: thrustTier(s) };
    }
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
    // Épave : elle s'éteint au lieu de s'effacer. Un fantôme déjà à demi
    // transparent qu'on pâlissait encore de moitié disparaissait — or c'est
    // justement ce qu'on veut voir, l'endroit où l'autre s'est arrêté.
    const lit = g.wrecked ? 1 : 0.85 + g.tier * 0.05;
    this.material.opacity = GHOST_OPACITY * near * lit;
    this.material.color.set(g.wrecked ? GHOST_WRECKED : GHOST_COLOUR);
  }
}
