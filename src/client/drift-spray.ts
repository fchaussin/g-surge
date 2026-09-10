/**
 * La gerbe de dérive : l'air arraché quand les appuis lâchent.
 *
 * Le drift avait une voix continue et aucune image, sinon le lacet de la coque.
 * C'est le premier émetteur événementiel du jeu — la traînée de fumée n'en est
 * pas un, c'est une chaîne de sprites placés par phase.
 *
 * Trois contraintes qui expliquent la forme du fichier :
 *
 * - **Parenté au vaisseau, et confinée.** Une particule lâchée dans le monde
 *   croise nécessairement la caméra, 19 m derrière. La gerbe reste dans la même
 *   enveloppe que la fumée, une douzaine de mètres, ce qui est aussi pourquoi
 *   sa vitesse de recul n'a rien à voir avec celle du vaisseau.
 * - **Aucune allocation par frame.** Tout est en tableaux typés, les sprites
 *   sont créés une fois, et une gerbe saturée cesse d'émettre plutôt que de
 *   grandir.
 * - **Un hasard qui lui appartient.** Les captures figées ne dérivent jamais —
 *   mesuré, `|slip|` y plafonne à 1,99 m/s contre 22,7 pour décrocher — donc
 *   rien n'oblige à semer ce générateur. Il l'est quand même : « ne peut pas
 *   arriver aujourd'hui » est plus faible que « ne peut pas varier », et c'est
 *   le raisonnement que la poussière du ciel tient déjà.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';
import { Rng, type SimState } from '../sim/index.js';
import { driftIntensity, driftSide } from './drift.js';

const COUNT = 32;

/**
 * Durée de vie d'une particule, son recul, et la profondeur de sa naissance.
 *
 * Exportés parce qu'ils portent une contrainte plutôt qu'un goût : leur somme
 * est la profondeur que la gerbe atteint, et elle doit rester en deçà de la
 * caméra. `tests/drift.test.ts` la vérifie, pour qu'allonger la durée de vie ne
 * puisse pas rouvrir en silence le bug que la fumée a déjà payé.
 */
export const LIFE = 0.42;
export const BACK_SPEED = 26;
export const SPAWN_BACK_MIN = 1.5;
export const SPAWN_BACK_MAX = 2.6;

/** Profondeur maximale atteinte, en mètres derrière le vaisseau. */
export const REACH = SPAWN_BACK_MAX + BACK_SPEED * LIFE;

/** Émission par seconde, au décrochage puis à fond. */
const RATE_MIN = 18;
const RATE_MAX = 64;

/** Vitesse latérale de la gerbe, en m/s, au décrochage puis à fond. */
const SIDE_MIN = 5;
const SIDE_MAX = 19;

export class DriftSpray {
  readonly group = new Group();

  private readonly sprites: Sprite[] = [];
  private readonly px = new Float32Array(COUNT);
  private readonly py = new Float32Array(COUNT);
  private readonly pz = new Float32Array(COUNT);
  private readonly vx = new Float32Array(COUNT);
  private readonly vy = new Float32Array(COUNT);
  private readonly age = new Float32Array(COUNT);
  /** Négatif quand la particule est libre. */
  private readonly live = new Int8Array(COUNT);

  private rng = Rng.fromSeed('g-surge', 'spray');
  private pending = 0;

  constructor() {
    const map = this.makeTexture();
    for (let i = 0; i < COUNT; i++) {
      const sprite = new Sprite(
        new SpriteMaterial({
          map,
          color: 0x9fe8ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: AdditiveBlending,
          fog: false,
        }),
      );
      sprite.visible = false;
      this.group.add(sprite);
      this.sprites.push(sprite);
    }
  }

  /**
   * Éteint la gerbe et remet son hasard à son état de départ.
   *
   * Les particules portent une position accumulée, exactement comme les
   * bouffées de fumée : sans cet appel une reprise de partie en hérite. Le
   * générateur est remis lui aussi, sans quoi une capture dépendrait du nombre
   * de frames qui l'ont précédée.
   */
  reset(): void {
    this.rng = Rng.fromSeed('g-surge', 'spray');
    this.pending = 0;
    for (let i = 0; i < COUNT; i++) {
      this.live[i] = -1;
      this.sprites[i]!.visible = false;
    }
  }

  /** @param frameDt vrai delta de frame : la gerbe est de la présentation. */
  update(frameDt: number, state: SimState): void {
    const intensity = driftIntensity(state);
    const side = driftSide(state);

    if (side !== 0) {
      this.pending += (RATE_MIN + (RATE_MAX - RATE_MIN) * intensity) * frameDt;
      while (this.pending >= 1) {
        this.pending -= 1;
        if (!this.spawn(side, intensity)) {
          // Réservoir plein : on jette la demande plutôt que de la garder, sinon
          // elle repartirait en rafale à la première particule libérée.
          this.pending = 0;
          break;
        }
      }
    } else {
      this.pending = 0;
    }

    for (let i = 0; i < COUNT; i++) {
      if (this.live[i]! < 0) continue;
      const a = (this.age[i]! += frameDt);
      if (a >= LIFE) {
        this.live[i] = -1;
        this.sprites[i]!.visible = false;
        continue;
      }
      // L'air freine la gerbe, il ne l'accélère pas : la vitesse latérale
      // s'éteint pendant que le recul reste constant.
      const drag = 1 - Math.min(1, frameDt * 3.4);
      this.vx[i]! *= drag;
      this.vy[i]! *= drag;
      this.px[i]! += this.vx[i]! * frameDt;
      this.py[i]! += this.vy[i]! * frameDt;
      this.pz[i]! -= BACK_SPEED * frameDt;

      const t = a / LIFE;
      const sprite = this.sprites[i]!;
      sprite.position.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      sprite.scale.setScalar(0.5 + t * 1.6);
      // Bornée par construction : `t` va de 0 à 1, donc l'échelle ne peut pas
      // devenir négative — un sprite miroir plein écran est un bug déjà payé.
      sprite.material.opacity = 0.55 * (1 - t) * (1 - t) * (0.4 + 0.6 * intensity);
    }
  }

  /** @returns false quand le réservoir est plein. */
  private spawn(side: -1 | 1, intensity: number): boolean {
    let i = 0;
    while (i < COUNT && this.live[i]! >= 0) i++;
    if (i === COUNT) return false;

    const rng = this.rng;
    this.live[i] = 1;
    this.age[i] = 0;
    this.px[i] = side * (1.05 + rng.next() * 0.5);
    this.py[i] = 0.55 + rng.next() * 0.6;
    this.pz[i] = -(SPAWN_BACK_MIN + rng.next() * (SPAWN_BACK_MAX - SPAWN_BACK_MIN));
    this.vx[i] = side * (SIDE_MIN + (SIDE_MAX - SIDE_MIN) * intensity) * (0.7 + rng.next() * 0.6);
    this.vy[i] = rng.centered(2.2);
    return true;
  }

  /** Une étincelle nette, plus dure que la bouffée de fumée. */
  private makeTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(200,244,255,0.62)');
    grd.addColorStop(1, 'rgba(140,220,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new CanvasTexture(canvas);
  }
}
