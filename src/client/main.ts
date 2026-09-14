/**
 * Point d'entrée du client.
 *
 * Du câblage, rien d'autre : ce fichier ne possède aucune règle. Le noyau de
 * simulation décide de ce qui arrive, les sous-systèmes décident de l'aspect et
 * du son, et ce fichier les relie et fait tourner l'horloge. Ce que la
 * simulation rapporte trouve sa réponse dans `feedback.ts`, et ce que les tests
 * doivent atteindre est exposé par `debug.ts`.
 */
import { AmbientLight, Color, DirectionalLight, FogExp2, MathUtils, Scene } from 'three';
import {
  BACK,
  DIFF,
  DT,
  driftFill,
  Sim,
  thrustTier,
  TraceCursor,
  tuningFor,
  unpackTrace,
  validTrace,
  type Difficulty,
  type Trace,
} from '../sim/index.js';
import { Audio } from './audio.js';
import { api, type BoardCategory, type BoardEntry } from './api.js';
import { avatarSvg } from './avatar.js';
import { photoFor, rememberPhoto } from './photos.js';
import { fromBase64 } from './base64.js';
import { BoardScreen } from './board.js';
import { ChaseCamera, COMPACT_BELOW } from './camera.js';
import { DamageOverlay } from './damage.js';
import { Duel, DUEL_LINK, type DuelEnd, type Pilot, type Standing } from './duel.js';
import { drawQr } from './qr.js';
import { installDebugSurface } from './debug.js';
import { driftIntensity, driftSide } from './drift.js';
import { DriftSpray } from './drift-spray.js';
import { Feedback } from './feedback.js';
import { Friends } from './friends.js';
import { Fullscreen } from './fullscreen.js';
import { Ghost } from './ghost.js';
import { GhostStore } from './ghosts.js';
import { BackButton } from './history.js';
import { Haptics } from './haptics.js';
import { formatClock, Hud } from './hud.js';
import { InputSource } from './input.js';
import { installed, InstallPrompt, type InstallOffer } from './install.js';
import { Loop } from './loop.js';
import { PerformanceGovernor } from './performance.js';
import { Pickups } from './pickups.js';
import { PreferenceStore } from './preferences.js';
import { Ranked, type Unranked } from './ranked.js';
import { ScoreScreen, type ScoreBreakdown } from './score-screen.js';
import { Session } from './session.js';
import { Scores } from './scores.js';
import { Screens } from './screens.js';
import { Settings } from './settings.js';
import { ShieldFx } from './shield.js';
import { Ship } from './ship.js';
import { SurgeOverlay } from './overlay.js';
import { Sky } from './sky.js';
import { SurgeMeter } from './surge.js';
import { Tips } from './tips.js';
import { TrackMesh } from './track-mesh.js';
import { Updates } from './updates.js';
import { Viewport } from './viewport.js';

const VOID = 0x05060a;

/**
 * Secousse tenue au plein du G-SURGE, en plus du coup porté à l'entrée.
 *
 * Volontairement sous ce qu'un choc de mur produit : la §10 veut une secousse
 * « forte mais contrôlée », et une image aussi agitée qu'un crash pendant cinq
 * secondes est illisible plutôt qu'intense.
 */
const SURGE_SHAKE = 0.45;

function seedFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('seed');
  } catch {
    return null;
  }
}

function freshSeed(): string {
  return (
    Math.floor(Math.random() * 4294967296).toString(36) +
    Math.floor(Math.random() * 4294967296).toString(36)
  );
}

const prefs = new PreferenceStore();
// Lue avant tout : le jeton du retour de connexion est dans l'URL, et il en sort ici.
const session = new Session();
const pinnedSeed = seedFromUrl();
const sim = new Sim({ seed: pinnedSeed ?? freshSeed(), difficulty: prefs.values.difficulty });

/* ---------------------------------------------------------------- scène -- */

const scene = new Scene();
scene.background = new Color(VOID);
scene.fog = new FogExp2(VOID, 0.0017);

const viewport = new Viewport(sim.tuning.fovBase);
const camera = new ChaseCamera(viewport.camera, sim.tuning);
const sky = new Sky();
const trackMesh = new TrackMesh(viewport.renderer);
const pickups = new Pickups();
const ship = new Ship();
const ghost = new Ghost();
const shield = new ShieldFx();
const surgeMeter = new SurgeMeter();
const surgeOverlay = new SurgeOverlay();
const damage = new DamageOverlay();
// Parentée au vaisseau, comme la fumée : dans le monde, une particule lâchée
// ici croiserait la caméra 19 m derrière.
const spray = new DriftSpray();
ship.group.add(spray.group, shield.group);
scene.add(sky.group, trackMesh.group, pickups.group, ship.group, ghost.group);

// Le vaisseau est le seul objet éclairé ; tout le reste est sans éclairage à
// dessein.
scene.add(new AmbientLight(0x2c3d59, 1.15));
const keyLight = new DirectionalLight(0xdff0ff, 1.2);
keyLight.position.set(0.45, 1, -0.5);
scene.add(keyLight);

/* ------------------------------------------------------- interface, boucle -- */

const hud = new Hud();
const audio = new Audio();
const haptics = new Haptics();
const scores = new Scores();
const ghosts = new GhostStore();
const ranked = new Ranked();
const duel = new Duel();
const tips = new Tips();
const scoreScreen = new ScoreScreen(() => audio.resume());

const fullscreen = new Fullscreen((active, blocked) => {
  const toggle = document.getElementById('tglFull');
  toggle?.classList.toggle('on', active);
  toggle?.setAttribute('aria-pressed', String(active));
  const button = document.getElementById('btnFullMenu');
  if (button) {
    button.textContent = blocked ? 'FULLSCREEN BLOCKED' : active ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
  }
  // Passer en plein écran change ce qui est affiché, donc ce qui est navigable.
  screens.buildNav();
});

const boardScreen = new BoardScreen(
  document.getElementById('wboardBody'),
  document.getElementById('wboardReset'),
  prefs.values.difficulty,
  (entry, d) => void watchEntry(entry, d),
);

/**
 * Le bouton retour du système. `screens.back` dit s'il avait quelque chose à
 * quitter ; sinon, installé, on demande confirmation avant de sortir.
 */
const back = new BackButton({
  back: () => screens.back(),
  installed,
  confirmQuit: () => screens.setMode('quit'),
});

const screens = new Screens({
  onChange(mode) {
    if (mode !== 'run') input.release();
    // Les navigateurs ne laissent démarrer un AudioContext que sur un geste, et
    // chaque changement d'écran en est un.
    audio.resume();
    // La barre de mise à jour ne se montre qu'hors partie.
    showUpdateBar();
    // Toujours une lecture fraîche à l'ouverture, jamais celle d'une visite précédente.
    if (mode === 'board') boardScreen.open();
    if (mode !== 'watch' && watching) stopWatching();
    // Revenir au menu quitte le salon : la prise se ferme, le fantôme s'efface.
    if (mode === 'menu' && duel.active) leaveDuel();
    if (mode === 'menu') racing = false;
  },
});

