/**
 * Pièces, réparations et super boosts, tirés d'un réservoir.
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
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  TorusGeometry,
} from 'three';
import {
  BACK,
  COUNT,
  ITEM_COIN,
  ITEM_SUP,
  type Item,
  SEG,
  trackPoint,
  type ThrustTier,
  type Track,
} from '../sim/index.js';

/** Bronze, or, blanc, blanc chaud. Indexé par barreau de poussée, comme `COIN_GAIN`. */
export const COIN_COLOURS = [0xc47a2e, 0xffc24a, 0xdff4ff, 0xfff6d0] as const;

/** Les pièces sont assez fréquentes pour un réservoir profond ; les deux autres non. */
const COIN_POOL = 40;
const OTHER_POOL = 6;

/** Les objets flottent à cette hauteur au-dessus de la route. */
const HOVER = 2.0;

/**
 * Le violet de l'invincibilité : aucune autre chose du jeu ne le porte. Les
 * pièces sont bronze à blanc chaud, la réparation verte, le super boost magenta,
 * le drift cyan ; un item qui rend les murs inoffensifs devait avoir sa teinte.
 */
export const RIDE_COLOUR = 0x9b6bff;
/** L'orangé d'un bidon : chaud comme l'or des pièces, mais la forme fait le reste — une caisse, pas un anneau. */
export const FUEL_COLOUR = 0xff9f1a;

export class Pickups {
  readonly group = new Group();

  private readonly pools: Object3D[][] = [];
  private readonly coinMaterial: MeshBasicMaterial;
  private readonly point = trackPoint();
  private spin = 0;

  constructor() {
    const geometries = [
      new TorusGeometry(1.55, 0.26, 6, 18),
      new OctahedronGeometry(1.5),
      new ConeGeometry(1.4, 3.0, 5),
      // Un anneau épais : un bouclier qu'on traverse, pas une pièce qu'on prend.
      new TorusGeometry(1.35, 0.5, 8, 16),
      // Un bidon : une caisse, la seule forme anguleuse posée sur la piste.
      new BoxGeometry(1.7, 2.2, 1.7),
    ];
    this.coinMaterial = new MeshBasicMaterial({ color: COIN_COLOURS[1] });
    const materials = [
      this.coinMaterial,
      new MeshBasicMaterial({ color: 0x35e08a }),
      new MeshBasicMaterial({ color: 0xff2f9a }),
      new MeshBasicMaterial({ color: RIDE_COLOUR }),
      new MeshBasicMaterial({ color: FUEL_COLOUR }),
    ];

    for (let type = 0; type < 5; type++) {
      const pool: Object3D[] = [];
      const size = type === ITEM_COIN ? COIN_POOL : OTHER_POOL;
      for (let i = 0; i < size; i++) {
        const grp = new Group();
        const mesh = new Mesh(geometries[type], materials[type]);
        if (type === ITEM_SUP) mesh.rotation.x = Math.PI / 2; // point it forwards
        grp.add(mesh);
        grp.visible = false;
        this.group.add(grp);
        pool.push(grp);
      }
      this.pools.push(pool);
    }
  }

  /**
   * Abandonne la rotation accumulée, pour qu'une frame après une remise à zéro
   * soit reproductible. Sans cela les objets restent à l'angle où les frames
   * précédentes les ont laissés, c'est-à-dire autant de frames que la page a
   * mis à charger.
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
    grp.visible = true;
    grp.position.set(
      s.x + s.rx * item.lat + s.ux * HOVER,
      s.y + s.ry * item.lat + s.uy * HOVER,
      s.z + s.rz * item.lat + s.uz * HOVER,
    );
    grp.rotation.set(0, s.yaw, s.bank, 'YXZ');

    const mesh = grp.children[0]!;
    if (item.type === ITEM_COIN) {
      grp.scale.setScalar(this.coinScale);
      mesh.rotation.z = 0;
      mesh.rotation.y = this.spin * 0.5;
    } else {
      mesh.rotation.z = this.spin;
    }
  }
}
