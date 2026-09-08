'use strict';
/* Void Runner — physique, interface, audio, boucle. Nécessite engine.js. */

if (typeof THREE === 'undefined') throw new Error('three.js is required');

/* ============================ 6. Physique ============================ */
const state = { dist:0, cursor:0, speed:DEFAULTS.speedStart, lat:0, latVel:0, scrape:0,
                energy:100, boosting:false, air:false, hop:0, vyRel:0, airTime:0,
                hull:100, contact:false, shake:0, yaw:0, drift:false, wrecked:false,
                coins:0, superT:0, slip:0, halo:0, haloPow:1, travel:0,
                mult:1, multPeak:1, score:0 };
const input = { steer:0, brake:false, boost:false };
const keys = {}, touch = { brake:false, boost:false };
let stickX = 0;   // manche analogique, -1 a 1, positif vers la gauche de l'ecran

function step(dt, attract){
  if (attract){
    input.steer = THREE.MathUtils.clamp(-(state.lat*0.10 + state.latVel*0.55), -1, 1);
    input.brake = false; input.boost = false;
  } else {
    // l'axe X du monde apparaît à gauche de l'écran, d'où l'inversion
    const kb = (keys.left?1:0) - (keys.right?1:0);
    input.steer = kb !== 0 ? kb : stickX;
    input.brake = !!(keys.brake||touch.brake);
    input.boost = !!(keys.boost||touch.boost);
  }

  if (state.superT > 0) state.superT = Math.max(0, state.superT - dt);
  const superOn = state.superT > 0 && !attract;
  if (attract) state.boosting = false;
  else if (superOn) state.boosting = true;
  else {
    if (input.boost && !state.boosting && state.energy >= TUNING.boostMin) state.boosting = true;
    if (!input.boost || state.energy <= 0) state.boosting = false;
  }
  const dmg = 1 - state.hull / 100;
  if (state.boosting && !superOn) state.energy -= TUNING.boostDrain * dt;
  else if (!superOn) state.energy += TUNING.boostRecharge * (1 - dmg * 0.5) * dt;
  state.energy = THREE.MathUtils.clamp(state.energy, 0, 100);
  if (!attract) state.hull = Math.min(100, state.hull + TUNING.hullRegen * dt);

  let target, gain = TUNING.speedGain;
  if (attract) target = 46;
  else {
    const ramp = Math.min(1, state.dist / TUNING.speedRamp);
    target = TUNING.speedStart + (TUNING.speedMax - TUNING.speedStart) * ramp;
    if (state.boosting){
      target *= superOn ? TUNING.boostFactor * TUNING.supFactor : TUNING.boostFactor;
      gain *= TUNING.boostGain;
    }
    if (input.brake) target *= TUNING.brakeFactor;
    target *= (1 - dmg * TUNING.damageSpeed);
  }
  state.speed += (target - state.speed) * Math.min(1, dt * gain);
  genSpeed = state.speed;

  // le multiplicateur s'érode proportionnellement à lui même, moitié moins vite
  // tant que le palier maximum de vitesse est tenu
  const fastLane = state.speed >= TUNING.coinTier3;
  state.mult -= (state.mult - 1) * TUNING.multDecay * (fastLane ? TUNING.multDecayFast : 1) * dt;
  if (state.mult < 1) state.mult = 1;

  const d = state.speed * dt;
  state.travel += d;
  if (!attract){
    state.dist += d;
    state.score += state.speed * state.mult * diffMul * dt;
    if (state.mult > state.multPeak) state.multPeak = state.mult;
  }
  state.cursor += d;
  while (state.cursor >= SEG){ state.cursor -= SEG; pushNode(); }

  const kNow = nk[BACK];
  const bNow = nb[BACK] + (nb[BACK+1] - nb[BACK]) * (state.cursor / SEG);

  // décollage : la piste se dérobe plus vite que la gravité ne peut rabattre le vaisseau
  const gNow = gradeAt(0), gAhead = gradeAt(22);
  if (!state.air && !attract && state.speed > 45){
    const need = (gAhead - gNow) * state.speed * state.speed / 22;
    if (need < -9.81 * TUNING.airThresh){
      state.air = true; state.airTime = 0;
      state.vyRel = TUNING.launchScale * state.speed * (gNow - gAhead);
      state.hop = 0.05;
    }
  }
  if (state.air){
    state.airTime += dt;
    state.vyRel -= 9.81 * TUNING.airGravity * dt;
    state.hop += state.vyRel * dt;
    if (state.hop <= 0){
      state.hop = 0; state.air = false; state.vyRel = 0;
      SFX.land(); buzz(18, 120);
      if (Math.abs(state.lat) > HALF - SHIP){          // réception hors piste
        state.speed *= (1 - TUNING.badLanding);
        state.energy = Math.max(0, state.energy - 40);
        state.hull = Math.max(0, state.hull - 18);
        state.shake = 0.8; state.scrape = 0.4; SFX.hit(0.7);
        flashHalo(0xff3b30, 1.1); buzz([40, 50, 120]);
        state.mult = 1 + (state.mult - 1) * TUNING.multWallCut;
      }
    }
  }

  // le manche commande un angle de lacet, pas directement une accélération latérale
  const yawMax = THREE.MathUtils.clamp(
      TUNING.yawBase * TUNING.yawSpeedRef / Math.max(40, state.speed),
      TUNING.yawMin, TUNING.yawBase) * (1 - dmg * TUNING.damageSteer);
  state.yaw += (input.steer * yawMax - state.yaw) * Math.min(1, dt * TUNING.yawResponse);

  // vitesse latérale que le nez réclame, et écart réellement encaissé par les appuis
  const vWant = Math.sin(state.yaw) * state.speed;
  const dv = vWant - state.latVel;
  if (!state.air){
    if (!state.drift && Math.abs(dv) * TUNING.gripHold > TUNING.gripLimit) state.drift = true;
    if (state.drift && Math.abs(dv) < TUNING.driftExit) state.drift = false;
  } else state.drift = false;

  let grip = state.drift ? TUNING.gripDrift : TUNING.gripHold;
  if (state.air) grip *= TUNING.airSteer;
  state.latVel += dv * Math.min(1, dt * grip);
  if (!state.air){
    state.latVel -= kNow * state.speed * state.speed * TUNING.centri * dt;
    state.latVel -= 9.81 * Math.sin(bNow) * TUNING.bankAssist * dt;
  }
  state.latVel = THREE.MathUtils.clamp(state.latVel, -TUNING.steerMaxVel, TUNING.steerMaxVel);
  state.lat += state.latVel * dt;
  if (state.drift && !attract) state.energy = Math.min(100, state.energy + TUNING.driftCharge * dt);
  state.slip = dv;

  const lim = (HALF - SHIP) + (state.air ? TUNING.airOverhang : 0);
  if (Math.abs(state.lat) > lim){
    const impact = Math.abs(state.latVel);
    state.lat = Math.sign(state.lat) * lim;
    if (Math.sign(state.latVel) === Math.sign(state.lat)){
      state.latVel = -state.latVel * TUNING.wallBounce;
      if (!attract && !state.air){
        state.speed -= state.speed * TUNING.wallPenalty * dt * 6;
        state.energy = Math.max(0, state.energy - TUNING.wallDrain * dt);
        if (!state.contact){                       // choc franc, une seule fois par contact
          const hit = THREE.MathUtils.clamp(impact * TUNING.hullImpact, 2, 42);
          state.hull = Math.max(0, state.hull - hit);
          state.shake = Math.min(1, hit / 26); SFX.hit(state.shake);
          flashHalo(0xff3b30, 0.75 + state.shake * 0.6);
          buzz(state.shake > 0.6 ? [35, 40, 110] : [25 + Math.round(state.shake * 60)]);
          state.mult = 1 + (state.mult - 1) * TUNING.multWallCut;
          state.speed *= (1 - Math.min(0.30, hit / 140));
        }
      }
    }
    if (!attract && !state.air){
      state.hull = Math.max(0, state.hull - TUNING.hullScrape * dt);
      holdHalo(0xff3b30, 0.70, 0.7);
      buzz(9, 190);                      // frottement : brèves impulsions espacées
    }
    if (!state.air){ state.contact = true; state.scrape = attract ? 0 : 0.16; }
  } else {
    state.contact = false;
    if (state.scrape > 0) state.scrape -= dt;
  }
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.6);

  // ramassage : chaque objet est testé au moment où le vaisseau le dépasse
  const ibase = nid[0];
  for (const it of items){
    if (it.done) continue;
    if ((it.id - ibase - BACK) * SEG - state.cursor > 0) continue;
    it.done = true;
    if (attract) continue;
    if (Math.abs(state.lat - it.lat) > TUNING.pickRadius || state.hop > 4) continue;
    it.taken = true;
    if (it.type === ITEM_COIN){
      const ct = COIN_TIER[coinTier()];
      state.coins++;
      state.mult = Math.min(TUNING.multMax, state.mult + ct.gain);
      pop('\u00d7 +' + ct.gain.toFixed(1), ct.css);
      SFX.coin(1 + ct.gain * 3); flashHalo(ct.hex, 0.75 + ct.gain * 0.9);
      buzz(10 + Math.round(ct.gain * 22));
    } else if (it.type === ITEM_FIX){
      state.hull = Math.min(100, state.hull + TUNING.fixAmount);
      pop('REPAIRED', '#35e08a'); SFX.fix(); flashHalo(0x35e08a);
      buzz([22, 40, 22]);
    } else {
      state.superT = TUNING.supTime; state.energy = 100;
      pop('SUPER BOOST', '#ff2f9a'); SFX.sup(); flashHalo(0xff2f9a);
      buzz([30, 30, 70]);
    }
  }
  if (!attract && state.hull <= 0) state.wrecked = true;
  if (state.speed < 12) state.speed = 12;
  return bNow;
}

