/**
 * La caméra de poursuite.
 *
 * Elle suit la piste plutôt que le vaisseau : sa position comme sa visée
 * viennent de `sample`, décalées latéralement d'une fraction du décalage du
 * vaisseau lui-même. C'est ce qui garde un virage lisible — la caméra y entre
 * en tête au lieu d'être traînée de côté.
 *
 * Deux détails à garder :
 *
 * - **Le roulis est partiel dans un virage et total dans une vrille.** Suivre
 *   le dévers complètement à chaque virage donne la nausée ; l'ignorer tout à
 *   fait rend une vrille illisible. Le mélange bascule autour de 0,5 rad.
 * - **Le retard est en temps de frame, pas de simulation.** C'est un
 *   amortissement d'affichage, donc il prend le vrai delta de frame comme tout
 *   autre lissage ici.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import {
  thrustTier,
  trackPoint,
  type SimState,
  type ThrustTier,
  type Track,
  type Tuning,
} from '../sim/index.js';
import { driftIntensity, driftSide } from './drift.js';

/**
 * Fraction du décalage latéral du vaisseau appliquée derrière et devant.
 *
 * `OFFSET_BEHIND` est exporté parce que la caméra n'est pas seulement ce qui
 * voit : c'est aussi ce qui **écoute**. Le son spatial place son écoutant ici,
 * `camDist` en arrière et à cette fraction de l'écart du vaisseau, et non sur
 * la coque. Voir `flyby.ts`.
 */
export const OFFSET_BEHIND = 0.55;
const OFFSET_AHEAD = 0.25;

/** Dévers sous lequel la caméra ne suit qu'en partie, et largeur du mélange. */
const FOLLOW_FROM = 0.5;
const FOLLOW_SPAN = 0.7;

/**
 * Champ de vision, sa convergence, et le retard de position, par barreau de
 * poussée.
 *
 * L'indice 1 tient exactement ce qu'un boost recevait — `+7` degrés, convergence
 * à 6, pas de changement du retard — donc un boost a aujourd'hui l'air d'hier
 * et seul le super boost est neuf. C'est aussi ce qui tient les captures de
 * scène figées à l'écart : ce sont des frames du mode attraction, où le
 * barreau vaut 0.
 *
 * Le coup à l'indice 2 fait délibérément plus du double, et le retard lâche :
 * un super boost doit se lire comme une catapulte plutôt qu'une poussée plus
 * forte, et une caméra qui reste collée se lit comme une poussée plus forte.
 * Voir docs/FX-PALETTE.md §15.
 */
const FOV_KICK = [0, 7, 18, 26] as const;
const FOV_EASE = [3, 6, 11, 14] as const;
const LAG_SCALE = [1, 1, 0.55, 0.4] as const;

/**
 * Multiplicateur de rattrapage appliqué au retard après un drift, et sa durée.
 *
 * Pendant une glisse le décalage latéral du vaisseau bouge plus vite que la
 * caméra ne suit, donc le cadre traîne derrière. Le rattraper au retard
 * habituel prendrait près d'une seconde, et se lirait comme de la mollesse au
 * moment précis où le contrôle revient.
 */
const SNAP_GAIN = 2.4;
const SNAP_TIME = 0.32;

/**
 * Ce qu'un drift fait à la caméra : la visée glisse vers le côté où le vaisseau
 * part, et l'horizon roule dans le même sens, tous deux en retard sur la glisse.
 *
 * Les CAM_DRIFT_YAW et CAM_DRIFT_ROLL de la palette. Jusque-là la caméra ne
 * lisait ni `slip` ni `drift`, donc une glisse n'était dite que par le lacet de
 * la coque et la gerbe, et le cadre lui-même restait rigide. Les deux effets
 * lisent la seule échelle partagée, `driftIntensity`, et son côté mesuré ; les
 * deux sont petits, en mètres de décalage de visée et en radians de roulis,
 * parce que le surge est au-dessus et qu'une caméra qui balance fort à chaque
 * drift mangerait le barreau du dessus.
 *
 * Amorti en temps de frame, comme le retard de position — le retard est le
 * but, une caméra qui claque avec la glisse se lit boulonnée à la coque. Nul
 * hors drift, donc nul dans toute capture du mode attraction.
 */
