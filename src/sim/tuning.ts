/**
 * Toutes les valeurs réglables, et les surcharges par difficulté.
 *
 * `DEFAULTS` est le niveau facile, les autres niveaux ne posent qu'un sous
 * ensemble par-dessus. C'est la source de vérité : docs/GAMEPLAY.md doit être
 * dérivé d'ici, jamais recopié — une ligne de ce document a déjà vécu des mois
 * avec un chiffre faux faute de cette règle.
 *
 * Un test Playwright compare ces valeurs à celles de legacy/engine.js, pour que
 * la transcription ne puisse pas dériver tant que les deux coexistent.
 */

export interface Tuning {
  /* Vitesse */
  speedStart: number;
  speedMax: number;
  speedRamp: number;
  speedGain: number;
  brakeFactor: number;
  steerMaxVel: number;

  /* Lacet et adhérence */
  yawBase: number;
  yawSpeedRef: number;
  yawMin: number;
  yawResponse: number;
  yawVisual: number;
  driftYaw: number;
  gripHold: number;
  gripDrift: number;
  gripLimit: number;
  driftExit: number;
  driftCharge: number;
  /** Mètres de drift propre pour passer du boost au super boost. */
  climbSup: number;
  /** Mètres de drift propre pour passer du super boost au G-SURGE. */
  climbSurge: number;
  /** Vitesse, en m/s, à laquelle la montée redescend hors drift. */
  climbDecay: number;
  surgeTime: number;

  /* Perfect Drift : l'enchaînement de drifts propres */
  /** Drifts enchaînés à partir desquels le combo est actif et paie. */
  comboArm: number;
  /** Fenêtre, en secondes, pour rouvrir un drift après le précédent, au début du combo. */
  comboWindow: number;
  /** La même fenêtre une fois le combo haut : elle se resserre entre les deux. */
  comboWindowMin: number;
  /** Plus court drift, en secondes, qui compte dans le combo. */
  comboMinHeld: number;
  /** Points par niveau de combo, par m/s de vitesse, à chaque drift qui prolonge. */
  comboScore: number;
  /** Part de montée supplémentaire par niveau de combo, plafonnée à `comboClimbMax`. */
  comboClimb: number;
  comboClimbMax: number;

  /* Near Miss : frôler le mur sans le toucher */
  /** Largeur, en mètres depuis le mur, de la bande où l'on frôle. */
  nearBand: number;
  /** Plus court passage dans la bande, en secondes, qui compte. */
  nearMinHeld: number;
  /** Points par m/s de vitesse à la proximité maximale, dosés par la proximité atteinte. */
  nearScore: number;
  /** Points de réserve rendus à la proximité maximale. */
  nearCharge: number;

  /* Invincibilité et wall riding */
  /** Mètres de piste avant lesquels aucun « extra » n'apparaît. */
  extrasFrom: number;
  /** Probabilité par segment de 12 m d'un item d'invincibilité, au-delà. */
  rideChance: number;
  /** Durée de l'invincibilité, en secondes. */
  rideTime: number;
  /** Gain de vitesse par seconde de contact avec un mur, en fraction de la vitesse. */
  rideGain: number;

  /* Carburant : une ressource permanente, de 0 à 100 */
  /** Consommation par seconde, en points, à chaque palier de poussée. */
  fuelCruise: number;
  fuelBoost: number;
  fuelSup: number;
  /** Consommation par seconde pendant un G-SURGE, qui remplit le réservoir à son entrée. */
  fuelSurge: number;
  /** Probabilité par segment de 12 m d'un bidon, au-delà de `extrasFrom`. */
  fuelCanChance: number;
  /** Points rendus par bidon. */
  fuelCan: number;
  /** Vitesse de croisière plafonnée à sec, en m/s : le moteur tousse, il ne s'arrête pas. */
  fuelDrySpeed: number;
  centri: number;
  bankAssist: number;
  bankScale: number;

  /* Génération de piste */
  /** Mètres de ligne droite et plate devant le vaisseau au départ. */
  openingStraight: number;
  /** Mètres avant lesquels aucune vrille n'est tirée. */
  rollFrom: number;
  curveLoad: number;
  curveMin: number;
  curveMax: number;
  climbRate: number;
  rollChance: number;
  rollNodes: number;
  stripeEvery: number;

  /* Dégâts */
  hullImpact: number;
  /** Plafond d'un choc, en points de coque. */
  hullImpactMax: number;
  hullScrape: number;
  hullRegen: number;
  /** Coque perdue sur une réception hors piste. */
  badLandingHull: number;
  damageSpeed: number;
  damageSteer: number;

  /* Objets et score */
  coinChance: number;
  fixChance: number;
  fixAmount: number;
  supChance: number;
  supTime: number;
  supFactor: number;
  pickRadius: number;
  haloTime: number;
  fastLane: number;
  multDecay: number;
  multDecayFast: number;
  multWallCut: number;
  multMax: number;

  /* Affichage, sans effet sur la simulation */
  renderScale: number;