function resetRun(){
  state.dist = 0; state.cursor = 0; state.speed = TUNING.speedStart;
  state.lat = 0; state.latVel = 0; state.scrape = 0;
  state.energy = 100; state.boosting = false;
  state.air = false; state.hop = 0; state.vyRel = 0;
  state.hull = 100; state.contact = false; state.shake = 0; stickX = 0;
  state.yaw = 0; state.drift = false; state.wrecked = false;
  state.coins = 0; state.superT = 0; state.slip = 0; state.halo = 0; state.haloPow = 1;
  state.mult = 1; state.multPeak = 1; state.score = 0; state.travel = 0;
  clearSmoke();          // les bouffées gardaient l'ancienne distance parcourue
  tipsReset();
  seedTrack();
  camReady = false;
}

/* ============================ 7. Classement ============================ */
const KEY = 'voidrunner.scores.v1';
let scores = [];

/* localStorage peut lever : navigation privée, quota plein, cookies bloqués.
   Dans ce cas le classement reste en mémoire pour la session. */
function storageOk(){
  try {
    const k = '__vr_probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch(e){ return false; }
}
const HAS_LS = storageOk();

function loadScores(){
  if (HAS_LS){
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) scores = JSON.parse(raw) || [];
    } catch(e){ scores = []; }
  }
  renderBoard();
}
function persist(){
  if (!HAS_LS) return;
  try { window.localStorage.setItem(KEY, JSON.stringify(scores)); }
  catch(e){ /* quota atteint, on garde la valeur en mémoire */ }
}
function submitScore(d, coins){
  const v = Math.round(d);
  if (v < 50) return;
  scores.push({ d:v, c:coins || 0, t:Date.now(), x:DIFF[diff].label[0] });
  scores.sort((a,b) => b.d - a.d);
  scores = scores.slice(0, 5);
  persist(); renderBoard();
}
function fmtM(v){ return Math.round(v).toLocaleString('en-GB') + ' m'; }
function fmtN(v){ return Math.round(v).toLocaleString('en-GB'); }
function fmtDate(ts){
  const d = new Date(ts);
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
}
function renderBoard(){
  const host = document.getElementById('boardBody');
  if (!scores.length){
    host.innerHTML = '<p class="empty">No runs yet. A distance enters the board when you crash, restart or quit.</p>';
  } else {
    host.innerHTML = '<ol>' + scores.map((s,i) =>
      '<li><span class="rk">' + (i+1) + '</span><span class="dv">' + fmtN(s.d) +
      '</span><span class="dt">' + (s.x ? s.x + '  ' : '') + (s.c ? s.c + ' coins  ' : '') +
      fmtDate(s.t) + '</span></li>').join('') + '</ol>';
  }
  document.getElementById('recline').textContent = 'best ' + (scores.length ? fmtN(scores[0].d) : '0');
}
loadScores();

/* ============================ 8. États ============================ */
const L = {
  menu: document.getElementById('menu'),
  pause: document.getElementById('pause'),
  over: document.getElementById('over'),
  help: document.getElementById('help'),
  fpsinfo: document.getElementById('fpsinfo'),
  settings: document.getElementById('settings'),
  hud: document.getElementById('hud')
};
let mode = 'menu', settingsBack = 'menu';

function setMode(m){
  mode = m;
  L.menu.classList.toggle('on', m === 'menu');
  L.pause.classList.toggle('on', m === 'pause');
  L.over.classList.toggle('on', m === 'over');
  L.help.classList.toggle('on', m === 'help');
  L.fpsinfo.classList.toggle('on', m === 'fpsinfo');
  L.settings.classList.toggle('on', m === 'settings');
  document.getElementById('btnMute').classList.toggle('hide', m === 'settings' || m === 'help');
  L.hud.classList.toggle('on', m === 'run');
  navBuild();
  if (m !== 'run'){
    keys.left = keys.right = keys.brake = keys.boost = false;
    touch.brake = touch.boost = false;
    stickX = 0; stickId = null;
    stickEl.classList.remove('on');
    document.querySelectorAll('.pad.act').forEach(p => p.classList.remove('act'));
  }
}
function openPause(){
  document.getElementById('pauseDist').textContent = fmtN(state.score);
  setMode('pause');
}

const sRow = {
  dist:  document.getElementById('sDist'),  coins: document.getElementById('sCoins'),
  bonus: document.getElementById('sBonus'), total: document.getElementById('sTotal'),
  mul:   document.getElementById('sMul'),   tag:   document.getElementById('overTag')
};
let revealId = 0;

