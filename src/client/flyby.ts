/**
 * Les objets de la piste, entendus au passage.
 *
 * L'étape qui fabrique vraiment la vitesse. Les couches tenues — moteur, vent,
 * frottement — disent *à quelle allure* on va ; elles ne disent jamais qu'on
 * **dépasse** quelque chose. Un objet qui arrive de loin, se place sur un bord,
 * descend d'un demi-ton en passant et s'éteint derrière : voilà ce que l'oreille
 * lit comme du déplacement, et ce qu'aucune bande continue ne peut imiter.
 *
 * **Pourquoi les objets et pas la piste elle-même.** L'arithmétique tranche :
 * un segment fait 12 m, donc à 200 m/s la géométrie de la piste défile à 16
 * événements par seconde, et la période des chevrons vaut 8,3 Hz — ce n'est plus
 * un rythme, c'est un timbre, et le moteur occupe déjà ce registre. Les objets,
 * eux, sont rares : `coinChance` vaut 0,015 par segment, soit une pièce tous les
 * 800 m, soit une toutes les quatre secondes à 200 m/s. Assez espacé pour se
 * lire comme un objet qu'on double.
 *
 * La géométrie est sortie de la classe et exportée, parce qu'elle est
 * l'essentiel et qu'elle se teste sans navigateur. Le reste n'est que du
 * câblage Web Audio.
 *
 * Tout est alloué à la construction — voix, oscillateurs, panoramiques — et
 * rien ne l'est ensuite : règle de la boucle. Une voix inutilisée n'est pas
 * détruite, son gain tombe à zéro.
 */
import { BACK, ITEM_COIN, ITEM_FIX, ITEM_FUEL, ITEM_RIDE, SEG } from '../sim/index.js';
import type { Item, Track } from '../sim/index.js';
import { GANTRY_EVERY } from './gantry.js';
import { panOf } from './pan.js';

/**
 * Portée, en mètres : au-delà, devant comme derrière, la voix est muette.
 *
 * 110 m fait environ une seconde d'audition à 200 m/s, et moins d'une demie au
 * plafond. Plus loin, les objets se chevaucheraient — un toutes les 480 m
 * toutes listes confondues — et la scène deviendrait un bourdon.
 */
const RANGE = 110;

/** Distance de référence de l'atténuation, en mètres. */
const REF = 18;

/**
 * Désaccord maximal du passage, en cents, et la vitesse à laquelle il est
 * atteint.
 *
 * Ce n'est pas l'effet Doppler physique, et ça ne peut pas l'être : le son va à
 * 340 m/s et le vaisseau monte à 409, donc la formule passe le mur et diverge.
 * On garde sa *forme* — aigu en approche, neutre au travers, grave derrière —
 * et on la dose à l'oreille.
 */
const DOPPLER_CENTS = 260;
const DOPPLER_REF_SPEED = 260;
const DOPPLER_MAX_FACTOR = 1.5;

/** Voix d'objets simultanées. Mesuré : il y a 0 ou 1 objet en portée, rarement 2. */
const VOICES = 3;

/**
 * Gain de crête d'un objet, et celui d'un portique.
 *
 * Descendus après écoute : la première version passait pour un élément du mix
 * alors que ce doit être un indice — « il y a quelque chose, à gauche ». Un
 * passage doit s'entendre sans qu'on l'écoute, et se rater si on écoute
 * ailleurs.
 */
const ITEM_GAIN = 0.018;
const GANTRY_GAIN = 0.02;

/**
 * Fréquence de base par type d'objet, en Hz.
 *
 * Descendues d'une octave après écoute : le premier jeu sifflait. Elles ne
 * cherchent pas l'accord — chacune doit se distinguer des autres — mais elles
 * vivent désormais dans le médium grave, sous le corps du moteur plutôt
 * qu'au-dessus de son sifflement. Le prisme reste le plus haut parce qu'il est
 * le plus rare et le plus désirable.
 */
