/**
 * Les écritures DOM de chaque frame.
 *
 * Tout ici est lu dans l'état de la simulation et écrit dans des éléments
 * trouvés une fois à la construction. Rien dans ce fichier ne remonte vers la
 * simulation, ce qui permet de le sauter entièrement quand on ne joue pas.
 *
 * La seule règle qui compte : ne toucher le DOM que si la valeur a changé. Une
 * écriture de style par frame à 144 Hz sur huit éléments, c'est assez de mise
 * en page pour apparaître à côté du rendu.
 */
import { thrustTier, type SimState, type Tuning } from '../sim/index.js';

/** Couleur du multiplicateur par palier de vitesse, celle de la pièce d'origine. */
const TIER_CSS = ['#e0913f', '#ffc24a', '#dff4ff', '#fff6d0'] as const;

/** Durée du flash du multiplicateur après un changement, en secondes. */
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
  private readonly boostBox = byId('bstBox');
  /* Les trois couches de l'échelle, de la réserve au G-SURGE. */
  private readonly boost = byId('boostBar');
  private readonly l2 = this.boostBox?.querySelector<HTMLElement>('.l2') ?? null;
  private readonly l3 = this.boostBox?.querySelector<HTMLElement>('.l3') ?? null;
  private readonly boostFill = byId('boostFill');
  private readonly boostPad = document.querySelector<HTMLElement>('.pad.boost');
  private readonly best = byId('recline');
  private readonly pop = byId('pop');

  /* Dernières valeurs écrites, pour qu'une frame inchangée n'écrive rien. */
  private lastScore = -1;
  private lastSpeed = -1;
  private lastCoins = -1;
  private lastHull = -1;
  private lastL1 = -1;
  private lastL2 = -1;
  private lastL3 = -1;
  private lastUp = -1;
  private lastSurging = false;
  private lastTier = -1;
  private lastMult = 1;
  private lastWarn = '';
  private pulse = 0;
  private popTime = 0;

  /** Appelé une fois par frame pendant une partie. */
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

  /** Étiquette flottante d'un ramassage : le gain de multiplicateur, une réparation, un superboost. */
  showPop(text: string, colour: string): void {
    if (!this.pop) return;
    this.pop.textContent = text;
    this.pop.style.color = colour;
    this.pop.classList.remove('on');
    // Force un reflow pour que l'animation reparte sur un ramassage répété.
    void this.pop.offsetWidth;
    this.pop.classList.add('on');
    this.popTime = 0.9;
  }

  setBest(text: string): void {
    if (this.best) this.best.textContent = text;
  }

  /** Efface tout ce qu'une partie finie a laissé derrière elle. */
  reset(): void {
    this.lastScore = this.lastSpeed = this.lastCoins = -1;
    this.lastHull = this.lastL1 = this.lastL2 = this.lastL3 = this.lastUp = -1;
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
        // Vert à 100, jaune vers 55, rouge à 0 : la courbe prévient un peu
        // avant la moitié, quand ça compte encore.
        const hue = 120 * Math.pow(Math.max(0, state.hull) / 100, 1.35);
        this.hull.style.width = `${hull}%`;
        this.hull.style.background = `hsl(${hue.toFixed(0)},88%,50%)`;
        this.hull.style.boxShadow = `0 0 10px hsla(${hue.toFixed(0)},95%,55%,.65)`;
        this.hull.parentElement?.classList.toggle('crit', state.hull < 22);
      }
    }

    // L'échelle empilée : une couche par barreau au-dessus de la croisière.
    // En bas la réserve, en or. Par-dessus, la montée vers le super boost puis,
    // une fois dedans, son décompte, en blanc. Par-dessus encore, la montée
    // vers le G-SURGE puis le sien, en blanc chaud. Un palier qui s'éteint vide
    // sa couche et découvre celle du dessous : la pile se déconstruit dans
    // l'ordre où elle s'est bâtie. Aucun élément neuf pendant l'état — la §10
    // de la palette le veut simplifié, pas augmenté — et tout est borné à 100,
    // parce qu'un second ramassage peut porter une durée au double.
    const surging = state.surgeT > 0;
    const sup = state.superT > 0;
    const pct = (ratio: number) => Math.min(100, Math.max(0, Math.round(ratio * 100)));
    const l1 = sup || surging ? 100 : pct(state.energy / 100);
    const l2 = surging
      ? 100
      : sup
        ? pct(state.superT / tuning.supTime)
        : pct(state.climb / tuning.climbSup);
    const l3 = surging
      ? pct(state.surgeT / tuning.surgeTime)
      : sup
        ? pct(state.climb / tuning.climbSurge)
        : 0;
    // La couche que le drift fait monter en ce moment, 0 si aucune.
    const up = !state.drift || surging ? 0 : sup ? 3 : state.boosting ? 2 : 1;
    if (
      l1 === this.lastL1 &&
      l2 === this.lastL2 &&
      l3 === this.lastL3 &&
      up === this.lastUp &&
      surging === this.lastSurging
    ) {
      return;
    }
    this.lastL1 = l1;
    this.lastL2 = l2;
    this.lastL3 = l3;
    this.lastUp = up;
    this.lastSurging = surging;

    if (this.boost) this.boost.style.height = `${l1}%`;
    if (this.l2) this.l2.style.height = `${l2}%`;
    if (this.l3) this.l3.style.height = `${l3}%`;
    this.boost?.classList.toggle('up', up === 1);
    this.l2?.classList.toggle('up', up === 2);
    this.l3?.classList.toggle('up', up === 3);
    // Le pad suit la couche active : ce que le bouton dépense, ou ce qui reste
    // de l'état en cours.
    if (this.boostFill) this.boostFill.style.height = `${surging ? l3 : sup ? l2 : l1}%`;

    const full = !sup && !surging && state.energy > 99.5;
    const charging = up > 0;
    // Les instruments décrochent pendant l'état : une classe, et la feuille
    // de style fait le reste. On n'arrive ici que si une hauteur ou l'état a
    // bougé, donc ce n'est pas une écriture par frame.
    this.root?.classList.toggle('surge', surging);
    this.boostBox?.classList.toggle('surge', surging);
    this.boostBox?.classList.toggle('full', full);
    this.boostPad?.classList.toggle('low', state.energy < tuning.boostMin && !state.boosting);
    this.boostPad?.classList.toggle('charge', charging);
    this.boostPad?.classList.toggle('full', full);
    this.boostPad?.classList.toggle('sup', sup && !surging);
    this.boostPad?.classList.toggle('surge', surging);
    this.speedBox?.classList.toggle('hot', state.boosting);
    this.speedBox?.classList.toggle('sup', sup || surging);
  }
}