// Une mise à jour prête est annoncée, jamais appliquée seule : la barre
// apparaît hors partie, et c'est le joueur qui recharge.
const updates = new Updates(() => showUpdateBar());
function showUpdateBar(): void {
  const bar = document.getElementById('updateBar');
  if (bar) bar.hidden = !(updates.pending && screens.mode !== 'run');
}

// L'invitation à installer : une carte dans le menu, avec un bouton là où le
// navigateur offre une boîte, un mode d'emploi sur iOS, rien une fois installé
// ou fermé. Elle déplace ce qui est navigable, comme le plein écran.
function showInstall(offer: InstallOffer): void {
  const card = document.getElementById('installCard');
  const text = document.getElementById('installText');
  if (card) {
    card.hidden = offer.kind === 'none';
    card.classList.toggle('manual', offer.kind === 'manual' || offer.kind === 'installed');
    card.classList.toggle('installed', offer.kind === 'installed');
  }
  if (text && (offer.kind === 'manual' || offer.kind === 'installed'))
    text.textContent = offer.hint;
  screens.buildNav();
}
const install = new InstallPrompt(prefs.values.installDismissed, showInstall);

const input = new InputSource({
  isPlaying: () => screens.isPlaying,
  buzz: (pattern) => haptics.buzz(pattern),
  canBoost: () => sim.state.energy >= sim.tuning.boostMin,
});

let difficulty: Difficulty = prefs.values.difficulty;
/** Courir contre sa meilleure partie, sur sa piste. */
let ghostOn = prefs.values.ghost;
/** Une partie lancée depuis le menu demande un ticket plutôt qu'une graine locale. */
let rankedOn = prefs.values.ranked;
let showFps = prefs.values.showFps;

const perf = new PerformanceGovernor({
  isPlaying: () => screens.isPlaying,
  getSkyDetail: () => skyDetail,
  setSkyDetail: (high) => {
    skyDetail = high;
    sky.setDetail(high);
  },
  getRenderScale: () => sim.tuning.renderScale,
  setRenderScale: (v) => {
    sim.tuning.renderScale = v;
    viewport.setRenderScale(v);
    settings.syncRow('renderScale');
    prefs.set('renderScale', v);
  },
});
let skyDetail = prefs.values.skyDetail;

const settings = new Settings({
  initial: prefs.values,
  tuning: () => sim.tuning,
  difficulty: () => difficulty,
  scoreMultiplier: (d) => DIFF[d].mul,
  setDifficulty: (d) => {
    difficulty = d;
    switchDifficulty(d);
    prefs.set('difficulty', d);
  },
  setTuning: (key, value) => {
    (sim.tuning as unknown as Record<string, number>)[key] = value;
    // L'échelle de rendu est la seule valeur d'accord qui soit aussi une
    // préférence : elle décrit la machine, pas le jeu.
    if (key === 'renderScale') {
      viewport.setRenderScale(value);
      prefs.set('renderScale', value);
    }
  },
  resetTuning: () => {
    const scale = sim.tuning.renderScale;
    Object.assign(sim.tuning, tuningFor(difficulty));
    sim.tuning.renderScale = scale;
  },
  setSound: (on, byUser) => {
    audio.setMuted(!on);
    // Une pression est un geste, donc elle peut ouvrir l'audio ; une
    // restauration ne le peut pas.
    if (on && byUser) audio.unlock();
    prefs.set('sound', on);
  },
  setHaptics: (on, byUser) => {
    haptics.setEnabled(on);
    // La vibration de confirmation répond à une pression, pas à une
    // restauration.
    if (on && byUser) haptics.buzz(20);
    prefs.set('haptics', on);
  },
  hapticsAvailable: haptics.available,
  setTips: (on) => {
    tips.setEnabled(on);
    prefs.set('tips', on);
  },
  setLefty: (on) => prefs.set('lefty', on),
  setSky: (on) => {
    sky.setVisible(on);
    prefs.set('sky', on);
  },
  setSkyDetail: (high) => {
    skyDetail = high;
    sky.setDetail(high);
    prefs.set('skyDetail', high);
  },
  setShowFps: (on) => {
    showFps = on;
    prefs.set('showFps', on);
  },
  setGhost: (on) => {
    ghostOn = on;
    prefs.set('ghost', on);
  },
  setRanked: (on) => {
    rankedOn = on;
    prefs.set('ranked', on);
  },
  account: () => session.account,
  signedIn: () => session.signedIn,
  signIn: (provider) => session.signIn(provider),
  signOut: () => session.signOut(),
  deleteAccount: () => session.deleteAccount(),
  rename: (name) => session.rename(name),
  clearScores: () => {
    scores.clear();
    ghosts.clear();
  },
  rebuildNav: () => screens.buildNav(),
});

let elapsed = 0;
let bank = 0;
/* Attitude visuelle, amortie vers la simulation plutôt que calée dessus. */
let lean = 0;
let yawVisual = 0;

// Le bout observateur de l'union d'événements : son, vibration, lueur,
// secousse, pops.
const feedback = new Feedback({ audio, haptics, hud, camera, ship, onWreck: () => endRun() });

/**
 * Tout ce qui s'amortit sur des frames, remis à zéro en un seul endroit.
 *
 * Partagé à dessein entre le début d'une partie et une capture : un état amorti
 * neuf qui rejoint une liste et oublie l'autre, c'est exactement ainsi que trois
 * bugs de référence visuelle sont nés. Le ciel n'y est pas — il continue du menu
 * à la partie, et seule une capture le remet à zéro.
 */
function resetPresentation(): void {
  ship.clearSmoke();
  ship.resetExplosion();
  spray.reset();
  pickups.reset();
  camera.reset(sim.tuning);
  surgeMeter.reset();
  surgeOverlay.reset();
  damage.reset();
  feedback.reset();
  shield.reset();
  lean = 0;
  yawVisual = 0;
}

/**
 * Une partie en cours — jouée ou en pause — compte quand un départ l'écrase.
 * RESTART se presse depuis la pause : sans `pause` ici, une partie à 40 000
 * points relancée depuis la pause ne laissait rien au palmarès ni de fantôme,
 * alors que le texte du tableau vide promet « crash, restart or quit ».
 */
function endsARun(): boolean {
  return screens.mode === 'run' || screens.mode === 'pause';
}

/**
 * Change la difficulté de la simulation en gardant l'échelle de rendu, qui
 * appartient à la machine et non au niveau : `setDifficulty` pose un objet
 * de réglage neuf. Trois appelants, une seule règle — le visionnage l'avait
 * oubliée, et après un WATCH le flou plein écran revenait sur une machine
 * que le gouverneur avait déjà rétrogradée.
 */
function switchDifficulty(d: Difficulty): void {
  const scale = sim.tuning.renderScale;
  sim.setDifficulty(d);
  sim.tuning.renderScale = scale;
  // La piste n'a pas la même largeur d'un niveau à l'autre : la route suit au
  // prochain `update`, les portiques sont rebâtis ici.
  trackMesh.setWidth(sim.tuning.half);
}

function startRun(): void {
  if (endsARun()) submit();
  ranked.abandon();
  // Avec le fantôme, la partie se joue sur la piste de la meilleure : c'est la
  // seule façon de courir contre elle. Une graine épinglée par l'URL l'emporte,
  // et le fantôme ne court alors que si c'est aussi la sienne.
  const best = ghostOn ? ghosts.best(difficulty) : null;
  sim.reset(pinnedSeed ?? best?.trace.seed ?? freshSeed());
  if (best && best.trace.seed === sim.seed) ghost.arm(best.trace);
  else ghost.disarm();
  launch();
}