const DRIFT_AIM = 4.0;
const DRIFT_ROLL = 0.07;
const DRIFT_EASE = 3.5;

/**
 * La caméra rapprochée des écrans bas — un téléphone en paysage.
 *
 * `fitAspect` tient déjà le champ horizontal sur un écran large, ce qui
 * grossit le vaisseau de 17 % en 19,5:9 ; joué, c'était encore trop loin.
 * Sous `COMPACT_BELOW` pixels CSS de haut la caméra recule moins et vole plus
 * bas, ce qui rapproche le vaisseau d'un tiers de plus. Les captures de scène
 * font 720 px de haut et ne le voient pas.
 */
export const COMPACT_BELOW = 520;
const COMPACT_DIST = 0.7;
const COMPACT_HEIGHT = 0.85;
const COMPACT_LOOK = 0.85;

/**
 * La caméra dans le vaisseau, le temps d'un G-SURGE.
 *
 * Le quatrième barreau ne va pas plus vite qu'un super boost — il n'y a plus de
 * place sous le plafond du moteur — donc il ne peut se dire qu'autrement. Passer
 * dans la coque est le plus fort de ces « autrement » : la piste cesse d'être
 * regardée et devient traversée, et le même défilement qu'une seconde plus tôt
 * se lit deux fois plus vite parce que rien n'est plus loin.
 *
 * `COCKPIT_DIST` est **négatif** : l'œil se pose devant l'origine, au nez, et
 * non au centre de masse. Essayé à 0,2 en arrière, il tombait au milieu de la
 * coque et l'on regardait ses propres ailes de l'intérieur — du clipping, pas
 * une vue de cockpit. Au nez, rien n'occulte et la silhouette reste hors cadre.
 * `COCKPIT_HEIGHT` se tient juste au-dessus du vol stationnaire, 1,35, pour
 * qu'on soit posé dans la machine et non au-dessus. La visée porte plus loin :
 * de si bas, viser court ne montrerait que du bitume.
 *
 * **L'écart latéral passe de `OFFSET_BEHIND` à 1.** En poursuite la caméra
 * reste en retrait vers le centre, ce qui donne du contexte ; dans la coque il
 * n'y a plus de retrait possible, on *est* le vaisseau. Le retard aussi
 * disparaît : une caméra boulonnée ne traîne pas derrière ce qui la porte.
 */
const COCKPIT_DIST = -1.8;
const COCKPIT_HEIGHT = 1.55;
const COCKPIT_LOOK = 1.45;
const COCKPIT_LAG = 42;

/**
 * Durées de la transition, en secondes, et elles sont dissymétriques à dessein.
 *
 * 225 ms pour entrer : assez pour que le mouvement se lise comme un plongeon
 * dans la coque plutôt qu'une coupure. 125 ms pour sortir : l'état est fini, et
 * traîner dehors ferait porter la fin de l'effet par la caméra alors qu'elle
 * appartient au moteur et au son.
 *
 * Une durée franche, pas une constante de temps : un amortissement exponentiel
 * n'arrive jamais, et ces deux nombres-là ont été demandés en millisecondes. Le
 * lissage est donc posé sur la progression — `smoothstep` — et non sur la
 * cadence, ce qui laisse la durée exacte tout en retirant les deux ruptures de
 * vitesse aux extrémités.
 */
const COCKPIT_IN = 0.225;
const COCKPIT_OUT = 0.125;