function revealScore(dist, coins, peak, total, wasBest, prevBest){
  const id = ++revealId;
  sRow.mul.textContent = 'coins raise it, walls halve it';
  sRow.tag.textContent = '';
  const steps = [
    { el:sRow.dist,  to:Math.round(dist), suffix:' m', dec:0 },
    { el:sRow.coins, to:coins,            suffix:'',   dec:0 },
    { el:sRow.bonus, to:peak,             prefix:'\u00d7', suffix:'', dec:1 },
    { el:sRow.total, to:Math.round(total),suffix:'',   dec:0 }
  ];
  steps.forEach(st => {
    st.el.textContent = (st.prefix || '') + (st.dec ? '0.0' : '0') + st.suffix;
    st.el.parentElement.classList.add('pending');
  });
  const START = 260, DUR = 480;               // décalage puis durée de comptage, en ms
  const t0 = performance.now();
  (function tick(now){
    if (id !== revealId) return;
    const t = now - t0;
    let done = 0;
    steps.forEach((st, i) => {
      const k = THREE.MathUtils.clamp((t - i * START) / DUR, 0, 1);
      if (k > 0) st.el.parentElement.classList.remove('pending');
      const eased = 1 - Math.pow(1 - k, 3);
      const v = st.to * eased;
      st.el.textContent = (st.prefix || '')
        + (st.dec ? v.toFixed(st.dec) : Math.round(v).toLocaleString('en-GB'))
        + st.suffix;
      if (k >= 1) done++;
      if (k >= 1 && !st.rung){ st.rung = true; blip(i === 3 ? 880 : 660, 0.10, 'square', 0.10); }
    });
    if (done < steps.length) requestAnimationFrame(tick);
    else sRow.tag.textContent = total < 50 ? ''
       : (wasBest ? 'NEW BEST' : 'best ' + fmtN(prevBest));
  })(t0);
}

function gameOver(){
  const total = state.score;
  const prevBest = scores.length ? scores[0].d : 0;
  const wasBest = !scores.length || total > prevBest;
  submitScore(total, state.coins);
  setMode('over');
  revealScore(state.dist, state.coins, state.multPeak, total, wasBest, prevBest);
}
document.getElementById('btnAgain').addEventListener('click', () => { audioResume(); resetRun(); setMode('run'); });
document.getElementById('btnOverMenu').addEventListener('click', () => { resetRun(); setMode('menu'); });
document.getElementById('btnStart').addEventListener('click', () => { audioResume(); resetRun(); setMode('run'); });
document.getElementById('btnPause').addEventListener('click', openPause);
document.getElementById('btnResume').addEventListener('click', () => setMode('run'));
document.getElementById('btnRestart').addEventListener('click', () => { submitScore(state.score, state.coins); resetRun(); setMode('run'); });
document.getElementById('btnQuit').addEventListener('click', () => { submitScore(state.score, state.coins); resetRun(); setMode('menu'); });
document.getElementById('btnHelp').addEventListener('click', () => setMode('help'));
document.getElementById('btnFpsInfo').addEventListener('click', () => setMode('fpsinfo'));
document.getElementById('btnCloseFps').addEventListener('click', () => setMode('settings'));
document.getElementById('btnCloseHelp').addEventListener('click', () => setMode('menu'));
document.getElementById('btnSettingsMenu').addEventListener('click', () => { settingsBack = 'menu'; setMode('settings'); });
document.getElementById('btnSettingsPause').addEventListener('click', () => { settingsBack = 'pause'; setMode('settings'); });
document.getElementById('btnCloseSettings').addEventListener('click', () => setMode(settingsBack));

/* ---------- retours haptiques. Android les gère, iOS ne fournit pas
   navigator.vibrate, l'interrupteur est alors masqué. ---------- */
const canVibrate = !!(navigator && navigator.vibrate);
let hapticsOn = canVibrate, lastBuzz = 0;
function buzz(pattern, minGap){
  if (!hapticsOn || !canVibrate) return;
  const t = performance.now();
  if (minGap && t - lastBuzz < minGap) return;   // évite d'annuler sans cesse la vibration en cours
  lastBuzz = t;
  try { navigator.vibrate(pattern); } catch(e){}
}

/* ---------- niveaux de difficulté ----------
   La table DEFAULTS est le niveau facile. Chaque niveau réécrit un sous ensemble
   de valeurs, et applique un coefficient au score puisque le risque n'est pas le même. */
const DIFF = {
  easy: { label:'EASY', mul:1.0, note:'Wide corners, slow damage, plenty of repairs. The reference setting.', set:{} },
  medium: { label:'MEDIUM', mul:1.35,
    note:'Tighter corners, top speed reached sooner, impacts cost more and the multiplier fades faster.',
    set:{ curveLoad:38, speedRamp:6000, hullImpact:2.6, hullRegen:1.2, hullScrape:19,
          multDecay:0.14, fixChance:0.0022, rollChance:0.18, climbRate:27 } },
  hard: { label:'HARD', mul:1.8,
    note:'Severe corners, full speed in four kilometres, heavy damage, scarce repairs and a multiplier that melts.',
    set:{ curveLoad:46, speedRamp:4000, hullImpact:3.4, hullRegen:0.8, hullScrape:24,
          multDecay:0.20, fixChance:0.0015, supChance:0.0018, rollChance:0.24, climbRate:31,
          gripLimit:29 } }
};
let diff = 'easy', diffMul = 1;
const segDiff = document.getElementById('segDiff'), diffNote = document.getElementById('diffNote');

function applyDifficulty(d){
  diff = d;
  diffMul = DIFF[d].mul;
  const keepScale = TUNING.renderScale;          // réglage d'affichage, pas de jeu
  Object.assign(TUNING, DEFAULTS, DIFF[d].set);
  TUNING.renderScale = keepScale;
  for (const k in readouts) syncRow(k);
  segDiff.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.d === d));
  diffNote.innerHTML = DIFF[d].note + ' Score <b>\u00d7' + DIFF[d].mul.toFixed(2) + '</b>.';
}
segDiff.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) applyDifficulty(b.dataset.d);
});

/* ============================ 9. Entrées ============================ */
const KEYMAP = { ArrowLeft:'left', KeyA:'left', KeyQ:'left', ArrowRight:'right', KeyD:'right',
                 ArrowDown:'brake', KeyS:'brake', Space:'boost', ArrowUp:'boost', KeyW:'boost', KeyZ:'boost' };
/* ---------- navigation clavier dans les écrans ---------- */
const NAV_IDS = {
  menu:  ['segDiff', 'btnStart', 'btnHelp', 'btnSettingsMenu', 'btnFullMenu'],
  help:  ['btnCloseHelp'],
  fpsinfo: ['lnkFf', 'lnkCh', 'lnkSa', 'btnCloseFps'],
  pause: ['btnResume', 'btnRestart', 'btnSettingsPause', 'btnQuit'],
  over:  ['btnAgain', 'btnOverMenu']
};
// élément présélectionné à l'ouverture de chaque écran
const NAV_DEFAULT = { menu:'btnStart', pause:'btnResume', over:'btnAgain', help:'btnCloseHelp' };
let navList = [], navIdx = -1, navActive = false;

