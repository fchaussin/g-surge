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

/** Longueur de l'impulsion de réverbération, en secondes. Bâtie une fois, au premier usage. */
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
          this.thud(0.5, 1400);
          break;
        case 'wallImpact':
          this.thud(Math.min(0.5, 0.12 + e.force * 0.4), 1400);
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
    this.rideBand?.gain.gain.setTargetAtTime(playing && this.riding ? 0.11 : 0, t, 0.06);
    this.rideBand?.filter.frequency.setTargetAtTime(900 + r * 700, t, 0.1);
    this.riding = false;

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
    this.rideBand = this.band(this.loop(0.7), 'bandpass', 1100, 1.6);

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

  private band(src: AudioNode, type: BiquadFilterType, freq: number, q: number): Band {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
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

  private thud(vol: number, freq: number): void {
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
    g.connect(this.master!);
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
    g.connect(this.master!);
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
   * L'onde de choc de `ship.ts`, pas une gerbe : un éclair bref et aigu pour
   * l'instant de l'impact, un souffle filtré qui balaie vers l'aigu comme
   * l'anneau qui s'écarte, et le même poids grave qu'avant — un pouls a une
   * masse, même magnétique. Le crissement de tôle et les six éclats aléatoires
   * de l'ancienne gerbe de débris ont disparu avec elle.
   */
  private crash(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    this.reverb();
    this.blip(1800, 0.09, 'triangle', 0.22, 5200); // l'éclair
    this.noiseHit(t, 0.3, 'bandpass', 260, 3400, 3.2, 0.5, true); // l'anneau qui s'écarte
    this.noiseHit(t, 0.45, 'lowpass', 2600, 90, 1.0, 0.4, true); // impact
    this.noiseHit(t + 0.015, 0.18, 'lowpass', 700, 55, 0.9, 1.5, true); // queue grave

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.32);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g);
    g.connect(this.master!);
    const rev = this.reverb();
    if (rev) g.connect(rev);
    o.start(t);
    o.stop(t + 0.55);
  }
}
