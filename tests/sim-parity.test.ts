/**
 * Le noyau TypeScript doit reproduire le jeu au chiffre près.
 *
 * Les références de tests/e2e/fixtures/ ont été capturées dans le navigateur,
 * sur legacy/engine.js et legacy/game.js, avant tout portage. Ce fichier les
 * rejoue dans Node contre src/sim/. C'est la seule preuve que l'extraction n'a
 * rien changé : elles n'ont pas été régénérées depuis, et ne doivent pas l'être
 * pour faire passer ce test.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Sim, trackPoint } from '../src/sim/index.js';
import type { Difficulty } from '../src/sim/index.js';
import { digest } from './helpers/digest.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'e2e', 'fixtures');
const UPDATE = !!process.env.UPDATE_FIXTURES;

/**
 * Compares against a frozen reference, or writes it when asked.
 *
 * The generator lives here rather than in a browser test because `src/sim/`
 * is the source of truth: the reference should say what the core does, and the
 * browser suite then checks that the shipped bundle agrees. It used to be the
 * other way round, back when the legacy was the reference — and deleting that
 * spec at the switch quietly removed the only way to regenerate anything.
 *
 * `npm run fixtures:update`. Not a routine command: a reference that moves is
 * a change of behaviour and needs a commit that says which and why.
 */
function matchFixture(name: string, value: unknown): void {
  const path = join(FIXTURES, `${name}.json`);
  const serialised = `${JSON.stringify(value, null, 2)}\n`;
  if (UPDATE || !existsSync(path)) {
    writeFileSync(path, serialised);
    return;
  }
  expect(JSON.parse(serialised)).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Round-trips a value through JSON before comparing it to a fixture.
 *
 * The references are JSON, and JSON has no negative zero: the legacy writes
 * `-0` for a flat gradient at cursor zero and the file stores `0`. Comparing a
 * live `-0` against a parsed `0` fails under `Object.is`, which is what
 * `toEqual` uses. Both sides therefore go through the same lossy step, exactly
 * as `matchFixture` does on the Playwright side.
 */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Miroir exact de `__gs.nodes()` et `__gs.items()` côté jeu. */
function readTrack(sim: Sim) {
  return {
    seed: sim.seed,
    nodes: {
      k: Array.from(sim.track.nk),
      g: Array.from(sim.track.ng),
      b: Array.from(sim.track.nb),
      id: Array.from(sim.track.nid),
    },
    items: sim.track.items.map((it) => ({ id: it.id, lat: it.lat, type: it.type })),
  };
}

/** Miroir exact de `__gs.trace()` côté jeu, y compris l'arrêt à l'épave. */
function trace(opts: {
  seed: string;
  diff?: Difficulty;
  steps?: number;
  dt?: number;
  every?: number;
  script?: Array<{ from: number; steer?: number; brake?: boolean; boost?: boolean }>;
}) {
  const steps = opts.steps ?? 1200;
  const dt = opts.dt ?? 1 / 120;
  const every = opts.every ?? 60;
  const script = opts.script ?? [];
  const diff = opts.diff ?? 'easy';

  const sim = new Sim({ seed: opts.seed, difficulty: diff });
  sim.setDifficulty(diff);
  sim.reset(opts.seed);

  const s = sim.state;
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const snap = (i: number) => ({
    i,
    dist: r6(s.dist), travel: r6(s.travel), cursor: r6(s.cursor),
    speed: r6(s.speed), lat: r6(s.lat), latVel: r6(s.latVel),
    yaw: r6(s.yaw), hop: r6(s.hop), vyRel: r6(s.vyRel),
    energy: r6(s.energy), hull: r6(s.hull),
    mult: r6(s.mult), score: r6(s.score), coins: s.coins,
    air: s.air, drift: s.drift, wrecked: s.wrecked,
  });

  let si = 0;
  let cur: { from: number; steer?: number; brake?: boolean; boost?: boolean } = { from: 0 };
  const frames = [snap(-1)];
  let last = -1;
  for (let i = 0; i < steps; i++) {
    while (si < script.length && script[si]!.from <= i) cur = script[si++]!;
    sim.step({ steer: cur.steer ?? 0, brake: !!cur.brake, boost: !!cur.boost }, dt, false);
    last = i;
    if (s.wrecked) {
      frames.push(snap(i));
      break;
    }
    if ((i + 1) % every === 0 || i === steps - 1) frames.push(snap(i));
  }
  return { seed: sim.seed, diff, steps, ran: last + 1, dt, wrecked: s.wrecked, frames };
}

/** Le même que celui du script de trace, à garder synchronisé avec la spec e2e. */
const REFERENCE_SCRIPT = [
  { from: 0, steer: 0, brake: false, boost: false },
  { from: 240, steer: 0.18, brake: false, boost: true },
  { from: 600, steer: -0.22, brake: false, boost: true },
  { from: 900, steer: 0.1, brake: false, boost: false },
  { from: 1200, steer: -0.12, brake: true, boost: false },
  { from: 1500, steer: 0.06, brake: false, boost: true },
];

describe('parité du noyau avec le jeu', () => {
  it('régénère la piste de référence, nœud par nœud', () => {
    const sim = new Sim({ seed: 'reference', difficulty: 'easy' });
    sim.reset('reference');
    matchFixture('track-reference', asJson(readTrack(sim)));
  });

  it('régénère les soixante pistes de référence', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `ref-${i}`);
    const got: Record<string, string> = {};
    for (const seed of seeds) {
      const sim = new Sim({ seed, difficulty: 'easy' });
      sim.reset(seed);
      got[seed] = digest(readTrack(sim));
    }
    matchFixture('track-checksums', got);
  });

  for (const diff of ['easy', 'medium', 'hard'] as const) {
    it(`rejoue la trace de physique en ${diff}`, () => {
      const got = trace({
        seed: 'reference',
        diff,
        steps: 1800,
        every: 120,
        script: REFERENCE_SCRIPT,
      });
      matchFixture(`physics-${diff}`, asJson(got));
    });
  }
});