function navBuild(){
  const prevSel = navList[navIdx];      // le changement d'onglet ne doit pas perdre la sélection
  if (mode === 'settings'){
    const nodes = Array.from(document.querySelectorAll(
      '#settings .close, #settings .navgroup, ' +
      '#settings .page.on button, #settings .page.on input[type=range]'));
    // un groupe de boutons compte pour un seul élément, ses boutons sont écartés
    navList = nodes.filter(el => el.classList.contains('navgroup')
      || (!el.classList.contains('rst') && !el.closest('.navgroup')));
  } else {
    navList = (NAV_IDS[mode] || []).map(id => document.getElementById(id))
                                   .filter(el => el && el.offsetParent !== null);
  }
  let i = prevSel ? navList.indexOf(prevSel) : -1;
  if (i < 0 && NAV_DEFAULT[mode]) i = navList.indexOf(document.getElementById(NAV_DEFAULT[mode]));
  navIdx = i >= 0 ? i : (navList.length ? 0 : -1);
  navPaint();
}
function navPaint(){
  const cur = document.querySelector('.nav-sel');
  if (cur) cur.classList.remove('nav-sel');
  if (!navActive || navIdx < 0 || !navList[navIdx]) return;
  const el = navList[navIdx];
  el.classList.add('nav-sel');
  try { el.focus({ preventScroll: true }); } catch(err){ el.focus(); }
  if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}
function segStep(seg, dir){
  const btns = Array.from(seg.querySelectorAll('button'));
  let i = btns.findIndex(b => b.classList.contains('on'));
  if (i < 0) i = 0;
  btns[(i + dir + btns.length) % btns.length].click();
}
function navMove(step){
  if (!navList.length) return;
  navActive = true;
  navIdx = (navIdx + step + navList.length) % navList.length;
  navPaint();
}
// au doigt ou à la souris, on retire le repère clavier
window.addEventListener('pointerdown', () => {
  if (navActive){ navActive = false; navPaint(); }
}, true);
// si le navigateur donne le focus ailleurs, l'index suit
window.addEventListener('focusin', e => {
  const i = navList.indexOf(e.target);
  if (i >= 0) navIdx = i;
});

window.addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP'){
    if (mode === 'run') openPause();
    else if (mode === 'pause') setMode('run');
    else if (mode === 'settings') setMode(settingsBack);
    else if (mode === 'help') setMode('menu');
    else if (mode === 'fpsinfo') setMode('settings');
    e.preventDefault(); return;
  }

  if (mode !== 'run'){
    if (e.code === 'ArrowDown' || e.code === 'KeyS' || (e.code === 'Tab' && !e.shiftKey)){
      navMove(1); e.preventDefault(); return;
    }
    if (e.code === 'ArrowUp' || e.code === 'KeyW' || (e.code === 'Tab' && e.shiftKey)){
      navMove(-1); e.preventDefault(); return;
    }
    const cur = navActive && navList[navIdx];
    // sur un groupe de boutons, gauche et droite changent la valeur au lieu de naviguer
    if (cur && cur.classList && cur.classList.contains('navgroup')){
      if (e.code === 'ArrowLeft'){ segStep(cur, -1); e.preventDefault(); return; }
      if (e.code === 'ArrowRight' || e.code === 'Space'
          || e.code === 'Enter' || e.code === 'NumpadEnter'){
        segStep(cur, 1); e.preventDefault(); return;
      }
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space'){
      if (cur){ cur.click(); }
      else { navActive = true; navPaint(); }
      e.preventDefault(); return;
    }
    // les curseurs se règlent avec gauche et droite, laissés au navigateur
    return;
  }

  const k = KEYMAP[e.code];
  if (k && mode === 'run'){ keys[k] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });

const stickZone = document.getElementById('stickZone'),
      stickEl = document.getElementById('stick');
const STICK_R = 46, STICK_DEAD = 0.07;
let stickId = null, stickCx = 0, stickCy = 0;

function stickUpdate(e){
  let dx = e.clientX - stickCx, dy = e.clientY - stickCy;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R){ dx *= STICK_R / d; dy *= STICK_R / d; }
  stickEl.firstElementChild.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
  let v = dx / STICK_R;
  if (Math.abs(v) < STICK_DEAD) v = 0;
  else v = (v - Math.sign(v) * STICK_DEAD) / (1 - STICK_DEAD);
  stickX = -v;                      // vers la droite de l'écran, donc vers le -X du monde
}
function stickEnd(){
  stickId = null; stickX = 0;
  stickEl.classList.remove('on');
  stickEl.firstElementChild.style.transform = '';
}
stickZone.addEventListener('pointerdown', e => {
  if (mode !== 'run' || stickId !== null) return;
  stickId = e.pointerId;
  stickZone.setPointerCapture(e.pointerId);
  stickCx = e.clientX; stickCy = e.clientY;
  stickEl.style.left = stickCx + 'px';
  stickEl.style.top = stickCy + 'px';
  stickEl.classList.add('on');
  stickUpdate(e); e.preventDefault();
});
stickZone.addEventListener('pointermove', e => { if (e.pointerId === stickId){ stickUpdate(e); e.preventDefault(); } });
stickZone.addEventListener('pointerup', e => { if (e.pointerId === stickId) stickEnd(); });
stickZone.addEventListener('pointercancel', e => { if (e.pointerId === stickId) stickEnd(); });
stickZone.addEventListener('lostpointercapture', e => { if (e.pointerId === stickId) stickEnd(); });
stickZone.addEventListener('contextmenu', e => e.preventDefault());

