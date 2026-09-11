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
import { thrustTier, type SimState } from './state.js';
import { BACK, clamp, HALF, ITEM_COIN, ITEM_FIX, SEG, SHIP, Track } from './track.js';
import { sin } from './trig.js';
import type { Tuning } from './tuning.js';

export interface Input {
  /** -1 à 1. Positif vers la gauche de l'écran : l'axe X du monde y est inversé. */
  steer: number;
  brake: boolean;
  boost: boolean;
}

/**
 * Gain de multiplicateur par barreau de poussée.
 *
 * Le palier suivait la vitesse : sous 500 km/h, sous 1000, au-delà. Mesuré,
 * c'était une mauvaise approximation de ce qu'il voulait dire. Les dégâts
 * rabattent la vitesse cible — `target *= 1 - dmg * damageSpeed` — et la coque
 * moyenne vaut 86 / 61 / 31 selon la difficulté, si bien que le plafond réel du
 * super boost tombait de 1 473 à ~950 km/h en difficile. Une coque abîmée
 * coûtait donc deux fois : la vitesse, puis le palier que cette vitesse ouvre.
 *
 * Le barreau dit la même chose sans l'approximation, et `GAMEPLAY.md` l'écrivait
 * déjà : « le palier 3 exige de booster ». C'est la clarification d'une
 * intention, pas une intention neuve.
 */
