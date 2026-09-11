/**
 * Le bouclier d'invincibilité, tel qu'il se voit : une boule à plasma autour
 * de la coque — une bobine Tesla enfermée dans une sphère.
 *
 * La sphère est un halo visible, une bulle dont le bord s'allume par fresnel
 * et dont l'intérieur reste presque clair, pour qu'on voie la coque au
 * travers. Les arcs claquent de la coque à la paroi, jamais au-delà, et sont
 * redessinés quelques dizaines de fois par seconde, jamais deux fois pareils.
 * Tout est alloué à la construction — un `LineSegments` dont les positions
 * sont réécrites sur place — et rien ne l'est ensuite, règle de la boucle.
 *
 * `value` est l'intensité amortie, 0 à 1, que les rails et le son lisent
 * aussi : le même chiffre allume les trois, pour que l'effet soit un état et
 * non trois effets qui se ressemblent. Il ne monte qu'en partie, jamais en
 * attract — `rideT` y reste à zéro — donc aucune capture ne peut le voir ; il
 * est quand même remis à zéro avec le reste de ce qui s'amortit.
 *
 * Le hasard ici est celui de la plume et du scintillement du drift : du
 * client, hors simulation, sans effet sur rien de figé.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import type { SimState } from '../sim/index.js';

/** Arcs simultanés, et points par arc — chaque arc est une polyligne de segments. */
const ARCS = 24;
const POINTS = 6;
/** Rayon d'où partent les arcs, un peu au-dessus de la coque, et celui de la bulle où ils meurent. */
const R_HULL = 1.4;
const R_SHELL = 3.4;
/** Secondes entre deux redessins des arcs : le claquement, pas la cadence d'affichage. */
const CRACKLE = 0.045;
/** Part des arcs allumés à chaque redessin : un bouclier plein serait une boule. */
const ALIVE = 0.6;
/** Montée et descente de l'intensité, en secondes. */
const EASE_IN = 0.18;
const EASE_OUT = 0.35;
/** Secondes avant la fin où le bouclier clignote pour prévenir, et sa fréquence. */
const WARN_TIME = 1.5;
const WARN_HZ = 4;

/** Le violet du prisme, blanchi : un arc est presque blanc au cœur. */
const ARC_COLOUR = 0xd6c4ff;
const GLOW_COLOUR = 0x9b6bff;

/**
 * La bulle : un fresnel, donc le bord est vif et le centre presque vide, et
 * la palette arc-en-ciel du prisme sur ce bord — la même formule en cosinus,
 * décalée par la normale et le temps, pour que la bulle soit visiblement ce
 * que le diamant a donné. Additif, sans écriture de profondeur : la coque et
 * les arcs se lisent au travers, et le halo violet du contact avec un rail,
 * qui est une sphère à part dans `ship.ts`, reste visible dedans.
 */
const SHELL_VS = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const SHELL_FS = /* glsl */ `
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    float facing = abs(dot(n, normalize(vView)));
    float rim = pow(1.0 - facing, 2.4);
    float t = uTime * 0.25 + n.x * 0.35 + n.y * 0.3;
    vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
    float ripple = 0.85 + 0.15 * sin(uTime * 9.0 + n.y * 7.0 + n.x * 5.0);
    vec3 colour = mix(rainbow * 0.5, mix(rainbow, vec3(1.0), 0.15), rim);
    float alpha = (0.05 + rim * 0.85 * ripple) * uOpacity;
    gl_FragColor = vec4(colour * alpha, alpha);
  }
`;

export class ShieldFx {
  readonly group = new Group();

  /** Intensité amortie, 0 à 1. Lue par les rails et par le son. */
  value = 0;

  private readonly arcs: LineSegments;
  private readonly arcMaterial: LineBasicMaterial;
  /** Les mêmes arcs, violets, un peu plus larges : une ligne WebGL fait un pixel, deux font une lueur. */
  private readonly arcsHalo: LineSegments;
  private readonly arcHaloMaterial: LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly shell: Mesh;
  private readonly shellMaterial: ShaderMaterial;
  private crackle = 0;
  private clock = 0;