/**
 * Une partie classée : le ticket d'abord, la piste servie ensuite. Sans
 * ticket — hors ligne, serveur muet — c'est `startRun`, et le joueur le sait
 * par l'étiquette. Rend la raison si la partie n'est pas classée.
 */
async function startRanked(): Promise<Unranked | null> {
  if (endsARun()) submit();
  ranked.abandon();
  // Sans session, inutile de demander : le serveur dirait la même chose, une
  // requête plus tard. Le classé se joue connecté.
  const issued = session.signedIn ? await ranked.request(difficulty) : 'sign-in';
  if (typeof issued === 'string') {
    startRun();
    hud.setBest(`unranked \u00b7 ${UNRANKED[issued]}`);
    return issued;
  }
  // la graine locale ne sert à rien : la piste vient de la file dès le premier pas
  sim.reset(freshSeed());
  ghost.disarm();
  if (!ranked.begin(sim, issued)) {
    startRun();
    return 'no-ticket';
  }
  launch();
  hud.setBest('ranked');
  return null;
}

/**
 * Regarder une partie du tableau : sa trace, rejouée à l'écran.
 *
 * Le vaisseau est celui de la partie enregistrée, pas un fantôme à côté d'une
 * autre : la simulation du joueur est remise sur la graine et la difficulté de
 * la trace, et ses entrées viennent d'un `TraceCursor` au lieu du clavier. Tout
 * le reste — piste, caméra, HUD, son — marche sans le savoir, ce qui est la
 * raison de ce choix plutôt que d'animer le maillage fantôme seul.
 *
 * C'est la preuve rendue regardable : le serveur a rejoué cette trace pour en
 * tirer le score affiché, et l'écran rejoue la même.
 */
let watching: TraceCursor | null = null;
/** Le dernier visionnage fini : le minuteur qui rend la main ne rend que pour lui. */
let last: TraceCursor | null = null;
/** La difficulté du joueur, mise de côté le temps d'un visionnage. */
let difficultyBeforeWatch: Difficulty | null = null;

async function watchEntry(entry: BoardEntry, d: Difficulty): Promise<void> {
  let trace: Trace | null = null;
  try {
    const { trace: b64 } = await api.trace(entry.id);
    trace = unpackTrace(fromBase64(b64));
  } catch {
    trace = null;
  }
  // Une trace élaguée, un serveur muet, des octets illisibles : le tableau le
  // dit là où le joueur regarde, et rien ne bouge.
  if (!trace || !validTrace(trace)) {
    boardScreen.say('That run is no longer kept — only the week’s best are.');
    return;
  }
  if (endsARun()) submit();
  ranked.abandon();
  ghost.disarm();
  difficultyBeforeWatch = difficulty;
  switchDifficulty(trace.difficulty);
  sim.reset(trace.seed);
  watching = new TraceCursor(trace);
  const who = document.getElementById('watchWho');
  if (who) who.textContent = `WATCHING ${entry.name}`;
  tips.reset();
  resetPresentation();
  hud.reset();
  loop.reset();
  hud.setBest(`${d} \u00b7 ${Math.round(entry.score).toLocaleString('en-GB')}`);
  screens.setMode('watch');
}

/** Fin de la trace, ou sortie par le bouton : la difficulté du joueur revient. */
function stopWatching(): void {
  watching = null;
  if (difficultyBeforeWatch) {
    switchDifficulty(difficultyBeforeWatch);
    difficultyBeforeWatch = null;
  }
  hud.setBest(scores.bestLabel);
}

/**
 * Un duel. Le salon sert la piste, la simulation reste la sienne ; ce qui
 * change est ce qui part — la trace en morceaux — et ce qui arrive — l'autre
 * vaisseau, dessiné par le fantôme. L'ouvreur attend sur l'écran
 * d'invitation ; le second arrive par le lien, et les deux démarrent quand la
 * seconde prise s'ouvre.
 */
const DUEL_WHY: Record<DuelEnd, string> = {
  offline: 'offline',
  'sign-in': 'Sign in to take the other seat. A duel needs two accounts.',
  self: 'This room is your own. The other pilot needs their own account.',
  refused: 'refused by the server',
  unreachable: 'server unreachable',
  full: 'that room is full',
  gone: 'that room is gone',
  diverged: 'connection dropped: out of sync',
  expired: 'the room has expired',
};

/**
 * Le bloc de partage — le lien, les deux boutons, le QR — n'a de sens que pour
 * celui qui ouvre le salon, et seulement une fois qu'il est ouvert. Il reste
 * masqué partout ailleurs : masqué, il sort aussi de la navigation clavier,
 * que `buildNav` refait.
 */
function showShare(on: boolean): void {
  document.getElementById('duelShare')?.toggleAttribute('hidden', !on);
  screens.buildNav();
}

/**
 * Le salon qu'une invitation attend, le temps d'une connexion.
 *
 * Le lien porte le salon dans son fragment, et le fragment ne survit pas à
 * l'aller-retour chez le fournisseur : le retour se fait sur l'origine seule,
 * et le serveur y accroche déjà `#session=`. Il est donc mis de côté ici, dans
 * le stockage de l'onglet — le même que la marque de départ de `session.ts`,
 * et pour la même raison : il vit dans l'onglet et traverse la navigation.
 */
const PENDING_DUEL = 'gsurge.duel.pending';

function pendingDuel(): string | null {
  try {
    return sessionStorage.getItem(PENDING_DUEL);
  } catch {
    return null;
  }
}

function rememberDuel(room: string | null): void {
  try {
    if (room) sessionStorage.setItem(PENDING_DUEL, room);
    else sessionStorage.removeItem(PENDING_DUEL);
  } catch {
    // sans stockage d'onglet, l'invitation se perd à la connexion ; le message
    // reste juste, et le lien peut être rouvert
  }
}

/** L'écran d'invitation sans compte : le refus, et de quoi en sortir. */
function askSignIn(room: string | null): void {
  rememberDuel(room);
  sayDuel(DUEL_WHY['sign-in']);
  document.getElementById('btnDuelSignIn')?.toggleAttribute('hidden', false);
  screens.buildNav();
}

/**
 * Le salon mis de côté, rejoint dès qu'un compte est là. Rend vrai s'il a pris
 * la main : l'appelant n'a alors rien d'autre à montrer.
 */
function resumePendingDuel(): boolean {
  const room = pendingDuel();
  if (!room || !session.signedIn) return false;
  rememberDuel(null);
  void joinDuel(room);
  return true;
}

/**
 * Les amis, en tête de l'écran de duel. Un défi ouvre un salon exactement
 * comme le bouton de partage, et mène à la même grille de départ ; la
 * différence est qu'il n'y a rien à faire parvenir à personne.
 */
const friends = new Friends({
  difficulty: () => difficulty,
  picture: () => session.picture,
  onOpened: (seat, friend) => {
    duel.adopt(seat, friend);
    duel.connect();
    showShare(false);
    showGrid('has been challenged. Waiting for them to join…');
  },
  onJoin: (room) => void joinDuel(room),
  onRebuild: () => screens.buildNav(),
});

