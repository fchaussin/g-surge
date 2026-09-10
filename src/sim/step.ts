/**
 * Un pas de simulation.
 *
 * Portage ligne à ligne du `step()` de legacy/game.js, avec deux seules
 * différences, l'une et l'autre voulues :
 *
 * - les appels de présentation (`SFX`, `buzz`, `flashHalo`, `pop`) sont
 *   remplacés par des événements poussés dans `out` ;
 * - `halo` et `haloPow` ne sont plus des champs d'état.
 *
 * Le reste, y compris l'ordre des opérations, doit rester identique : les
 * références de tests/e2e/fixtures/ ont été capturées sur la version d'origine
 * et ne doivent pas bouger d'un chiffre.
 */
import type { SimEvent } from './events.js';
import type { SimState } from './state.js';
import { BACK, clamp, HALF, ITEM_COIN, ITEM_FIX, SEG, SHIP, Track } from './track.js';
import type { Tuning } from './tuning.js';

export interface Input {
  /** -1 à 1. Positif vers la gauche de l'écran : l'axe X du monde y est inversé. */
  steer: number;
  brake: boolean;
  boost: boolean;
}

/** Palier de la pièce selon la vitesse : sous 500 km/h, sous 1000, au-delà. */
export function coinTier(speed: number, tuning: Tuning): 0 | 1 | 2 {
  if (speed >= tuning.coinTier3) return 2;
  if (speed >= tuning.coinTier2) return 1;
  return 0;
}

/** Gain de multiplicateur par palier. */
export const COIN_GAIN: readonly [number, number, number] = [0.1, 0.3, 0.6];

/**
 * Avance la simulation de `dt`, en émettant ses événements dans `out`.
 * Renvoie le dévers sous le vaisseau, dont le rendu a besoin.
 */