const FREQ_BY_TYPE: Record<number, number> = {
  [ITEM_COIN]: 310,
  [ITEM_FIX]: 240,
  [ITEM_FUEL]: 180,
  [ITEM_RIDE]: 440,
};

/**
 * Les portiques : deux voix, et un registre à part.
 *
 * Ils ne sont pas des objets qu'on longe mais des arches qu'on **traverse**,
 * donc pas de panoramique — ils n'ont pas de côté, et leur en donner un serait
 * un mensonge de plus que le centre. Il leur reste le gonflement et le
 * désaccord, ce qui suffit : espacés de 144 m, ils défilent à une cadence que
 * l'oreille compte, et une cadence qui accélère est ce que la vitesse fait.
 *
 * Grave, parce qu'ils sont gros, et parce que le registre où les objets
 * viennent de descendre est déjà pris.
 */
const GANTRY_VOICES = 2;
const GANTRY_FREQ = 96;
/** Portée propre : plus courte, sinon deux portiques se chevauchent toujours. */
const GANTRY_RANGE = 90;

/** Constante de temps du suivi. Courte, mais pas nulle : voir `assign`. */
const EASE = 0.05;

/**
 * Le panoramique d'un objet à `ahead` mètres devant et `lat` mètres de côté.
 *
 * C'est le sinus de l'angle sous lequel on le voit, ce qui fait le balayage
 * tout seul : un objet loin devant est presque au centre quel que soit son
 * écart, et il part sur le bord d'autant plus vite qu'on l'approche. Aucune
 * courbe à régler, c'est la géométrie qui la donne.
 *
 * L'inversion vers la gauche de l'écran passe par `panOf`, comme tout le reste.
 */
export function flybyPan(ahead: number, lat: number): number {
  const r = Math.hypot(ahead, lat);
  return r < 1e-6 ? 0 : panOf(lat / r);
}

/**
 * Le gain d'un objet, 0 à 1 : une atténuation en carré de la distance, fermée
 * par une fenêtre qui atteint exactement zéro à `RANGE`.
 *
 * La fenêtre n'est pas une coquetterie : sans elle une voix s'éteint sur un
 * palier non nul quand l'objet sort de portée, et ça s'entend comme un clic.
 */
export function flybyGain(ahead: number, lat: number): number {
  const r = Math.hypot(ahead, lat);
  if (r >= RANGE) return 0;
  const near = 1 / (1 + (r / REF) * (r / REF));
  return near * (1 - r / RANGE);
}

/**
 * Le désaccord d'un objet, en cents : positif devant, nul au travers, négatif
 * derrière — et d'autant plus marqué qu'on va vite.
 */
/**
 * Le gain d'un portique, 0 à 1. Même forme que celui d'un objet, sur sa propre
 * portée : ils sont espacés de 144 m, donc une portée de 110 m en laisserait
 * deux audibles en permanence et la cadence se perdrait dans le recouvrement.
 */
export function gantryGain(ahead: number): number {
  const r = Math.abs(ahead);
  if (r >= GANTRY_RANGE) return 0;
  const near = 1 / (1 + (r / REF) * (r / REF));
  return near * (1 - r / GANTRY_RANGE);
}

export function flybyDetune(ahead: number, lat: number, speed: number): number {
  const r = Math.hypot(ahead, lat);
  if (r < 1e-6) return 0;
  const pace = Math.min(DOPPLER_MAX_FACTOR, speed / DOPPLER_REF_SPEED);
  return DOPPLER_CENTS * pace * (ahead / r);
}

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  /** Nul pour un portique : une arche n'a pas de côté. */
  pan: StereoPannerNode | null;
}

export class Flybys {
  private readonly voices: Voice[] = [];

  private readonly gantries: Voice[] = [];