document.querySelectorAll('[data-in]').forEach(el => {
  const key = el.dataset.in;
  const on = e => {
    if (mode !== 'run') return;
    touch[key] = true; el.classList.add('act'); el.setPointerCapture(e.pointerId); e.preventDefault();
    if (key === 'boost') buzz(state.energy >= TUNING.boostMin ? 26 : 6);
    else if (key === 'brake') buzz(14);
  };
  const off = () => { touch[key] = false; el.classList.remove('act'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('lostpointercapture', off);
  el.addEventListener('contextmenu', e => e.preventDefault());
});

/* ============================ 10. Panneau ============================ */
const SLIDERS = [
  ['renderScale','Render scale',0.6,1,0.05,'Fraction of the native resolution. Below 0.8 the thin track edges start to break up.', 'adv'],
  ['speedMax','Top speed',120,340,2,'In metres per second. 258 is about 930 km/h, boost takes it to 1200.', 'adv'],
  ['speedRamp','Ramp-up distance',2000,20000,200,'Distance needed to reach top speed.', 'adv'],
  ['yawBase','Steering angle',0.15,0.8,0.01,'Maximum yaw angle at low speed, in radians. It shrinks as speed rises.', 'adv'],
  ['yawResponse','Stick response',1.5,12,0.1,'How fast the ship takes the requested angle.', 'adv'],
  ['gripHold','Grip',0.4,4,0.05,'How fast the path swings round to follow the nose.', 'adv'],
  ['gripLimit','Drift threshold',10,70,1,'Lateral load beyond which grip breaks away, in m/s².', 'adv'],
  ['gripDrift','Grip while drifting',0.1,2,0.05,'Grip left once the slide has started.', 'adv'],
  ['driftCharge','Drift boost charge',0,40,1,'Boost points regained per second while drifting.', 'adv'],
  ['centri','Centrifugal force',0,0.14,0.002,'Outward push in corners. The most sensitive value here.', 'adv'],
  ['bankAssist','Banking assist',0,1,0.02,'How much of the track banking actually pulls you back in.', 'adv'],
  ['bankScale','Corner banking',0,1.3,0.02,'Share of the balance angle applied to the track. At 1 corners almost drive themselves.', 'adv'],
  ['curveLoad','Corner severity',8,40,1,'Target lateral load in corners, in m/s². Track curvature adapts to speed to hold it.', 'adv'],
  ['climbRate','Relief',5,45,1,'Maximum vertical speed of the track, in m/s. Sets the size of crests and ramps.', 'adv'],
  ['launchScale','Jump strength',0,1.2,0.02,'Share of a crest converted into lift. At zero, no jumps at all.', 'adv'],
  ['rollChance','Corkscrew frequency',0,0.5,0.01,'Odds that a new stretch rolls into a corkscrew.', 'adv'],
  ['stripeEvery','Chevron spacing',1,5,0.25,'Segments between two chevrons, one segment is 12 m. Below 2 the pattern strobes at top speed.', 'adv'],
  ['hullImpact','Damage per impact',0,5,0.05,'Points lost per metre per second of impact into a wall.', 'adv'],
  ['hullRegen','Repair rate',0,6,0.1,'Damage points recovered per second.', 'adv'],
  ['coinChance','Coin trail frequency',0,0.08,0.002,'Odds per 12 m segment of starting a coin trail.', 'adv'],
  ['multDecay','Multiplier decay',0.02,0.4,0.01,'Share of the multiplier lost per second. Halved above the top speed tier.', 'adv'],
  ['multWallCut','Wall multiplier cut',0,1,0.05,'Fraction of the multiplier kept after hitting a wall. 0.5 halves it.', 'adv'],
  ['multMax','Multiplier cap',5,80,1,'Upper limit of the multiplier.', 'adv'],
  ['coinTier2','Coin ×2 speed',60,320,2,'Speed in m/s above which coins are worth double. 139 is 500 km/h.', 'adv'],
  ['coinTier3','Coin ×3 speed',60,340,2,'Speed in m/s above which coins are worth triple. 278 is 1000 km/h.', 'adv'],
  ['fixChance','Repair frequency',0,0.02,0.0005,'Odds per 12 m segment of a repair pickup.', 'adv'],
  ['supChance','Super boost frequency',0,0.02,0.0005,'Odds per 12 m segment of a super boost pickup.', 'adv'],
  ['rollNodes','Corkscrew length',16,90,2,'Segments per full turn. Lower is more violent.', 'adv'],
  ['boostFactor','Boost power',1,2,0.02,'Multiplier applied to target speed while boosting.', 'adv'],
  ['boostDrain','Boost drain',5,60,1,'Reserve points spent per second. The reserve runs 0 to 100.', 'adv'],
  ['boostRecharge','Boost recharge',2,40,1,'Reserve points regained per second outside boost.', 'adv'],
  ['wallPenalty','Wall penalty',0,1,0.02,'Speed lost while scraping a wall.', 'adv']
];
const onTune = { renderScale: () => applyRenderScale(TUNING.renderScale) };
const holders = { adv: document.getElementById('slidersAdv') };
const readouts = {};
function syncRow(key){
  const r = readouts[key];
  r.inp.value = TUNING[key];
  r.out.textContent = TUNING[key];
}
SLIDERS.forEach(([key,label,min,max,stp,hint,grp]) => {
  const row = document.createElement('div');
  row.className = 't-row';
  row.innerHTML = '<label>' + label +
      '<span><b>' + TUNING[key] + '</b><button class="rst" title="reset">\u21ba</button></span></label>' +
    '<input type="range" min="'+min+'" max="'+max+'" step="'+stp+'" value="'+TUNING[key]+'">' +
    '<div class="hint">' + hint + '</div>';
  const inp = row.querySelector('input'), out = row.querySelector('b'), rst = row.querySelector('.rst');
  readouts[key] = { inp, out };
  inp.addEventListener('input', () => {
    TUNING[key] = parseFloat(inp.value); out.textContent = TUNING[key];
    if (onTune[key]) onTune[key]();
  });
  rst.addEventListener('click', () => {
    TUNING[key] = DEFAULTS[key]; syncRow(key);
    if (onTune[key]) onTune[key]();
  });
  (holders[grp] || holders.adv).appendChild(row);
});
document.getElementById('btnDefault').addEventListener('click', () => {
  applyDifficulty(diff);
  applyRenderScale(TUNING.renderScale);
});

const pages = { gen: document.getElementById('pageGen'), adv: document.getElementById('pageAdv') };
const tabs  = { gen: document.getElementById('tabGen'),  adv: document.getElementById('tabAdv') };
function showTab(which){
  for (const k in pages){
    pages[k].classList.toggle('on', k === which);
    tabs[k].classList.toggle('on', k === which);
  }
  navBuild();
}
tabs.gen.addEventListener('click', () => showTab('gen'));
tabs.adv.addEventListener('click', () => showTab('adv'));

const clearBtn = document.getElementById('btnClear');
let clearArmed = false;
clearBtn.addEventListener('click', () => {
  if (!clearArmed){ clearArmed = true; clearBtn.textContent = 'CONFIRM'; return; }
  scores = []; persist(); renderBoard();
  clearArmed = false; clearBtn.textContent = 'CLEARED';
  setTimeout(() => { clearBtn.textContent = 'CLEAR LEADERBOARD'; }, 1600);
});

const tglSkyHi = document.getElementById('tglSkyHi');
let skyHi = true;
function setSkyHi(v){
  skyHi = v;
  tglSkyHi.classList.toggle('on', skyHi);
  skyMat.uniforms.uSimple.value = skyHi ? 0 : 1;
}
tglSkyHi.addEventListener('click', () => setSkyHi(!skyHi));

const tglFps = document.getElementById('tglFps');
const elFps = document.getElementById('fps'), elFpsVal = document.getElementById('fpsVal');
const segFps = document.getElementById('segFps'), hzHint = document.getElementById('hzHint');
let showFps = false;

/* Cible de cadence. requestAnimationFrame ne peut pas dépasser la fréquence de
   l'écran : une cible plus basse est tenue en sautant des trames, une cible plus
   haute que l'écran est inatteignable et donc signalée. */
let targetHz = 60, frameMin = 0, refreshHz = 0;
function applyThrottle(){
  // on ne saute des trames que si le rapport est au moins de deux, sinon un écran
  // 144 Hz visant 120 sauterait une trame sur deux et retomberait à 72
  if (!refreshHz){ frameMin = 0; return; }
  const n = Math.max(1, Math.round(refreshHz / targetHz));
  frameMin = n <= 1 ? 0 : (n - 0.5) / refreshHz;
}
function setTarget(hz){
  targetHz = hz;
  applyThrottle();
  segFps.querySelectorAll('button').forEach(b => {
    const v = +b.dataset.hz;
    b.classList.toggle('on', v === hz);
    b.classList.toggle('off', refreshHz > 0 && v > refreshHz + 5);
  });
  updateHzHint();
}
function updateHzHint(){
  if (!refreshHz){ hzHint.textContent = 'detecting display refresh…'; return; }
  hzHint.textContent = 'display runs at ' + refreshHz + ' Hz'
    + (targetHz > refreshHz + 5 ? ', browser caps it here. Tap to re-detect.' : '. Tap to re-detect.');
}
function redetect(){
  refreshHz = 0; hzSamples.length = 0; frameMin = 0; updateHzHint();
}
hzHint.style.cursor = 'pointer';
hzHint.addEventListener('click', e => { e.stopPropagation(); redetect(); });
segFps.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setTarget(+b.dataset.hz);
});
setTarget(60);

