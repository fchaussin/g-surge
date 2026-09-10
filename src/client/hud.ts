/**
 * The per-frame DOM writes.
 *
 * Everything here is read from simulation state and written to elements found
 * once at construction. Nothing in this file feeds back into the simulation,
 * which is why it can be skipped entirely when the game is not being played.
 *
 * The one rule worth keeping: touch the DOM only when the value has changed.
 * A style write per frame at 144 Hz on eight elements is enough layout work to
 * show up next to the renderer.
 */
import { thrustTier, type SimState, type Tuning } from '../sim/index.js';

/** Multiplier colour by speed tier, matching the coin it came from. */
const TIER_CSS = ['#e0913f', '#ffc24a', '#dff4ff', '#fff6d0'] as const;

/** How long the multiplier flashes after a change, in seconds. */
const PULSE_UP = 0.16;
const PULSE_CUT = 0.2;

const byId = (id: string) => document.getElementById(id);

export class Hud {
  private readonly root = byId('hud');
  private readonly score = byId('dist');
  private readonly mult = byId('mult');
  private readonly speed = byId('spd');
  private readonly speedBox = byId('spdBox');
  private readonly warn = byId('warn');
  private readonly coins = byId('coinCount');
  private readonly hull = byId('hullBar');
  private readonly boost = byId('boostBar');
  private readonly boostBox = byId('bstBox');
  private readonly boostFill = byId('boostFill');
  private readonly boostPad = document.querySelector<HTMLElement>('.pad.boost');
  private readonly best = byId('recline');
  private readonly pop = byId('pop');

  /* Last written values, so an unchanged frame writes nothing. */
  private lastScore = -1;
  private lastSpeed = -1;
  private lastCoins = -1;
  private lastHull = -1;
  private lastLevel = -1;
  private lastSurging = false;
  private lastTier = -1;
  private lastMult = 1;
  private lastWarn = '';
  private pulse = 0;
  private popTime = 0;

  /** Called once per frame while a run is on. */
  update(state: SimState, tuning: Tuning, frameDt: number): void {
    const score = Math.round(state.score);
    if (score !== this.lastScore) {
      this.lastScore = score;
      if (this.score) this.score.textContent = score.toLocaleString('en-GB');
    }

    const kmh = Math.round(state.speed * 3.6);
    if (kmh !== this.lastSpeed) {
      this.lastSpeed = kmh;
      if (this.speed) this.speed.textContent = String(kmh);
    }

    if (state.coins !== this.lastCoins) {
      this.lastCoins = state.coins;
      if (this.coins) this.coins.textContent = String(state.coins);
    }

    this.updateMultiplier(state, tuning, frameDt);
    this.updateWarning(state);
    this.updateGauges(state, tuning);

    if (this.popTime > 0) {
      this.popTime -= frameDt;
      if (this.popTime <= 0) this.pop?.classList.remove('on');
    }
  }

  /** Floating label on a pickup: the multiplier gain, a repair, a super boost. */
  showPop(text: string, colour: string): void {
    if (!this.pop) return;
    this.pop.textContent = text;
    this.pop.style.color = colour;
    this.pop.classList.remove('on');
    // Forces a reflow so the animation restarts on a repeated pickup.
    void this.pop.offsetWidth;
    this.pop.classList.add('on');
    this.popTime = 0.9;
  }

  setBest(text: string): void {
    if (this.best) this.best.textContent = text;
  }

  /** Clears everything a finished run left behind. */
  reset(): void {
    this.lastScore = this.lastSpeed = this.lastCoins = -1;
    this.lastHull = this.lastLevel = -1;
    this.lastSurging = false;
    this.lastTier = -1;
    this.lastMult = 1;
    this.lastWarn = '';
    this.pulse = 0;
    this.popTime = 0;
    this.pop?.classList.remove('on');
    this.warn?.classList.remove('on');
    this.root?.classList.remove('surge');
  }