  /* Sauts */
  launchScale: number;
  airGravity: number;
  airThresh: number;
  airSteer: number;
  airOverhang: number;
  badLanding: number;

  /* Boost */
  boostFactor: number;
  boostDrain: number;
  boostRecharge: number;
  boostMin: number;
  boostGain: number;

  /* Murs */
  wallBounce: number;
  wallPenalty: number;
  wallDrain: number;

  /* Caméra et champ, sans effet sur la simulation */
  camDist: number;
  camHeight: number;
  camLag: number;
  camRoll: number;
  lookAhead: number;
  lookHeight: number;
  fovBase: number;
  fovSpeed: number;
}

export const DEFAULTS: Readonly<Tuning> = {
  speedStart: 70,
  speedMax: 258,
  speedRamp: 9000,
  speedGain: 0.42,
  brakeFactor: 0.62,
  steerMaxVel: 34,
  yawBase: 0.4,
  yawSpeedRef: 90,
  yawMin: 0.1,
  yawResponse: 5.0,
  yawVisual: 2.4,
  driftYaw: 0.012,
  gripHold: 1.5,
  gripDrift: 0.6,
  gripLimit: 34,
  driftExit: 12,
  driftCharge: 17,
  /* La montée se mesure en mètres pour que la jauge la montre, mais elle se
   * dose en fraction de la fenêtre : 450 m valent un tiers de ce qu'une réserve
   * pleine parcourt en boost, 600 m moins d'un tiers d'un super boost de 5 s.
   * GAMEPLAY.md recalcule ces fractions. À rejuger en jouant. */
  climbSup: 450,
  climbSurge: 600,
  climbDecay: 100,
  surgeTime: 5,
  /* Le combo se lit en drifts, pas en angle : trois pour l'ouvrir, une fenêtre
   * qui se resserre de 1,5 à 0,8 s, et un drift qui compte s'il a duré un quart
   * de seconde. Les valeurs de la spécification, à rejuger en jouant. */
  comboArm: 3,
  comboWindow: 1.5,
  comboWindowMin: 0.8,
  comboMinHeld: 0.25,
  comboScore: 0.5,
  comboClimb: 0.25,
  comboClimbMax: 1.0,
  /* La bande fait un peu plus d'une demi-largeur de vaisseau (SHIP = 1,9) :
   * assez pour qu'on la sente, trop étroite pour qu'un passage ordinaire y
   * tombe. Récompense proportionnelle à la vitesse, comme la spécification le
   * suggère, et petite recharge sans jauge neuve. À rejuger en jouant. */
  nearBand: 1.2,
  nearMinHeld: 0.08,
  nearScore: 0.6,
  nearCharge: 6,
  /* Au-delà des traces figées, qui couvrent 1 345 m. Aussi rare qu'un super
   * boost, huit secondes — six semblaient courtes en jeu —, et un gain qui
   * pousse la vitesse un quart au-dessus de sa cible tant qu'on frotte — la
   * cible la ramène à speedGain par seconde, donc l'excès se fixe à
   * rideGain / (speedGain − rideGain), 0,235 ici. À rejuger en jouant. */
  extrasFrom: 1500,
  rideChance: 0.0025,
  rideTime: 8,
  rideGain: 0.08,
  /* Facile : la croisière ne consomme rien, un boost une réserve pleine
   * durant 3,8 s en brûle 11, un super boost de 5 s en brûle 30, le surge est
   * gratuit et remplit. Un bidon tous les 1,5 km environ. Moyen et difficile
   * surchargent tout cela dans DIFF. À sec : plus de boost ni de super boost,
   * et la croisière retombe vers 300 km/h — décidé le 11 septembre 2026, en
   * deux temps : d'abord un facteur laissé à 1, puis, en jouant, un plafond,
   * parce qu'une croisière à 900 km/h sans carburant n'avait aucun sens. Un
   * plafond et non un facteur, pour que la vitesse à sec soit la même partout
   * sur la rampe — un facteur aurait donné une vitesse différente à chaque
   * bout de la rampe, pas la même partout. Remonté de 200 à 300 le 12
   * septembre 2026 : 200 se lisait comme un coup de frein plutôt qu'une panne
   * sèche qui laisse encore rouler. À rejuger en jouant. */
  fuelCruise: 0,
  fuelBoost: 3,
  fuelSup: 6,
  fuelSurge: 0,
  fuelCanChance: 0.008,
  fuelCan: 35,
  fuelDrySpeed: 83.3,
  centri: 0.085,
  bankAssist: 0.3,
  bankScale: 0.9,
  openingStraight: 200,
  rollFrom: 5000,
  curveLoad: 30,
  curveMin: 0.0012,
  curveMax: 0.011,
  climbRate: 23,
  rollChance: 0.14,
  rollNodes: 44,
  stripeEvery: 2,
  /* Réglés cinq fois le 11 septembre 2026. La première version, 2,0 / 15 /
   * 1,7 pour le choc, le frottement et la régénération, jouait comme un
   * simulateur ; la seconde, 1,2 / 7 / 4, ne laissait plus perdre ; la
   * troisième, 1,6 / 11 / 1,5, non plus — pour mourir il fallait rester collé
   * au mur, à l'arrêt, dix à vingt secondes : la coque était remplie par
   * trois sources à la fois, 90 points par minute de régénération, une
   * réparation de 40 tous les 4 km, et des chocs à 20 ou 30. La quatrième a
   * fait de la coque un budget — régénération à 0,25, réparation de 30 tous
   * les 8 km — mais a monté le choc à 2,2 avec un plafond de 42 hérité des
   * réglages d'avant : un choc de travers coûtait la moitié de la barre en
   * facile, contre vingt secondes de frottement pour la perdre entière, et
   * ça n'était pas cohérent. La cinquième garde le budget et ramène le choc
   * à l'échelle du frottement : en facile un choc vaut au plus trois
   * secondes de frottement, `hullImpactMax` = 24 contre 8 par seconde, et
   * 12 m/s en coûtent 17. Ce qui compte dans un choc est la vitesse
   * latérale de fermeture, pas la vitesse de la course. Quatre à cinq chocs
   * francs sans réparation, et la course est perdue. Les dégâts retirent
   * moins de vitesse et de direction qu'au départ, pour ne pas enfermer une
   * coque abîmée dans une spirale. La sixième touche ne change que la
   * réparation : les dégâts jugés équilibrés, la réparation de 30 était
   * radine — quatre ou cinq objets pour revenir au plein. Deux doivent
   * suffire depuis n'importe où, donc 50. */
  hullImpact: 1.4,
  hullImpactMax: 24,
  hullScrape: 8,
  hullRegen: 0.25,
  badLandingHull: 12,
  damageSpeed: 0.22,
  damageSteer: 0.2,
  coinChance: 0.015,
  fixChance: 0.0015,
  fixAmount: 50,
  supChance: 0.0024,
  /* 2,6 s tant que le super boost n'était qu'un ramassage ; 5 s depuis qu'il
   * est un barreau dans lequel on drifte pour monter au suivant. */
  supTime: 5,
  supFactor: 1.22,
  pickRadius: 3.6,
  haloTime: 0.45,
  /** Vitesse au-dessus de laquelle le multiplicateur s'érode deux fois moins
   *  vite. S'appelait `coinTier3` du temps où elle ouvrait aussi un palier de
   *  pièce ; elle ne fait plus que ça. 278 m/s valent 1 000 km/h. */
  fastLane: 277.8,
  multDecay: 0.1,
  multDecayFast: 0.5,
  multWallCut: 0.5,
  multMax: 30,
  renderScale: 1,
  launchScale: 0.5,
  airGravity: 3.4,
  airThresh: 2.2,
  airSteer: 0.4,
  airOverhang: 11,
  badLanding: 0.35,
  boostFactor: 1.3,
  boostDrain: 26,
  boostRecharge: 10,
  boostMin: 14,
  boostGain: 2.2,
  wallBounce: 0.25,
  wallPenalty: 0.36,
  wallDrain: 26,
  camDist: 19,
  camHeight: 5.0,
  camLag: 7.5,
  camRoll: 0.42,
  lookAhead: 46,
  lookHeight: 2.6,
  fovBase: 74,
  fovSpeed: 22,
};

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyDef {
  /** Coefficient de score. Il compense la baisse du multiplicateur atteignable :
   *  sans lui, le niveau difficile rapporterait moins que le facile. */
  readonly mul: number;
  readonly set: Readonly<Partial<Tuning>>;
}