/* détection : médiane des intervalles sur les premières trames */
const hzSamples = [];
function detectHz(dt){
  if (refreshHz || dt <= 0 || dt > 0.2) return;
  hzSamples.push(dt);
  if (hzSamples.length < 90) return;
  const sorted = hzSamples.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const raw = 1 / med;
  refreshHz = [60, 75, 90, 120, 144, 165, 240].reduce(
    (best, v) => Math.abs(v - raw) < Math.abs(best - raw) ? v : best, 60);
  // la détection ne choisit pas à la place du joueur : elle met à jour la
  // limitation et grise les cibles hors de portée, la cible reste sur 60
  setTarget(targetHz);
}
tglFps.addEventListener('click', () => {
  showFps = !showFps;
  tglFps.classList.toggle('on', showFps);
  elFps.classList.toggle('on', showFps);
});

/* mesure sur une fenêtre glissante d'une seconde, puis correction lente
   pour éviter les allers retours d'échelle */
let fpsFrames = 0, fpsTime = 0, fpsNow = 60, autoHold = 0, badWin = 0, goodWin = 0, runSecs = 0;
function perfUpdate(dt){
  fpsFrames++; fpsTime += dt;
  if (fpsTime < 1) return;
  fpsNow = fpsFrames / fpsTime;
  fpsFrames = 0; fpsTime = 0;
  if (showFps) elFpsVal.textContent = Math.round(fpsNow);
  if (refreshHz && frameMin === 0 && fpsNow > refreshHz * 1.2) redetect();
  if (mode !== 'run'){ runSecs = 0; badWin = goodWin = 0; return; }
  runSecs++;
  if (runSecs < 4) return;              // les premières secondes compilent les shaders
  if (autoHold > 0){ autoHold--; return; }

  const reachable = Math.min(targetHz, refreshHz || targetHz);
  if (fpsNow < reachable * 0.78){ badWin++; goodWin = 0; } 
  else if (fpsNow > reachable * 0.95){ goodWin++; badWin = 0; }
  else { badWin = goodWin = 0; }

  // trois secondes consécutives dans le même sens avant d'agir, et le fond
  // n'est jamais coupé automatiquement : seul son niveau de détail baisse
  if (badWin >= 3){
    badWin = 0;
    if (skyHi){ setSkyHi(false); autoHold = 3; }
    else if (TUNING.renderScale > 0.7){
      TUNING.renderScale = Math.max(0.7, +(TUNING.renderScale - 0.1).toFixed(2));
      applyRenderScale(TUNING.renderScale); syncRow('renderScale'); autoHold = 4;
    }
  } else if (goodWin >= 3){
    goodWin = 0;
    if (TUNING.renderScale < 1){
      TUNING.renderScale = Math.min(1, +(TUNING.renderScale + 0.05).toFixed(2));
      applyRenderScale(TUNING.renderScale); syncRow('renderScale'); autoHold = 4;
    } else if (!skyHi){ setSkyHi(true); autoHold = 5; }
  }

}

const tglLefty = document.getElementById('tglLefty');
tglLefty.addEventListener('click', () => {
  tglLefty.classList.toggle('on', document.body.classList.toggle('lefty'));
});
const tglTips = document.getElementById('tglTips');
tglTips.addEventListener('click', () => {
  tipsOn = !tipsOn;
  tglTips.classList.toggle('on', tipsOn);
});

const tglHaptics = document.getElementById('tglHaptics');
if (!canVibrate) document.getElementById('rowHaptics').style.display = 'none';
tglHaptics.addEventListener('click', () => {
  hapticsOn = !hapticsOn;
  tglHaptics.classList.toggle('on', hapticsOn);
  if (hapticsOn) buzz(20);
});

const tglSky = document.getElementById('tglSky');
function setSkyOn(v){
  skyOn = v;
  tglSky.classList.toggle('on', skyOn);
  skyGroup.visible = skyOn;
}
tglSky.addEventListener('click', () => setSkyOn(!skyOn));

const tglSound = document.getElementById('tglSound');
const btnMute = document.getElementById('btnMute');
function setMuted(v){
  muted = v;
  tglSound.classList.toggle('on', !muted);
  btnMute.classList.toggle('off', muted);
  if (master) master.gain.value = muted ? 0 : 0.55;
  if (!muted) audioResume();
}
tglSound.addEventListener('click', () => setMuted(!muted));
btnMute.addEventListener('click', () => setMuted(!muted));

const tgl = document.getElementById('tglFull');
const btnFullMenu = document.getElementById('btnFullMenu');
const rootEl = document.documentElement;
const fsOk = !!(rootEl.requestFullscreen || rootEl.webkitRequestFullscreen);
if (!fsOk){
  document.getElementById('grpDisplay').style.display = 'none';
  btnFullMenu.style.display = 'none';
}
function fsOn(){ return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function fsToggle(){
  try {
    if (!fsOn()){
      const req = rootEl.requestFullscreen || rootEl.webkitRequestFullscreen;
      const r = req.call(rootEl, { navigationUI: 'hide' });
      if (r && r.catch) r.catch(fsBlocked);
    } else {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      const r = ex.call(document);
      if (r && r.catch) r.catch(() => {});
    }
  } catch(e){ fsBlocked(); }
  setTimeout(fsSync, 150);
}
function fsBlocked(){
  // refus typique d'une iframe sans allow="fullscreen"
  btnFullMenu.textContent = 'FULLSCREEN BLOCKED';
  setTimeout(fsSync, 2200);
}
tgl.addEventListener('click', fsToggle);
btnFullMenu.addEventListener('click', fsToggle);
function fsSync(){
  const on = fsOn();
  tgl.classList.toggle('on', on);
  btnFullMenu.textContent = on ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
}
function fsChanged(){ fsSync(); navBuild(); }
document.addEventListener('fullscreenchange', fsChanged);
document.addEventListener('webkitfullscreenchange', fsChanged);


/* ============================ 10b. Son ============================ */
let AC = null, master = null, eng = null, wind = null, driftNz = null, muted = false;

function audioInit(){
  if (AC) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try { AC = new Ctx(); } catch(e){ return; }
  master = AC.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(AC.destination);

  // bruit blanc partagé par toutes les couches
  const buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  AC.noise = buf;

  function source(rate){
    const src = AC.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    src.start();
    return src;
  }
  function band(src, type, freq, q){
    const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = AC.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master);
    return { f, g };
  }

  // réacteur : grondement large en bas, corps filtré au milieu, souffle en haut,
  // plus un sifflement de turbine très discret. Aucun oscillateur harmonique,
  // c'est ce qui donnait le côté moteur à explosion.
  const srcA = source(1), srcB = source(0.73);
  const rumble = band(srcA, 'lowpass', 140, 7);
  const body   = band(srcA, 'bandpass', 420, 1.1);
  const hiss   = band(srcB, 'highpass', 3200, 0.6);
  const whineO = AC.createOscillator(); whineO.type = 'sine'; whineO.frequency.value = 600;
  const whineG = AC.createGain(); whineG.gain.value = 0;
  whineO.connect(whineG); whineG.connect(master); whineO.start();
  eng = { rumble, body, hiss, whineO, whineG };

  wind = band(source(0.55), 'bandpass', 900, 0.7);
  driftNz = band(source(1.3), 'bandpass', 2600, 2.2);
}

function audioResume(){
  audioInit();
  if (AC && AC.state === 'suspended') AC.resume();
}