describe('la géométrie du ruban portée dans le noyau', () => {
  /** Les mêmes distances que `__gs.path` côté jeu. */
  const AT = [-19, -6, 0, 12, 22, 46, 120, 600, 1400];

  it('reproduit le ruban intégré et ses échantillons', () => {
    const sim = new Sim({ seed: 'geometry', difficulty: 'easy' });
    sim.reset('geometry');

    // Même arrondi que la capture. Math.cos rend un dernier bit différent sous
    // le V8 de Chromium et celui de Node — vérifié, sin non, cos oui — donc une
    // référence prise dans un navigateur ne peut pas être rejouée ici au bit
    // près. Voir TECH-DEBT.md section 17.
    const r = (v: number) => Math.round(v * 1e9) / 1e9;
    const ra = (a: Float32Array) => Array.from(a, r);

    const point = trackPoint();
    const got = [0, 0.37, 4.5, 11.9].map((cursor) => {
      sim.track.buildPath(cursor);
      return {
        cursor,
        px: ra(sim.track.px), py: ra(sim.track.py),
        pz: ra(sim.track.pz), pyaw: ra(sim.track.pyaw),
        samples: AT.map((d) => {
          const o = sim.track.sample(cursor, d, point);
          return {
            d, x: r(o.x), y: r(o.y), z: r(o.z), yaw: r(o.yaw), bank: r(o.bank),
            rx: r(o.rx), ry: r(o.ry), rz: r(o.rz), ux: r(o.ux), uy: r(o.uy), uz: r(o.uz),
          };
        }),
        grades: AT.map((d) => r(sim.track.gradeAt(cursor, d))),
      };
    });

    matchFixture('track-geometry', asJson(got));
  });

  it('réutilise le point fourni au lieu d\'allouer', () => {
    const sim = new Sim({ seed: 'alloc', difficulty: 'easy' });
    sim.reset('alloc');
    sim.track.buildPath(0);
    const point = trackPoint();
    expect(sim.track.sample(0, 10, point)).toBe(point);
  });
});

describe('le noyau raconte ce qu\'il fait', () => {
  it('émet des événements au lieu de jouer des sons', () => {
    const sim = new Sim({ seed: 'evenements', difficulty: 'easy' });
    sim.reset('evenements');

    const seen = new Set<string>();
    for (let i = 0; i < 6000; i++) {
      sim.step({ steer: i % 900 < 450 ? 0.9 : -0.9, brake: false, boost: true }, 1 / 120);
      for (const e of sim.events) seen.add(e.type === 'pickup' ? `pickup:${e.kind}` : e.type);
      if (sim.state.wrecked) break;
    }

    // Un pilotage à grands coups de manche finit forcément au mur, et le mur
    // produit d'abord un choc franc puis du frottement.
    expect(seen).toContain('wallImpact');
    expect(seen).toContain('scrape');
    expect(seen.size).toBeGreaterThan(2);
  });

  it('ne signale l\'épave qu\'une fois', () => {
    const sim = new Sim({ seed: 'epave', difficulty: 'hard' });
    sim.reset('epave');

    let wrecks = 0;
    for (let i = 0; i < 8000; i++) {
      sim.step({ steer: i % 300 < 150 ? 1 : -1, brake: false, boost: true }, 1 / 120);
      wrecks += sim.events.filter((e) => e.type === 'wreck').length;
    }
    expect(sim.state.wrecked).toBe(true);
    expect(wrecks).toBe(1);
  });
});

/*
 * Limite de résolution, mesurée et non supposée.
 *
 * Les instantanés sont arrondis à 1e-6, et les valeurs brutes elles-mêmes ne
 * divergent pas toujours : intervertir les deux termes latéraux de `step`, une
 * réassociation flottante pure, décale `latVel` d'environ 4e-16 au bout de 1800
 * pas, sans s'amplifier — la dynamique est contractante à cet endroit. Cette
 * référence attrape donc les changements de comportement, pas les
 * réécritures numériquement équivalentes. C'est ce qu'on lui demande, mais il
 * faut le savoir avant de conclure d'un test vert qu'un pas de temps fixe ou un
 * changement d'ordre d'intégration sont sans effet : ceux-là, eux, divergent.
 */