export const COIN_GAIN: readonly [number, number, number, number] = [0.13, 0.3, 0.55, 1.35];

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
    steer = clamp(-(state.lat * 0.1 + state.latVel * 0.55), -1, 1);
    brake = false;
    boost = false;
  } else {
    steer = input.steer;
    brake = input.brake;
    boost = input.boost;
  }

  if (state.surgeT > 0) {
    state.surgeT = Math.max(0, state.surgeT - dt);
    if (state.surgeT === 0) out.push({ type: 'surgeEnd' });
  }
  if (state.superT > 0) {
    state.superT = Math.max(0, state.superT - dt);
    // même arithmétique qu'avant, on ne fait que nommer l'instant où elle
    // touche le fond : `superT` n'est pas dans la trace, l'événement non plus,
    // donc les références figées ne bougent pas d'un chiffre
    if (state.superT === 0) out.push({ type: 'supEnd' });
  }
  const superOn = state.superT > 0 && !attract;
  const surgeOn = state.surgeT > 0 && !attract;
  // Le G-SURGE roule à la vitesse d'un super boost, pas au-delà : il ne reste
  // que 7 % de marge sous le plafond auquel `audio.ts` borne le moteur, et §15
  // de la palette veut de toute façon une perception altérée, pas une
  // accélération. Ce qu'il ajoute est de la durée et du retour.
  const topped = superOn || surgeOn;
  if (attract) state.boosting = false;
  else if (topped) state.boosting = true;
  else {
    if (boost && !state.boosting && state.energy >= T.boostMin) state.boosting = true;
    if (!boost || state.energy <= 0) state.boosting = false;
  }
  const dmg = 1 - state.hull / 100;
  if (state.boosting && !topped) state.energy -= T.boostDrain * dt;
  else if (!topped) state.energy += T.boostRecharge * (1 - dmg * 0.5) * dt;
  state.energy = clamp(state.energy, 0, 100);
  if (!attract) state.hull = Math.min(100, state.hull + T.hullRegen * dt);

  let target: number;
  let gain = T.speedGain;
  if (attract) target = 46;
  else {
    // Un super boost ne dépend pas de la rampe. Multiplier une cible encore
    // basse donnait 410 km/h de médiane avant la fin de rampe, avec une coque
    // intacte et sans toucher un mur — le ramassage le plus rare du jeu, avec
    // tout son appareil sensoriel, affichait moins qu'une croisière ordinaire.
    // Une fois la rampe finie la ligne ne change rien : `ramp` y vaut déjà 1.
    const ramp = topped ? 1 : Math.min(1, state.dist / T.speedRamp);
    target = T.speedStart + (T.speedMax - T.speedStart) * ramp;
    if (state.boosting) {
      target *= topped ? T.boostFactor * T.supFactor : T.boostFactor;
      gain *= T.boostGain;
    }
    if (brake) target *= T.brakeFactor;
    target *= 1 - dmg * T.damageSpeed;
  }
  state.speed += (target - state.speed) * Math.min(1, dt * gain);

  // le multiplicateur s'érode proportionnellement à lui même, moitié moins vite
  // tant que le palier maximum de vitesse est tenu
  const fastLane = state.speed >= T.fastLane;
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
        state.climb = 0;
        if (state.combo >= T.comboArm) out.push({ type: 'comboEnd', count: state.combo });
        state.combo = 0;
        state.comboLeft = 0;
        out.push({ type: 'badLanding' });
      }
    }
  }

  // le manche commande un angle de lacet, pas directement une accélération latérale
  const yawMax =
    clamp((T.yawBase * T.yawSpeedRef) / Math.max(40, state.speed), T.yawMin, T.yawBase) *
    (1 - dmg * T.damageSteer);
  state.yaw += (steer * yawMax - state.yaw) * Math.min(1, dt * T.yawResponse);

  // vitesse latérale que le nez réclame, et écart réellement encaissé par les appuis
  const vWant = sin(state.yaw) * state.speed;
  const dv = vWant - state.latVel;
  const wasDrifting = state.drift;
  if (!state.air) {
    if (!state.drift && Math.abs(dv) * T.gripHold > T.gripLimit) state.drift = true;
    if (state.drift && Math.abs(dv) < T.driftExit) state.drift = false;
  } else state.drift = false;
  // on se contente d'observer la bascule, qui ne change pas : `drift` est dans
  // la trace figée, `driftHeld` et les événements n'y sont pas
  if (state.drift !== wasDrifting) {
    if (state.drift) {
      state.driftHeld = 0;
      out.push({ type: 'driftStart' });
    } else {
      out.push({ type: 'driftEnd', held: state.driftHeld });
      // Le Perfect Drift : un drift assez long prolonge l'enchaînement et
      // rouvre la fenêtre, resserrée à mesure que le combo monte. Trop court,
      // il ne compte pas — et ne casse rien non plus : c'est la fenêtre qui
      // juge, pas la longueur.
      if (!attract && state.driftHeld >= T.comboMinHeld) {
        state.combo++;
        const t = Math.min(1, state.combo / 10);
        state.comboLeft = T.comboWindow + (T.comboWindowMin - T.comboWindow) * t;
        const bonus =
          state.combo >= T.comboArm ? state.speed * state.combo * T.comboScore * diffMul : 0;
        state.score += bonus;
        out.push({ type: 'comboUp', count: state.combo, bonus });
      }
    }
  }
  if (state.drift) state.driftHeld += dt;
  // Hors drift la fenêtre s'écoule ; expirée, le combo tombe. Pendant un drift
  // elle ne bouge pas : c'est le drift suivant qu'on attend, pas sa fin.
  if (!state.drift && state.combo > 0) {
    state.comboLeft -= dt;
    if (state.comboLeft <= 0) {
      if (state.combo >= T.comboArm) out.push({ type: 'comboEnd', count: state.combo });
      state.combo = 0;
      state.comboLeft = 0;
    }
  }

  // La montée : du drift propre cumulé en mètres vers le barreau suivant. Elle
  // ne compte qu'en poussée, puisque l'échelle se gravit barreau par barreau —
  // en boost vers le super boost, en super boost vers le G-SURGE — et jamais
  // au sommet. Hors drift elle redescend, un mur l'annule. Elle ne rétroagit
  // sur aucune ligne de physique, donc elle n'est pas dans la trace et ne
  // déplace aucune référence.
  const climbing = state.drift && !attract && state.boosting && state.surgeT <= 0;
  // Un combo armé accélère la montée : la régularité paie vers le barreau
  // suivant, plafonnée pour qu'un long enchaînement ne l'écrase pas.
  const comboGain =
    state.combo >= T.comboArm
      ? Math.min(T.comboClimbMax, T.comboClimb * (state.combo - T.comboArm + 1))
      : 0;
  if (climbing) state.climb += d * (1 + comboGain);
  else if (state.climb > 0) state.climb = Math.max(0, state.climb - T.climbDecay * dt);
  if (!attract && state.surgeT <= 0) {
    if (state.superT > 0) {
      // Le G-SURGE exige un super boost en cours : sans précondition visible,
      // l'état partait tout seul. Depuis que la jauge montre la montée, la
      // précondition se voit.
      if (state.climb >= T.climbSurge) {
        state.climb = 0;
        state.surgeT = T.surgeTime;
        out.push({ type: 'surgeStart' });
      }
    } else if (state.boosting && state.climb >= T.climbSup) {
      // Le super boost mérité vaut le super boost trouvé : même durée, même
      // réserve pleine, pour que la jauge lise pareil dans les deux cas.
      state.climb = 0;
      state.superT = T.supTime;
      state.energy = 100;
      out.push({ type: 'supEarned' });
    }
  }

  let grip = state.drift ? T.gripDrift : T.gripHold;
  if (state.air) grip *= T.airSteer;
  state.latVel += dv * Math.min(1, dt * grip);
  if (!state.air) {
    state.latVel -= kNow * state.speed * state.speed * T.centri * dt;
    state.latVel -= 9.81 * sin(bNow) * T.bankAssist * dt;
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
        // Un mur casse la montée : elle récompense la propreté, pas l'obstination.
        state.climb = 0;
        // Et le combo avec elle, s'il était armé.
        if (state.combo >= T.comboArm) out.push({ type: 'comboEnd', count: state.combo });
        state.combo = 0;
        state.comboLeft = 0;
        state.speed -= state.speed * T.wallPenalty * dt * 6;
        state.energy = Math.max(0, state.energy - T.wallDrain * dt);
        if (!state.contact) {
          // choc franc, une seule fois par contact
          const hit = clamp(impact * T.hullImpact, 2, 42);
          state.hull = Math.max(0, state.hull - hit);
          state.shake = Math.min(1, hit / 26);
          state.mult = 1 + (state.mult - 1) * T.multWallCut;
          state.speed *= 1 - Math.min(0.3, hit / 140);
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

  // Near Miss : frôler le mur sans le toucher. On entre dans la bande, on en
  // ressort ; si aucun contact n'a eu lieu entre les deux et que le passage a
  // duré, la sortie paie — en points selon la vitesse et la proximité
  // atteinte, et en un peu de réserve. Un contact pendant le passage l'annule
  // sans le clore : la bande se rouvre au prochain passage seulement. En l'air
  // rien ne compte, la bordure y est un autre objet. Aucune référence figée ne
  // bouge : le pilote de référence entre dans la bande et touche à chaque fois.
  if (!attract) {
    const edge = HALF - SHIP - Math.abs(state.lat);
    const inBand = !state.air && edge < T.nearBand;
    if (inBand) {
      if (!state.near) {
        state.near = true;
        state.nearClean = true;
        state.nearHeld = 0;
        state.nearPeak = 0;
      }
      state.nearHeld += dt;
      state.nearPeak = Math.max(state.nearPeak, 1 - Math.max(0, edge) / T.nearBand);
      if (state.contact) state.nearClean = false;
    } else if (state.near) {
      state.near = false;
      if (!state.air && state.nearClean && state.nearHeld >= T.nearMinHeld) {
        const bonus = state.speed * T.nearScore * state.nearPeak * diffMul;
        state.score += bonus;
        state.energy = Math.min(100, state.energy + T.nearCharge * state.nearPeak);
        out.push({ type: 'nearMiss', closeness: state.nearPeak, bonus });
      }
    }
  }

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
      const tier = thrustTier(state);
      const gainValue = COIN_GAIN[tier];
      state.coins++;
      state.mult = Math.min(T.multMax, state.mult + gainValue);
      out.push({ type: 'pickup', kind: 'coin', tier, gain: gainValue });
    } else if (it.type === ITEM_FIX) {
      state.hull = Math.min(100, state.hull + T.fixAmount);
      out.push({ type: 'pickup', kind: 'fix' });
    } else {
      state.energy = 100;
      out.push({ type: 'pickup', kind: 'sup' });
      if (state.surgeT > 0) {
        // Un second ramassage pendant l'état le prolonge. Plafonné, parce que
        // le blanc audio est une absence : une absence qui dure cesse de se
        // lire comme un événement et commence à se lire comme un mix cassé.
        state.surgeT = Math.min(T.surgeTime * 2, state.surgeT + T.surgeTime);
      } else if (state.superT > 0) {
        // Deux super boosts qui se chevauchent — mesuré une fois par dix
        // minutes. C'est déjà un exploit, la montée n'est pas demandée.
        state.climb = 0;
        state.surgeT = T.surgeTime;
        out.push({ type: 'surgeStart' });
      } else {
        state.superT = T.supTime;
      }
    }
  }
  if (!attract && state.hull <= 0 && !state.wrecked) {
    state.wrecked = true;
    out.push({ type: 'wreck' });
  }
  if (state.speed < 12) state.speed = 12;
  return bNow;
}