/**
 * L'écran de duel : les amis, la liste des défis reçus, et le lien en dernier
 * recours. **Il n'ouvre plus de salon en s'ouvrant** — c'est ce que faisait
 * l'ancien, si bien que regarder l'écran créait un objet à chaque visite.
 */
function openDuel(): void {
  screens.setMode('duel');
  showShare(false);
  document.getElementById('btnDuelSignIn')?.toggleAttribute('hidden', true);
  if (!session.signedIn) {
    askSignIn(null);
    return;
  }
  sayDuel('Challenge a friend, or invite by link.');
  friends.load();
}

/** Le lien : pour qui n'est pas encore un ami. C'est ici que le salon s'ouvre. */
async function makeLink(): Promise<void> {
  if (!session.signedIn) {
    askSignIn(null);
    return;
  }
  sayDuel('Opening a room…');
  const why = await duel.open(difficulty, session.picture);
  if (screens.mode !== 'duel') return;
  if (why) {
    sayDuel(DUEL_WHY[why]);
    return;
  }
  duel.connect();
  showShare(true);
  const link = document.getElementById('inviteLink') as HTMLInputElement | null;
  if (link) link.value = duel.inviteLink();
  // Le lien en QR aussi : d'un téléphone à l'autre, sans clavier.
  const qr = document.getElementById('inviteQr') as HTMLCanvasElement | null;
  if (qr) {
    try {
      drawQr(qr, duel.inviteLink());
      qr.hidden = false;
    } catch {
      qr.hidden = true;
    }
  }
  sayDuel('Share this link with the other pilot. The race starts when they arrive.');
}

async function joinDuel(room: string): Promise<void> {
  screens.setMode('duel');
  showShare(false);
  document.getElementById('btnDuelSignIn')?.toggleAttribute('hidden', true);
  if (!session.signedIn) {
    askSignIn(room);
    return;
  }
  sayDuel('Joining…');
  const why = await duel.join(room, session.picture);
  if (why) {
    // Sans compte, il reste de quoi en prendre un : le salon attend le retour.
    if (why === 'sign-in') askSignIn(room);
    else sayDuel(DUEL_WHY[why]);
    return;
  }
  // Le départ viendra du salon, avec son décompte, quand les deux prises sont
  // là. D'ici là, la grille : qui invite, et où l'on en est.
  duel.connect();
  // Sans nom en face — un serveur d'avant, qui ne donne pas les pilotes — la
  // phrase ne peut pas commencer par « untel ».
  showGrid(duel.rival ? 'invites you to race. Getting ready…' : 'In the room. Getting ready…');
}

/* ------------------------------------------------------ la grille de départ -- */

/**
 * L'écran de départ, celui que les deux pilotes voient : le visage et le nom
 * d'en face, une ligne d'état, et le décompte quand il vient. Il remplace
 * l'ancien bricolage — décompte, attente et résultat écrits tour à tour dans la
 * ligne grise de l'écran de partage, entre un champ d'invitation et un QR.
 */
function showGrid(line: string): void {
  const rival = duel.rival;
  // Le salon est le seul endroit où la photo d'un pilote circule ; l'appareil
  // s'en souvient pour la liste d'amis, que le serveur ne peut pas fournir.
  rememberPhoto(rival?.face, rival?.pic);
  const face = document.getElementById('gridFace');
  if (face) paintFace(face, rival, 56);
  const who = document.getElementById('gridWho');
  if (who) who.textContent = rival?.name ?? 'DUEL';
  const count = document.getElementById('gridCount');
  if (count) {
    count.hidden = true;
    count.classList.remove('go');
  }
  sayGrid(line);
  if (screens.mode !== 'grid') screens.setMode('grid');
}

function sayGrid(text: string): void {
  const line = document.getElementById('gridLine');
  if (line) line.textContent = text;
}

/** Vrai entre le départ et la ligne ou l'épave : la course est en cours pour moi. */
let racing = false;

/**
 * Le décompte, puis le départ. Un compte à rebours sur l'horloge murale :
 * ce n'est pas la simulation, et le classement se fait en pas simulés, donc
 * un décalage d'une frame entre les deux n'avantage personne.
 */
function countdownThenStart(seconds: number): void {
  const count = document.getElementById('gridCount');
  sayGrid('Both pilots are here. Same track, same start.');
  let left = seconds;
  const tick = (): void => {
    if (screens.mode !== 'grid' || !duel.active) return;
    if (count) {
      count.hidden = false;
      count.textContent = left > 0 ? String(left) : 'GO';
      count.classList.toggle('go', left <= 0);
    }
    if (left <= 0) {
      racing = true;
      startDuel();
      return;
    }
    left--;
    window.setTimeout(tick, 1000);
  };
  tick();
}

/** Ce que la carte de fin dit tant que le salon n'a pas jugé. */
const DUEL_WAIT = 'duel \u00b7 waiting for the other pilot…';

/**
 * À la ligne : le reste de la trace part, la partie compte, et la carte de
 * score monte — la même que pour n'importe quelle fin, avec le duel en note.
 * Le résultat la réécrira. C'est la partie qu'on vient de jouer qui doit
 * s'afficher, pas l'écran d'appairage.
 */
function finishDuel(): void {
  racing = false;
  duel.flush(sim);
  endRun(DUEL_WAIT, 0);
}

/** Le classement, tel que le salon l'a jugé, écrit sous le score. */
function showResult(ranking: Standing[]): void {
  racing = false;
  const me = duel.member;
  const won = ranking[0]?.who === me;
  const other = ranking.find((s) => s.who !== me);
  const how = (s: Standing): string =>
    s.finished
      ? `finished in ${formatClock(s.steps * DT)}`
      : `wrecked at ${(s.dist / 1000).toFixed(1)} km`;
  const verdict =
    `duel \u00b7 ${won ? 'YOU WON' : 'YOU LOST'}` +
    (other ? ` \u00b7 ${other.name} ${how(other)}` : '');
  noteCard(verdict);
  const face = document.getElementById('overFace');
  if (face) paintFace(face, other ? { name: other.name, ...(duel.rival ?? {}) } : null, 20);
  // Le résultat peut arriver alors que la carte n'est pas là : quitté vers le
  // menu, ou encore sur la grille parce que la course n'a jamais démarré.
  if (screens.mode === 'grid') sayGrid(verdict);
  duel.leave();
  ghost.unfollow();
}

function startDuel(): void {
  if (endsARun()) submit();
  ranked.abandon();
  ghost.disarm();
  ghost.unfollow();
  rivalOut = false;
  sim.reset(freshSeed());
  if (!duel.begin(sim)) {
    sayGrid(DUEL_WHY.gone);
    return;
  }
  launch();
  hud.setBest('duel');
}

function leaveDuel(): void {
  duel.leave();
  ghost.unfollow();
}

function sayDuel(text: string): void {
  const line = document.getElementById('duelLine');
  if (line) line.textContent = text;
}

