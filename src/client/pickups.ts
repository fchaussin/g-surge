/**
 * Coins, repairs and super boosts, drawn from a pool.
 *
 * The simulation owns which pickups exist and where; this only decides how
 * they look. Meshes are allocated once and reused — a run collects thousands
 * of coins and creating a mesh per coin would hand the collector a job every
 * few seconds.
 *
 * Coin colour follows the speed tier, which is the whole point of the tiers
 * being visible at all: bronze under 500 km/h, gold to 1000, white above.
 */
import {
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  TorusGeometry,
} from 'three';
import { BACK, COUNT, ITEM_COIN, ITEM_SUP, SEG, trackPoint, type Track } from '../sim/index.js';

/** Bronze, gold, white. Indexed by speed tier, same order as `COIN_GAIN`. */
export const COIN_COLOURS = [0xc47a2e, 0xffc24a, 0xdff4ff] as const;

/** Coins are common enough to need a deep pool; the other two are not. */
const COIN_POOL = 40;
const OTHER_POOL = 6;

/** Pickups float this far above the road surface. */
const HOVER = 2.0;

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
    ];
    this.coinMaterial = new MeshBasicMaterial({ color: COIN_COLOURS[1] });
    const materials = [
      this.coinMaterial,
      new MeshBasicMaterial({ color: 0x35e08a }),
      new MeshBasicMaterial({ color: 0xff2f9a }),
    ];

    for (let type = 0; type < 3; type++) {
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
   * Drops the accumulated spin, so a frame after a reset is reproducible.
   * Without it, pickups sit at whatever angle the frames before the reset left
   * them, which is exactly as many frames as the page happened to take to load.
   */
  reset(): void {
    this.spin = 0;
  }

  /**
   * @param tier current coin tier, 0 to 2. Drives colour and size.
   * @param frameDt real frame delta: the spin is decoration.
   */
  update(track: Track, cursor: number, tier: 0 | 1 | 2, frameDt: number): void {
    this.spin += frameDt * (2.6 + tier * 1.6);
    this.coinMaterial.color.setHex(COIN_COLOURS[tier]);
    const coinScale = 1 + tier * 0.16;

    const used = [0, 0, 0];
    const base = track.nid[0]!;

    for (const item of track.items) {
      // Taken ones vanish at once; the rest stay drawn until they leave range.
      if (item.taken) continue;
      const i = item.id - base;
      if (i < 0 || i >= COUNT - 1) continue;

      const pool = this.pools[item.type]!;
      if (used[item.type]! >= pool.length) continue;
      const grp = pool[used[item.type]!++]!;

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
        grp.scale.setScalar(coinScale);
        mesh.rotation.z = 0;
        mesh.rotation.y = this.spin * 0.5;
      } else {
        mesh.rotation.z = this.spin;
      }
    }

    for (let type = 0; type < 3; type++) {
      const pool = this.pools[type]!;
      for (let k = used[type]!; k < pool.length; k++) pool[k]!.visible = false;
    }
  }
}
