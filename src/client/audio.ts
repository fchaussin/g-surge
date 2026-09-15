/**
 * Tout ce qu'on entend, synthétisé. Aucun fichier, ce qui est pourquoi le
 * bundle n'a aucune chaîne d'actifs.
 *
 * Le moteur est trois bandes de bruit filtré — grondement bas, corps médium,
 * sifflement haut — plus une sinusoïde très discrète pour le sifflement de
 * turbine. Des oscillateurs harmoniques ont été essayés d'abord et sonnaient
 * comme un moteur à pistons ; le bruit est ce qui le fait lire comme un
 * réacteur.
 *
 * Rien ici n'est créé avant un geste de l'utilisateur : les navigateurs
 * refusent sinon de démarrer un `AudioContext`, et un échec d'autoplay dans la
 * console à chaque chargement est un bruit d'un autre genre.
 */
import type { SimEvent, ThrustTier } from '../sim/index.js';
import type { Track } from '../sim/index.js';
import { Flybys } from './flyby.js';
import { panOf } from './pan.js';

/** Longueur de l'impulsion de réverbération, en secondes. Bâtie une fois, au premier usage. */
/* --- L'explosion finale, d'après le modèle décrit dans `crash` --- */

/** La coupe du modèle, fondu de sortie compris. */
const CRASH_SECONDS = 2.82;
/** Le canal droit, décalé : de la largeur, pas un écho. */
const CRASH_SHIFT = 0.05;
/** Étages d'allpass du phaser. Le modèle en demande quatorze, voir `crash`. */
const CRASH_STAGES = 8;
const CRASH_LFO_HZ = 0.1;
const CRASH_FEEDBACK = 0.7;
/** Le bas et le haut du balayage des allpass, en Hz. */
const CRASH_SWEEP_FROM = 420;
const CRASH_SWEEP_DEPTH = 1100;
/** Les deux plateaux de tonalité, en dB. Le grave est bridé, voir `crash`. */
const CRASH_BASS_DB = 18;
const CRASH_TREBLE_DB = 7;
/** Ce qui sort, après le compresseur qui tient le grave. */
const CRASH_LEVEL = 0.42;

const REVERB_SECONDS = 3;

/**
 * Plafond du rapport de vitesse du moteur.
 *
 * Au-dessus de 1 sous boost, ce qui empêche le haut de s'aplatir — mais c'est
 * un plafond, et passé celui-ci chaque couche cesse de bouger pendant que le
 * vaisseau accélère encore. Cela en fait une contrainte sur l'accord et pas
 * seulement sur ce fichier : `boostFactor * supFactor` doit rester en dessous.
 * Exporté pour qu'un test le dise, puisque rien d'autre ne remarquerait le jour
 * où ça cesserait d'être vrai.
 */
export const ENGINE_R_MAX = 1.7;

/**
 * Poussée du moteur par barreau.
 *
 * L'indice 1 vaut 1, ce que le booléen remplacé donnait toujours à un boost,
 * donc un boost sonne exactement comme avant et seul le super boost est neuf.
 * Jusque-là `update` ne recevait jamais `superT` : le réacteur et le vent
 * étaient le cas le plus net du super boost qui n'est qu'un boost avec une
 * autre plume.
 */
const DRIVE_BY_TIER = [0, 1, 2, 0] as const;

/**
 * Le vent est la seule couche qu'un boost n'a jamais levée, donc il n'y a pas
 * de valeur antérieure à préserver et le barreau peut la posséder entièrement.
 * La §10 de la palette demande aussi un vent renforcé sous un simple boost ;
 * c'est un changement du son d'un boost, et ce n'est pas l'affaire de cette
 * étape.
 */
const WIND_BY_TIER = [0, 0, 1, 1] as const;

/**
 * Le surge ne sonne pas plus fort, il sonne *bouché*.
 *
 * Il ne reste pas de place au-dessus : `boostFactor * supFactor` vaut 1,586
 * contre un plafond de 1,7, donc un quatrième barreau ne peut pas se bâtir en
 * ajoutant. Il se bâtit en retirant — les couches du moteur couchées à presque
 * rien, la bande de drift couchée avec elles, et le vent passé au travers
 * d'un passe-bas jusqu'à ne laisser qu'un souffle. Des tympans gonflés, pas
 * du silence : rien n'est coupé net, tout est couché par `duck`. Voir
 * docs/FX-PALETTE.md §16.
 *
 * La constante de temps est longue à dessein : une pression qui se ferme, pas
 * un interrupteur.
 */
const SURGE_DUCK = 0.16;
const SURGE_WIND_HZ = 340;
const SURGE_WIND_GAIN = 0.11;
const SURGE_EASE = 0.28;

/**
 * Plus court drift, en secondes, qui mérite un whoosh de réalignement.
 *
 * Pas une supposition : un drift d'un seul pas existe, mesuré à 1 ms en
 * louvoyant. Son entrée et sa sortie tomberaient l'une sur l'autre et se
 * liraient comme un clic plutôt que deux instants. Le transitoire d'entrée est
 * assez court pour tenir seul, donc seule la sortie est filtrée.
 */
const DRIFT_RELEASE_MIN = 0.12;

