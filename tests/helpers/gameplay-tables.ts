/**
 * Les parties de `docs/GAMEPLAY.md` qui sont de l'arithmétique sur les tables
 * d'accord.
 *
 * Ce document a existé des mois avec une ligne simplement fausse — un rapport
 * divisé par un chiffre qui n'apparaissait nulle part dans le code — parce que
 * chaque nombre y était tapé à la main et que rien ne pouvait le contredire.
 * Tout ce qui se dérive est désormais calculé ici et vérifié par un test, donc
 * le document ne peut plus dériver de `src/sim/tuning.ts`.
 *
 * Ce qui n'est délibérément *pas* généré : la prose, l'intention de conception,
 * et les deux tables qui dépendaient de la façon dont quelqu'un conduisait. Un
 * nombre qui a besoin d'une politique de jeu pour être vrai n'a pas sa place
 * dans une référence.
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

/** Vitesse latérale d'approche supposée pour « l'impact moyen », en m/s. */
const TYPICAL_IMPACT = 12;

const kmh = (ms: number) => Math.round(ms * 3.6);

/**
 * Replie la prose à la largeur à laquelle ce dépôt écrit.
 *
 * Un texte généré se lit encore dans un diff, et un paragraphe qui se replie
 * autrement chaque fois qu'un nombre gagne un chiffre fait paraître chaque
 * changement plus gros qu'il n'est.
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

/** Le virage le plus serré que le générateur dessine à une vitesse donnée, et son rayon. */
function tightestCorner(t: Tuning, speed: number) {
  const v2 = Math.max(3600, speed * speed);
  const k = clamp(t.curveLoad / (v2 * t.centri), t.curveMin, t.curveMax);
  const load = k * v2 * t.centri;
  // Le dévers est l'angle d'équilibre pour cette charge, donc une part de la
  // poussée est prise par la piste elle-même et n'atteint jamais le pilote.
  const bank = clamp(-Math.atan(load / 9.81) * t.bankScale, -1.25, 1.25);
  const assist = 9.81 * Math.abs(Math.sin(bank)) * t.bankAssist;
  return { radius: 1 / k, load, net: load - assist };
}

/** Lacet maximal que le manche peut commander à une vitesse donnée, en radians. */
const yawMax = (t: Tuning, speed: number) =>
  clamp((t.yawBase * t.yawSpeedRef) / Math.max(40, speed), t.yawMin, t.yawBase);

