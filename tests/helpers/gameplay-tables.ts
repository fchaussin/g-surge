/**
 * The parts of `docs/GAMEPLAY.md` that are arithmetic on the tuning tables.
 *
 * This document existed for months carrying a row that was simply wrong — a
 * ratio divided by a figure that appeared nowhere in the code — because every
 * number in it was typed by hand and nothing could contradict it. Anything
 * derivable is now computed here and checked by a test, so the document cannot
 * drift from `src/sim/tuning.ts` again.
 *
 * What is deliberately *not* generated: prose, design intent, and the two
 * tables that depended on how someone happened to be driving. A number that
 * needs a play policy to be true does not belong in a reference.
 */
import {
  clamp,
  COUNT,
  BACK,
  SEG,
  COIN_GAIN,
  DIFF,
  tuningFor,
  type Difficulty,
  type Tuning,
} from '../../src/sim/index.js';

/** Assumed lateral closing speed for the "average impact", in m/s. */
const TYPICAL_IMPACT = 12;

const kmh = (ms: number) => Math.round(ms * 3.6);

/**
 * Wraps prose at the width this repository writes at.
 *
 * Generated text still has to be read in a diff, and a paragraph that rewraps
 * differently every time a number gains a digit makes every change look
 * larger than it is.
 */
function wrap(text: string, width = 79, indent = ''): string {
  const out: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line.trim() && line.length + 1 + word.length > width) {
      out.push(line);
      line = indent + word;
    } else {
      line = line.trim() ? `${line} ${word}` : indent + word;
    }
  }
  if (line.trim()) out.push(line);
  return out.join('\n');
}
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Tightest corner the generator will draw at a given speed, and its radius. */
function tightestCorner(t: Tuning, speed: number) {
  const v2 = Math.max(3600, speed * speed);
  const k = clamp(t.curveLoad / (v2 * t.centri), t.curveMin, t.curveMax);
  const load = k * v2 * t.centri;
  // Banking is the balance angle for that load, so part of the push is taken
  // by the track itself and never reaches the driver.
  const bank = clamp(-Math.atan(load / 9.81) * t.bankScale, -1.25, 1.25);
  const assist = 9.81 * Math.abs(Math.sin(bank)) * t.bankAssist;
  return { radius: 1 / k, load, net: load - assist };
}

/** Maximum yaw the stick can command at a given speed, in radians. */
const yawMax = (t: Tuning, speed: number) =>
  clamp((t.yawBase * t.yawSpeedRef) / Math.max(40, speed), t.yawMin, t.yawBase);

export function speedTiers(t: Tuning): string {
  const rows = [
    ['1', `under ${kmh(t.coinTier2)} km/h`, 'bronze', COIN_GAIN[0]],
    ['2', `${kmh(t.coinTier2)} to ${kmh(t.coinTier3)}`, 'gold', COIN_GAIN[1]],
    ['3', `above ${kmh(t.coinTier3)}`, 'white', COIN_GAIN[2]],
  ] as const;
  return [
    '| Tier | Speed | Coin colour | Multiplier gain |',
    '|---|---|---|---|',
    ...rows.map(([n, s, c, g]) => `| ${n} | ${s} | ${c} | +${g} |`),
    '',
    wrap(
      `Top speed without boost is ${kmh(t.speedMax)} km/h, and boost takes it to ` +
        `${kmh(t.speedMax * t.boostFactor)}, so tier 3 requires boosting. Boost is fed ` +
        'by drifting. That is the intended loop: **drift to charge, boost to score**.',
    ),
  ].join('\n');
}

export function difficulties(): string {
  const levels: Difficulty[] = ['easy', 'medium', 'hard'];
  const cols = levels.map((d) => {
    const t = tuningFor(d);
    const corner = tightestCorner(t, t.speedMax);
    const impact = clamp(t.hullImpact * TYPICAL_IMPACT, 2, 42);
    return {
      radius: `${corner.radius.toFixed(0)} m`,
      load: `${corner.net.toFixed(1)} m/s²`,
      grip: `${t.gripLimit}`,
      share: `${Math.round((100 * corner.net) / t.gripLimit)} %`,
      ramp: `${(t.speedRamp / 1000).toFixed(0)} km`,
      impact: `${impact.toFixed(0)} pts`,
      repair: `${(impact / t.hullRegen).toFixed(0)} s`,
      score: `×${DIFF[d].mul.toFixed(2)}`,
    };
  });
  const row = (label: string, pick: (c: (typeof cols)[number]) => string) =>
    `| ${label} | ${cols.map(pick).join(' | ')} |`;

  return [
    '| | Easy | Medium | Hard |',
    '|---|---|---|---|',
    row('Tightest corner at top speed', (c) => c.radius),
    row('Its load, banking deducted', (c) => c.load),
    row('Grip threshold, `gripLimit`', (c) => c.grip),
    row('Share of grip that corner demands', (c) => c.share),
    row('Distance to top speed', (c) => c.ramp),
    row(`Impact at ${TYPICAL_IMPACT} m/s closing`, (c) => c.impact),
    row('Time to repair it', (c) => c.repair),
    row('Score coefficient', (c) => c.score),
  ].join('\n');
}