/** Gain de la bande d'air du drift à pleine dérive. Elle était plate à 0,09. */
const DRIFT_AIRFLOW = 0.12;

/**
 * La turbulence de la bande de drift : deux sinusoïdes lentes à des cadences
 * incommensurables, sommées, qui pilotent la fréquence centrale de la bande et
 * son gain. Deux cadences plutôt qu'une pour que le flottement ne se cale
 * jamais sur un battement que l'oreille prédirait — le SFX_DRIFT_TURBULENCE de
 * la palette demande de l'irrégulier, et un seul LFO est une sirène. La
 * profondeur suit l'intensité du drift : une glisse légère flotte à peine, une
 * pleine déchire.
 */
const TURB_RATES = [3.3, 5.9] as const;

/**
 * Le bouclier : une bobine Tesla, entendue. Deux dents de scie graves qui
 * battent l'une contre l'autre sous un passe-bas serré — le bourdon — hachées
 * par une modulation à quelques dizaines de hertz, qui est le crépitement, et
 * un filet de souffle aigu par-dessus, l'étincelle. Tout suit `ShieldFx.value`,
 * donc le son monte, clignote et s'éteint avec les arcs et les rails.
 */
const SHIELD_HZ = 46;
const SHIELD_BEAT = 0.7;
const SHIELD_LOWPASS = 190;
const SHIELD_CRACKLE_HZ = 27;
const SHIELD_GAIN = 0.16;
const SHIELD_SPARK_GAIN = 0.02;
const TURB_FREQ_DEPTH = 420;
const TURB_GAIN_DEPTH = 0.3;

/**
 * Où la voix de recharge commence, par barreau de poussée, en Hz.
 *
 * La voix suivait la seule réserve, et se taisait dès qu'elle était pleine —
 * ce qui, sous boost, est exactement le moment où le drift commence à compter
 * pour le barreau suivant. Elle suit désormais ce que le drift remplit, et
 * chaque barreau chante un registre plus haut, pour que l'oreille sache quel
 * barreau se gravit sans qu'une couleur le lui dise : dette 10, un peu
 * remboursée. Le surge n'a rien au-dessus, et son blanc coupe cette voix de
 * toute façon.
 *
 * La montée de fréquence est restée ; le timbre, non. Une seule triangulaire
 * glissant vers l'aigu se lisait comme un gag de dessin animé, pas comme une
 * charge. Deux dents de scie légèrement désaccordées battent l'une contre
 * l'autre — plus proche d'un champ d'énergie qu'une note — et un filtre
 * passe-bas qui s'ouvre avec la charge tient le grain de la scie sous
 * contrôle tant que la réserve est loin d'être pleine.
 */
const CHARGE_BASE_BY_TIER = [300, 400, 520, 520] as const;
const CHARGE_SPAN = 560;
const CHARGE_DETUNE_CENTS = 9;
const CHARGE_FILTER_BASE = 650;
const CHARGE_FILTER_SPAN = 2200;

/**
 * Constante de temps du panoramique latéral.
 *
 * `pan` est un `AudioParam` comme les gains : une affectation directe à la
 * cadence des frames est un saut, donc un clic. Même raison qu'eux, voir
 * `update`.
 */
const PAN_EASE = 0.06;

