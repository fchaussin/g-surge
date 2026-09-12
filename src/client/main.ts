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
  driftFill,
  Sim,
  thrustTier,
  tuningFor,
  type Difficulty,
} from '../sim/index.js';
import { Audio } from './audio.js';
import type { BoardCategory } from './api.js';
import { BoardScreen } from './board.js';
import { ChaseCamera, COMPACT_BELOW } from './camera.js';
import { DamageOverlay } from './damage.js';
import { installDebugSurface } from './debug.js';
import { driftIntensity, driftSide } from './drift.js';
import { DriftSpray } from './drift-spray.js';
import { Feedback } from './feedback.js';
import { Fullscreen } from './fullscreen.js';
import { Ghost } from './ghost.js';
import { GhostStore } from './ghosts.js';
import { Haptics } from './haptics.js';
import { Hud } from './hud.js';
import { InputSource } from './input.js';
import { InstallPrompt, type InstallOffer } from './install.js';
import { Loop } from './loop.js';
import { PerformanceGovernor } from './performance.js';
import { Pickups } from './pickups.js';
import { PreferenceStore } from './preferences.js';
import { Ranked, type Unranked } from './ranked.js';
import { ScoreScreen } from './score-screen.js';
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
);

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
    // On garde la valeur d'affichage : elle appartient à la machine, pas au
    // niveau.
    const scale = sim.tuning.renderScale;
    sim.setDifficulty(d);
    sim.tuning.renderScale = scale;
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
  setName: (n) => prefs.set('name', n),
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

function startRun(): void {
  if (screens.mode === 'run') submit();
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
  if (screens.mode === 'run') submit();
  ranked.abandon();
  const issued = await ranked.request(difficulty);
  if (typeof issued === 'string') {
    startRun();
    hud.setBest(`unranked \u00b7 ${issued === 'offline' ? 'offline' : 'no server'}`);
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

function endRun(): void {
  haptics.buzz([90, 60, 200]);
  // La coque n'a plus de jauge à faire clignoter une fois explosée : sans
  // ceci le voile rouge continuait de pulser sur l'écran de score.
  damage.reset();
  // le score du fantôme avant `submit`, qui peut le remplacer par cette partie
  const raced = ghost.armed ? ghosts.bestScore(difficulty) : null;
  const wasRanked = ranked.active;
  const { wasBest, previousBest } = submit();
  screens.setMode('over');
  scoreScreen.show({
    distance: sim.state.dist,
    seconds: sim.state.time,
    coins: sim.state.coins,
    peakMultiplier: sim.state.multPeak,
    topSpeed: sim.state.speedPeak,
    total: sim.state.score,
    wasBest,
    previousBest,
    ghostScore: raced,
    note: wasRanked
      ? 'ranked \u00b7 checking'
      : unrankedWhy
        ? `unranked \u00b7 ${UNRANKED[unrankedWhy]}`
        : '',
  });
  if (wasRanked) {
    // Le score du serveur remplace le local quand il arrive ; sinon le local
    // reste, et l'étiquette dit pourquoi. La partie suivante peut déjà avoir
    // commencé : l'écran ne bouge que s'il montre encore celle-ci.
    const shown = runId;
    void ranked.submit(sim, prefs.values.name).then((verdict) => {
      if (runId !== shown) return;
      if (typeof verdict === 'string') scoreScreen.note(`unranked \u00b7 ${UNRANKED[verdict]}`);
      else
        scoreScreen.note(
          `ranked \u00b7 ${Math.round(verdict.score).toLocaleString('en-GB')} on the board` +
            (ranked.rank ? ` \u00b7 #${ranked.rank}` : ''),
        );
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
  shield.update(frameDt, state, screens.isPlaying);
  trackMesh.update(sim.track, sim.tuning.stripeEvery, shield.value, elapsed);

  const thrust = thrustTier(state);
  // Le palier de pièce est le barreau de poussée : une seule notion, celle que
  // le noyau publie, au lieu d'un seuil de vitesse qui l'approximait mal.
  pickups.update(sim.track, state.cursor, thrust, frameDt);
  ghost.update(sim);
  ranked.pump();
  if (ghost.armed && screens.isPlaying) hud.setGap(ghost.gap);
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
  damage.update(state.hull, elapsed);

  // Un écran bas — un téléphone en paysage — rapproche la caméra. Lu à chaque
  // frame : `innerHeight` ne force pas de mise en page, et la rotation d'un
  // téléphone ne prévient pas.
  camera.setCompact(window.innerHeight < COMPACT_BELOW);

  // Lueur, secousse du client et hystérésis de la réserve pleine, sur l'horloge
  // d'affichage.
  feedback.update(frameDt, state, sim.tuning, screens.isPlaying);

  // L'intensité de l'état monte tant que le pilotage tient, et tout ce qui doit
  // croître pendant les cinq secondes la lit : la secousse et le calque.
  surgeMeter.update(frameDt, state, sim.tuning);
  // Le flou plein écran est le seul effet dont le coût dépasse le sien : il
  // s'efface dès que la qualité a dû baisser, par le gouverneur ou à la main.
  surgeOverlay.update(surgeMeter.value, skyDetail && sim.tuning.renderScale >= 1);
  // Hors partie, la simulation n'avance plus et `state.shake` reste bloqué à
  // sa dernière valeur — sans quoi une secousse figée en la perdant tremblerait
  // indéfiniment derrière l'écran de pause ou la modale SHIP WRECKED.
  const shake = screens.isPlaying
    ? state.shake + feedback.shake + surgeMeter.value * SURGE_SHAKE
    : 0;
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
    screens.isPlaying,
    state.speed,
    sim.tuning.speedMax,
    thrust,
    driftIntensity(state),
    driftFill(state, sim.tuning),
    shield.value,
  );

  if (screens.isPlaying) {
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
    } else if (mode === 'menu') {
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

screens.setMode('menu');
screens.revealCursorOnPrecisePointer();
settings.syncAll();

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

installDebugSurface({ sim, loop, viewport, screens, sky, ghost, freeze, startRanked });
