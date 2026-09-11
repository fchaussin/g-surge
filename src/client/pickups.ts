/**
 * Pièces, réparations, super boosts, prismes et bidons, tirés d'un réservoir.
 *
 * La simulation possède quels objets existent et où ; ceci ne décide que de
 * leur aspect. Les maillages sont alloués une fois et réutilisés — une partie
 * ramasse des milliers de pièces, et créer un maillage par pièce donnerait du
 * travail au ramasse-miettes toutes les quelques secondes.
 *
 * La couleur d'une pièce suit le barreau de poussée du vaisseau, ce qui est
 * toute la raison d'être visible des barreaux : bronze en croisière, or sous
 * boost, blanc sous super boost, blanc chaud en surge — le même code que la
 * jauge.
 */
import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  ShaderMaterial,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
} from 'three';
import {
  BACK,
  COUNT,
  ITEM_COIN,
  ITEM_FIX,
  ITEM_FUEL,
  ITEM_RIDE,
  ITEM_SUP,
  type Item,
  SEG,
  trackPoint,
  type ThrustTier,
  type Track,
} from '../sim/index.js';

/** Bronze, or, blanc, blanc chaud. Indexé par barreau de poussée, comme `COIN_GAIN`. */
export const COIN_COLOURS = [0xc47a2e, 0xffc24a, 0xdff4ff, 0xfff6d0] as const;

/** Les pièces sont assez fréquentes pour un réservoir profond ; les autres non. */
const COIN_POOL = 40;
const OTHER_POOL = 6;

/** Les objets flottent à cette hauteur au-dessus de la route. */
const HOVER = 2.0;
/**
 * Le bidon, plus haut que les autres : debout il touchait presque la route
 * et se lisait comme un obstacle. Troisième partie, 11 septembre 2026.
 */
const CAN_HOVER = 3.6;

/**
 * Le violet de l'invincibilité, pour ce qui n'est pas le prisme lui-même : le
 * flash, la coque, l'étiquette. Le prisme est un arc-en-ciel animé, et aucune
 * couleur seule ne le résume ; celle-ci est sa dominante, qu'aucune autre chose
 * du jeu ne porte. Les pièces sont bronze à blanc chaud, la réparation verte,
 * le super boost magenta, le drift cyan, le bidon rouge.
 */
export const RIDE_COLOUR = 0x9b6bff;
/**
 * Le rouge d'un bidon. Il était orangé, et se confondait de loin avec l'or des
 * pièces sous boost ; le rouge est la seule teinte chaude que rien d'autre ne
 * porte sur la piste, et c'est celle de la jauge de carburant.
 */
export const FUEL_COLOUR = 0xe8202a;

/**
 * Le prisme : un arc-en-ciel qui tourne sur la surface. La teinte est prise sur
 * la normale de la face et sur la hauteur, décalée par le temps, et passée dans
 * une palette en cosinus — trois phases, une par canal. Un fresnel blanchit les
 * arêtes. `uTime` est la rotation accumulée de la classe, donc remis à zéro par
 * `reset()` avec elle. Le brouillard de la scène est appliqué par les mêmes
 * fragments que les matériaux de three.js, sinon un prisme au loin brillerait
 * à travers le vide.
 */
const PRISM_VS = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vHeight;
  #include <fog_pars_vertex>
  void main() {
    vNormal = normalize(normalMatrix * normal);
    // Nommée ainsi parce que le fragment de brouillard de three.js la lit.
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mvPosition.xyz);
    vHeight = position.y;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const PRISM_FS = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vHeight;
  #include <fog_pars_fragment>
  void main() {
    float t = uTime * 0.35 + vNormal.x * 0.45 + vNormal.y * 0.25 + vHeight * 0.18;
    vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
    float fresnel = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.0);
    vec3 colour = mix(rainbow, vec3(1.0), fresnel * 0.6) * 1.15;
    gl_FragColor = vec4(colour, 1.0);
    #include <fog_fragment>
  }
