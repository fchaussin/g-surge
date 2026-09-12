/**
 * Le vaisseau : coque, ailes, nacelles, plumes de réacteur, traînée de fumée et
 * halo de ramassage.
 *
 * Le seul objet éclairé du jeu. Tout le reste est en `MeshBasicMaterial` ; le
 * vaisseau a un `MeshLambertMaterial` sous une lumière principale et une
 * ambiante faible, pour se lire comme un volume plein et pour que sa rotation
 * reste lisible dans une vrille.
 *
 * Deux choses reprises à dessein :
 *
 * - **`MeshLambertMaterial` n'a pas de `flatShading` en r128.** Une géométrie
 *   non indexée est déjà ombrée à plat ; poser la propriété ne fait que loguer
 *   un avertissement. Les coques sont bâties en triangles libres exactement
 *   pour cela.
 * - **La traînée de fumée est parentée au vaisseau, pas émise dans le monde.**
 *   En espace monde une bouffée lâchée au vaisseau croise nécessairement la
 *   caméra 19 m derrière et remplit l'écran. Parentée, la chaîne reste entre
 *   les deux et ne peut pas croiser.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import type { ThrustTier } from '../sim/index.js';

/** Barreaux de poussée : croisière, boost, super boost, surge. */
const THRUST_LEVELS = [
  { len: 1.1, rad: 0.3, opacity: 0.35, colour: 0x5fd8ff },
  { len: 3.0, rad: 0.44, opacity: 0.75, colour: 0xbdf0ff },
  { len: 5.0, rad: 0.56, opacity: 0.95, colour: 0xff8ae0 },
  { len: 7.2, rad: 0.66, opacity: 1.0, colour: 0xfff0a8 },
] as const;

/** Couleur du cœur de flamme par palier. Le G-SURGE vire au blanc chaud. */
const CORE_BY_TIER = [0xffffff, 0xffffff, 0xffe6fb, 0xfff6d0] as const;

const SMOKE_COUNT = 18;
const TRAIL_LENGTH = 11;

/** Débris de l'explosion : combien, combien de temps, et leur freinage dans l'air. */
const EXPLOSION_COUNT = 28;
const EXPLOSION_LIFE = 1.1;
const EXPLOSION_DRAG = 2.2;
const EXPLOSION_SPEED_MIN = 4;
const EXPLOSION_SPEED_MAX = 9;
const EXPLOSION_COLOURS = [0xff5a2a, 0xffae40, 0xfff0c0] as const;

/**
 * Ce qu'un drift fait à la traînée de fumée : elle se courbe vers le côté d'où
 * le vaisseau vient, puisque les bouffées ont été laissées là où il n'est plus,
 * et elle se disloque — chaque bouffée oscille pour son compte, d'autant plus
 * qu'elle est loin en arrière.
 *
 * Le FX_DRIFT_WAKE de la palette. Déterministe, une sinusoïde par bouffée sur
 * une horloge qui ne tourne que tant que le sillage est levé, plutôt qu'un
 * hasard par frame : la traînée est dans chaque capture de scène, et une
 * oscillation exactement nulle hors drift est ce qui tient ces captures en
 * place. Amorti, donc à remettre à zéro.
 */
const WAKE_BEND = 2.4;
const WAKE_JITTER = 0.55;
const WAKE_RATE = 9;
const WAKE_EASE = 6;

type Point3 = readonly [number, number, number];