export function handling(t: Tuning): string {
  const boosted = t.speedMax * t.boostFactor;
  const at = (v: number) => `${deg(yawMax(t, v)).toFixed(1)}° at ${kmh(v)} km/h`;

  // At the top of the range `yawMax` scales as 1/v, so the authority the stick
  // commands is almost constant — which is why it is quoted as one figure.
  const authority = Math.sin(yawMax(t, t.speedMax)) * t.speedMax * t.gripHold;
  const full = Math.sin(yawMax(t, boosted)) * boosted * t.gripHold;

  return [
    wrap(
      'The stick commands a **yaw angle**, not a lateral force. Maximum yaw ' +
        `shrinks with speed: ${at(100)}, ${at(t.speedMax)}, ${at(boosted)}. The ` +
        'trajectory then swings towards the nose at a rate set by `gripHold`.',
    ),
    '',
    wrap(
      'Two time constants in series, `1/yawResponse` = ' +
        `${(1 / t.yawResponse).toFixed(2)} s and \`1/gripHold\` = ` +
        `${(1 / t.gripHold).toFixed(2)} s. That lag is the whole feel of the vehicle. ` +
        'Raising `gripHold` makes it darty, lowering it makes it a barge.',
    ),
    '',
    wrap(
      '**Drift** starts when the demanded lateral acceleration exceeds ' +
        `\`gripLimit\`, ${t.gripLimit} m/s². Full lock at boosted speed demands ` +
        `${full.toFixed(0)}, half lock ${(full / 2).toFixed(0)}, so the driver decides ` +
        `when to break traction. Steering authority is about ${authority.toFixed(0)} m/s² ` +
        'and barely moves with speed. During a drift `gripDrift` replaces `gripHold`, ' +
        'the ship slides wide, and the boost reserve refills at `driftCharge` = ' +
        `${t.driftCharge} points per second against a passive ${t.boostRecharge}.`,
    ),
  ].join('\n');
}

export function damage(t: Tuning): string {
  return [
    '| Event | Cost |',
    '|---|---|',
    `| Impact | \`hullImpact\` × lateral closing speed, clamped 2 to 42 |`,
    `| Scraping | ${t.hullScrape} per second |`,
    `| Bad landing off track | 18 points, plus ${Math.round(t.badLanding * 100)} % of speed |`,
    `| Passive repair | ${t.hullRegen} per second |`,
    `| Repair pickup | \`fixAmount\`, ${t.fixAmount} points |`,
    '',
    wrap(
      `Damage reduces top speed by up to ${Math.round(t.damageSpeed * 100)} %, steering ` +
        `by ${Math.round(t.damageSteer * 100)} % and halves boost recharge. At zero the ` +
        'run ends.',
    ),
  ].join('\n');
}

export function constants(t: Tuning): string {
  const boosted = t.speedMax * t.boostFactor;
  const period = t.stripeEvery * SEG;
  const perFrame = boosted / 60;
  const draw = (COUNT - BACK) * SEG;
  return [
    wrap(
      '- **Chevron period must stay above twice the per frame travel.** At ' +
        `${boosted.toFixed(0)} m/s and 60 fps that is ${(perFrame * 2).toFixed(1)} m, ` +
        `hence \`stripeEvery: ${t.stripeEvery}\` for a ${period} m period. Below that ` +
        'the track visually decomposes and no amount of GPU fixes it.',
      77,
      '',
    ).replace(/\n(?!-)/g, '\n  '),
    wrap(
      `- **Draw distance is ${draw} m**, which is ${(draw / boosted).toFixed(1)} seconds ` +
        'at full boost. Raising top speed without raising `COUNT` will make the track ' +
        'pop in.',
      77,
      '',
    ).replace(/\n(?!-)/g, '\n  '),
  ].join('\n');
}

/** Every generated block, by the marker name that encloses it. */
export function sections(): Record<string, string> {
  const t = tuningFor('easy');
  return {
    'speed-tiers': speedTiers(t),
    difficulty: difficulties(),
    handling: handling(t),
    damage: damage(t),
    constants: constants(t),
  };
}

/** Replaces each `<!-- generated:name -->` block. Throws if one is missing. */
export function render(document: string): string {
  let out = document;
  for (const [name, body] of Object.entries(sections())) {
    const open = `<!-- generated:${name} -->`;
    const close = `<!-- /generated:${name} -->`;
    const from = out.indexOf(open);
    const to = out.indexOf(close);
    if (from < 0 || to < 0 || to < from) {
      throw new Error(`GAMEPLAY.md: missing or malformed markers for "${name}"`);
    }
    out = `${out.slice(0, from + open.length)}\n${body}\n${out.slice(to)}`;
  }
  return out;
}