interface Band {
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface Engine {
  rumble: Band;
  body: Band;
  hiss: Band;
  whine: OscillatorNode;
  whineGain: GainNode;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: Engine | null = null;
  private wind: Band | null = null;
  private driftNoise: Band | null = null;
  /** Le frottement sous invincibilité : une bande tenue tant que les pas de contact arrivent. */
  private rideBand: Band | null = null;
  /** Un pas de contact est arrivé depuis la dernière frame. */
  private riding = false;
  /**
   * Le raclement contre un mur, même forme que `rideBand` et pour la même
   * raison : `scrape` arrive à chaque pas de contact, donc c'est une bande
   * tenue et non un coup.
   *
   * Elle manquait tout simplement. L'événement existait depuis le découpage,
   * mais seuls le voile rouge et la vibration le consommaient : on entendait le
   * choc, puis plus rien pendant qu'on rabotait la paroi. C'était le trou le
   * plus audible du mix une fois que les bords ont eu un côté.
   */
  private scrapeBand: Band | null = null;
  private scraping = false;
  /** Profondeurs de modulation de la turbulence de la bande de drift, en Hz et en gain. */
  private turb: { freq: GainNode; amp: GainNode } | null = null;
  private charge: {
    oscA: OscillatorNode;
    oscB: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null = null;
  /** Le bourdon du bouclier et son étincelle, ouverts par une seule intensité. */
  private shield: { gain: GainNode; filter: BiquadFilterNode; spark: Band } | null = null;
  /**
   * Le bus latéral : tout ce qui se produit contre un bord y passe.
   *
   * Le reste — moteur, vent, recharge, bouclier — reste au centre, et ce n'est
   * pas un oubli : ces couches appartiennent au vaisseau, qui est à l'origine
   * du monde et ne bouge jamais. Les placer quelque part serait un mensonge.
   */
  private side: StereoPannerNode | null = null;
  /** Les objets qui passent. Voir `flyby.ts` ; ils portent leur propre panoramique. */
  private flybys: Flybys | null = null;
  private reverbIn: GainNode | null = null;
  private muted = false;
  /** Aucun graphe n'existe avant un geste ; voir `unlock`. */
  private unlocked = false;

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Ouvre l'audio, depuis un geste de l'utilisateur.
   *
   * Rien avant ceci ne crée de contexte. Un navigateur suspend un contexte créé
   * hors d'un geste et s'en plaint, ce qui arrivait six fois à chaque
   * chargement parce que la machine des écrans reprenait sur sa propre première
   * transition.
   */
  unlock(): void {
    this.unlocked = true;
    this.resume();
  }

  /**
   * Reprend un contexte suspendu par le navigateur — un onglet en arrière-plan,
   * un appel qui interrompt. Sans effet jusqu'à `unlock`, donc sûr à appeler
   * depuis n'importe quel changement d'écran.
   */
  resume(): void {
    if (!this.unlocked) return;
    this.init();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Bâtit la réverbération à l'avance.
   *
   * Sa réponse impulsionnelle fait 288 000 échantillons sur deux canaux,
   * produits dans une boucle. Laissée se bâtir au premier crash, elle tombe
   * comme un à-coup au pire moment possible.
   */
  warmUp(): void {
    if (!this.unlocked) return;
    this.reverb();
  }

  /** Transforme les événements de la simulation en son. */
  play(events: readonly SimEvent[]): void {
    if (!this.ctx || this.muted) return;
    for (const e of events) {
      switch (e.type) {
        case 'land':
          this.thud(0.16, 700);
          break;
        case 'badLanding':
          this.thud(0.5, 1400, true);
          break;
        case 'wallImpact':
          this.thud(Math.min(0.5, 0.12 + e.force * 0.4), 1400, true);
          break;
        case 'pickup':
          if (e.kind === 'coin') this.coin(1 + e.gain * 3);
          else if (e.kind === 'fix') this.fix();
          else if (e.kind === 'sup') this.superBoost();
          else if (e.kind === 'ride') this.ridePickup();
          else this.fuelPickup();
          break;
        case 'supEarned':
          // Trouvé ou mérité, le même barreau : le même son.
          this.superBoost();
          break;
        case 'comboUp':
          if (e.bonus > 0) this.comboUp(e.count);
          break;
        case 'comboEnd':
          this.comboEnd();
          break;
        case 'nearMiss':
          this.nearMiss(e.closeness);
          break;
        case 'ride':
          // Un pas de contact : `update` tient la bande allumée tant qu'il en
          // arrive, et la laisse retomber sinon.
          this.riding = true;
          break;
        case 'scrape':
          this.scraping = true;
          break;
        case 'rideEnd':
          this.rideRelease();
          break;
        case 'fuelEmpty':
          this.fuelEmpty();
          break;
        case 'supEnd':
          this.superRelease();
          break;
        case 'surgeStart':
          this.surgeIn();
          break;
        case 'surgeEnd':
          this.surgeOut();
          break;
        case 'driftStart':
          this.driftEntry();
          break;
        case 'driftEnd':
          if (e.held > DRIFT_RELEASE_MIN) this.driftRelease(e.held);
          break;
        case 'wreck':
          this.crash();
          break;
        default:
          break;
      }
    }
  }

  /**
   * Les objets de la piste qu'on double, une frame de scène.
   *
   * Séparé d'`update` à dessein : celui-ci suit des couches attachées au
   * vaisseau, celui-là une scène extérieure qui a ses propres positions. Les
   * mélanger aurait demandé de passer la piste à une fonction qui n'en a que
   * faire, et qui prend déjà huit paramètres.
   *
   * @param listenerLat écart latéral de l'écoutant, en mètres d'espace piste.
   * @param back mètres dont l'écoutant est en arrière du vaisseau.
   *
   * **L'écoutant est la caméra, pas la coque.** C'est le point de vue du joueur,
   * et il est `camDist` en arrière : un objet au niveau du vaisseau n'est donc
   * pas encore passé, il lui reste dix-neuf mètres. Placer l'oreille sur la
   * coque faisait basculer le panoramique et le Doppler une demi-seconde trop
   * tôt à vitesse de croisière.
   */
  passing(
    playing: boolean,
    track: Track,
    cursor: number,
    speed: number,
    listenerLat: number,
    back: number,
  ): void {
    if (!this.ctx || this.muted) return;
    this.flybys?.update(playing, track, cursor, speed, listenerLat, back);
  }

  /**
   * Les couches continues, suivies une fois par frame.
   *
   * `setTargetAtTime` plutôt qu'une affectation directe : un saut sur un gain
   * à la cadence audio est un clic audible, et il y en a un par frame.
   */
  /**
   * @param drift 0 à 1, l'échelle de dérive partagée de `drift.ts`. C'était un
   *   booléen et un gain fixe : la bande disait qu'un drift avait lieu, jamais
   *   avec quelle force.
   * @param charge ce que le drift remplit, 0 à 1 : la réserve de boost en
   *   croisière, la montée vers le barreau suivant en poussée. Une seule
   *   échelle, celle de la jauge.
   * @param shield l'intensité du bouclier d'invincibilité, 0 à 1, amortie par
   *   `ShieldFx` : la bobine Tesla est audible à proportion.
   */
  update(
    playing: boolean,
    speed: number,
    speedMax: number,
    tier: ThrustTier,
    drift: number,
    charge: number,
    shield = 0,
    lateral = 0,
  ): void {
    const ctx = this.ctx;
    const eng = this.engine;
    if (!ctx || !eng || !this.wind || !this.driftNoise || !this.charge) return;

    const t = ctx.currentTime;
    // Au-dessus de 1 sous boost, ce qui empêche le haut de s'aplatir.
    const r = Math.min(ENGINE_R_MAX, speed / speedMax);
    const bst = DRIVE_BY_TIER[tier];
    const wnd = WIND_BY_TIER[tier];
    const surge = tier === 3;
    const duck = surge ? SURGE_DUCK : 1;
    /** La constante de temps de chaque couche, allongée pendant un surge. */
    const tc = (normal: number) => (surge ? SURGE_EASE : normal);

    eng.rumble.filter.frequency.setTargetAtTime(90 + r * 190, t, 0.1);
    eng.rumble.gain.gain.setTargetAtTime(playing ? (0.13 + r * 0.2) * duck : 0, t, tc(0.18));

    eng.body.filter.frequency.setTargetAtTime(250 + r * 850 + bst * 380, t, 0.1);
    eng.body.gain.gain.setTargetAtTime(
      playing ? (0.05 + r * 0.12 + bst * 0.05) * duck : 0,
      t,
      tc(0.16),
    );

    eng.hiss.filter.frequency.setTargetAtTime(2600 + r * 2400, t, 0.14);
    eng.hiss.gain.gain.setTargetAtTime(
      playing ? (0.012 + r * 0.055 + bst * 0.02) * duck : 0,
      t,
      tc(0.18),
    );

    eng.whine.frequency.setTargetAtTime(430 + r * 2000, t, 0.12);
    eng.whineGain.gain.setTargetAtTime(
      playing ? (0.004 + r * 0.016 + bst * 0.008) * duck : 0,
      t,
      tc(0.2),
    );

    this.wind.filter.frequency.setTargetAtTime(
      surge ? SURGE_WIND_HZ : 650 + r * 1500 + wnd * 520,
      t,
      tc(0.25),
    );
    this.wind.gain.gain.setTargetAtTime(
      playing ? (surge ? SURGE_WIND_GAIN : 0.02 + r * 0.1 + wnd * 0.06) : 0,
      t,
      tc(0.18),
    );

    // Le frottement d'invincibilité : visé haut si un pas de contact est arrivé
    // depuis la dernière frame, vers zéro sinon. Les constantes de temps font
    // le reste, sans dépendre de la cadence — `update` n'a pas le delta.
    // Le bus latéral suit le vaisseau : ce qui touche un bord vient de ce bord.
    // Amené et non posé, pour la même raison que les gains le sont.
    this.side?.pan.setTargetAtTime(playing ? panOf(lateral) : 0, t, PAN_EASE);

    this.rideBand?.gain.gain.setTargetAtTime(playing && this.riding ? 0.11 : 0, t, 0.06);
    this.rideBand?.filter.frequency.setTargetAtTime(900 + r * 700, t, 0.1);
    this.riding = false;

    // Le raclement, suivi de la même façon. Il s'ouvre un peu avec la vitesse :
    // à l'arrêt on frotte, lancé on arrache.
    this.scrapeBand?.gain.gain.setTargetAtTime(playing && this.scraping ? 0.085 : 0, t, 0.05);
    this.scrapeBand?.filter.frequency.setTargetAtTime(300 + r * 260, t, 0.1);
    this.scraping = false;

    // Le bouclier suit son intensité amortie, déjà lissée par le client ; une
    // constante courte suffit à ôter le clic. Le passe-bas s'ouvre un peu avec
    // la vitesse, pour que le bourdon ne se perde pas sous le moteur.
    if (this.shield) {
      const level = playing ? shield : 0;
      this.shield.gain.gain.setTargetAtTime(SHIELD_GAIN * level * duck, t, 0.05);
      this.shield.filter.frequency.setTargetAtTime(SHIELD_LOWPASS + r * 90, t, 0.1);
      this.shield.spark.gain.gain.setTargetAtTime(SHIELD_SPARK_GAIN * level * level, t, 0.05);
    }

    // Comme le reste sous un surge : couchée par `duck`, pas coupée net — un
    // souffle qui reste plutôt qu'un silence, cohérent avec le vent lui-même
    // quelques lignes plus haut.
    const airflow = playing ? drift * DRIFT_AIRFLOW * duck : 0;
    this.driftNoise.gain.gain.setTargetAtTime(airflow, t, 0.07);
    if (this.turb) {
      // La modulation de gain est une fraction du souffle lui-même, donc elle
      // ne peut jamais pousser la bande sous zéro : deux sinusoïdes somment à 2
      // au plus.
      this.turb.freq.gain.setTargetAtTime(drift * TURB_FREQ_DEPTH, t, 0.1);
      this.turb.amp.gain.setTargetAtTime((airflow * TURB_GAIN_DEPTH) / 2, t, 0.1);
    }

    // La recharge : elle monte avec ce que le drift remplit et ne s'entend
    // qu'en drift, parce que c'est là que la réserve se remplit trois fois plus
    // vite, là que la montée compte, et là que le joueur a une raison
    // d'écouter. Un registre par barreau, voir CHARGE_BASE_BY_TIER.
    const charging = drift > 0 && charge < 0.995 && !surge;
    const chargeFreq = CHARGE_BASE_BY_TIER[tier] + charge * CHARGE_SPAN;
    this.charge.oscA.frequency.setTargetAtTime(chargeFreq, t, 0.08);
    this.charge.oscB.frequency.setTargetAtTime(chargeFreq, t, 0.08);
    this.charge.filter.frequency.setTargetAtTime(
      CHARGE_FILTER_BASE + charge * CHARGE_FILTER_SPAN,
      t,
      0.08,
    );
    this.charge.gain.gain.setTargetAtTime(playing && charging ? 0.018 : 0, t, 0.09);
  }

  private init(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // Le bus latéral, entre les couches de bord et la sortie. `StereoPanner` et
    // non `Panner` : le second est une convolution HRTF par échantillon et par
    // voix, pour une scène qui n'a qu'un axe et un jeu qui pèse 160 Ko. Celui-ci
    // est un gain à puissance constante, deux multiplications par échantillon.
    this.side = ctx.createStereoPanner();
    this.side.connect(this.master);

    // Directement sur le master : chaque voix a déjà le sien, puisqu'elles ne
    // sont pas au même endroit.
    this.flybys = new Flybys(ctx, this.master);

    // Un seul tampon de bruit blanc, partagé par toutes les couches.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    const srcA = this.loop(1);
    const srcB = this.loop(0.73);
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.value = 600;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain);
    whineGain.connect(this.master);
    whine.start();

    this.engine = {
      rumble: this.band(srcA, 'lowpass', 140, 7),
      body: this.band(srcA, 'bandpass', 420, 1.1),
      hiss: this.band(srcB, 'highpass', 3200, 0.6),
      whine,
      whineGain,
    };
    this.wind = this.band(this.loop(0.55), 'bandpass', 900, 0.7);
    this.driftNoise = this.band(this.loop(1.3), 'bandpass', 2600, 2.2);
    // Le wall riding : un grondement métallique médium, à part du souffle du drift.
    this.rideBand = this.band(this.loop(0.7), 'bandpass', 1100, 1.6, true);
    // Plus grave que le wall riding, et c'est ce qui les distingue à l'oreille
    // avant toute couleur : celui-ci mord, l'autre pousse. Un raclement de
    // coque est un grondement, pas un sifflement.
    this.scrapeBand = this.band(this.loop(0.45), 'bandpass', 360, 1.1, true);

    // Turbulence : les deux LFO somment dans deux gains de profondeur, l'un sur
    // la fréquence de la bande, l'autre sur son gain. Les deux partent de zéro
    // et suivent le drift dans update(), donc hors drift la bande est
    // exactement ce qu'elle était.
    const turbFreq = ctx.createGain();
    const turbAmp = ctx.createGain();
    turbFreq.gain.value = 0;
    turbAmp.gain.value = 0;
    for (const rate of TURB_RATES) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = rate;
      lfo.connect(turbFreq);
      lfo.connect(turbAmp);
      lfo.start();
    }
    turbFreq.connect(this.driftNoise.filter.frequency);
    turbAmp.connect(this.driftNoise.gain.gain);
    this.turb = { freq: turbFreq, amp: turbAmp };

    const chargeOscA = ctx.createOscillator();
    chargeOscA.type = 'sawtooth';
    chargeOscA.frequency.value = 300;
    const chargeOscB = ctx.createOscillator();
    chargeOscB.type = 'sawtooth';
    chargeOscB.frequency.value = 300;
    chargeOscB.detune.value = CHARGE_DETUNE_CENTS;
    const chargeFilter = ctx.createBiquadFilter();
    chargeFilter.type = 'lowpass';
    chargeFilter.Q.value = 0.6;
    chargeFilter.frequency.value = CHARGE_FILTER_BASE;
    const chargeGain = ctx.createGain();
    chargeGain.gain.value = 0;
    chargeOscA.connect(chargeFilter);
    chargeOscB.connect(chargeFilter);
    chargeFilter.connect(chargeGain);
    chargeGain.connect(this.master);
    chargeOscA.start();
    chargeOscB.start();
    this.charge = { oscA: chargeOscA, oscB: chargeOscB, filter: chargeFilter, gain: chargeGain };

    // Le bouclier. Les deux oscillateurs somment dans le passe-bas ; le
    // crépitement est un LFO carré sur un gain à mi-course, donc le bourdon
    // s'ouvre et se ferme sans jamais s'inverser ; le tout dans un gain à zéro
    // que `update` ouvre.
    const shieldFilter = ctx.createBiquadFilter();
    shieldFilter.type = 'lowpass';
    shieldFilter.frequency.value = SHIELD_LOWPASS;
    shieldFilter.Q.value = 3;
    for (const hz of [SHIELD_HZ, SHIELD_HZ + SHIELD_BEAT]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;
      osc.connect(shieldFilter);
      osc.start();
    }
    const crackle = ctx.createGain();
    crackle.gain.value = 0.5;
    const crackleLfo = ctx.createOscillator();
    crackleLfo.type = 'square';
    crackleLfo.frequency.value = SHIELD_CRACKLE_HZ;
    const crackleDepth = ctx.createGain();
    crackleDepth.gain.value = 0.5;
    crackleLfo.connect(crackleDepth);
    crackleDepth.connect(crackle.gain);
    crackleLfo.start();
    const shieldGain = ctx.createGain();
    shieldGain.gain.value = 0;
    shieldFilter.connect(crackle);
    crackle.connect(shieldGain);
    shieldGain.connect(this.master);
    const spark = this.band(this.loop(1.6), 'highpass', 5200, 0.8);
    this.shield = { gain: shieldGain, filter: shieldFilter, spark };
  }

  private loop(rate: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start();
    return src;
  }

  /** @param sided vrai pour sortir par le bus latéral plutôt qu'au centre. */
  private band(
    src: AudioNode,
    type: BiquadFilterType,
    freq: number,
    q: number,
    sided = false,
  ): Band {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(sided ? this.side! : this.master!);
    return { filter, gain };
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    sweep = 0,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(25, sweep), t + dur);
    // Les rampes exponentielles ne peuvent pas toucher zéro, d'où le plancher quasi muet.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  /** @param sided vrai pour les chocs qui ont un bord : un mur, une réception hors piste. */
  private thud(vol: number, freq: number, sided = false): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(f);
    f.connect(g);
    g.connect(sided ? this.side! : this.master!);
    src.start(t);
    src.stop(t + 0.32);
  }