export function step(
  state: SimState,
  track: Track,
  tuning: Tuning,
  diffMul: number,
  input: Input,
  dt: number,
  attract: boolean,
  out: SimEvent[],
): number {
  const T = tuning;

  let steer: number;
  let brake: boolean;
  let boost: boolean;
  if (attract) {
    // pilote automatique de l'écran d'accueil : il se recentre, rien de plus
    steer = clamp(-(state.lat * 0.10 + state.latVel * 0.55), -1, 1);
    brake = false;
    boost = false;
  } else {
    steer = input.steer;
    brake = input.brake;
    boost = input.boost;
  }

  if (state.superT > 0) state.superT = Math.max(0, state.superT - dt);
  const superOn = state.superT > 0 && !attract;
  if (attract) state.boosting = false;
  else if (superOn) state.boosting = true;
  else {
    if (boost && !state.boosting && state.energy >= T.boostMin) state.boosting = true;
    if (!boost || state.energy <= 0) state.boosting = false;
  }
  const dmg = 1 - state.hull / 100;
  if (state.boosting && !superOn) state.energy -= T.boostDrain * dt;
  else if (!superOn) state.energy += T.boostRecharge * (1 - dmg * 0.5) * dt;
  state.energy = clamp(state.energy, 0, 100);
  if (!attract) state.hull = Math.min(100, state.hull + T.hullRegen * dt);

  let target: number;
  let gain = T.speedGain;
  if (attract) target = 46;
  else {
    const ramp = Math.min(1, state.dist / T.speedRamp);
    target = T.speedStart + (T.speedMax - T.speedStart) * ramp;
    if (state.boosting) {
      target *= superOn ? T.boostFactor * T.supFactor : T.boostFactor;
      gain *= T.boostGain;
    }
    if (brake) target *= T.brakeFactor;
    target *= 1 - dmg * T.damageSpeed;
  }
  state.speed += (target - state.speed) * Math.min(1, dt * gain);
  // le générateur voit la vitesse courante, et c'est le couplage qui empêche
  // encore une piste partagée entre joueurs. Voir track.ts.
  track.genSpeed = state.speed;

  // le multiplicateur s'érode proportionnellement à lui même, moitié moins vite
  // tant que le palier maximum de vitesse est tenu
  const fastLane = state.speed >= T.coinTier3;
  state.mult -= (state.mult - 1) * T.multDecay * (fastLane ? T.multDecayFast : 1) * dt;
  if (state.mult < 1) state.mult = 1;

  const d = state.speed * dt;
  state.travel += d;
  if (!attract) {
    state.dist += d;
    state.score += state.speed * state.mult * diffMul * dt;
    if (state.mult > state.multPeak) state.multPeak = state.mult;
  }
  state.cursor += d;
  while (state.cursor >= SEG) {
    state.cursor -= SEG;
    track.push();
  }

  const kNow = track.nk[BACK]!;
  const bBack = track.nb[BACK]!;
  const bNow = bBack + (track.nb[BACK + 1]! - bBack) * (state.cursor / SEG);

  // décollage : la piste se dérobe plus vite que la gravité ne peut rabattre le vaisseau
  const gNow = track.gradeAt(state.cursor, 0);
  const gAhead = track.gradeAt(state.cursor, 22);
  if (!state.air && !attract && state.speed > 45) {
    const need = ((gAhead - gNow) * state.speed * state.speed) / 22;
    if (need < -9.81 * T.airThresh) {
      state.air = true;
      state.airTime = 0;
      state.vyRel = T.launchScale * state.speed * (gNow - gAhead);
      state.hop = 0.05;
    }
  }
  if (state.air) {
    state.airTime += dt;
    state.vyRel -= 9.81 * T.airGravity * dt;
    state.hop += state.vyRel * dt;
    if (state.hop <= 0) {
      state.hop = 0;
      state.air = false;
      state.vyRel = 0;
      out.push({ type: 'land' });
      if (Math.abs(state.lat) > HALF - SHIP) {
        // réception hors piste
        state.speed *= 1 - T.badLanding;
        state.energy = Math.max(0, state.energy - 40);
        state.hull = Math.max(0, state.hull - 18);
        state.shake = 0.8;
        state.scrape = 0.4;
        state.mult = 1 + (state.mult - 1) * T.multWallCut;
        out.push({ type: 'badLanding' });
      }
    }
  }

  // le manche commande un angle de lacet, pas directement une accélération latérale
  const yawMax =
    clamp(
      (T.yawBase * T.yawSpeedRef) / Math.max(40, state.speed),
      T.yawMin,
      T.yawBase,
    ) * (1 - dmg * T.damageSteer);
  state.yaw += (steer * yawMax - state.yaw) * Math.min(1, dt * T.yawResponse);

  // vitesse latérale que le nez réclame, et écart réellement encaissé par les appuis
  const vWant = Math.sin(state.yaw) * state.speed;
  const dv = vWant - state.latVel;
  if (!state.air) {
    if (!state.drift && Math.abs(dv) * T.gripHold > T.gripLimit) state.drift = true;
    if (state.drift && Math.abs(dv) < T.driftExit) state.drift = false;
  } else state.drift = false;

  let grip = state.drift ? T.gripDrift : T.gripHold;
  if (state.air) grip *= T.airSteer;
  state.latVel += dv * Math.min(1, dt * grip);
  if (!state.air) {
    state.latVel -= kNow * state.speed * state.speed * T.centri * dt;
    state.latVel -= 9.81 * Math.sin(bNow) * T.bankAssist * dt;
  }
  state.latVel = clamp(state.latVel, -T.steerMaxVel, T.steerMaxVel);
  state.lat += state.latVel * dt;
  if (state.drift && !attract) state.energy = Math.min(100, state.energy + T.driftCharge * dt);
  state.slip = dv;

  const lim = HALF - SHIP + (state.air ? T.airOverhang : 0);
  if (Math.abs(state.lat) > lim) {
    const impact = Math.abs(state.latVel);
    state.lat = Math.sign(state.lat) * lim;
    if (Math.sign(state.latVel) === Math.sign(state.lat)) {
      state.latVel = -state.latVel * T.wallBounce;
      if (!attract && !state.air) {
        state.speed -= state.speed * T.wallPenalty * dt * 6;
        state.energy = Math.max(0, state.energy - T.wallDrain * dt);
        if (!state.contact) {
          // choc franc, une seule fois par contact
          const hit = clamp(impact * T.hullImpact, 2, 42);
          state.hull = Math.max(0, state.hull - hit);
          state.shake = Math.min(1, hit / 26);
          state.mult = 1 + (state.mult - 1) * T.multWallCut;
          state.speed *= 1 - Math.min(0.30, hit / 140);
          out.push({ type: 'wallImpact', force: state.shake });
        }
      }
    }
    if (!attract && !state.air) {
      state.hull = Math.max(0, state.hull - T.hullScrape * dt);
      out.push({ type: 'scrape' });
    }
    if (!state.air) {
      state.contact = true;
      state.scrape = attract ? 0 : 0.16;
    }
  } else {
    state.contact = false;
    if (state.scrape > 0) state.scrape -= dt;
  }
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.6);

  // ramassage : chaque objet est testé au moment où le vaisseau le dépasse
  const ibase = track.nid[0]!;
  for (const it of track.items) {
    if (it.done) continue;
    if ((it.id - ibase - BACK) * SEG - state.cursor > 0) continue;
    it.done = true;
    if (attract) continue;
    if (Math.abs(state.lat - it.lat) > T.pickRadius || state.hop > 4) continue;
    it.taken = true;
    if (it.type === ITEM_COIN) {
      const tier = coinTier(state.speed, T);
      const gainValue = COIN_GAIN[tier];
      state.coins++;
      state.mult = Math.min(T.multMax, state.mult + gainValue);
      out.push({ type: 'pickup', kind: 'coin', tier, gain: gainValue });
    } else if (it.type === ITEM_FIX) {
      state.hull = Math.min(100, state.hull + T.fixAmount);
      out.push({ type: 'pickup', kind: 'fix' });
    } else {
      state.superT = T.supTime;
      state.energy = 100;
      out.push({ type: 'pickup', kind: 'sup' });
    }
  }
  if (!attract && state.hull <= 0 && !state.wrecked) {
    state.wrecked = true;
    out.push({ type: 'wreck' });
  }
  if (state.speed < 12) state.speed = 12;
  return bNow;
}