/** Triangles libres : la géométrie est ombrée à plat sans le demander. */
function poly(
  faces: readonly (readonly [string, string, string])[],
  points: Record<string, Point3>,
): BufferGeometry {
  const v: number[] = [];
  for (const [a, b, c] of faces) v.push(...points[a]!, ...points[b]!, ...points[c]!);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Ship {
  /** Suit la piste. Fumée et halo y sont accrochés. */
  readonly group = new Group();
  /** Porte la gîte et le lacet visuels, que la coque montre mais pas la trajectoire. */
  readonly body = new Group();

  private readonly flames: Mesh[] = [];
  private readonly flameOuter: MeshBasicMaterial;
  private readonly flameCore: MeshBasicMaterial;
  private readonly halo: Mesh;
  private readonly haloMaterial: MeshBasicMaterial;
  private readonly smoke: Sprite[] = [];
  private smokeMap!: CanvasTexture;
  private smokePhase = 0;
  /** La glisse telle que la traînée la sent, −1 à 1, amortie. */
  private wake = 0;
  private wakeClock = 0;

  /** Débris de l'explosion, partagent la texture de la fumée. Voir `explode`. */
  private readonly burst: Sprite[] = [];
  private readonly burstPX = new Float32Array(EXPLOSION_COUNT);
  private readonly burstPY = new Float32Array(EXPLOSION_COUNT);
  private readonly burstPZ = new Float32Array(EXPLOSION_COUNT);
  private readonly burstVX = new Float32Array(EXPLOSION_COUNT);
  private readonly burstVY = new Float32Array(EXPLOSION_COUNT);
  private readonly burstVZ = new Float32Array(EXPLOSION_COUNT);
  private exploding = false;
  /** Vrai dès l'explosion et jusqu'à `resetExplosion` : la coque reste cachée. */
  private destroyed = false;
  private explodeAge = 0;

  /* Couleurs de travail, pour que les interpolations par frame n'allouent rien. */
  private readonly tmpA = new Color();
  private readonly tmpB = new Color();

  constructor() {
    this.group.add(this.body);
    this.buildHull();
    ({ outer: this.flameOuter, core: this.flameCore } = this.buildPlumes());

    this.haloMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new Mesh(new SphereGeometry(2.6, 14, 10), this.haloMaterial);
    this.halo.position.y = 0.8;
    this.halo.visible = false;
    this.group.add(this.halo);

    this.buildSmoke();
    this.buildBurst();
  }

  /** Place le vaisseau dans le repère de la piste. `bank` vient de la simulation. */
  setPose(lat: number, hop: number, bank: number): void {
    const cb = Math.cos(bank),
      sb = Math.sin(bank);
    const hover = 1.35 + hop;
    this.group.position.set(cb * lat - sb * hover, sb * lat + cb * hover, 0);
    this.group.rotation.z = bank;
  }

  /** Attitude visuelle : roulis dans le virage, lacet avec la dérive. */
  setAttitude(lean: number, yaw: number, pitch: number): void {
    this.body.rotation.z = lean;
    this.body.rotation.y = yaw;
    this.body.rotation.x = pitch;
  }

  /**
   * @param level 0 croisière, 1 boost, 2 super boost, 3 surge.
   * @param frameDt vrai delta de frame : c'est un lissage d'affichage, pas de la simulation.
   */
  updateThrust(frameDt: number, level: ThrustTier): void {
    const lv = THRUST_LEVELS[level];
    // Délibérément encore sur Math.random : du bruit visuel par frame, hors
    // simulation, et le semer couplerait la présentation au noyau.
    const flicker = 0.86 + Math.random() * 0.28;

    for (let i = 0; i < this.flames.length; i++) {
      const m = this.flames[i]!;
      const isCore = i % 2 === 1;
      const targetLen = lv.len * (isCore ? 0.62 : 1) * flicker;
      const targetRad = lv.rad * (isCore ? 0.5 : 1);
      const k = Math.min(1, frameDt * 12);
      m.scale.x += (targetRad - m.scale.x) * k;
      m.scale.y = m.scale.x;
      m.scale.z += (targetLen - m.scale.z) * k;
    }

    const ko = Math.min(1, frameDt * 8);
    this.flameOuter.opacity += (lv.opacity * 0.55 - this.flameOuter.opacity) * ko;
    this.flameCore.opacity += (lv.opacity - this.flameCore.opacity) * ko;
    const kc = Math.min(1, frameDt * 6);
    this.flameOuter.color.lerp(this.tmpA.setHex(lv.colour), kc);
    this.flameCore.color.lerp(this.tmpB.setHex(CORE_BY_TIER[level]), kc);
  }

  /**
   * Pose les plumes directement à leur état stable, sans scintillement.
   *
   * Seule la capture de frame déterministe s'en sert. Les plumes convergent
   * vers leur cible sur beaucoup de frames, donc une frame prise après un nombre
   * arbitraire d'entre elles n'est pas reproductible — ce qui s'est vu comme
   * 7 000 pixels de différence entre deux captures du même état figé.
   */
  snapThrust(level: ThrustTier): void {
    const lv = THRUST_LEVELS[level];
    for (let i = 0; i < this.flames.length; i++) {
      const m = this.flames[i]!;
      const isCore = i % 2 === 1;
      m.scale.z = lv.len * (isCore ? 0.62 : 1);
      m.scale.x = lv.rad * (isCore ? 0.5 : 1);
      m.scale.y = m.scale.x;
    }
    this.flameOuter.opacity = lv.opacity * 0.55;
    this.flameCore.opacity = lv.opacity;
    this.flameOuter.color.setHex(lv.colour);
    this.flameCore.color.setHex(CORE_BY_TIER[level]);
  }

  /**
   * @param slide le drift, signé par le côté où le vaisseau glisse, 0 en dehors
   *   — `driftIntensity × driftSide`, l'échelle partagée. La traînée se courbe
   *   de l'autre côté et se disloque en proportion.
   */
  updateSmoke(frameDt: number, speed: number, level: ThrustTier, slide = 0): void {
    if (speed < 1) {
      for (const sp of this.smoke) sp.visible = false;
      return;
    }
    this.smokePhase = (this.smokePhase + (speed * frameDt) / TRAIL_LENGTH) % 1;
    this.wake += (slide - this.wake) * Math.min(1, frameDt * WAKE_EASE);
    const turbulence = Math.abs(this.wake);
    if (turbulence > 0.001) this.wakeClock += frameDt * WAKE_RATE;
    const half = SMOKE_COUNT / 2;
    const base = 0.2 + level * 0.11;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const sp = this.smoke[i]!;
      const side = i < half ? -1 : 1;
      // 0 à la tuyère, 1 à la queue. Borné par construction, d'où l'échelle de
      // sprite ci-dessous qui ne peut jamais devenir négative — un sprite
      // miroir plein écran est un bug que ce code a déjà payé.
      const p = (this.smokePhase + (i % half) / half) % 1;
      sp.visible = true;
      // Exactement nul quand le sillage est nul : `a + 0` vaut `a`, donc une
      // frame du mode attraction tombe sur les mêmes flottants qu'avant le sillage.
      const bend = -this.wake * WAKE_BEND * p;
      const jitter = turbulence * WAKE_JITTER * p * Math.sin(this.wakeClock + i * 2.4);
      sp.position.set(
        side * (1.15 + p * 1.05) + bend + jitter,
        1.0 + p * 0.85 + jitter * 0.5,
        -2.6 - p * TRAIL_LENGTH,
      );
      sp.scale.setScalar(0.45 + p * 1.35 + turbulence * p * 0.6);
      sp.material.opacity = base * Math.pow(Math.sin(p * Math.PI), 1.3);
    }
  }

  /** Les bouffées portent une distance parcourue, donc une remise à zéro doit les lâcher. */
  clearSmoke(): void {
    this.smokePhase = 0;
    this.wake = 0;
    this.wakeClock = 0;
    for (const sp of this.smoke) sp.visible = false;
  }

  /**
   * La coque cède : elle disparaît, une gerbe de débris part dans toutes les
   * directions. Déclenché une fois par `wreck` — un second appel avant
   * `resetExplosion` ne fait rien, la partie est déjà perdue.
   */
  explode(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.exploding = true;
    this.explodeAge = 0;
    this.body.visible = false;
    this.halo.visible = false;

    for (let i = 0; i < EXPLOSION_COUNT; i++) {
      // Direction uniforme sur la sphère par rejet plutôt que par angles, plus
      // simple à lire que la conversion sphérique pour un effet qui n'a besoin
      // d'aucune propriété d'échantillonnage particulière.
      let dx = 0,
        dy = 0,
        dz = 0,
        len = 0;
      do {
        dx = Math.random() * 2 - 1;
        dy = Math.random() * 2 - 1;
        dz = Math.random() * 2 - 1;
        len = Math.hypot(dx, dy, dz);
      } while (len < 0.001 || len > 1);
      const speed =
        EXPLOSION_SPEED_MIN + Math.random() * (EXPLOSION_SPEED_MAX - EXPLOSION_SPEED_MIN);

      this.burstPX[i] = 0;
      this.burstPY[i] = 1;
      this.burstPZ[i] = 0;
      this.burstVX[i] = (dx / len) * speed;
      // Biaisée vers le haut : un nuage de débris qui ne s'écrase pas au sol
      // aussitôt se lit davantage comme une explosion que comme une chute.
      this.burstVY[i] = (dy / len) * speed * 0.7 + 1.8;
      this.burstVZ[i] = (dz / len) * speed;

      const sp = this.burst[i]!;
      sp.visible = true;
      sp.material.opacity = 1;
      sp.scale.setScalar(0.7 + Math.random() * 0.8);
    }
  }

  /**
   * Frame d'affichage de la gerbe de débris : ne fait rien hors explosion, et
   * s'éteint d'elle-même sans toucher à `destroyed` — la coque reste cachée
   * une fois les débris dissipés, jusqu'à `resetExplosion`.
   */
  updateExplosion(frameDt: number): void {
    if (!this.exploding) return;
    this.explodeAge += frameDt;
    const t = Math.min(1, this.explodeAge / EXPLOSION_LIFE);
    const drag = Math.max(0, 1 - frameDt * EXPLOSION_DRAG);

    for (let i = 0; i < EXPLOSION_COUNT; i++) {
      this.burstVX[i]! *= drag;
      this.burstVY[i]! *= drag;
      this.burstVZ[i]! *= drag;
      this.burstPX[i]! += this.burstVX[i]! * frameDt;
      this.burstPY[i]! += this.burstVY[i]! * frameDt;
      this.burstPZ[i]! += this.burstVZ[i]! * frameDt;

      const sp = this.burst[i]!;
      sp.position.set(this.burstPX[i]!, this.burstPY[i]!, this.burstPZ[i]!);
      sp.material.opacity = (1 - t) * (1 - t);
    }

    if (t >= 1) {
      this.exploding = false;
      for (const sp of this.burst) sp.visible = false;
    }
  }

  /** Reforme le vaisseau pour une nouvelle partie : l'inverse de `explode`. */
  resetExplosion(): void {
    this.destroyed = false;
    this.exploding = false;
    this.explodeAge = 0;
    this.body.visible = true;
    for (const sp of this.burst) sp.visible = false;
  }

  /**
   * Lueur de ramassage et d'impact. Pilotée par le client, pas par l'état de la
   * simulation : `halo` et `haloPow` ont quitté le noyau quand les événements
   * les ont remplacés.
   *
   * @param intensity 0 à 1, amortie par l'appelant.
   */
  setHalo(colour: number, intensity: number, power: number): void {
    if (intensity <= 0) {
      this.halo.visible = false;
      return;
    }
    this.haloMaterial.color.setHex(colour);
    this.halo.visible = true;
    this.haloMaterial.opacity = 0.85 * intensity * intensity * power;
    this.halo.scale.setScalar(0.55 + (1 - intensity) * 2.3 * power);
  }

  private buildHull(): void {
    this.body.add(hullBody());
  }

  /** Un cône large et diffus et un cœur étroit et brillant, par tuyère. */
  private buildPlumes(): { outer: MeshBasicMaterial; core: MeshBasicMaterial } {
    const geo = new ConeGeometry(1, 1, 12, 1, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -0.5);

    const outer = new MeshBasicMaterial({
      color: 0x5fd8ff,
      transparent: true,
      opacity: 0.4,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const core = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    for (const x of [-1.15, 1.15]) {
      const o = new Mesh(geo, outer);
      const c = new Mesh(geo, core);
      o.position.set(x, 1.0, -2.3);
      c.position.set(x, 1.0, -2.3);
      this.flames.push(o, c);
      this.body.add(o, c);
    }
    return { outer, core };
  }

  private buildSmoke(): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const g = canvas.getContext('2d')!;
    const grd = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.40)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 96, 96);

    const map = new CanvasTexture(canvas);
    this.smokeMap = map;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const sp = new Sprite(
        new SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false, fog: false }),
      );
      sp.visible = false;
      this.group.add(sp);
      this.smoke.push(sp);
    }
  }

  /** Débris de l'explosion : même dégradé que la fumée, teinté et additif. */
  private buildBurst(): void {
    for (let i = 0; i < EXPLOSION_COUNT; i++) {
      const sp = new Sprite(
        new SpriteMaterial({
          map: this.smokeMap,
          color: EXPLOSION_COLOURS[i % EXPLOSION_COLOURS.length],
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: AdditiveBlending,
          fog: false,
        }),
      );
      sp.visible = false;
      this.group.add(sp);
      this.burst.push(sp);
    }
  }
}