  private noiseHit(
    t0: number,
    vol: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    dur: number,
    send: boolean,
    sided = false,
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sided ? this.side! : this.master!);
    if (send) {
      const rev = this.reverb();
      if (rev) g.connect(rev);
    }
    // Décalage aléatoire dans le tampon, pour que les répétitions ne se mettent pas en phase.
    src.start(t0, Math.random() * 1.4);
    src.stop(t0 + dur + 0.05);
  }

  /** Bruit à décroissance exponentielle, bâti une fois. */
  private reverb(): GainNode | null {
    if (this.reverbIn || !this.ctx) return this.reverbIn;
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * REVERB_SECONDS);
    const impulse = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (1 - Math.exp(-i / 220));
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.85;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.reverbIn.connect(conv);
    conv.connect(wet);
    wet.connect(this.master!);
    return this.reverbIn;
  }

  private coin(mul: number): void {
    const k = 1 + (mul - 1) * 0.16;
    this.blip(1180 * k, 0.07, 'square', 0.1);
    this.blip(1760 * k, 0.1, 'square', 0.09, 0, 0.055);
    if (mul > 2) this.blip(2400 * k, 0.12, 'square', 0.07, 0, 0.11);
  }

  private fix(): void {
    this.blip(520, 0.12, 'triangle', 0.18);
    this.blip(780, 0.2, 'triangle', 0.16, 0, 0.1);
  }

  /**
   * Le super boost, qui est aussi sa propre activation : le ramassage le tire.
   *
   * Un balayage montant seul se lit « plus vite ». La détonation en dessous est
   * ce qui le fait lire comme une catapulte, la distinction que la §15 de la
   * palette demande et que le jeu ne faisait pas.
   */
  private superBoost(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;

    this.noiseHit(t, 0.3, 'lowpass', 1900, 130, 0.9, 0.24, true);

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.3);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + 0.46);

    this.blip(180, 0.55, 'sawtooth', 0.2, 1500);
    this.blip(360, 0.5, 'square', 0.07, 2400, 0.04);
  }

  /**
   * La réserve est pleine : deux notes montantes, et pas le carré de la pièce.
   *
   * Appelé par le client, qui possède la décision du moment où un remplissage
   * mérite une annonce. La simulation ne sait que la réserve est à 100, et elle
   * y est de nouveau trois pas après qu'un mur en a rogné 0,036.
   */
  boostReady(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(660, 0.09, 'triangle', 0.075);
    this.blip(990, 0.14, 'triangle', 0.065, 0, 0.07);
  }

  /**
   * Un drift de plus dans un combo armé : une note qui monte avec le niveau.
   *
   * Un demi-ton par niveau sur une base triangulaire, courte et douce : elle
   * répond à la sortie du drift, dont le whoosh vient de tomber, et doit
   * s'entendre comme une marche gravie, pas comme une pièce.
   */
  private comboUp(count: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const f = 440 * Math.pow(2, Math.min(count, 12) / 12);
    this.blip(f, 0.09, 'triangle', 0.07);
    this.blip(f * 1.5, 0.12, 'triangle', 0.045, 0, 0.05);
  }

  /**
   * Un mur frôlé : un fouet d'air, court et haut, plus sec à mesure qu'on est
   * passé près. Du bruit filtré et pas une note — c'est de l'air qui déchire,
   * pas une récompense qui sonne.
   */
  private nearMiss(closeness: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.noiseHit(
      ctx.currentTime,
      0.1 + closeness * 0.12,
      'bandpass',
      3800,
      1400,
      2.4,
      0.11,
      false,
      true,
    );
  }

  /** L'invincibilité ramassée : un accord qui s'ouvre, tenu — une protection qui se pose. */
  private ridePickup(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(330, 0.32, 'triangle', 0.08);
    this.blip(415, 0.32, 'triangle', 0.07, 0, 0.04);
    this.blip(494, 0.4, 'triangle', 0.06, 0, 0.08);
    this.noiseHit(ctx.currentTime, 0.12, 'highpass', 3000, 1600, 0.8, 0.25, true);
  }

  /** Un bidon : un coup sourd et un glouglou court — du liquide, pas du métal. */
  private fuelPickup(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.thud(0.1, 380);
    this.blip(220, 0.12, 'sine', 0.07, 60);
    this.blip(300, 0.1, 'sine', 0.05, 40, 0.08);
  }

  /** Le réservoir est vide : un bourdon qui descend et s'étouffe. */
  private fuelEmpty(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(180, 0.5, 'sawtooth', 0.05, -90);
    this.blip(120, 0.6, 'triangle', 0.05, -50, 0.1);
  }

  /** Elle tombe : l'accord se referme, plus bas. */
  private rideRelease(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(494, 0.14, 'triangle', 0.05);
    this.blip(330, 0.22, 'triangle', 0.05, 0, 0.1);
  }

  /** Le combo tombe : deux notes qui descendent, discrètes — c'est une perte, pas un choc. */
  private comboEnd(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(392, 0.1, 'triangle', 0.05);
    this.blip(294, 0.16, 'triangle', 0.045, 0, 0.09);
  }

  /**
   * L'entrée en drift : une rupture aérodynamique, pas un impact.
   *
   * Le drift avait déjà une voix continue — une bande de bruit à 2600 Hz qui
   * monte — et aucun instant. Voici la première des deux extrémités.
   */
  private driftEntry(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.noiseHit(ctx.currentTime, 0.13, 'bandpass', 900, 2600, 1.8, 0.13, false);
  }

  /**
   * La sortie : les appuis reviennent, et le whoosh descend plutôt qu'il ne
   * monte.
   *
   * Dosé par la durée du drift, que l'événement porte. Une longue glisse mérite
   * un réalignement plus long et plus fort ; c'était aussi la graine de la
   * chaîne que la palette décrivait, avant la mécanique qui l'a portée.
   */
  private driftRelease(held: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const k = Math.min(1, held / 0.9);
    this.noiseHit(
      ctx.currentTime,
      0.08 + k * 0.09,
      'bandpass',
      2800,
      700,
      1.5,
      0.22 + k * 0.12,
      true,
    );
  }

  /**
   * L'entrée en surge : le monde se ferme plutôt qu'il ne s'ouvre.
   *
   * Un balayage descendant sous le couchage, pour que l'oreille lise un
   * changement de pression plutôt que de seulement remarquer que le moteur est
   * parti.
   */
  private surgeIn(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(520, 0.5, 'sine', 0.16, 90);
    this.noiseHit(ctx.currentTime, 0.2, 'lowpass', 2600, 260, 0.8, 0.45, true);
  }

  /** La sortie : le mix revient, et ça doit se lire comme remonter à la surface. */
  private surgeOut(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(140, 0.42, 'sine', 0.15, 900);
    this.noiseHit(ctx.currentTime, 0.18, 'bandpass', 500, 3200, 1.1, 0.38, true);
  }

  /**
   * La fin d'un super boost : une décompression, pas une chute.
   *
   * Plus discrète que l'activation, à dessein. Elle clôt le temps au lieu de
   * rivaliser avec lui, et ce qu'elle annonce est un passage de relais — le
   * ramassage a rempli la réserve et le super boost ne l'a jamais vidée, donc
   * la partie enchaîne directement sur un boost.
   */
  private superRelease(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.noiseHit(ctx.currentTime, 0.14, 'bandpass', 2400, 620, 1.2, 0.3, true);
    this.blip(760, 0.28, 'triangle', 0.075, 280);
  }

  /**
   * L'explosion finale : un tir de laser long, très grave, et qui tourne.
   *
   * Bâti d'après un modèle décrit par l'auteur — le premier échantillon des
   * « laser gun blasts #2 » de jgrzinich, coupé à 2,818 s avec un fondu de
   * sortie, le canal droit décalé de 0,05 s, puis dans Audacity un
   * rehaussement de grave de +30 dB avec +7 d'aigu et un phaser à quatorze
   * étages, réinjection 70, LFO à 0,1 Hz.
   *
   * **Le jeu n'embarque aucun fichier audio, et c'est une décision** — voir
   * `CLAUDE.md` : pas de modèles, pas de textures, pas de sons, ce qui est
   * pourquoi la charge tient en 160 ko compressés, three.js compris. Ce qui
   * est repris ici est donc la chaîne, pas l'échantillon : la durée, le fondu,
   * le décalage entre canaux, les deux plateaux de tonalité et le phaser sont
   * reproduits en synthèse, avec une source qui tient lieu du tir.
   *
   * Trois écarts assumés, chacun pour une raison :
   *
   * - **+18 dB de grave et non +30.** Le modèle sort d'un fichier qu'on
   *   normalise après coup ; ici le gain part directement dans le mélange, et
   *   +30 dB sous 120 Hz écrêterait. Un compresseur tient la sortie derrière.
   * - **Huit étages d'allpass, pas quatorze.** Au-delà, dans un graphe
   *   WebAudio construit à chaque explosion, le coût monte sans que l'oreille
   *   distingue un creux de plus.
   * - **La phase de départ du LFO est approchée par la fréquence de base des
   *   allpass**, parce qu'un `OscillatorNode` ne se démarre pas à une phase
   *   choisie. À 0,1 Hz, le balayage ne fait de toute façon qu'un quart de
   *   tour pendant les 2,8 s : c'est une montée lente, pas un cycle.
   *
   * Les versions d'avant, dans l'ordre : le fracas de tôle de la gerbe de
   * débris, le souffle balayé de l'anneau, un laser trop aigu, le même
   * descendu d'une octave et demie, puis sa glissade étalée à une
   * demi-seconde. Chacune est partie parce que l'image ou l'oreille l'a
   * démentie.
   */
  private crash(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.noise) return;
    const t = ctx.currentTime;
    const end = t + CRASH_SECONDS;
    const rev = this.reverb();

    /* La chaîne, bâtie de la sortie vers la source.

       Le canal droit est le gauche retardé : deux entrées d'un `ChannelMerger`
       nourries par le même signal, l'une à travers un délai. Sous le seuil de
       l'écho, un décalage entre oreilles ne s'entend pas comme un second son
       mais comme de la largeur. */
    const merger = ctx.createChannelMerger(2);
    const shift = ctx.createDelay(0.5);
    shift.delayTime.value = CRASH_SHIFT;
    merger.connect(this.master!);
    if (rev) merger.connect(rev);

    // Le grave qu'on ajoute revient par la sortie : sans quoi il écrête.
    const guard = ctx.createDynamicsCompressor();
    guard.threshold.value = -18;
    guard.ratio.value = 12;
    guard.attack.value = 0.002;
    guard.release.value = 0.25;
    const out = ctx.createGain();
    out.gain.value = CRASH_LEVEL;
    guard.connect(out);
    out.connect(merger, 0, 0);
    out.connect(shift);
    shift.connect(merger, 0, 1);

    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 120;
    bass.gain.value = CRASH_BASS_DB;
    const treble = ctx.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 3500;
    treble.gain.value = CRASH_TREBLE_DB;
    bass.connect(treble);
    treble.connect(guard);

    /* Le phaser : une file d'allpass dont la fréquence est balayée ensemble,
       et la sortie réinjectée à l'entrée. Ce sont les creux d'interférence
       entre le signal et sa copie déphasée qui font le balayage. */
    const stages: BiquadFilterNode[] = [];
    for (let i = 0; i < CRASH_STAGES; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.Q.value = 0.7;
      ap.frequency.value = CRASH_SWEEP_FROM;
      stages.push(ap);
    }
    for (let i = 0; i < stages.length - 1; i++) stages[i]!.connect(stages[i + 1]!);
    const last = stages[stages.length - 1]!;
    last.connect(bass);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = CRASH_LFO_HZ;
    const depth = ctx.createGain();
    depth.gain.value = CRASH_SWEEP_DEPTH;
    lfo.connect(depth);
    for (const ap of stages) depth.connect(ap.frequency);
    lfo.start(t);
    lfo.stop(end);

    const feedback = ctx.createGain();
    feedback.gain.value = CRASH_FEEDBACK;
    const loop = ctx.createDelay(0.05);
    loop.delayTime.value = 0.0045;
    last.connect(loop);
    loop.connect(feedback);
    feedback.connect(stages[0]!);

    /* L'enveloppe : l'attaque, le corps, puis la queue qui s'éteint jusqu'à la
       fin. C'est le fondu de sortie du modèle. */
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.3, t + 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(stages[0]!);

    // Le tir : deux dents de scie désaccordées qui plongent, et tiennent
    // ensuite le grave que le phaser fait tourner.
    for (const detune of [0, 11]) {
      const voice = ctx.createOscillator();
      voice.type = 'sawtooth';
      voice.detune.value = detune;
      voice.frequency.setValueAtTime(900, t);
      voice.frequency.exponentialRampToValueAtTime(38, t + 0.9);
      voice.connect(env);
      voice.start(t);
      voice.stop(end);
    }

    // Le souffle du départ, dans la même chaîne : passé par le phaser, il est
    // ce qui lui donne de quoi tourner.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airBand = ctx.createBiquadFilter();
    airBand.type = 'bandpass';
    airBand.Q.value = 1.2;
    airBand.frequency.setValueAtTime(2600, t);
    airBand.frequency.exponentialRampToValueAtTime(180, t + 1.1);
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.85, t);
    airGain.gain.exponentialRampToValueAtTime(0.12, t + 0.5);
    air.connect(airBand);
    airBand.connect(airGain);
    airGain.connect(env);
    air.start(t);
    air.stop(end);

    // Le corps, hors phaser : un grave qui tourne perd le coup de poing.
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(110, t);
    body.frequency.exponentialRampToValueAtTime(28, t + 0.3);
    bodyGain.gain.setValueAtTime(0.5, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    body.connect(bodyGain);
    bodyGain.connect(guard);
    body.start(t);
    body.stop(t + 0.95);
  }
}
