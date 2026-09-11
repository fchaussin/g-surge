/**
 * La réaction du client à ce que la simulation rapporte.
 *
 * `step()` publie des événements typés au lieu d'appeler l'audio ou le halo, et
 * ce module est le bout observateur de cette union : il traduit chaque
 * événement en son, en vibration, en lueur sur la coque, en secousse de caméra
 * et en pop sur le HUD. Il porte aussi l'état de présentation qui en découle,
 * le halo et la secousse, qui s'amortissent sur des frames et doivent donc être
 * remis à zéro pour une capture, comme tout ce qui s'amortit.
 *
 * Rien ici n'écrit dans la simulation. `state.shake` appartient au noyau et y
 * écrire déplacerait toutes les références figées ; la secousse du client est
 * un champ à part, et la caméra additionne les deux.
 */
import { driftFill, type SimEvent, type SimState, type Tuning } from '../sim/index.js';
import type { Audio } from './audio.js';
import type { ChaseCamera } from './camera.js';
import type { Haptics } from './haptics.js';
import type { Hud } from './hud.js';
import { COIN_COLOURS, RIDE_COLOUR } from './pickups.js';
import type { Ship } from './ship.js';

/** Durée d'extinction de la lueur d'un ramassage, en secondes. */
const HALO_TIME = 0.45;

/** Durée d'extinction de la secousse de présentation, en secondes. */
const FX_SHAKE_TIME = 0.42;

/**
 * Plus court drift, en secondes, qui fasse recentrer la caméra.
 *
 * Indépendant du seuil de l'audio à dessein — ce sont deux effets, et l'un
 * peut être retouché sans l'autre — mais issu de la même mesure : un drift peut
 * durer un seul pas, et recaler une caméra qui n'a pas bougé n'est qu'une
 * raideur que le joueur sent sans raison.
 */
const DRIFT_SNAP_MIN = 0.12;

/**
 * La lueur du drift : le cyan de la charge, volontairement faible.
 *
 * `--neon` est déjà le remplissage de la jauge de boost, le libellé DRIFT du HUD
 * et l'épine du vaisseau, donc la couleur dit « ça charge » avant tout le
 * reste. Sa puissance reste basse à dessein : le G-SURGE est en haut de la même
 * échelle et un drift éclatant mangerait le barreau du dessus.
 *
 * Tenue à intensité fixe avec une puissance qui monte, et pas l'inverse : parce
 * que `setHalo` rétrécit la sphère quand l'intensité grimpe — cette loi est
 * écrite pour un flash qui s'étend en s'éteignant, et ceci est une lueur tenue.
 * La puissance fait croître taille et opacité ensemble, ce à quoi une énergie
 * qui s'accumule doit ressembler.
 */
const DRIFT_HALO = 0x25e2ff;
const DRIFT_HALO_HOLD = 0.75;
const DRIFT_HALO_MIN = 0.08;
const DRIFT_HALO_MAX = 0.3;

/**
 * Niveau de réserve sous lequel un remplissage redevient digne d'être annoncé.
 *
 * C'était un événement de simulation d'abord, et c'était faux là-bas. « La
 * réserve est à 100 » est un fait que le noyau possède, mais elle y est de
 * nouveau trois pas après qu'un frottement de mur en a rogné 0,036 — un test
 * l'a pris à tirer dix-huit fois là où trois étaient voulues. La taille du
 * creux qui mérite un son est un jugement de présentation, donc il vit ici.
 * Cinq points, c'est une pression brève sur le boost, et plus qu'aucun pas
 * isolé ne peut retirer.
 */
const BOOST_READY_ARM = 95;

export interface FeedbackDeps {
  readonly audio: Audio;
  readonly haptics: Haptics;
  readonly hud: Hud;
  readonly camera: ChaseCamera;
  readonly ship: Ship;
  /** La fin de partie : le seul événement dont la suite n'est pas de la présentation. */
  onWreck(): void;
}