`;

export class Pickups {
  readonly group = new Group();

  private readonly pools: Object3D[][] = [];
  private readonly coinMaterial: MeshBasicMaterial;
  private readonly prismMaterial: ShaderMaterial;
  private readonly point = trackPoint();
  private spin = 0;

  constructor() {
    this.coinMaterial = new MeshBasicMaterial({ color: COIN_COLOURS[1] });
    this.prismMaterial = new ShaderMaterial({
      vertexShader: PRISM_VS,
      fragmentShader: PRISM_FS,
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true,
    });

    const coinGeometry = new TorusGeometry(1.55, 0.26, 6, 18);
    const fixGeometry = new OctahedronGeometry(1.5);
    const supGeometry = new ConeGeometry(1.4, 3.0, 5);
    // Un diamant : l'octaèdre étiré sur sa hauteur, et non indexé, donc à
    // faces planes — chaque facette porte sa teinte, comme une pierre taillée.
    const prismGeometry = new OctahedronGeometry(1.5).scale(1, 1.75, 1);
    const fixMaterial = new MeshBasicMaterial({ color: 0x35e08a });
    const supMaterial = new MeshBasicMaterial({ color: 0xff2f9a });

    const build: Record<number, () => Object3D> = {
      [ITEM_COIN]: () => new Mesh(coinGeometry, this.coinMaterial),
      [ITEM_FIX]: () => new Mesh(fixGeometry, fixMaterial),
      [ITEM_SUP]: () => {
        const mesh = new Mesh(supGeometry, supMaterial);
        mesh.rotation.x = Math.PI / 2; // la pointe vers l'avant
        return mesh;
      },
      [ITEM_RIDE]: () => new Mesh(prismGeometry, this.prismMaterial),
      [ITEM_FUEL]: () => this.makeCan(),
    };

    for (let type = 0; type < 5; type++) {
      const pool: Object3D[] = [];
      const size = type === ITEM_COIN ? COIN_POOL : OTHER_POOL;
      for (let i = 0; i < size; i++) {
        const grp = new Group();
        grp.add(build[type]!());
        grp.visible = false;
        this.group.add(grp);
        pool.push(grp);
      }
      this.pools.push(pool);
    }
  }

  /* Partagés entre les bidons du réservoir : une géométrie et un matériau par pièce. */
  private readonly canBody = new CylinderGeometry(1.1, 1.1, 2.6, 10);
  private readonly canCap = new CylinderGeometry(0.5, 0.65, 0.5, 8);
  private readonly canMaterial = new MeshBasicMaterial({ color: FUEL_COLOUR });
  private readonly canTrim = new MeshBasicMaterial({ color: 0x3a0a0e });

  /**
   * Un bidon : un cylindre debout et un goulot, rien d'autre. Il portait deux
   * cerclages sombres, et c'était plus de détail que n'importe quel autre
   * objet de la piste — chacun est une seule forme pleine d'une seule couleur,
   * et il tranchait. Le goulot reste, c'est lui qui fait la bouteille : une
   * silhouette verticale se lit de loin, une boîte se confondait avec une
   * pièce vue de côté.
   */
  private makeCan(): Object3D {
    const can = new Group();
    can.add(new Mesh(this.canBody, this.canMaterial));
    const cap = new Mesh(this.canCap, this.canTrim);
    cap.position.y = 1.55;
    can.add(cap);
    return can;
  }

  /**
   * Abandonne la rotation accumulée, pour qu'une frame après une remise à zéro
   * soit reproductible. Sans cela les objets restent à l'angle où les frames
   * précédentes les ont laissés, c'est-à-dire autant de frames que la page a
   * mis à charger. Le prisme lit le même compteur, donc il repart avec.
   */
  reset(): void {
    this.spin = 0;
  }

  /**
   * @param tier barreau de poussée courant, 0 à 3. Pilote couleur et taille.
   * @param frameDt vrai delta de frame : la rotation est de la décoration.
   */
  update(track: Track, cursor: number, tier: ThrustTier, frameDt: number): void {
    this.spin += frameDt * (2.6 + tier * 1.6);
    this.coinMaterial.color.setHex(COIN_COLOURS[tier]);
    this.prismMaterial.uniforms.uTime!.value = this.spin;
    this.coinScale = 1 + tier * 0.16;
    this.used.fill(0);
    this.base = track.nid[0]!;

    // Les deux listes se dessinent pareil ; la seconde est celle des extras.
    // Deux boucles et pas une concaténation : un tableau par frame est ce que
    // la règle d'allocation interdit.
    for (const item of track.items) this.place(item, track, cursor);
    for (const item of track.extras) this.place(item, track, cursor);

    for (let type = 0; type < this.pools.length; type++) {
      const pool = this.pools[type]!;
      for (let k = this.used[type]!; k < pool.length; k++) pool[k]!.visible = false;
    }
  }

  /* État de la frame en cours, tenu sur l'instance pour ne rien allouer. */
  private readonly used = [0, 0, 0, 0, 0];
  private base = 0;
  private coinScale = 1;

  private place(item: Item, track: Track, cursor: number): void {
    // Les objets pris disparaissent aussitôt ; les autres restent dessinés
    // jusqu'à sortir de portée.
    if (item.taken) return;
    const i = item.id - this.base;
    if (i < 0 || i >= COUNT - 1) return;

    const pool = this.pools[item.type]!;
    if (this.used[item.type]! >= pool.length) return;
    const grp = pool[this.used[item.type]!++]!;

    const s = track.sample(cursor, (i - BACK) * SEG - cursor, this.point);
    const hover = item.type === ITEM_FUEL ? CAN_HOVER : HOVER;
    grp.visible = true;
    grp.position.set(
      s.x + s.rx * item.lat + s.ux * hover,
      s.y + s.ry * item.lat + s.uy * hover,
      s.z + s.rz * item.lat + s.uz * hover,
    );
    grp.rotation.set(0, s.yaw, s.bank, 'YXZ');

    const mesh = grp.children[0]!;
    if (item.type === ITEM_COIN) {
      grp.scale.setScalar(this.coinScale);
      mesh.rotation.z = 0;
      mesh.rotation.y = this.spin * 0.5;
    } else if (item.type === ITEM_RIDE || item.type === ITEM_FUEL) {
      // Debout, ils tournent sur leur axe comme une pièce : culbuter un bidon
      // ou un diamant les rendrait illisibles.
      mesh.rotation.z = 0;
      mesh.rotation.y = this.spin * (item.type === ITEM_RIDE ? 0.8 : 0.5);
    } else {
      mesh.rotation.z = this.spin;
    }
  }
}