export function speedTiers(t: Tuning): string {
  const boostSpeed = t.speedMax * t.boostFactor;
  const topSpeed = boostSpeed * t.supFactor;
  // La fenêtre du barreau 1 est ce qu'une réserve pleine dure en boost ; celle
  // du barreau 2 est la durée du super boost. Les deux sont exprimées en
  // mètres à la vitesse du barreau, pour comparer à la montée demandée.
  const boostWindow = 100 / t.boostDrain;
  const boostReach = boostSpeed * boostWindow;
  const supReach = topSpeed * t.supTime;
  const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)} %`;
  const rows = [
    ['0', 'cruising', 'bronze', COIN_GAIN[0]],
    ['1', 'holding boost, reserve above `boostMin`', 'gold', COIN_GAIN[1]],
    ['2', `a pickup, or ${t.climbSup} m of clean drift under boost`, 'white', COIN_GAIN[2]],
    ['3', `${t.climbSurge} m of clean drift under a super boost`, 'warm white', COIN_GAIN[3]],
  ] as const;
  const speeds = [kmh(t.speedMax), kmh(boostSpeed), kmh(topSpeed)];
  return [
    '| Tier | Reached by | Coin colour | Multiplier gain |',
    '|---|---|---|---|',
    ...rows.map(([n, s, c, g]) => `| ${n} | ${s} | ${c} | +${g} |`),
    '',
    wrap(
      `The tier is the thrust rung, not a speed threshold. Top speeds are ` +
        `${speeds[0]} km/h cruising, ${speeds[1]} under boost and ${speeds[2]} under a ` +
        'super boost, which the surge matches without exceeding.',
    ),
    '',
    wrap(
      'The ladder is climbed rung by rung, and the climb is measured in metres of ' +
        'drift with nothing touched — a wall empties it, and off drift it drains at ' +
        `${t.climbDecay} m/s. Whether a rung is reachable is a matter of the window ` +
        `it is climbed in: ${t.climbSup} m is ${pct(t.climbSup, boostReach)} of the ` +
        `${boostReach.toFixed(0)} m a full reserve covers under boost ` +
        `(${boostWindow.toFixed(1)} s at ${t.boostDrain} points per second, before ` +
        `drifting refills it), and ${t.climbSurge} m is ` +
        `${pct(t.climbSurge, supReach)} of the ${supReach.toFixed(0)} m a ` +
        `${t.supTime} s super boost covers. Earned or found, a super boost lasts the ` +
        'same and pins a full reserve, so the gauge reads the same either way.',
    ),
    '',
    wrap(
      'Cruising and boost climb with the speed ramp over the opening of a run. A super ' +
        'boost does not: it reaches its own ceiling from the first metre, because ' +
        'multiplying a target that is still climbing had it showing less than an ' +
        'ordinary cruise while wearing the loudest presentation in the game.',
    ),
    '',
    wrap(
      'It used to be a speed threshold, and that was measured to be a poor stand-in ' +
        'for what it meant. Damage cuts the target speed, so a battered hull lost the ' +
        'tier its speed would have opened — paying twice for the same mistake. The rung ' +
        'says the same thing without the approximation, and it is what the tiers always ' +
        'meant: the top one has always required boosting.',
    ),
    '',
    wrap(
      'The top gain jumps rather than rises. Holding the surge means drifting, which ' +
        'costs collection, so that rung is paying for coins that are not there — the ' +
        'ladder is calibrated on multiplier earned per second, not per coin.',
    ),
    '',
    wrap(
      `Above ${kmh(t.fastLane)} km/h the multiplier also decays half as fast, which is ` +
        'what makes holding the top of the ladder worth more than reaching it. Boost is ' +
        'fed by drifting. That is the intended loop: **drift to charge, boost to score**.',
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

  // En haut de la plage `yawMax` varie en 1/v, donc l'autorité que le manche
  // commande est presque constante — d'où un seul chiffre cité.
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
  // Le plafond réel est le super boost, pas le boost. Les deux constantes
  // ci-dessous sont des marges contre la vitesse la plus haute que le jeu
  // atteint, et les écrire contre le boost les surestimait — discrètement tant
  // que supFactor valait 1,08, moins discrètement ensuite.
  const top = t.speedMax * t.boostFactor * t.supFactor;
  const period = t.stripeEvery * SEG;
  const perFrame = top / 60;
  const draw = (COUNT - BACK) * SEG;
  return [
    wrap(
      '- **Chevron period must stay above twice the per frame travel.** At ' +
        `${top.toFixed(0)} m/s under a super boost and 60 fps that is ` +
        `${(perFrame * 2).toFixed(1)} m, ` +
        `hence \`stripeEvery: ${t.stripeEvery}\` for a ${period} m period. Below that ` +
        'the track visually decomposes and no amount of GPU fixes it.',
      77,
      '',
    ).replace(/\n(?!-)/g, '\n  '),
    wrap(
      `- **Draw distance is ${draw} m**, which is ${(draw / top).toFixed(1)} seconds ` +
        'at the top speed. Raising it without raising `COUNT` will make the track pop ' +
        'in.',
      77,
      '',
    ).replace(/\n(?!-)/g, '\n  '),
  ].join('\n');
}

/** Chaque bloc généré, par le nom du marqueur qui l'encadre. */
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

/** Remplace chaque bloc `<!-- generated:name -->`. Lève si l'un manque. */
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