/**
 * Le visage d'un pilote dans un élément : ses pixels d'abord, sa photo par
 * dessus si elle charge.
 *
 * Dans cet ordre et pas l'inverse : rien ne garantit qu'une adresse donnée à
 * la connexion vaille encore trente jours plus tard — Google les fait tourner
 * — et l'échange se fait au chargement, donc une photo absente ne laisse
 * jamais de trou, elle ne remplace simplement rien. `no-referrer` par-dessus
 * la politique du site : le fournisseur n'apprend même pas d'où on regarde.
 */
function paintFace(el: HTMLElement, pilot: Pilot | null, size: number): void {
  el.innerHTML = pilot ? avatarSvg(pilot.face ?? pilot.name, size) : '';
  // Celle qu'il envoie, ou celle qu'on a retenue de lui la dernière fois.
  const url = pilot?.pic ?? photoFor(pilot?.face);
  if (!pilot || !url) return;
  const img = new Image(size, size);
  img.className = 'photo';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    el.replaceChildren(img);
  };
  img.src = url;
}

/** Vrai une fois que la sortie du rival a été annoncée, pour ne le dire qu'une fois. */
let rivalOut = false;

duel.onChange = (why) => {
  if (why) {
    // la prise s'est fermée : la partie continue seule, et chaque écran le dit
    // là où il peut — une bulle en course, la note sous le score, la ligne de
    // la grille.
    const wasRacing = racing;
    racing = false;
    if (screens.isLive) {
      hud.setBest(`duel \u00b7 ${DUEL_WHY[why]}`);
      if (wasRacing && !rivalOut) {
        rivalOut = true;
        tips.say(`<b>${duel.rival?.name ?? 'The other pilot'}</b> left the race.`);
      }
    } else if (screens.mode === 'grid') sayGrid(DUEL_WHY[why]);
    else noteCard(`duel \u00b7 ${DUEL_WHY[why]}`);
    ghost.unfollow();
    return;
  }
  // L'autre vient d'entrer : celui qui attendait sur l'écran de partage passe
  // sur la grille, où le décompte va tomber.
  if (duel.seats >= 2 && (screens.mode === 'duel' || screens.mode === 'grid')) {
    showGrid(duel.rival ? 'is here. Getting ready…' : 'The other pilot is here. Getting ready…');
  }
};
duel.onStart = (countdown) => {
  if (screens.mode === 'grid') countdownThenStart(countdown);
};
duel.onResult = (ranking) => showResult(ranking);

/** Ce que toute partie fait après que sa piste est en place. */
function launch(): void {
  unrankedWhy = null;
  tips.reset();
  resetPresentation();
  hud.reset();
  loop.reset();
  screens.setMode('run');
}

/** Pourquoi la partie en cours, partie classée, ne l'est plus. Pour l'écran de fin. */
let unrankedWhy: Unranked | null = null;

/**
 * Ce que l'onde de choc a pour elle avant que la carte de score la couvre, en
 * ms. Un peu moins que `SHOCKWAVE_LIFE` : la fin de l'onde est déjà presque
 * transparente, et l'écran de fin n'a pas à attendre qu'elle s'éteigne.
 */
const WRECK_HOLD_MS = 620;

/**
 * La carte de fin en cours, pour qu'une réponse tardive la réécrive : le
 * verdict du tableau classé, ou le classement d'un duel. `up` dit si elle est
 * déjà montée — avant, la note se pose dans la carte, que `show` lira.
 */
let liveCard: { card: ScoreBreakdown; id: number; up: boolean } | null = null;

/** Réécrit la ligne sous le score de la partie qui vient de finir, et d'elle seule. */
function noteCard(text: string): void {
  if (!liveCard || liveCard.id !== runId) return;
  liveCard.card.note = text;
  if (liveCard.up) scoreScreen.note(text);
}

/**
 * La fin d'une partie, quelle qu'elle soit : l'épave, ou la ligne d'arrivée
 * d'un duel. `note` impose la ligne sous le score — un duel attend le
 * classement du salon là où une partie seule attend celui du tableau — et
 * `delayMs` laisse l'onde de choc à l'écran, ce qu'une arrivée n'a pas à faire.
 */
function endRun(note?: string, delayMs = WRECK_HOLD_MS): void {
  haptics.buzz([90, 60, 200]);
  // En duel, l'épave est aussi une sortie de course : le reste de la trace part.
  if (duel.active && racing) {
    racing = false;
    duel.flush(sim);
  }
  // La coque n'a plus de jauge à faire clignoter une fois explosée : sans
  // ceci le voile rouge continuait de pulser sur l'écran de score.
  damage.reset();
  // le score du fantôme avant `submit`, qui peut le remplacer par cette partie
  const raced = ghost.armed ? ghosts.bestScore(difficulty) : null;
  const wasRanked = ranked.active;
  const { wasBest, previousBest } = submit();
  // Le monde est déjà figé — `wreck` ne joue pas plus qu'`over` — mais rien
  // n'est encore posé par-dessus : l'explosion a l'écran pour elle. Une
  // arrivée n'explose pas, donc elle n'attend pas.
  if (delayMs > 0) screens.setMode('wreck');
  // Le visage du duel précédent n'a rien à faire sur la carte d'une partie
  // seule : il n'est posé que par un verdict, et retiré à chaque fin.
  document.getElementById('overFace')?.replaceChildren();
  const card: ScoreBreakdown = {
    distance: sim.state.dist,
    seconds: sim.state.time,
    coins: sim.state.coins,
    peakMultiplier: sim.state.multPeak,
    topSpeed: sim.state.speedPeak,
    total: sim.state.score,
    wasBest,
    previousBest,
    ghostScore: raced,
    note:
      note ??
      (wasRanked
        ? 'ranked \u00b7 checking'
        : unrankedWhy
          ? `unranked \u00b7 ${UNRANKED[unrankedWhy]}`
          : ''),
  };

  // `show` compte ses sept lignes en les faisant sonner : elle ne peut pas
  // tourner derrière un calque caché, donc elle attend avec lui.
  const shown = runId;
  liveCard = { card, id: shown, up: false };
  window.setTimeout(() => {
    if (runId !== shown) return;
    if (liveCard) liveCard.up = true;
    screens.setMode('over');
    scoreScreen.show(card);
  }, delayMs);

  if (wasRanked) {
    // Le score du serveur remplace le local quand il arrive ; sinon le local
    // reste, et l'étiquette dit pourquoi. La partie suivante peut déjà avoir
    // commencé : l'écran ne bouge que s'il montre encore celle-ci. Une réponse
    // plus rapide que le délai ci-dessus n'est pas perdue : elle va dans la
    // carte, que `show` lira en montant.
    void ranked.submit(sim).then((verdict) => {
      if (runId !== shown) return;
      const text =
        typeof verdict === 'string'
          ? `unranked \u00b7 ${UNRANKED[verdict]}`
          : `ranked \u00b7 ${Math.round(verdict.score).toLocaleString('en-GB')} on the board` +
            (ranked.rank ? ` \u00b7 #${ranked.rank}` : '');
      noteCard(text);
    });
  }
}

/** Le mot de l'écran de fin pour chaque façon de ne pas être classé. */
const UNRANKED: Record<Unranked, string> = {
  offline: 'offline',
  'no-ticket': 'no server',
  dry: 'connection lost',
  refused: 'refused by the server',
  unreachable: 'server unreachable',
  off: 'ranked mode is off',
  'sign-in': 'sign in to play ranked',
};
/** Compte les parties, pour qu'une réponse tardive ne touche pas l'écran d'une autre. */
let runId = 0;