  constructor() {
    this.positions = new Float32Array(ARCS * (POINTS - 1) * 2 * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.arcMaterial = new LineBasicMaterial({
      color: ARC_COLOUR,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.arcs = new LineSegments(g, this.arcMaterial);
    this.arcs.frustumCulled = false;
    this.arcs.visible = false;
    this.arcHaloMaterial = new LineBasicMaterial({
      color: GLOW_COLOUR,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.arcsHalo = new LineSegments(g, this.arcHaloMaterial);
    this.arcsHalo.frustumCulled = false;
    this.arcsHalo.visible = false;
    this.arcsHalo.scale.setScalar(1.06);

    this.shellMaterial = new ShaderMaterial({
      vertexShader: SHELL_VS,
      fragmentShader: SHELL_FS,
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.shell = new Mesh(new SphereGeometry(R_SHELL, 28, 18), this.shellMaterial);
    this.shell.visible = false;

    this.arcs.position.y = this.arcsHalo.position.y = this.shell.position.y = 0.8;
    // La bulle après les arcs : additive et sans profondeur, l'ordre ne change
    // que la lecture, et un arc sous le bord se voit mieux que par-dessus.
    this.group.add(this.arcsHalo, this.arcs, this.shell);
  }

  /** Remise à zéro avec tout ce qui s'amortit : voir `resetPresentation` dans main.ts. */
  reset(): void {
    this.value = 0;
    this.crackle = 0;
    this.clock = 0;
    this.arcs.visible = this.arcsHalo.visible = false;
    this.shell.visible = false;
  }

  /**
   * Une frame, sur l'horloge d'affichage. L'intensité suit `rideT` : montée
   * vive au ramassage, descente plus lente à la fin, et un clignotement sur
   * la dernière seconde et demie — le HUD compte, mais l'œil est sur la piste.
   */
  update(frameDt: number, state: SimState, playing: boolean): void {
    const on = playing && state.rideT > 0;
    let target = on ? 1 : 0;
    if (on && state.rideT < WARN_TIME) {
      target = 0.35 + 0.65 * Math.abs(Math.sin(state.rideT * Math.PI * WARN_HZ));
    }
    const ease = target > this.value ? EASE_IN : EASE_OUT;
    this.value += (target - this.value) * Math.min(1, frameDt / ease);
    if (!on && this.value < 0.01) this.value = 0;

    if (this.value <= 0) {
      this.arcs.visible = this.arcsHalo.visible = false;
      this.shell.visible = false;
      return;
    }

    this.clock += frameDt;
    this.crackle -= frameDt;
    if (this.crackle <= 0) {
      this.crackle = CRACKLE;
      this.redraw();
    }

    this.shell.visible = true;
    this.shellMaterial.uniforms.uOpacity!.value = this.value;
    this.shellMaterial.uniforms.uTime!.value = this.clock;
    this.arcs.visible = this.arcsHalo.visible = true;
    this.arcMaterial.opacity = Math.min(1, 0.55 + 0.6 * this.value) * this.value;
    this.arcHaloMaterial.opacity = 0.7 * this.value;
  }

  /** Redessine chaque arc : un départ sur la coque, une fin sur la sphère, du bruit entre. */
  private redraw(): void {
    const p = this.positions;
    let o = 0;
    for (let a = 0; a < ARCS; a++) {
      const alive = Math.random() < ALIVE;
      // Direction de départ tirée sur la sphère, celle d'arrivée un peu à côté :
      // un arc penche, il ne rayonne pas droit.
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const dx = Math.sin(ph) * Math.cos(th);
      const dy = Math.cos(ph);
      const dz = Math.sin(ph) * Math.sin(th);
      const ex = dx + (Math.random() - 0.5) * 0.9;
      const ey = dy + (Math.random() - 0.5) * 0.9;
      const ez = dz + (Math.random() - 0.5) * 0.9;
      const en = 1 / Math.hypot(ex, ey, ez);
      // L'arc meurt sur la paroi, exactement : c'est ce qui fait la boule à
      // plasma, l'éclair qui vient toucher le verre.
      const rOut = R_SHELL;

      let lx = dx * R_HULL,
        ly = dy * R_HULL,
        lz = dz * R_HULL;
      for (let k = 1; k < POINTS; k++) {
        const t = k / (POINTS - 1);
        const r = R_HULL + (rOut - R_HULL) * t;
        // Le bruit est nul aux deux bouts, maximal au milieu : l'arc reste
        // accroché à la coque et à la sphère.
        const j = (1 - Math.abs(2 * t - 1)) * 0.7;
        const nx = (dx + (ex * en - dx) * t) * r + (Math.random() - 0.5) * j;
        const ny = (dy + (ey * en - dy) * t) * r + (Math.random() - 0.5) * j;
        const nz = (dz + (ez * en - dz) * t) * r + (Math.random() - 0.5) * j;
        if (alive) {
          p[o++] = lx;
          p[o++] = ly;
          p[o++] = lz;
          p[o++] = nx;
          p[o++] = ny;
          p[o++] = nz;
        } else {
          // Un arc éteint est un segment de longueur nulle : rien à dessiner,
          // rien à réallouer.
          for (let z = 0; z < 6; z++) p[o++] = 0;
        }
        lx = nx;
        ly = ny;
        lz = nz;
      }
    }
    this.arcs.geometry.attributes.position!.needsUpdate = true;
  }
}