function blip(freq, dur, type, vol, sweep, delay){
  if (!AC || muted) return;
  const t = AC.currentTime + (delay || 0);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'triangle';
  o.frequency.setValueAtTime(freq, t);
  if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(25, sweep), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.22, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.03);
}

function thud(vol, freq){
  if (!AC || muted || !AC.noise) return;
  const t = AC.currentTime;
  const src = AC.createBufferSource(); src.buffer = AC.noise;
  const f = AC.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(freq || 900, t);
  f.frequency.exponentialRampToValueAtTime(120, t + 0.25);
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.32);
}

/* réverbération construite à la première utilisation : une réponse
   impulsionnelle de bruit à décroissance exponentielle, trois secondes */
let revIn = null;
function reverb(){
  if (revIn || !AC) return revIn;
  const secs = 3.0, rate = AC.sampleRate, len = Math.floor(rate * secs);
  const imp = AC.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++){
    const d = imp.getChannelData(ch);
    for (let i = 0; i < len; i++){
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (1 - Math.exp(-i / 220));
    }
  }
  const conv = AC.createConvolver(); conv.buffer = imp;
  const wet = AC.createGain(); wet.gain.value = 0.85;
  revIn = AC.createGain(); revIn.gain.value = 1;
  revIn.connect(conv); conv.connect(wet); wet.connect(master);
  return revIn;
}

function noiseHit(t0, vol, type, f0, f1, q, dur, send){
  if (!AC || muted || !AC.noise) return;
  const src = AC.createBufferSource();
  src.buffer = AC.noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.6;
  const f = AC.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  if (send) g.connect(reverb());
  src.start(t0, Math.random() * 1.4);
  src.stop(t0 + dur + 0.05);
}

const SFX = {
  coin(mul){ const k = 1 + (mul - 1) * 0.16;
             blip(1180 * k, 0.07, 'square', 0.10);
             blip(1760 * k, 0.10, 'square', 0.09, 0, 0.055);
             if (mul > 2) blip(2400 * k, 0.12, 'square', 0.07, 0, 0.11); },
  fix(){ blip(520, 0.12, 'triangle', 0.18); blip(780, 0.20, 'triangle', 0.16, 0, 0.10); },
  sup(){ blip(180, 0.55, 'sawtooth', 0.20, 1500); blip(360, 0.5, 'square', 0.07, 2400, 0.04); },
  hit(v){ thud(Math.min(0.5, 0.12 + v * 0.4), 1400); },
  land(){ thud(0.16, 700); },
  over(){
    if (!AC || muted) return;
    const t = AC.currentTime;
    reverb();
    noiseHit(t, 0.35, 'highpass', 2400, 900, 0.7, 0.09, true);      // claquement de tôle
    noiseHit(t, 0.45, 'lowpass', 2600, 90, 1.0, 0.40, true);        // impact
    noiseHit(t + 0.015, 0.18, 'lowpass', 700, 55, 0.9, 1.5, true);  // traîne grave
    const o = AC.createOscillator(), g = AC.createGain();      // coup sourd
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.32);
    g.gain.setValueAtTime(0.40, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(master); g.connect(reverb());
    o.start(t); o.stop(t + 0.55);
    for (let i = 0; i < 6; i++){                               // débris projetés
      noiseHit(t + 0.04 + Math.random() * 0.5,
               0.07 + Math.random() * 0.06,
               'bandpass', 900 + Math.random() * 2800, 0, 7,
               0.09 + Math.random() * 0.13, true);
    }
  }
};

function audioUpdate(){
  if (!AC || !eng) return;
  const t = AC.currentTime, on = mode === 'run';
  const r = Math.min(1.7, state.speed / TUNING.speedMax);
  const bst = state.boosting ? 1 : 0;

  eng.rumble.f.frequency.setTargetAtTime(90 + r * 190, t, 0.10);
  eng.rumble.g.gain.setTargetAtTime(on ? 0.13 + r * 0.20 : 0, t, 0.18);

  eng.body.f.frequency.setTargetAtTime(250 + r * 850 + bst * 380, t, 0.10);
  eng.body.g.gain.setTargetAtTime(on ? 0.05 + r * 0.12 + bst * 0.05 : 0, t, 0.16);

  eng.hiss.f.frequency.setTargetAtTime(2600 + r * 2400, t, 0.14);
  eng.hiss.g.gain.setTargetAtTime(on ? 0.012 + r * 0.055 + bst * 0.02 : 0, t, 0.18);

  eng.whineO.frequency.setTargetAtTime(430 + r * 2000, t, 0.12);
  eng.whineG.gain.setTargetAtTime(on ? 0.004 + r * 0.016 + bst * 0.008 : 0, t, 0.20);

  wind.f.frequency.setTargetAtTime(650 + r * 1500, t, 0.25);
  wind.g.gain.setTargetAtTime(on ? 0.02 + r * 0.10 : 0, t, 0.18);

  driftNz.g.gain.setTargetAtTime(on && state.drift ? 0.09 : 0, t, 0.07);
}

/* ---------- bulles d'aide, sur horloge, une seule fois par course ---------- */
const TIPS = [
  [1.5,  'Steer with the <b>stick</b>.<br>Hold <b>BOOST</b> on straights.'],
  [7.0,  '<b>Drift</b> in corners.<br>Sliding <b>refills the boost</b>.'],
  [14.0, 'Coins raise your <b>multiplier</b>.<br>Faster means more.'],
  [22.0, 'Past <b>1000 km/h</b> coins pay most<br>and the multiplier holds.'],
  [31.0, 'A wall <b>halves the multiplier</b><br>and damages the hull.']
];
let tipsOn = true, tipIdx = 0, tipT = 0;
const elToast = document.getElementById('toast');
function tipsReset(){ tipIdx = 0; tipT = 0; elToast.classList.remove('on'); }
function tipsUpdate(dt){
  if (mode !== 'run') return;
  tipT += dt;
  if (tipsOn && tipIdx < TIPS.length && tipT >= TIPS[tipIdx][0]){
    elToast.innerHTML = TIPS[tipIdx][1];
    elToast.classList.add('on');
    tipIdx++;
  }
  if (tipIdx > 0 && tipT > TIPS[tipIdx-1][0] + 4.5) elToast.classList.remove('on');
}

/* ============================ 11. Boucle ============================ */
const lookAt = new THREE.Vector3(), camPos = new THREE.Vector3(), camWant = new THREE.Vector3();
let fov = TUNING.fovBase, lean = 0, bank = 0, camReady = false, yawVis = 0;
const elDist = document.getElementById('dist'), elSpd = document.getElementById('spd'),
      elWarn = document.getElementById('warn'), elFill = document.getElementById('boostFill'),
      padBoost = document.querySelector('.pad.boost'), elHull = document.getElementById('hullBar'),
      elCoins = document.getElementById('coinCount'), elPop = document.getElementById('pop'),
      elMult = document.getElementById('mult'),
      elSpdBox = document.getElementById('spdBox'),
      elBst = document.getElementById('boostBar'), elBstBox = document.getElementById('bstBox');
let lastTier = -1, multPulse = 0, lastMult = 1;
let popT = 0;
function pop(text, color){
  elPop.textContent = text;
  elPop.style.color = color;
  elPop.style.textShadow = '0 0 18px ' + color + '99';
  elPop.classList.add('on');
  popT = 0.9;
}
let last = performance.now();