  constructor(ctx: AudioContext, dest: AudioNode) {
    for (let i = 0; i < GANTRY_VOICES; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = GANTRY_FREQ;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // Pas de panoramique : une arche n'a pas de côté. La voix sort au centre,
      // ce qui est aussi une économie de deux nœuds.
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      this.gantries.push({ osc, gain, pan: null });
    }
    for (let i = 0; i < VOICES; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = FREQ_BY_TYPE[ITEM_COIN]!;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(gain);
      gain.connect(pan);
      pan.connect(dest);
      osc.start();
      this.voices.push({ osc, gain, pan });
    }
  }

  /**
   * Une frame de scène.
   *
   * Les deux listes sont parcourues dans l'ordre de la piste, donc par distance
   * croissante, et les premières en portée prennent les voix. Une voix peut
   * donc changer d'objet quand l'un sort de portée ; la constante de temps du
   * suivi absorbe le saut, ce qui est tout ce qu'on lui demande — à trois voix
   * pour zéro ou un objet en portée, le cas est rare et bref.
   */
  update(playing: boolean, track: Track, cursor: number, speed: number): void {
    let used = 0;
    let arches = 0;
    if (playing) {
      const base = track.nid[0]!;
      used = this.scan(track.items, base, cursor, speed, used);
      used = this.scan(track.extras, base, cursor, speed, used);
      arches = this.scanGantries(track, cursor, speed);
    }
    for (let i = used; i < this.voices.length; i++) {
      this.voices[i]!.gain.gain.setTargetAtTime(0, this.now(this.voices, i), EASE);
    }
    for (let i = arches; i < this.gantries.length; i++) {
      this.gantries[i]!.gain.gain.setTargetAtTime(0, this.now(this.gantries, i), EASE);
    }
  }

  /**
   * Les portiques en portée, dans l'ordre de la piste.
   *
   * On parcourt les identifiants de segment plutôt qu'une liste : les portiques
   * ne sont pas des objets de la simulation, ils sont posés tous les
   * `GANTRY_EVERY` segments par la façon dont la piste est habillée.
   */
  private scanGantries(track: Track, cursor: number, speed: number): number {
    let n = 0;
    for (let i = 0; i < track.nid.length && n < this.gantries.length; i++) {
      if (track.nid[i]! % GANTRY_EVERY !== 0) continue;
      const ahead = (i - BACK) * SEG - cursor;
      const gain = gantryGain(ahead);
      if (gain <= 0) continue;
      const v = this.gantries[n++]!;
      const t = this.now(this.gantries, n - 1);
      v.osc.detune.setTargetAtTime(flybyDetune(ahead, 0, speed), t, EASE);
      v.gain.gain.setTargetAtTime(gain * GANTRY_GAIN, t, EASE);
    }
    return n;
  }

  private scan(
    list: readonly Item[],
    base: number,
    cursor: number,
    speed: number,
    used: number,
  ): number {
    for (const item of list) {
      if (used >= this.voices.length) return used;
      if (item.taken) continue;
      const ahead = (item.id - base - BACK) * SEG - cursor;
      const gain = flybyGain(ahead, item.lat);
      if (gain <= 0) continue;
      const v = this.voices[used++]!;
      const t = this.now(this.voices, used - 1);
      v.osc.frequency.setTargetAtTime(FREQ_BY_TYPE[item.type] ?? FREQ_BY_TYPE[ITEM_COIN]!, t, EASE);
      v.osc.detune.setTargetAtTime(flybyDetune(ahead, item.lat, speed), t, EASE);
      v.pan!.pan.setTargetAtTime(flybyPan(ahead, item.lat), t, EASE);
      v.gain.gain.setTargetAtTime(gain * ITEM_GAIN, t, EASE);
    }
    return used;
  }

  /** L'horloge du contexte, prise sur la voix plutôt que stockée. */
  private now(pool: readonly Voice[], i: number): number {
    return pool[i]!.osc.context.currentTime;
  }
}