  private updateMultiplier(state: SimState, tuning: Tuning, frameDt: number): void {
    if (!this.mult) return;
    this.mult.textContent = `×${state.mult.toFixed(1)}`;

    const tier = thrustTier(state);
    if (tier !== this.lastTier) {
      this.lastTier = tier;
      this.mult.style.color = TIER_CSS[tier];
    }

    if (state.mult > this.lastMult + 0.001) {
      this.mult.classList.remove('cut');
      this.mult.classList.add('up');
      this.pulse = PULSE_UP;
    } else if (state.mult < this.lastMult - 0.05) {
      this.mult.classList.remove('up');
      this.mult.classList.add('cut');
      this.pulse = PULSE_CUT;
    }
    this.lastMult = state.mult;

    if (this.pulse > 0) {
      this.pulse -= frameDt;
      if (this.pulse <= 0) this.mult.classList.remove('up', 'cut');
    }
  }

  private updateWarning(state: SimState): void {
    if (!this.warn) return;
    const text = state.scrape > 0 ? 'WALL HIT' : state.drift ? 'DRIFT' : '';
    if (text === this.lastWarn) return;
    this.lastWarn = text;

    if (!text) {
      this.warn.classList.remove('on');
      return;
    }
    this.warn.textContent = text;
    this.warn.classList.toggle('drift', text === 'DRIFT');
    this.warn.classList.add('on');
  }

  private updateGauges(state: SimState, tuning: Tuning): void {
    const hull = Math.round(state.hull);
    if (hull !== this.lastHull) {
      this.lastHull = hull;
      if (this.hull) {
        // Green at 100, yellow near 55, red at 0: the curve warns a little
        // before the halfway point, which is when it still matters.
        const hue = 120 * Math.pow(Math.max(0, state.hull) / 100, 1.35);
        this.hull.style.width = `${hull}%`;
        this.hull.style.background = `hsl(${hue.toFixed(0)},88%,50%)`;
        this.hull.style.boxShadow = `0 0 10px hsla(${hue.toFixed(0)},95%,55%,.65)`;
        this.hull.parentElement?.classList.toggle('crit', state.hull < 22);
      }
    }

    // Pendant le G-SURGE la jauge de boost ne veut plus rien dire : la réserve
    // est figée et rien ne draine. Elle devient donc le compte à rebours de
    // l'état, sans que le HUD gagne un élément — la §10 de la palette le veut
    // simplifié pendant cet état, pas augmenté. Bornée à 100 parce qu'un second
    // ramassage peut porter la durée au double.
    const surging = state.surgeT > 0;
    const level = surging
      ? Math.min(100, Math.round((state.surgeT / tuning.surgeTime) * 100))
      : Math.round(state.energy);
    if (level === this.lastLevel && surging === this.lastSurging) return;
    this.lastLevel = level;
    this.lastSurging = surging;

    const pct = `${level}%`;
    if (this.boost) this.boost.style.height = pct;
    if (this.boostFill) this.boostFill.style.height = pct;

    const full = !surging && state.energy > 99.5;
    const charging = !surging && state.drift && !full;
    // Les instruments décrochent pendant l'état : une classe, et la feuille
    // de style fait le reste. On n'arrive ici que si `level` ou `surging` a
    // bougé, donc ce n'est pas une écriture par frame.
    this.root?.classList.toggle('surge', surging);
    this.boostBox?.classList.toggle('surge', surging);
    this.boostBox?.classList.toggle('full', full);
    this.boostBox?.classList.toggle('charge', charging);
    this.boostPad?.classList.toggle('low', state.energy < tuning.boostMin && !state.boosting);
    this.boostPad?.classList.toggle('charge', charging);
    this.boostPad?.classList.toggle('full', full);
    this.speedBox?.classList.toggle('hot', state.boosting);
    this.speedBox?.classList.toggle('sup', state.superT > 0 || surging);
  }
}