/** Une partie compte quand elle finit, quelle que soit la fin : crash, relance ou abandon. */
function submit(): { wasBest: boolean; previousBest: number } {
  runId++;
  const result = scores.submit(sim.state.score, sim.state.coins, difficulty, Date.now());
  // Toujours repeint : pendant une course au fantôme, l'étiquette montrait l'écart.
  hud.setBest(scores.bestLabel);
  // La trace de chaque partie est proposée, fantôme ou pas : celle qui bat la
  // meilleure devient le prochain fantôme de la difficulté.
  ghosts.offer(sim.trace(), sim.state.score);
  ghost.disarm();
  return result;
}

function renderFrame(frameDt: number): void {
  elapsed += frameDt;

  // Le chemin doit être intégré avant que quoi que ce soit le lise : les rubans
  // parcourent ses tampons directement et la caméra échantillonne le long.
  const state = sim.state;
  sim.track.buildPath(state.cursor);
  // Le bouclier d'abord : les rails lisent son intensité de cette frame.
  shield.update(frameDt, state, screens.isLive);
  trackMesh.update(sim.track, sim.tuning.stripeEvery, shield.value, elapsed);

  const thrust = thrustTier(state);
  // Le palier de pièce est le barreau de poussée : une seule notion, celle que
  // le noyau publie, au lieu d'un seuil de vitesse qui l'approximait mal.
  pickups.update(sim.track, state.cursor, thrust, frameDt);
  if (duel.active) {
    duel.pump(sim);
    if (duel.other) ghost.follow(duel.other, frameDt);
    // Le rival sorti : on le dit une fois, pendant la course. Sans ça son
    // vaisseau s'arrêtait simplement de suivre, sans un mot.
    if (racing && duel.other?.wrecked && !rivalOut) {
      rivalOut = true;
      tips.say(`<b>${duel.rival?.name ?? 'The other pilot'}</b> is out. Finish the line.`);
    }
    // La ligne : la course de ce vaisseau est finie, l'objet jugera sur ce
    // qu'il a rejoué — le reste de la trace part tout de suite.
    if (racing && screens.isPlaying && duel.race > 0 && sim.state.dist >= duel.race) finishDuel();
  }
  ghost.update(sim, frameDt);
  ranked.pump();
  if (ghost.armed && screens.isPlaying) hud.setGap(ghost.gap, duel.active ? 'rival' : 'ghost');
  ship.setPose(state.lat, state.hop, bank);
  // Gîte et lacet sont montrés, pas simulés : ils traînent derrière l'état pour
  // que la coque se lise comme une masse au lieu de sauter d'une attitude à
  // l'autre.
  const wantLean = -state.yaw * 0.9 - MathUtils.clamp(state.latVel * 0.01, -0.2, 0.2);
  lean += (wantLean - lean) * Math.min(1, frameDt * 7);
  const wantYaw =
    state.yaw * sim.tuning.yawVisual +
    MathUtils.clamp(state.slip * sim.tuning.driftYaw, -0.42, 0.42);
  yawVisual += (wantYaw - yawVisual) * Math.min(1, frameDt * 9);
  ship.setAttitude(lean, yawVisual, MathUtils.clamp(-state.vyRel * 0.018, -0.32, 0.32));
  ship.updateThrust(frameDt, thrust);
  ship.updateSmoke(frameDt, state.speed, thrust, driftIntensity(state) * driftSide(state));
  ship.updateExplosion(frameDt);
  spray.update(frameDt, state);
  damage.update(state.hull, screens.isLive);

  // Un écran bas — un téléphone en paysage — rapproche la caméra. Lu à chaque
  // frame : `innerHeight` ne force pas de mise en page, et la rotation d'un
  // téléphone ne prévient pas.
  camera.setCompact(window.innerHeight < COMPACT_BELOW);

  // Lueur, secousse du client et hystérésis de la réserve pleine, sur l'horloge
  // d'affichage.
  feedback.update(frameDt, state, sim.tuning, screens.isLive);

  // L'intensité de l'état monte tant que le pilotage tient, et tout ce qui doit
  // croître pendant les cinq secondes la lit : la secousse et le calque.
  surgeMeter.update(frameDt, state, sim.tuning);
  // Le flou plein écran est le seul effet dont le coût dépasse le sien : il
  // s'efface dès que la qualité a dû baisser, par le gouverneur ou à la main.
  surgeOverlay.update(surgeMeter.value, skyDetail && sim.tuning.renderScale >= 1);
  // Hors partie, la simulation n'avance plus et `state.shake` reste bloqué à
  // sa dernière valeur — sans quoi une secousse figée en la perdant tremblerait
  // indéfiniment derrière l'écran de pause ou la modale SHIP WRECKED.
  const shake = screens.isLive ? state.shake + feedback.shake + surgeMeter.value * SURGE_SHAKE : 0;
  camera.update(state, sim.track, sim.tuning, frameDt, shake);

  const position = viewport.camera.position;
  sky.update(
    elapsed,
    position.x,
    position.y,
    position.z,
    sim.track.nk[BACK]!,
    state.speed,
    frameDt,
    thrust,
  );

  perf.detect(frameDt);
  perf.update(frameDt);
  if (showFps) {
    const el = document.getElementById('fpsVal');
    if (el) el.textContent = String(Math.round(perf.fps));
  }

  audio.update(
    screens.isLive,
    state.speed,
    sim.tuning.speedMax,
    thrust,
    driftIntensity(state),
    driftFill(state, sim.tuning),
    shield.value,
  );

  if (screens.isLive) {
    hud.update(state, sim.tuning, frameDt);
    tips.update(frameDt);
  }

  viewport.render(scene);
}

const loop = new Loop({
  simulate(dt) {
    const mode = screens.mode;
    // Seuls deux modes font avancer le monde : une partie, et la boucle
    // d'attraction derrière le menu. Pause, réglages et le reste le figent à
    // dessein.
    if (mode === 'run') {
      bank = sim.step(input.sample(), dt, false);
      feedback.consume(sim.events);
      ghost.step(dt);
      // Piste à sec : la partie continue tout droit, mais elle n'est plus la
      // piste du serveur, donc plus classée. Le joueur le lit tout de suite.
      const lost = ranked.check(sim);
      if (lost) {
        unrankedWhy = lost;
        hud.setBest(`unranked \u00b7 ${UNRANKED[lost]}`);
      }
    } else if (mode === 'watch') {
      // Les entrées viennent de la trace. La partie enregistrée s'arrête où
      // elle s'est arrêtée : au bout, on rend la main au tableau.
      // Une trace du tableau finit sur son crash ; `wrecked` couvre celle
      // qui continuerait après — rien ne se joue plus une fois l'épave.
      if (watching && !watching.done && !sim.state.wrecked) {
        bank = sim.step(watching.advance(), dt, false);
        // Pas « en direct » : le crash de l'autre explose à l'écran et ne
        // finit rien chez le joueur.
        feedback.consume(sim.events, false);
      } else if (watching) {
        // Au bout de la trace — souvent un crash — l'écran garde la scène
        // le temps de l'onde, comme pour une vraie partie, puis rend la main.
        const shown = watching;
        last = shown;
        watching = null;
        window.setTimeout(() => {
          if (screens.mode === 'watch' && watching === null && shown === last) screens.back();
        }, WRECK_HOLD_MS);
      }
    } else if (mode === 'menu' || mode === 'signin' || mode === 'name') {
      // La porte et le pseudo sont des calques sur le menu : le monde vit
      // derrière, comme derrière le menu lui-même.
      bank = sim.step(input.value, dt, true);
    }
  },
  render: renderFrame,
});

