/**
 * Mesure, pas test : combien la montée rend, par difficulté, avec un pilote
 * scripté. Ne tourne qu'avec `MEASURE=1` — `npm run measure:ladder` — et ne
 * vérifie rien, elle imprime. Les chiffres servent les arbitrages de
 * docs/TODO.md ; ils sont une borne basse, le pilote ne vise pas les objets.
 */
import { describe, it } from 'vitest';
import { runPilot } from './helpers/pilot.js';

const SECONDS = 300;
const SEEDS = ['ladder-a', 'ladder-b', 'ladder-c'];
const DIFFS = ['easy', 'medium', 'hard'] as const;

describe.skipIf(!process.env.MEASURE)('the ladder, as a scripted pilot climbs it', () => {
  it('prints what five minutes per seed and difficulty yield', () => {
    const rows: string[] = [];
    for (const difficulty of DIFFS) {
      for (const aggressiveness of [0.5, 0.7]) {
        let earned = 0;
        let found = 0;
        let surges = 0;
        let walls = 0;
        let drift = 0;
        let seconds = 0;
        let peak = 0;
        let wrecks = 0;
        let dry = 0;
        let comboPeak = 0;
        const tiers = [0, 0, 0, 0];
        for (const seed of SEEDS) {
          const s = runPilot({ seed, difficulty, seconds: SECONDS, aggressiveness });
          earned += s.supEarned;
          found += s.supFound;
          surges += s.surges;
          walls += s.walls;
          drift += s.driftSeconds;
          seconds += s.seconds;
          peak = Math.max(peak, s.climbPeak);
          if (s.wrecked) wrecks++;
          dry += s.drySeconds;
          comboPeak = Math.max(comboPeak, s.comboPeak);
          for (let t = 0; t < 4; t++) tiers[t]! += s.tierSeconds[t]!;
        }
        const per10 = (n: number) => ((n * 600) / seconds).toFixed(1);
        const alive = (seconds / SEEDS.length).toFixed(0);
        const pct = (n: number) => `${((n / seconds) * 100).toFixed(0)}%`;
        rows.push(
          `| ${difficulty} | ${aggressiveness} | ${per10(earned)} | ${per10(found)} | ${per10(surges)} | ` +
            `${per10(walls)} | ${pct(drift)} | ${pct(tiers[1]!)} / ${pct(tiers[2]!)} / ${pct(tiers[3]!)} | ` +
            `${(peak * 100).toFixed(0)}% | ${wrecks}/${SEEDS.length} | ${alive} s | ${pct(dry)} | ${comboPeak} |`,
        );
      }
    }
    console.log(
      [
        '',
        `Per ten minutes of driving, ${SEEDS.length} seeds × ${SECONDS} s each (or until wrecked):`,
        '| difficulty | aggr. | earned | found | surges | walls | drift | tier 1/2/3 | climb peak | wrecks | alive | dry | combo |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        ...rows,
        '',
      ].join('\n'),
    );
  });
});
