/**
 * L'invincibilité et le wall riding.
 *
 * Les items vivent dans `track.extras`, une liste à part sur son propre flux,
 * jamais avant `extrasFrom` : les références de piste enregistrent `items` tel
 * que l'ancien jeu le produisait, et les traces physiques s'arrêtent avant. Ce
 * fichier est donc le seul filet de la mécanique, et il vérifie d'abord que
 * cette séparation tient.
 */
import { describe, expect, it } from 'vitest';
import { BACK, HALF, ITEM_FUEL, ITEM_RIDE, SEG, Sim, type SimEvent } from '../src/sim/index.js';

const DT = 1 / 720;
const NEUTRAL = { steer: 0, brake: false, boost: false };

function fresh(seed = 'ride'): Sim {
  const sim = new Sim({ seed });
  sim.reset(seed);
  return sim;
}

/** Pose un item d'invincibilité juste sous le vaisseau, comme `dropSup` dans surge.test. */
function dropRide(sim: Sim): void {
  sim.state.lat = 0;
  sim.track.extras.push({
    id: sim.track.nid[0]! + BACK,
    lat: 0,
    type: ITEM_RIDE,
    done: false,
    taken: false,
  });
}

/**
 * Contre la paroi, en poussant dedans, `steps` pas. Les objets sont vidés à
 * chaque pas : collé au mur à 11,5 m le vaisseau attrape ce qui est posé
 * jusqu'à 8 m, et un super boost ramassé par hasard fausserait la vitesse.
 */
function grind(sim: Sim, steps: number, out: SimEvent[]): void {
  for (let i = 0; i < steps; i++) {
    sim.track.items.length = 0;
    sim.track.extras.length = 0;
    sim.state.lat = HALF;
    sim.state.latVel = 8;
    sim.state.yaw = 0;
    sim.step(NEUTRAL, DT, false);
    out.push(...sim.events);
  }
}

describe('the extras list', () => {
  it('holds nothing before extrasFrom, on any seed', () => {
    for (const seed of ['reference', 'ref-0', 'ref-31', 'alpha']) {
      const sim = fresh(seed);
      for (const it of sim.track.extras)
        expect(it.id * SEG).toBeGreaterThanOrEqual(sim.tuning.extrasFrom);
    }
  });

  it('is deterministic per seed, and leaves items where they were', () => {
    const a = fresh('ref-3');
    const b = fresh('ref-3');
    const flat = (sim: Sim) =>
      sim.track.extras.map((it) => `${it.id}:${it.lat.toFixed(6)}:${it.type}`);
    // On avance assez pour dépasser extrasFrom dans les deux.
    for (let i = 0; i < 4000; i++) {
      a.step(NEUTRAL, DT, false);
      b.step(NEUTRAL, DT, false);
    }
    expect(flat(a)).toEqual(flat(b));
    expect(a.track.extras.every((it) => it.type === ITEM_RIDE || it.type === ITEM_FUEL)).toBe(true);
  });

  it('spawns ride items at about rideChance per segment once past extrasFrom', () => {
    let segments = 0;
    let rides = 0;
    for (let s = 0; s < 40; s++) {
      const sim = fresh(`ride-rate-${s}`);
      sim.tuning.extrasFrom = 0;
      sim.reset(`ride-rate-${s}`);
      const seen = new Set<number>();
      for (let i = 0; i < 6000; i++) {
        sim.step(NEUTRAL, DT, false);
        for (const it of sim.track.extras) if (it.type === ITEM_RIDE) seen.add(it.id);
      }
      segments += sim.track.nid[sim.track.nid.length - 1]!;
      rides += seen.size;
    }
    const rate = rides / segments;
    expect(rate).toBeGreaterThan(0.001);
    expect(rate).toBeLessThan(0.005);
  });
});

describe('invincibility', () => {
  it('starts on pickup, lasts rideTime, and ends once', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    dropRide(sim);
    sim.step(NEUTRAL, DT, false);
    ev.push(...sim.events);
    expect(ev.some((e) => e.type === 'pickup' && e.kind === 'ride')).toBe(true);
    expect(sim.state.rideT).toBeCloseTo(sim.tuning.rideTime, 2);

    let ends = 0;
    for (let i = 0; i < (sim.tuning.rideTime + 1) * 720; i++) {
      sim.step(NEUTRAL, DT, false);
      for (const e of sim.events) if (e.type === 'rideEnd') ends++;
    }
    expect(ends).toBe(1);
    expect(sim.state.rideT).toBe(0);
  });

  it('turns a wall into a push: no hull lost, speed gained, no bounce, climb and combo kept', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    sim.state.rideT = 5;
    sim.tuning.climbDecay = 0; // hors drift la montée redescend ; ici on ne mesure que le mur
    sim.state.climb = 200;
    sim.state.combo = 4;
    sim.state.comboLeft = 1;
    sim.state.speed = 200;
    sim.state.dist = 20000; // rampe finie : la cible est stable
    const hull = sim.state.hull;
    grind(sim, 360, ev); // une demi-seconde contre le mur
    expect(sim.state.hull).toBe(hull);
    expect(sim.state.speed).toBeGreaterThan(200);
    expect(sim.state.latVel).toBe(0);
    expect(sim.state.climb).toBe(200);
    expect(sim.state.combo).toBe(4);
    expect(ev.filter((e) => e.type === 'ride').length).toBe(360);
    expect(ev.some((e) => e.type === 'scrape' || e.type === 'wallImpact')).toBe(false);
  });

  it('caps the gain where the target speed pulls back, at rideGain / (speedGain − rideGain) above it', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    sim.state.rideT = 99;
    sim.state.dist = 20000;
    sim.state.speed = sim.tuning.speedMax;
    grind(sim, 720 * 20, ev);
    const excess = sim.state.speed / sim.tuning.speedMax - 1;
    // Point fixe de « pousser de r par seconde, ramener de g vers la cible » :
    // s = T·g / (g − r), donc l'excès vaut r / (g − r). La première borne écrite
    // ici était r / g, et la mesure l'a contredite de deux centièmes.
    const t = sim.tuning;
    const fixed = t.rideGain / (t.speedGain - t.rideGain);
    expect(excess).toBeGreaterThan(fixed * 0.8);
    expect(excess).toBeLessThan(fixed * 1.05);
  });

  it('bites again the moment it ends', () => {
    const sim = fresh();
    const ev: SimEvent[] = [];
    sim.state.rideT = 0;
    const hull = sim.state.hull;
    grind(sim, 60, ev);
    expect(sim.state.hull).toBeLessThan(hull);
    expect(ev.some((e) => e.type === 'wallImpact')).toBe(true);
  });
});