function frame(now){
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000;
  if (elapsed < frameMin) return;        // trame sautée pour tenir la cible
  let dt = elapsed; last = now;
  detectHz(dt);
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;

  if (mode === 'run'){
    bank = step(dt, false);
    if (state.wrecked){ state.shake = 1; SFX.over(); buzz([90, 60, 200]); gameOver(); }
  } else if (mode === 'menu') bank = step(dt, true);

  buildPath(state.cursor);
  updateRibbons();
  updateGantries();
  updateItems(dt);
  const thrustLevel = state.superT > 0 ? 2 : (state.boosting ? 1 : 0);
  updateThrust(dt, thrustLevel);
  updateSmoke(dt, thrustLevel);
  audioUpdate();

  const cb = Math.cos(bank), sb = Math.sin(bank);
  const hover = 1.35 + state.hop;
  const sx = cb * state.lat - sb * hover;
  const sy = sb * state.lat + cb * hover;
  ship.position.set(sx, sy, 0);
  ship.rotation.z = bank;
  const targetLean = -state.yaw * 0.9 - THREE.MathUtils.clamp(state.latVel * 0.010, -0.20, 0.20);
  lean += (targetLean - lean) * Math.min(1, dt * 7);
  const yawShow = state.yaw * TUNING.yawVisual
    + THREE.MathUtils.clamp((state.slip || 0) * TUNING.driftYaw, -0.42, 0.42);
  yawVis += (yawShow - yawVis) * Math.min(1, dt * 9);
  shipBody.rotation.z = lean;
  shipBody.rotation.y = yawVis;
  shipBody.rotation.x = THREE.MathUtils.clamp(-state.vyRel * 0.018, -0.32, 0.32);

  if (state.halo > 0){
    state.halo = Math.max(0, state.halo - dt / TUNING.haloTime);
    const k = state.halo, pw = state.haloPow;
    halo.visible = true;
    halo.material.opacity = 0.85 * k * k * pw;
    halo.scale.setScalar(0.55 + (1 - k) * 2.3 * pw);
  } else if (halo.visible) halo.visible = false;

  const B = sample(-TUNING.camDist, SBACK), F = sample(TUNING.lookAhead, SFRONT);
  const offB = state.lat * 0.55, offF = state.lat * 0.25;
  const camH = TUNING.camHeight + state.hop * 0.6;
  camWant.set(
    B.x + B.rx * offB + B.ux * camH,
    B.y + B.ry * offB + B.uy * camH,
    B.z + B.rz * offB + B.uz * camH
  );
  if (!camReady){ camPos.copy(camWant); camReady = true; }
  camPos.lerp(camWant, Math.min(1, dt * TUNING.camLag));
  camera.position.copy(camPos);
  if (state.shake > 0){
    const a = state.shake * 0.9;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
  }
  // en vrille la caméra suit entièrement la piste, en virage elle ne s'incline que partiellement
  const bw = Math.atan2(Math.sin(B.bank), Math.cos(B.bank));
  const follow = THREE.MathUtils.clamp((Math.abs(bw) - 0.5) / 0.7, 0, 1);
  const roll = bw * (TUNING.camRoll + (1 - TUNING.camRoll) * follow);
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  lookAt.set(
    F.x + F.rx * offF + F.ux * TUNING.lookHeight,
    F.y + F.ry * offF + F.uy * TUNING.lookHeight,
    F.z + F.rz * offF + F.uz * TUNING.lookHeight
  );
  camera.lookAt(lookAt);

  if (skyOn){
    skyYaw -= nk[BACK] * state.speed * dt;      // cap intégré : en virage le ciel balaye
    skyGroup.position.copy(camera.position);
    skyGroup.rotation.y = skyYaw;
    skyMat.uniforms.uTime.value = now * 0.001;
    skyMat.uniforms.uWarp.value = state.boosting ? 1 : 0;
  }

  const tf = TUNING.fovBase + Math.min(1, state.speed / TUNING.speedMax) * TUNING.fovSpeed
    + (state.boosting ? 7 : 0) + (state.scrape > 0 ? 3 : 0);
  fov += (tf - fov) * Math.min(1, dt * (state.boosting ? 6 : 3));
  camera.fov = fov; camera.updateProjectionMatrix();

  if (popT > 0){ popT -= dt; if (popT <= 0) elPop.classList.remove('on'); }
  tipsUpdate(dt);
  perfUpdate(dt);
  if (mode === 'run'){
    elDist.textContent = Math.round(state.score).toLocaleString('en-GB');
    elMult.textContent = '\u00d7' + state.mult.toFixed(1);
    elSpd.textContent = Math.round(state.speed * 3.6);
    if (state.scrape > 0){ elWarn.textContent = 'WALL HIT'; elWarn.classList.remove('drift'); elWarn.classList.add('on'); }
    else if (state.drift){ elWarn.textContent = 'DRIFT'; elWarn.classList.add('drift','on'); }
    else elWarn.classList.remove('on');
    elFill.style.height = state.energy.toFixed(0) + '%';
    padBoost.classList.toggle('low', state.energy < TUNING.boostMin && !state.boosting);
    padBoost.classList.toggle('charge', state.drift && state.energy < 99.5);
    padBoost.classList.toggle('full', state.energy > 99.5);
    elSpdBox.classList.toggle('hot', state.boosting);
    elSpdBox.classList.toggle('sup', state.superT > 0);
    elCoins.textContent = state.coins;
    const tier = coinTier();
    if (tier !== lastTier){ lastTier = tier; elMult.style.color = COIN_TIER[tier].css; }
    if (state.mult > lastMult + 0.001){ elMult.classList.remove('cut'); elMult.classList.add('up'); multPulse = 0.16; }
    else if (state.mult < lastMult - 0.05){ elMult.classList.remove('up'); elMult.classList.add('cut'); multPulse = 0.20; }
    lastMult = state.mult;
    if (multPulse > 0){ multPulse -= dt; if (multPulse <= 0) elMult.classList.remove('up','cut'); }
    // vert à 100, jaune vers 55, rouge à 0 : la courbe alerte un peu avant le milieu
    const hue = 120 * Math.pow(Math.max(0, state.hull) / 100, 1.35);
    elHull.style.width = state.hull.toFixed(0) + '%';
    elBst.style.height = state.energy.toFixed(0) + '%';
    elBstBox.classList.toggle('full', state.energy > 99.5);
    elBstBox.classList.toggle('charge', state.drift && state.energy < 99.5);
    elHull.style.background = 'hsl(' + hue.toFixed(0) + ',88%,50%)';
    elHull.style.boxShadow = '0 0 10px hsla(' + hue.toFixed(0) + ',95%,55%,.65)';
    elHull.parentElement.classList.toggle('crit', state.hull < 22);
  }

  renderer.render(scene, camera);
}

buildPath(0); updateRibbons(); updateGantries();
renderer.render(scene, camera);
applyDifficulty('easy');                    // remplit la note et aligne les curseurs
setMode('menu');                            // pose l'état de départ, dont la navigation clavier
// repère clavier visible d'emblée sur un pointeur précis, masqué au tactile
if (window.matchMedia && window.matchMedia('(pointer: fine)').matches){
  navActive = true; navPaint();
}
if (window.__vrReady) window.__vrReady();   // la première image est prête
requestAnimationFrame(frame);