/**
 * La coque : un M vu de face — deux ailes hautes, une épine centrale plus
 * basse, deux creux — avec ses nacelles, sa verrière et ses feux.
 *
 * Exportée pour le fantôme, qui est le même vaisseau vu à travers : avec un
 * `material`, chaque pièce le porte à la place du sien, et la silhouette reste
 * celle que le joueur connaît. Sans, ce sont les matériaux du joueur.
 */
export function hullBody(material?: Material): Group {
  const mat = (own: Material): Material => material ?? own;
  const P: Record<string, Point3> = {
    N: [0, 0.52, 2.9],
    T: [0, 1.05, -0.2],
    L: [-0.62, 0.46, -0.2],
    R: [0.62, 0.46, -0.2],
    B: [0, -0.02, -0.2],
    T2: [0, 0.86, -2.4],
    L2: [-0.48, 0.46, -2.4],
    R2: [0.48, 0.46, -2.4],
    B2: [0, 0.12, -2.4],
  };
  const hull = new Mesh(
    poly(
      [
        ['N', 'T', 'R'],
        ['N', 'R', 'B'],
        ['N', 'B', 'L'],
        ['N', 'L', 'T'],
        ['T', 'L', 'L2'],
        ['T', 'L2', 'T2'],
        ['R', 'T', 'T2'],
        ['R', 'T2', 'R2'],
        ['B', 'R', 'R2'],
        ['B', 'R2', 'B2'],
        ['L', 'B', 'B2'],
        ['L', 'B2', 'L2'],
        ['T2', 'L2', 'B2'],
        ['T2', 'B2', 'R2'],
      ],
      P,
    ),
    mat(new MeshLambertMaterial({ color: 0x36485f, side: DoubleSide })),
  );

  // aile en flèche, emplanture basse et bout relevé
  const W: Record<string, Point3> = {
    A: [0.52, 0.44, 1.0],
    B: [0.52, 0.44, -1.9],
    K1: [1.5, 1.3, -0.15],
    K2: [1.52, 1.3, -2.15],
    T1: [1.88, 1.02, -0.8],
    T2: [1.9, 1.02, -2.35],
  };
  const WL: Record<string, Point3> = {};
  for (const k of Object.keys(W)) WL[k] = [-W[k]![0], W[k]![1], W[k]![2]];
  const wingFaces = [
    ['A', 'K1', 'K2'],
    ['A', 'K2', 'B'],
    ['K1', 'T1', 'T2'],
    ['K1', 'T2', 'K2'],
  ] as const;
  const wingMat = mat(new MeshLambertMaterial({ color: 0x2b3b52, side: DoubleSide }));
  const wingR = new Mesh(poly(wingFaces, W), wingMat);
  const wingL = new Mesh(poly(wingFaces, WL), wingMat);

  // nacelles aux deux tiers de l'envergure
  const podGeo = new CylinderGeometry(0.26, 0.22, 1.15, 8);
  podGeo.rotateX(Math.PI / 2);
  const podMat = mat(new MeshLambertMaterial({ color: 0x1d2836 }));
  const pods = [-1.15, 1.15].map((x) => {
    const m = new Mesh(podGeo, podMat);
    m.position.set(x, 1.0, -1.7);
    return m;
  });

  const glowMat = mat(new MeshBasicMaterial({ color: 0x8af4ff, transparent: true, opacity: 0.95 }));
  const glowGeo = new CircleGeometry(0.23, 8);
  const glows = [-1.15, 1.15].map((x) => {
    const m = new Mesh(glowGeo, glowMat);
    m.position.set(x, 1.0, -2.29);
    m.rotation.y = Math.PI;
    return m;
  });

  const canopy = new Mesh(
    new BoxGeometry(0.44, 0.3, 1.05),
    mat(new MeshLambertMaterial({ color: 0x0d1620 })),
  );
  canopy.position.set(0, 0.96, 0.75);
  canopy.rotation.x = -0.12;

  const spine = new Mesh(
    new BoxGeometry(0.13, 0.06, 2.0),
    mat(new MeshBasicMaterial({ color: 0x25e2ff })),
  );
  spine.position.set(0, 1.07, -0.9);

  const strakeGeo = new BoxGeometry(0.09, 0.36, 0.72);
  const strakeMat = mat(new MeshBasicMaterial({ color: 0xff2f9a }));
  const strakes = [-1.51, 1.51].map((x) => {
    const m = new Mesh(strakeGeo, strakeMat);
    m.position.set(x, 1.46, -1.2);
    m.rotation.z = x < 0 ? 0.16 : -0.16;
    return m;
  });

  const g = new Group();
  g.add(hull, wingL, wingR, canopy, spine, ...pods, ...glows, ...strakes);
  return g;
}