export class Feedback {
  /* Lueur de ramassage et d'impact. Elle a quitté la simulation avec les événements. */
  private halo = 0;
  private haloPower = 1;
  private haloColour = 0xffffff;
  /* Secousse d'impact possédée par le client. Voir FX_SHAKE_TIME. */
  private fxShake = 0;
  /* Vrai une fois la réserve assez entamée pour valoir une nouvelle annonce. */
  private boostArmed = false;

  constructor(private readonly deps: FeedbackDeps) {}

  /** La secousse du client, à additionner à celle de la simulation. */
  get shake(): number {
    return this.fxShake;
  }

  /** Remise à zéro de tout ce qui s'amortit, pour un début de partie ou une capture. */
  reset(): void {
    this.halo = 0;
    this.fxShake = 0;
    this.boostArmed = false;
  }

  /** Une frappe : le halo repart de son plein. */
  flash(colour: number, power = 1): void {
    this.haloColour = colour;
    this.halo = 1;
    this.haloPower = power;
  }

  /** Un frottement tient la lueur haute au lieu de la relancer à chaque pas. */
  hold(colour: number, level: number, power: number): void {
    this.haloColour = colour;
    if (this.halo < level) this.halo = level;
    this.haloPower = power;
  }

  /** L'entrée en super boost : le seul instant où l'onde de choc peut partir. */
  private superBoost(): void {
    this.deps.hud.showPop('SUPER BOOST', '#ff2f9a');
    this.flash(0xff2f9a, 1.8);
    this.fxShake = 1;
    this.deps.haptics.buzz([30, 30, 70, 40, 120]);
  }

  /** Les événements d'un pas, drainés une fois. */
  consume(events: readonly SimEvent[]): void {
    const { audio, haptics, hud, camera } = this.deps;
    audio.play(events);
    for (const e of events) {
      switch (e.type) {
        case 'land':
          haptics.buzz(18, 120);
          break;
        case 'badLanding':
          this.flash(0xff3b30, 1.1);
          haptics.buzz([40, 50, 120]);
          break;
        case 'wallImpact':
          this.flash(0xff3b30, 0.75 + e.force * 0.6);
          haptics.buzz(e.force > 0.6 ? [35, 40, 110] : [25 + Math.round(e.force * 60)]);
          break;
        case 'scrape':
          this.hold(0xff3b30, 0.7, 0.7);
          // Espacé : relancer le moteur à chaque pas l'annule avant qu'il soit senti.
          haptics.buzz(9, 190);
          break;
        case 'pickup':
          if (e.kind === 'coin') {
            hud.showPop(`× +${e.gain.toFixed(1)}`, `#${COIN_COLOURS[e.tier].toString(16)}`);
            this.flash(COIN_COLOURS[e.tier], 0.75 + e.gain * 0.9);
            haptics.buzz(10 + Math.round(e.gain * 22));
          } else if (e.kind === 'fix') {
            hud.showPop('REPAIRED', '#35e08a');
            this.flash(0x35e08a);
            haptics.buzz([22, 40, 22]);
          } else if (e.kind === 'sup') {
            this.superBoost();
          } else {
            hud.showPop('INVINCIBLE', '#9b6bff');
            this.flash(RIDE_COLOUR, 1.4);
            haptics.buzz([25, 30, 25, 30, 60]);
          }
          break;
        case 'ride':
          // Tenu comme le frottement, dans le violet de l'item : le mur pousse,
          // il ne mord pas, et la coque doit le dire à chaque pas de contact.
          this.hold(RIDE_COLOUR, 0.8, 0.9);
          haptics.buzz(7, 160);
          break;
        case 'rideEnd':
          this.flash(RIDE_COLOUR, 0.7);
          haptics.buzz([12, 30, 12]);
          break;
        case 'supEarned':
          // Trouvé ou mérité, c'est le même barreau : même onde de choc.
          this.superBoost();
          break;
        case 'driftStart':
          // Espacé : la bascule est rare — dix entrées par minute au plus,
          // mesuré — mais relancer le moteur sur un drift d'un pas ne se sent
          // pas, il s'annule.
          haptics.buzz(12, 220);
          break;
        case 'driftEnd':
          // Même seuil que la décharge sonore, et pour la même raison : sur un
          // drift d'un seul pas la caméra n'a rien à rattraper.
          if (e.held > DRIFT_SNAP_MIN) camera.driftExitSnap();
          break;
        case 'surgeStart':
          // Blanc franc, et plus large que tout le reste : c'est le haut de
          // l'échelle, il doit être impossible à confondre avec la charge.
          this.flash(0xffffff, 2.0);
          this.fxShake = 1;
          haptics.buzz([40, 30, 40, 30, 90]);
          break;
        case 'surgeEnd':
          // Le blanc chaud de sa propre plume, et pas le cyan de la charge :
          // celui-là appartient au drift désormais.
          this.flash(0xfff6d0, 1.1);
          haptics.buzz([20, 40, 20]);
          break;
        case 'comboUp':
          // Sous le seuil le combo se construit en silence : un pop à chaque
          // drift noierait ceux des pièces. Armé, il dit son niveau et ce qu'il
          // vient de payer, dans le cyan du drift dont il est la suite.
          if (e.bonus > 0) {
            hud.showPop(`PERFECT DRIFT ×${e.count}  +${Math.round(e.bonus)}`, '#25e2ff');
            haptics.buzz([14, 30, 14]);
          }
          break;
        case 'comboEnd':
          hud.showPop(`COMBO LOST ×${e.count}`, '#dff2f8');
          break;
        case 'nearMiss':
          // L'orangé d'une brûlure, entre le rouge du mur et l'or de la réserve :
          // c'est un risque payé, pas un choc et pas une pièce.
          hud.showPop(`NEAR MISS  +${Math.round(e.bonus)}`, '#ff8a5c');
          this.flash(0xff8a5c, 0.5 + e.closeness * 0.5);
          haptics.buzz(8 + Math.round(e.closeness * 14));
          break;
        case 'supEnd':
          // Blanc, qui est la couleur que la jauge de boost prend déjà à plein :
          // le ramassage a rempli la réserve et le superboost ne l'a pas
          // consommée, donc la partie repart sur un boost entier. Un frottement
          // de mur peut en avoir mordu, ce qui est pourquoi rien n'est écrit.
          this.flash(0xffffff, 0.9);
          haptics.buzz([18, 30, 12]);
          break;
        case 'wreck':
          this.deps.onWreck();
          break;
        default:
          break;
      }
    }
  }