/* ---------------------------------------------------------------- écrans -- */

const on = (id: string, handler: () => void) =>
  document.getElementById(id)?.addEventListener('click', handler);

/** Ce que chaque bouton qui lance une partie appelle : classée si le réglage l'est. */
const play = () => void (rankedOn ? startRanked() : startRun());

on('btnStart', play);
on('btnPause', () => {
  const el = document.getElementById('pauseDist');
  if (el) el.textContent = Math.round(sim.state.score).toLocaleString('en-GB');
  screens.setMode('pause');
});
on('btnResume', () => screens.setMode('run'));
on('btnRestart', play);
on('btnQuit', () => {
  submit();
  // Le voile de dégâts clignote encore si la coque était basse en quittant :
  // sans ceci il continue de pulser sur le menu jusqu'à la prochaine partie.
  damage.reset();
  screens.setMode('menu');
});
on('btnAgain', play);
on('btnOverMenu', () => {
  damage.reset();
  screens.setMode('menu');
});
on('btnHelp', () => screens.setMode('help'));
on('btnCloseHelp', () => screens.setMode('menu'));
on('btnSettingsMenu', () => screens.openSettings());
on('btnSettingsPause', () => screens.openSettings());
on('btnCloseSettings', () => screens.setMode('menu'));
on('btnBoardMenu', () => screens.setMode('board'));
on('btnStay', () => screens.setMode('menu'));
on('btnDuel', () => openDuel());
on('btnMakeLink', () => void makeLink());
on('btnShareInvite', () => {
  const link = document.getElementById('inviteLink') as HTMLInputElement | null;
  if (!link || !link.value) return;
  // L'API de l'appareil quand elle existe — la feuille de partage du
  // téléphone — et la copie sinon.
  const nav = navigator as Navigator & {
    share?: (d: { url: string; title?: string }) => Promise<void>;
  };
  if (nav.share) void nav.share({ url: link.value, title: 'G-SURGE duel' }).catch(() => undefined);
  else document.getElementById('btnCopyInvite')?.dispatchEvent(new Event('click'));
});
on('btnJoinInvite', () => {
  const input = document.getElementById('inviteInput') as HTMLInputElement | null;
  const room = roomOf(input?.value ?? '');
  if (!room) {
    sayDuel('That is not an invite link.');
    return;
  }
  void joinDuel(room);
});

/** L'identifiant d'un salon dans ce qu'on colle : un lien entier, ou juste son code. */
function roomOf(text: string): string | null {
  const t = text.trim();
  const m = t.match(/(?:#|[?&])duel=([0-9a-f]{16})\b/) ?? t.match(/^([0-9a-f]{16})$/);
  return m ? m[1]! : null;
}
on('btnLeaveGrid', () => screens.setMode('menu'));
on('btnCancelDuel', () => {
  // Quitter l'écran, c'est renoncer à l'invitation : elle ne doit pas se
  // rouvrir toute seule à la prochaine connexion de l'onglet.
  rememberDuel(null);
  screens.setMode('menu');
});
on('btnCopyInvite', () => {
  const link = document.getElementById('inviteLink') as HTMLInputElement | null;
  if (!link || !link.value) return;
  link.select();
  void navigator.clipboard?.writeText(link.value).then(
    () => sayDuel('Link copied. The race starts when the other pilot arrives.'),
    () => sayDuel('Copy failed — select the link and copy it by hand.'),
  );
});
on('btnStopWatch', () => screens.back());
on('btnLeave', () => back.leave());
on('btnCloseBoard', () => screens.setMode('menu'));
document.getElementById('segBoardDiff')?.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('button');
  const d = button?.dataset.d as Difficulty | undefined;
  if (!d) return;
  for (const b of document.querySelectorAll<HTMLElement>('#segBoardDiff button')) {
    const on = b === button;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  boardScreen.setDifficulty(d);
});
document.getElementById('segBoardCategory')?.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('button');
  const c = button?.dataset.c as BoardCategory | undefined;
  if (!c) return;
  for (const b of document.querySelectorAll<HTMLElement>('#segBoardCategory button')) {
    const on = b === button;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  boardScreen.setCategory(c);
});
on('tglFull', () => fullscreen.toggle());
on('btnFullMenu', () => fullscreen.toggle());
on('btnInstall', () => void install.prompt());
on('btnInstallLater', () => {
  install.dismiss();
  prefs.set('installDismissed', true);
});
on('btnUpdate', () => updates.apply());

// Les deux commandes disparaissent là où l'API n'existe pas, plutôt que de
// rester là sans rien faire.
if (!fullscreen.available) {
  const group = document.getElementById('grpDisplay');
  if (group) group.style.display = 'none';
  const button = document.getElementById('btnFullMenu');
  if (button) button.style.display = 'none';
}

// L'état de départ est posé en appelant setMode, pas par une classe dans le
// HTML : la classe seule montrerait le bon écran avec une liste de navigation
// vide. Restauré avant que quoi que ce soit le lise. Il n'y a pas de cible de
// cadence à restaurer : le jeu rend à ce que l'écran donne, et la qualité s'y
// adapte.
sim.tuning.renderScale = prefs.values.renderScale;
viewport.setRenderScale(prefs.values.renderScale);
trackMesh.setWidth(sim.tuning.half);

screens.setMode('menu');
screens.setMenuGates({ account: session.signedIn });
paintAccountRow();
screens.revealCursorOnPrecisePointer();
// Entre le splash et le menu : qui vole ? Sans session, la porte propose de
// se connecter ou de jouer hors ligne — le jeu est le même. Une session
// présente la saute ; un retour de chez le fournisseur propose le pseudo.
const gateSeen = (): boolean => {
  try {
    return sessionStorage.getItem('gsurge.gate') !== null;
  } catch {
    return true;
  }
};
if (session.fresh) {
  session.fresh = false;
  screens.setMode('name');
} else if (!session.signedIn && !gateSeen()) {
  screens.setMode('signin');
}
/**
 * Qui vole, dans le menu. L'état du compte ne se lisait que dans l'onglet
 * Profil, deux écrans plus loin, alors que c'est lui qui décide de ce que le
 * menu propose — sans compte, le tableau et le duel n'y sont pas.
 *
 * Trois états : connecté et connu, connecté mais `/me` pas encore revenu, et
 * hors ligne. Le troisième est le seul à proposer un geste.
 */