/** 3t² − 2t³ : nulle en pente aux deux bouts, exacte en durée. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class ChaseCamera {
  /* Réutilisés à chaque frame. Voir la règle sans allocation de CLAUDE.md. */
  private readonly behind = trackPoint();
  private readonly ahead = trackPoint();
  private readonly want = new Vector3();
  private readonly position = new Vector3();
  private readonly target = new Vector3();

  private fov: number;
  private placed = false;
  /** Amorti, donc à remettre à zéro pour une capture. Voir `reset`. */
  private snap = 0;
  /** La glisse telle que la caméra la sent, −1 à 1, amortie. Remise à zéro aussi. */
  private drift = 0;
  /** Écran bas : la caméra se rapproche. Posé par le client depuis la fenêtre. */
  private compact = false;
  /**
   * Progression de l'entrée dans la coque, 0 à 1. Amortie sur plusieurs frames,
   * donc à remettre à zéro pour une capture — voir `reset`.
   */
  private cockpit = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    tuning: Tuning,
  ) {
    this.fov = tuning.fovBase;
  }

  /**
   * Abandonne tout ce que la caméra accumule : le retard de position, et le
   * champ de vision, qui converge sur plusieurs secondes vers la vitesse
   * courante.
   *
   * Oublier le champ de vision n'est pas cosmétique. Cela laisse la projection
   * là où les frames d'avant la remise à zéro l'avaient portée, c'est-à-dire
   * autant de frames que la page a mis à charger — assez pour déplacer chaque
   * étoile et chaque portique d'une frame capturée alors que la simulation est
   * identique au bit. C'est exactement ainsi que ça a été trouvé.
   */
  reset(tuning: Tuning): void {
    this.placed = false;
    this.fov = tuning.fovBase;
    this.snap = 0;
    this.drift = 0;
    this.cockpit = 0;
  }

  /** Un écran de moins de `COMPACT_BELOW` pixels de haut rapproche la caméra. */
  setCompact(compact: boolean): void {
    this.compact = compact;
  }

  /** Appelé sur `driftEnd` : la caméra se recentre au lieu de revenir en dérivant. */
  driftExitSnap(): void {
    this.snap = 1;
  }

  /**
   * @param shake la secousse de la simulation plus ce que le client ajoute pour
   *   un impact. Appliquée en bruit de position, d'où le passage en paramètre
   *   plutôt qu'une lecture : le tremblement est de la présentation et ne doit
   *   pas atteindre la simulation, et la part du client ne doit pas être
   *   réécrite dans `state.shake`.
   */
  update(state: SimState, track: Track, tuning: Tuning, frameDt: number, shake: number): void {
    const tier = thrustTier(state);

    // L'entrée dans la coque, en durée franche et non en constante de temps.
    const want = state.surgeT > 0 ? 1 : 0;
    const step = want > this.cockpit ? frameDt / COCKPIT_IN : -(frameDt / COCKPIT_OUT);
    this.cockpit = MathUtils.clamp(this.cockpit + step, 0, 1);
    const inside = smoothstep(this.cockpit);

    const dist = MathUtils.lerp(
      tuning.camDist * (this.compact ? COMPACT_DIST : 1),
      COCKPIT_DIST,
      inside,
    );
    const look = MathUtils.lerp(
      tuning.lookAhead * (this.compact ? COMPACT_LOOK : 1),
      tuning.lookAhead * COCKPIT_LOOK,
      inside,
    );
    const behind = track.sample(state.cursor, -dist, this.behind);
    const ahead = track.sample(state.cursor, look, this.ahead);

    const offBehind = state.lat * MathUtils.lerp(OFFSET_BEHIND, 1, inside);
    const offAhead = state.lat * OFFSET_AHEAD;
    const height =
      MathUtils.lerp(
        tuning.camHeight * (this.compact ? COMPACT_HEIGHT : 1),
        COCKPIT_HEIGHT,
        inside,
      ) +
      state.hop * 0.6;

    this.want.set(
      behind.x + behind.rx * offBehind + behind.ux * height,
      behind.y + behind.ry * offBehind + behind.uy * height,
      behind.z + behind.rz * offBehind + behind.uz * height,
    );
    if (!this.placed) {
      this.position.copy(this.want);
      this.placed = true;
    }
    if (this.snap > 0) this.snap = Math.max(0, this.snap - frameDt / SNAP_TIME);
    const lag = MathUtils.lerp(
      tuning.camLag * LAG_SCALE[tier] * (1 + this.snap * (SNAP_GAIN - 1)),
      COCKPIT_LAG,
      inside,
    );
    this.position.lerp(this.want, Math.min(1, frameDt * lag));
    this.camera.position.copy(this.position);

    if (shake > 0) {
      const a = shake * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }

    // La glisse, telle que la caméra la sent : signée, amortie, nulle hors drift.
    const slide = driftIntensity(state) * driftSide(state);
    this.drift += (slide - this.drift) * Math.min(1, frameDt * DRIFT_EASE);

    // Ramené dans [-pi, pi] : le dévers n'est pas borné, une vrille ajoute des tours.
    const bank = Math.atan2(Math.sin(behind.bank), Math.cos(behind.bank));
    const follow = MathUtils.clamp((Math.abs(bank) - FOLLOW_FROM) / FOLLOW_SPAN, 0, 1);
    // Le drift roule l'horizon comme le ferait un dévers vers le côté de la
    // glisse : un dévers positif pousse le vaisseau vers −lat, d'où le signe
    // inversé.
    const roll = bank * (tuning.camRoll + (1 - tuning.camRoll) * follow) - this.drift * DRIFT_ROLL;
    this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);

    // La visée glisse le long de l'axe latéral de la piste, en espace lat comme
    // les décalages au-dessus, vers là où le vaisseau va vraiment.
    const aim = offAhead + this.drift * DRIFT_AIM;
    this.target.set(
      ahead.x + ahead.rx * aim + ahead.ux * tuning.lookHeight,
      ahead.y + ahead.ry * aim + ahead.uy * tuning.lookHeight,
      ahead.z + ahead.rz * aim + ahead.uz * tuning.lookHeight,
    );
    this.camera.lookAt(this.target);

    this.updateFov(state, tuning, frameDt, tier);
  }

  /** S'élargit avec la vitesse, par barreau en poussée, et un peu contre un mur. */
  private updateFov(state: SimState, tuning: Tuning, frameDt: number, tier: ThrustTier): void {
    const wanted =
      tuning.fovBase +
      Math.min(1, state.speed / tuning.speedMax) * tuning.fovSpeed +
      FOV_KICK[tier] +
      (state.scrape > 0 ? 3 : 0);
    this.fov += (wanted - this.fov) * Math.min(1, frameDt * FOV_EASE[tier]);
    this.camera.fov = fitAspect(this.fov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}

/** Le rapport d'écran sur lequel chaque champ de vision de l'accord a été choisi. */
export const REF_ASPECT = 16 / 9;

/**
 * Le champ de vision vertical à employer sur un écran plus large que 16:9.
 *
 * three.js prend un angle vertical et laisse la largeur suivre le rapport
 * d'écran, donc un téléphone en paysage — 19,5:9, 20:9 — voyait simplement plus
 * de monde de chaque côté, et le vaisseau, dont la taille à l'écran est fixée
 * par cet angle, sortait de la même hauteur que sur un moniteur cent fois plus
 * grand. Sur un petit écran ça se lit comme un vaisseau trop loin. Tenir le
 * champ *horizontal* constant fait qu'un écran plus large zoome au lieu de
 * s'élargir : le vaisseau grandit du rapport des aspects, 17 % en 19,5:9.
 *
 * Rien ne se passe à 16:9 ou plus étroit, là où chaque référence de scène
 * figée est prise, et c'est pourquoi aucune ne bouge.
 */
export function fitAspect(vertical: number, aspect: number): number {
  if (aspect <= REF_ASPECT) return vertical;
  const half = Math.tan(MathUtils.degToRad(vertical) / 2) * (REF_ASPECT / aspect);
  return MathUtils.radToDeg(2 * Math.atan(half));
}