/**
 * Les libellés et les descriptions restent côté interface : ce sont des chaînes
 * à traduire un jour, elles n'ont rien à faire dans le noyau.
 */
export const DIFF: Readonly<Record<Difficulty, DifficultyDef>> = {
  easy: { mul: 1.0, set: {} },
  medium: {
    mul: 1.35,
    set: {
      curveLoad: 38,
      speedRamp: 6000,
      hullImpact: 2.0,
      hullImpactMax: 34,
      hullRegen: 0.2,
      hullScrape: 14,
      multDecay: 0.14,
      fixChance: 0.0012,
      rollChance: 0.18,
      climbRate: 27,
      fuelCruise: 1,
      fuelBoost: 5,
      fuelSup: 10,
      fuelCanChance: 0.005,
    },
  },
  hard: {
    mul: 1.8,
    set: {
      curveLoad: 46,
      speedRamp: 4000,
      hullImpact: 2.6,
      hullImpactMax: 42,
      hullRegen: 0.15,
      hullScrape: 18,
      multDecay: 0.2,
      fixChance: 0.001,
      supChance: 0.0018,
      rollChance: 0.24,
      climbRate: 31,
      gripLimit: 29,
      fuelCruise: 1.5,
      fuelBoost: 6,
      fuelSup: 12,
      fuelSurge: 2,
      fuelCanChance: 0.003,
    },
  },
};

/** Réglage effectif d'un niveau : le facile, puis les surcharges par-dessus. */
export function tuningFor(difficulty: Difficulty): Tuning {
  return { ...DEFAULTS, ...DIFF[difficulty].set };
}