function paintAccountRow(): void {
  const row = document.getElementById('btnAccount');
  const face = document.getElementById('menuFace');
  const who = document.getElementById('menuWho');
  const act = document.getElementById('menuAct');
  if (!row || !who || !act || !face) return;
  const account = session.account;
  const signedIn = session.signedIn;
  // Sa propre photo ici aussi, à la demande de l'auteur : c'est une requête
  // vers le fournisseur sur l'écran qu'on voit le plus, mais c'est son écran
  // et sa tête. Les pixels restent le repli.
  paintFace(
    face,
    account ? { name: account.name, face: account.face, pic: session.picture ?? undefined } : null,
    22,
  );
  who.textContent = account
    ? account.name
    : signedIn
      ? 'Signed in\u2026'
      : // Court : la ligne est étroite sur un téléphone, et la porte qu'elle
        // ouvre dit ce qu'un compte apporte.
        'Playing offline';
  act.textContent = signedIn ? 'ACCOUNT' : 'SIGN IN';
  row.classList.toggle('out', !signedIn);
}

on('btnAccount', () => {
  if (session.signedIn) {
    screens.openSettings();
    settings.showTab('tabProfile');
  } else screens.setMode('signin');
});
on('btnGateSignIn', () => session.signIn('google'));
on('btnGateOffline', () => {
  // Choisi pour l'onglet : la porte ne se représente pas à chaque écran.
  try {
    sessionStorage.setItem('gsurge.gate', 'offline');
  } catch {
    // sans stockage de session, la porte reviendra ; mieux que l'inverse
  }
  screens.setMode('menu');
});
on('btnNameSave', () => {
  const input = document.getElementById('nameInput') as HTMLInputElement | null;
  const note = document.getElementById('nameNote');
  if (!input) return;
  void session.rename(input.value.trim()).then((ok) => {
    if (ok && !resumePendingDuel()) screens.setMode('menu');
    else if (!ok && note) note.textContent = 'Two to sixteen letters, digits, space, - or _.';
  });
});
on('btnNameSkip', () => {
  if (!resumePendingDuel()) screens.setMode('menu');
});
on('btnDuelSignIn', () => session.signIn('google'));
// Un lien d'invitation : le fragment porte le salon, et il en sort ici. Sans
// compte, `joinDuel` le met de côté et propose de se connecter ; au retour, le
// salon est reprise juste après l'écran du pseudo.
{
  const hash = window.location.hash;
  const room = hash.startsWith('#') ? new URLSearchParams(hash.slice(1)).get(DUEL_LINK) : null;
  if (room && /^[0-9a-f]{16}$/.test(room)) {
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
    void joinDuel(room);
  } else if (screens.mode !== 'name') {
    resumePendingDuel();
  }
}
// Le retour du système remonte d'un écran plutôt que de quitter le jeu, et
// met en pause pendant une partie. Posé après `setMode`, qui est l'état de
// départ.
back.start();
settings.syncAll();
// Le compte : les réglages se repeignent quand la session change, et `/me`
// est demandé une fois au démarrage — sans jeton, il ne demande rien.
session.onChange = () => {
  settings.paintAccount();
  // Et le menu avec eux : une connexion ouvre le tableau et le duel, une
  // sortie les referme.
  screens.setMenuGates({ account: session.signedIn });
  paintAccountRow();
  // Le pseudo proposé au retour de chez le fournisseur : le nom du compte, à changer ou garder.
  const input = document.getElementById('nameInput') as HTMLInputElement | null;
  if (input && screens.mode === 'name' && session.account && !input.value)
    input.value = session.account.name;
};
void session.refresh();

// Un onglet fermé ou masqué n'exécute jamais un minuteur en attente, et les
// navigateurs mobiles peuvent ne jamais émettre `unload`.
window.addEventListener('pagehide', () => prefs.flush());
hud.setBest(scores.bestLabel);
// Construit avant le premier crash : sa réponse impulsionnelle fait 288 000
// échantillons et la produire à l'impact tombe comme un à-coup au pire moment.
const openAudio = () => {
  audio.unlock();
  audio.warmUp();
};
window.addEventListener('pointerdown', openAudio, { once: true });
window.addEventListener('keydown', openAudio, { once: true });

/**
 * Tient le splash jusqu'à ce que le jeu puisse vraiment tourner, plutôt qu'un
 * temps fixe.
 *
 * Deux choses coûtent un à-coup visible à la première frame si on les laisse
 * arriver en jeu. Les programmes de shader sont compilés paresseusement par
 * three.js la première fois qu'un matériau est dessiné — celui du ciel surtout
 * — ce que la garde « les premières secondes sont de la compilation » du
 * gouverneur de performance contourne. Et la texture canvas de la route est
 * envoyée au premier usage.
 *
 * `compile` règle la première, dessiner une frame règle la seconde.
 */
async function boot(): Promise<void> {
  window.__gsProgress?.(45, 'COMPILING SHADERS');
  // Deux frames, pour que le libellé soit réellement peint avant que le fil
  // principal soit bloqué par la compilation.
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
  );

  sim.track.buildPath(sim.state.cursor);
  trackMesh.update(sim.track, sim.tuning.stripeEvery);
  viewport.renderer.compile(scene, viewport.camera);

  window.__gsProgress?.(80, 'WARMING UP');
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  // Une frame entière : envoie la texture de la route et parcourt chaque chemin
  // que la boucle prendra, pour que la première frame vue ne soit pas la chère.
  renderFrame(loop.fixedStep);

  loop.start();
  window.__gsReady?.();
}

void boot();

// La coquille hors ligne et ses mises à jour : voir updates.ts. L'enregistrement
// vivait dans le script de pied de page de l'ancienne page et s'est perdu au
// portage — le fichier partait et rien ne l'activait. Attrapé en le cherchant
// plutôt que par un test, ce qui est la lacune.
updates.register();
// L'offre initiale : sur iOS elle existe avant tout événement, et `setMode('menu')`
// a déjà bâti la navigation, donc c'est ici qu'elle se montre.
showInstall(install.offer);

/* ------------------------------------------------------------ mise au point -- */

declare global {
  interface Window {
    __gsReady?: () => void;
    __gsProgress?: (percent: number, label?: string) => void;
  }
}

/**
 * Arrête la boucle, rejoue un nombre connu de pas fixes depuis une graine, et
 * dessine exactement une frame. C'est ce qui rend une référence visuelle plein
 * cadre possible : une frame dépendait autrefois du moment où on la prenait.
 *
 * Elle vit ici et non dans `debug.ts` parce qu'elle doit connaître chaque état
 * qui s'amortit — la même liste qu'un début de partie, d'où la remise à zéro
 * partagée — plus le ciel et le temps écoulé, qu'une partie garde et qu'une
 * capture ne doit pas garder.
 */
function freeze(seed: string, steps: number): void {
  loop.stop();
  sim.reset(seed);
  resetPresentation();
  sky.reset();
  elapsed = 0;
  const dt = loop.fixedStep;
  for (let i = 0; i < steps; i++) bank = sim.step(input.value, dt, true);
  renderFrame(dt);
  // Les plumes s'amortissent sur beaucoup de frames, donc une frame après une
  // remise à zéro atterrit là où la partie précédente les a laissées. On les
  // cale, puis on redessine.
  ship.snapThrust(thrustTier(sim.state));
  viewport.render(scene);
}

installDebugSurface({ sim, loop, viewport, screens, sky, ghost, ship, freeze, startRanked });