  /**
   * Une frame : la lueur de drift, l'amortissement du halo et de la secousse,
   * et l'annonce de la réserve revenue à plein. Horloge d'affichage, jamais le
   * pas fixe.
   */
  update(frameDt: number, state: SimState, tuning: Tuning, playing: boolean): void {
    // La lueur du drift, tenue tant qu'il dure et portée par ce que le drift
    // remplit — la réserve en croisière, la montée en poussée — donc elle dit
    // aussi « j'y suis presque », ce qu'aucun autre élément ne dit. Écartée si
    // un flash plus fort est en cours : un choc de mur prime.
    if (playing && state.drift && this.halo <= DRIFT_HALO_HOLD) {
      const ratio = driftFill(state, tuning);
      // Scintillement irrégulier, pas une pulsation : le HUD pulse déjà à
      // période fixe, et copier ce rythme ferait lire la lueur comme de
      // l'interface posée sur la coque plutôt que comme de la friction. Même
      // hasard par frame que la plume du réacteur, hors simulation.
      const flicker = 0.72 + Math.random() * 0.5;
      this.hold(
        DRIFT_HALO,
        DRIFT_HALO_HOLD,
        (DRIFT_HALO_MIN + (DRIFT_HALO_MAX - DRIFT_HALO_MIN) * ratio) * flicker,
      );
    }

    if (this.halo > 0) this.halo = Math.max(0, this.halo - frameDt / HALO_TIME);
    this.deps.ship.setHalo(this.haloColour, this.halo, this.haloPower);

    if (this.fxShake > 0) this.fxShake = Math.max(0, this.fxShake - frameDt / FX_SHAKE_TIME);

    if (playing) {
      if (state.energy < BOOST_READY_ARM) this.boostArmed = true;
      else if (this.boostArmed && state.energy >= 100) {
        this.boostArmed = false;
        this.deps.audio.boostReady();
      }
    }
  }
}
