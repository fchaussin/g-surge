'use strict';
/* G-SURGE — scène, piste, objets, vaisseau. À charger avant game.js. */


if (typeof THREE === 'undefined'){
  if (window.__gsFail) window.__gsFail('ENGINE UNAVAILABLE');
  throw new Error('three.js is required');
}

/* ============================ 1. Réglages ============================ */
const DEFAULTS = {
  speedStart:70, speedMax:258, speedRamp:9000, speedGain:0.42, brakeFactor:0.62,
  steerMaxVel:34,
  yawBase:0.40, yawSpeedRef:90, yawMin:0.10, yawResponse:5.0, yawVisual:2.4, driftYaw:0.012,
  gripHold:1.5, gripDrift:0.60, gripLimit:34, driftExit:12, driftCharge:17,
  centri:0.085, bankAssist:0.30, bankScale:0.90,
  curveLoad:30, curveMin:0.0012, curveMax:0.011, climbRate:23,
  rollChance:0.14, rollNodes:44, stripeEvery:2,
  hullImpact:2.0, hullScrape:15, hullRegen:1.7, damageSpeed:0.30, damageSteer:0.28,
  coinValue:100, coinChance:0.015, fixChance:0.003, fixAmount:40, supChance:0.0024,
  supTime:2.6, supFactor:1.08, pickRadius:3.6, haloTime:0.45,
  coinTier2:138.9, coinTier3:277.8,
  multDecay:0.10, multDecayFast:0.5, multWallCut:0.5, multMax:30,
  renderScale:1,
  launchScale:0.50, airGravity:3.4, airThresh:2.2, airSteer:0.40, airOverhang:11, badLanding:0.35,
  boostFactor:1.30, boostDrain:26, boostRecharge:10, boostMin:14, boostGain:2.2,
  wallBounce:0.25, wallPenalty:0.36, wallDrain:26,
  camDist:19, camHeight:5.0, camLag:7.5, camRoll:0.42,
  lookAhead:46, lookHeight:2.6,
  fovBase:74, fovSpeed:22
};
const TUNING = Object.assign({}, DEFAULTS);
window.TUNING = TUNING;

const COUNT = 130, SEG = 12, BACK = 10, HALF = 11.5, SHIP = 1.9;

/* ============================ 2. Scène ============================ */
const VOID = 0x05060a;
const scene = new THREE.Scene();
scene.background = new THREE.Color(VOID);
scene.fog = new THREE.FogExp2(VOID, 0.0017);

const camera = new THREE.PerspectiveCamera(TUNING.fovBase, 1, 0.4, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 2 });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
document.body.appendChild(renderer.domElement);

let renderScale = 1;
function applyRenderScale(v){
  renderScale = Math.max(0.4, Math.min(1, v));
  // le coût de remplissage varie comme le carré de cette valeur
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * renderScale);
  resize();
}
function resize(){
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();


/* ---------- fond cosmique : sphère inversée avec nuage procédural ---------- */
const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FS = `
varying vec3 vDir;
uniform float uTime;
uniform float uWarp;
uniform float uSimple;

float hash(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  return 0.55 * noise(p) + 0.28 * noise(p * 2.03) + 0.17 * noise(p * 4.11);
}
float fbm2(vec3 p){          // deux octaves : environ un tiers d'opérations en moins
  return 0.66 * noise(p) + 0.34 * noise(p * 2.03);
}
void main(){
  vec3 d = normalize(vDir);

  bool simple = uSimple > 0.5;
  float n  = simple ? fbm2(d * 2.4 + vec3(uTime * 0.006, 0.0, 0.0))
                    : fbm(d * 2.4 + vec3(uTime * 0.006, 0.0, 0.0));

  vec3 col = vec3(0.012, 0.016, 0.032);
  col = mix(col, vec3(0.10, 0.045, 0.24), smoothstep(0.38, 0.80, n));
  if (!simple){
    float n2 = fbm(d * 5.1 - vec3(0.0, uTime * 0.010, 0.0));
    col = mix(col, vec3(0.02, 0.20, 0.30), smoothstep(0.52, 0.92, n2) * 0.55);
    col = mix(col, vec3(0.30, 0.06, 0.20), smoothstep(0.62, 0.98, n * n2 * 2.2) * 0.5);
  }

  // deux couches d'étoiles, grille 3D et scintillement
  vec3 sp = d * 150.0;
  vec3 id = floor(sp);
  float h = hash(id);
  float st = step(0.975, h) * smoothstep(0.34, 0.0, length(fract(sp) - 0.5));
  col += vec3(0.85, 0.92, 1.0) * st * (0.55 + 0.45 * sin(uTime * 2.2 + h * 60.0));

  if (!simple){
    vec3 sp2 = d * 250.0;
    float h2 = hash(floor(sp2) + 7.3);
    col += vec3(0.55, 0.70, 0.95) * step(0.988, h2)
           * smoothstep(0.42, 0.0, length(fract(sp2) - 0.5)) * 0.7;
  }

  col *= 1.0 + uWarp * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

const skyGroup = new THREE.Group();
scene.add(skyGroup);
const skyMat = new THREE.ShaderMaterial({
  vertexShader: SKY_VS, fragmentShader: SKY_FS,
  uniforms: { uTime: { value: 0 }, uWarp: { value: 0 }, uSimple: { value: 0 } },
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat);
skyMesh.frustumCulled = false;
skyMesh.renderOrder = -1;
skyGroup.add(skyMesh);
let skyYaw = 0, skyOn = true;

(function dust(){
  const n = 900, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    const r = 140 + Math.random() * 700, a = Math.random() * Math.PI * 2;
    p[i*3] = Math.cos(a) * r; p[i*3+1] = (Math.random() - 0.45) * 460; p[i*3+2] = Math.sin(a) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x3a6a8c, size: 2.4, sizeAttenuation: true, fog: false, transparent: true, opacity: .8 }));
  pts.frustumCulled = false;
  skyGroup.add(pts);
})();

/* ============================ 3. Piste en flux ============================ */
const ITEM_COIN = 0, ITEM_FIX = 1, ITEM_SUP = 2;
let items = [];
const coinRun = { left:0, lat:0, drift:0 };

const nk = new Float32Array(COUNT), ng = new Float32Array(COUNT),
      nb = new Float32Array(COUNT), nid = new Int32Array(COUNT);
let genSpeed = DEFAULTS.speedStart;
const gen = { k:0, kTarget:0, kLeft:0, g:0, gTarget:0, gLeft:0, gLerp:0.09,
              crest:false, roll:0, rollDir:1, rollPhase:0, id:0 };

function nextNode(){
  const v2 = Math.max(3600, genSpeed * genSpeed);
  // courbure maximale telle que la charge latérale reste constante quelle que soit la vitesse
  const kMax = THREE.MathUtils.clamp(TUNING.curveLoad / (v2 * TUNING.centri),
                                     TUNING.curveMin, TUNING.curveMax);
  if (gen.kLeft <= 0){
    if (Math.random() < TUNING.rollChance){
      gen.roll = Math.round(TUNING.rollNodes);
      gen.rollDir = Math.random() < 0.5 ? -1 : 1;
      gen.kTarget = 0;
      gen.kLeft = gen.roll + 10;                 // piste droite pendant la vrille
    } else {
      gen.kTarget = Math.random() < 0.20 ? 0
        : (0.35 + Math.random() * 0.65) * kMax * (Math.random() < 0.5 ? -1 : 1);
      gen.kLeft = 10 + Math.floor(Math.random() * 26);
    }
  }
  gen.kLeft--;
  gen.k += (THREE.MathUtils.clamp(gen.kTarget, -kMax, kMax) - gen.k) * 0.11;

  // pente : bosses douces, plus des tremplins suivis d'une bascule franche
  const gMax = TUNING.climbRate / Math.max(60, genSpeed);
  if (gen.gLeft <= 0){
    if (gen.crest){
      gen.gTarget = -gMax * (0.75 + Math.random() * 0.25);
      gen.gLerp = 0.55; gen.gLeft = 4 + Math.floor(Math.random() * 3);
      gen.crest = false;
    } else if (gen.roll <= 0 && Math.random() < 0.26){
      gen.gTarget = gMax * (0.75 + Math.random() * 0.25);
      gen.gLerp = 0.30; gen.gLeft = 6 + Math.floor(Math.random() * 4);
      gen.crest = true;
    } else {
      gen.gTarget = (Math.random() - 0.5) * 1.4 * gMax;
      gen.gLerp = 0.09; gen.gLeft = 12 + Math.floor(Math.random() * 26);
    }
  }
  gen.gLeft--;
  gen.g += (gen.gTarget - gen.g) * gen.gLerp;

  // dévers : angle d'équilibre de la charge latérale, plus la vrille en cours
  const load = gen.k * v2 * TUNING.centri;
  let b = THREE.MathUtils.clamp(-Math.atan(load / 9.81) * TUNING.bankScale, -1.25, 1.25);
  if (gen.roll > 0){
    gen.rollPhase += gen.rollDir * (Math.PI * 2 / Math.max(6, Math.round(TUNING.rollNodes)));
    gen.roll--;
  }
  b += gen.rollPhase;

  return { k:gen.k, g:gen.g, b, id:gen.id++ };
}
function pushNode(){
  nk.copyWithin(0,1); ng.copyWithin(0,1); nb.copyWithin(0,1); nid.copyWithin(0,1);
  const n = nextNode();
  nk[COUNT-1]=n.k; ng[COUNT-1]=n.g; nb[COUNT-1]=n.b; nid[COUNT-1]=n.id;
  spawnItems(n.id);
  if (items.length && items[0].id < nid[0] - 2) items = items.filter(it => it.id >= nid[0] - 2);
}
function seedTrack(){
  gen.k=gen.kTarget=gen.g=gen.gTarget=0; gen.kLeft=26; gen.gLeft=30; gen.gLerp=0.09;
  gen.crest=false; gen.roll=0; gen.rollPhase=0; gen.id=0;
  genSpeed = TUNING.speedStart;
  items = []; coinRun.left = 0;
  for (let i=0;i<COUNT;i++){
    const n=nextNode(); nk[i]=n.k; ng[i]=n.g; nb[i]=n.b; nid[i]=n.id;
    if (i > BACK + 6) spawnItems(n.id);
  }
}
seedTrack();

const px = new Float32Array(COUNT), py = new Float32Array(COUNT),
      pz = new Float32Array(COUNT), pyaw = new Float32Array(COUNT);

function buildPath(cursor){
  const cy0 = -nk[BACK] * cursor;
  px[BACK] = -Math.sin(cy0) * cursor;
  pz[BACK] = -Math.cos(cy0) * cursor;
  py[BACK] = -ng[BACK] * cursor;
  pyaw[BACK] = cy0;
  for (let i = BACK - 1; i >= 0; i--){
    const y2 = pyaw[i+1] - nk[i] * SEG, mid = (y2 + pyaw[i+1]) * 0.5;
    px[i] = px[i+1] - Math.sin(mid) * SEG;
    pz[i] = pz[i+1] - Math.cos(mid) * SEG;
    py[i] = py[i+1] - ng[i] * SEG;
    pyaw[i] = y2;
  }
  const first = SEG - cursor, fy = nk[BACK] * first, midF = fy * 0.5;
  px[BACK+1] = Math.sin(midF) * first;
  pz[BACK+1] = Math.cos(midF) * first;
  py[BACK+1] = ng[BACK] * first;
  pyaw[BACK+1] = fy;
  for (let i = BACK + 2; i < COUNT; i++){
    const y2 = pyaw[i-1] + nk[i-1] * SEG, mid = (y2 + pyaw[i-1]) * 0.5;
    px[i] = px[i-1] + Math.sin(mid) * SEG;
    pz[i] = pz[i-1] + Math.cos(mid) * SEG;
    py[i] = py[i-1] + ng[i-1] * SEG;
    pyaw[i] = y2;
  }
}

/* point de la piste situé à `d` mètres devant le vaisseau, d négatif vers l'arrière */
function sample(d, out){
  let f = BACK + (state.cursor + d) / SEG;
  f = Math.max(0, Math.min(COUNT - 1.001, f));
  const i = Math.floor(f), t = f - i, j = i + 1;
  out.x = px[i] + (px[j] - px[i]) * t;
  out.y = py[i] + (py[j] - py[i]) * t;
  out.z = pz[i] + (pz[j] - pz[i]) * t;
  const yaw = pyaw[i] + (pyaw[j] - pyaw[i]) * t;
  const b = nb[i] + (nb[j] - nb[i]) * t;
  out.yaw = yaw;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cb = Math.cos(b), sb = Math.sin(b);
  out.rx = cy * cb; out.ry = sb;  out.rz = -sy * cb;   // droite, inclinée par le dévers
  out.ux = -cy * sb; out.uy = cb; out.uz = sy * sb;    // normale à la piste
  out.bank = b;
  return out;
}
const SBACK = {}, SFRONT = {};

/* pente de la piste à `d` mètres devant le vaisseau */
function gradeAt(d){
  let f = BACK + (state.cursor + d) / SEG;
  f = Math.max(0, Math.min(COUNT - 1.001, f));
  const i = Math.floor(f), t = f - i;
  return ng[i] + (ng[i+1] - ng[i]) * t;
}

/* ============================ 4. Rubans ============================ */
/* texture de la piste : une strie transversale par répétition, plus l'axe et les rives.
   Le tampon ne peut qu'assombrir, la couleur de base des sommets est donc éclaircie. */
function roadTexture(){
  const S = 128, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4a4a4a'; g.fillRect(0, 0, S, S);          // revêtement
  // chevron pointant vers l'avant du circuit
  g.lineCap = 'butt'; g.lineJoin = 'miter';
  g.strokeStyle = '#8a8a8a'; g.lineWidth = S * 0.17;
  g.beginPath();
  g.moveTo(-S * 0.02, S * 0.10); g.lineTo(S * 0.5, S * 0.46); g.lineTo(S * 1.02, S * 0.10);
  g.stroke();
  g.strokeStyle = '#ffffff'; g.lineWidth = S * 0.10;
  g.beginPath();
  g.moveTo(-S * 0.02, S * 0.08); g.lineTo(S * 0.5, S * 0.42); g.lineTo(S * 1.02, S * 0.08);
  g.stroke();
  g.fillStyle = '#dcdcdc';
  g.fillRect(0, 0, S * 0.03, S); g.fillRect(S * 0.97, 0, S * 0.03, S);     // rives
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const maxA = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  t.anisotropy = Math.min(8, maxA);
  return t;
}

function makeRibbon(material, withColor, withUv){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT*2*3), 3));
  if (withColor) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(COUNT*2*3), 3));
  if (withUv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(COUNT*2*2), 2));
  const idx = [];
  for (let i=0;i<COUNT-1;i++){ const k=i*2; idx.push(k,k+2,k+1,k+1,k+2,k+3); }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false; scene.add(m); return m;
}
const road   = makeRibbon(new THREE.MeshBasicMaterial({ vertexColors:true, map:roadTexture() }), true, true);
const edgeL  = makeRibbon(new THREE.MeshBasicMaterial({ vertexColors:true }), true);
const edgeR  = makeRibbon(new THREE.MeshBasicMaterial({ vertexColors:true }), true);
const skirtL = makeRibbon(new THREE.MeshBasicMaterial({ color:0x0a0d14, side:THREE.DoubleSide }), false);
const skirtR = makeRibbon(new THREE.MeshBasicMaterial({ color:0x0a0d14, side:THREE.DoubleSide }), false);

const ROAD_A = new THREE.Color(0x3d4a61), ROAD_B = new THREE.Color(0x333e52);
const NEON_A = new THREE.Color(0x25e2ff), NEON_B = new THREE.Color(0x0b4a63);
const HOT = new THREE.Color(0xff2f9a);
const LIP = 1.4, DROP = 3.2;

function setPair(a,i,ax,ay,az,bx,by,bz){
  const o=i*6; a[o]=ax;a[o+1]=ay;a[o+2]=az;a[o+3]=bx;a[o+4]=by;a[o+5]=bz;
}
function setColorPair(a,i,c){
  const o=i*6; a[o]=c.r;a[o+1]=c.g;a[o+2]=c.b;a[o+3]=c.r;a[o+4]=c.g;a[o+5]=c.b;
}
function updateRibbons(){
  const rp=road.geometry.attributes.position.array,  rc=road.geometry.attributes.color.array;
  const ru=road.geometry.attributes.uv.array;
  const inv = 1 / Math.max(0.4, TUNING.stripeEvery);
  const lp=edgeL.geometry.attributes.position.array, lc=edgeL.geometry.attributes.color.array;
  const qp=edgeR.geometry.attributes.position.array, qc=edgeR.geometry.attributes.color.array;
  const sl=skirtL.geometry.attributes.position.array, sr=skirtR.geometry.attributes.position.array;
  for (let i=0;i<COUNT;i++){
    const yaw=pyaw[i], b=nb[i];
    const cy=Math.cos(yaw), sy=Math.sin(yaw), cb=Math.cos(b), sb=Math.sin(b);
    const rx=cy*cb, ry=sb, rz=-sy*cb;
    const ux=-cy*sb, uy=cb, uz=sy*sb;
    const X=px[i], Y=py[i], Z=pz[i];
    setPair(rp,i, X-rx*HALF, Y-ry*HALF, Z-rz*HALF, X+rx*HALF, Y+ry*HALF, Z+rz*HALF);
    setColorPair(rc,i,(nid[i]%8<4)?ROAD_A:ROAD_B);
    const v = nid[i] * inv, o4 = i*4;
    ru[o4]=0; ru[o4+1]=v; ru[o4+2]=1; ru[o4+3]=v;
    const l1=-HALF-LIP, l2=-HALF, r1=HALF, r2=HALF+LIP;
    setPair(lp,i, X+rx*l1, Y+ry*l1, Z+rz*l1, X+rx*l2, Y+ry*l2, Z+rz*l2);
    setPair(qp,i, X+rx*r1, Y+ry*r1, Z+rz*r1, X+rx*r2, Y+ry*r2, Z+rz*r2);
    const c = (nid[i]%12===0) ? HOT : ((nid[i]%6<3) ? NEON_A : NEON_B);
    setColorPair(lc,i,c); setColorPair(qc,i,c);
    setPair(sl,i, X+rx*l1, Y+ry*l1, Z+rz*l1, X+rx*l1-ux*DROP, Y+ry*l1-uy*DROP, Z+rz*l1-uz*DROP);
    setPair(sr,i, X+rx*r2, Y+ry*r2, Z+rz*r2, X+rx*r2-ux*DROP, Y+ry*r2-uy*DROP, Z+rz*r2-uz*DROP);
  }
  [road,edgeL,edgeR].forEach(m=>{
    m.geometry.attributes.position.needsUpdate=true;
    m.geometry.attributes.color.needsUpdate=true;
  });
  road.geometry.attributes.uv.needsUpdate = true;
  skirtL.geometry.attributes.position.needsUpdate=true;
  skirtR.geometry.attributes.position.needsUpdate=true;
}

const GANTRIES = 14, gantries = [];
(function buildGantries(){
  const dark = new THREE.MeshBasicMaterial({ color:0x11161f });
  const glow = new THREE.MeshBasicMaterial({ color:0xff2f9a });
  const leg = new THREE.BoxGeometry(0.7, 9, 0.7);
  for (let i=0;i<GANTRIES;i++){
    const grp = new THREE.Group();
    const a=new THREE.Mesh(leg,dark), b2=new THREE.Mesh(leg,dark);
    a.position.set(-(HALF+2.2),4.5,0); b2.position.set(HALF+2.2,4.5,0);
    const beam=new THREE.Mesh(new THREE.BoxGeometry((HALF+2.6)*2,1.1,0.8),dark); beam.position.y=9.2;
    const bar =new THREE.Mesh(new THREE.BoxGeometry((HALF+2.2)*2,0.22,0.9),glow); bar.position.y=8.5;
    grp.add(a,b2,beam,bar); grp.visible=false; scene.add(grp); gantries.push(grp);
  }
})();
function updateGantries(){
  let n=0;
  for (let i=0;i<COUNT && n<GANTRIES;i++){
    if (nid[i]%12!==0) continue;
    const g=gantries[n++];
    g.visible=true;
    g.position.set(px[i],py[i],pz[i]);
    g.rotation.set(0,pyaw[i],nb[i],'YXZ');
  }
  for (let i=n;i<GANTRIES;i++) gantries[i].visible=false;
}

/* ============================ 4b. Objets à ramasser ============================ */
function spawnItems(id){
  if (coinRun.left > 0){
    coinRun.left--;
    coinRun.lat = THREE.MathUtils.clamp(coinRun.lat + coinRun.drift, -(HALF-3), HALF-3);
    items.push({ id, lat:coinRun.lat, type:ITEM_COIN, done:false, taken:false });
    return;
  }
  const r = Math.random();
  if (r < TUNING.supChance){
    items.push({ id, lat:(Math.random()-0.5)*2*(HALF-3.5), type:ITEM_SUP, done:false, taken:false });
  } else if (r < TUNING.supChance + TUNING.fixChance){
    items.push({ id, lat:(Math.random()-0.5)*2*(HALF-3.5), type:ITEM_FIX, done:false, taken:false });
  } else if (r < TUNING.supChance + TUNING.fixChance + TUNING.coinChance){
    coinRun.left = 5 + Math.floor(Math.random()*6);
    coinRun.lat = (Math.random()-0.5)*2*(HALF-4);
    coinRun.drift = (Math.random()-0.5)*1.6;
  }
}

const COIN_TIER = [
  { gain:0.1, hex:0xc47a2e, css:'#e0913f' },   // sous 500 km/h
  { gain:0.3, hex:0xffc24a, css:'#ffc24a' },   // 500 à 1000
  { gain:0.6, hex:0xdff4ff, css:'#dff4ff' }    // au delà de 1000
];
function coinTier(){
  return state.speed >= TUNING.coinTier3 ? 2 : (state.speed >= TUNING.coinTier2 ? 1 : 0);
}
let coinMat = null;
const POOL = 40, itemPool = [];
(function buildItems(){
  const geo = [
    new THREE.TorusGeometry(1.55, 0.26, 6, 18),
    new THREE.OctahedronGeometry(1.5),
    new THREE.ConeGeometry(1.4, 3.0, 5)
  ];
  const mat = [
    coinMat = new THREE.MeshBasicMaterial({ color:0xffc24a }),
    new THREE.MeshBasicMaterial({ color:0x35e08a }),
    new THREE.MeshBasicMaterial({ color:0xff2f9a })
  ];
  for (let t=0;t<3;t++){
    itemPool.push([]);
    const n = t === 0 ? POOL : 6;
    for (let i=0;i<n;i++){
      const grp = new THREE.Group();
      const m = new THREE.Mesh(geo[t], mat[t]);
      if (t === 2) m.rotation.x = Math.PI / 2;      // pointe vers l'avant
      grp.add(m); grp.visible = false; scene.add(grp);
      itemPool[t].push(grp);
    }
  }
})();

const SITEM = {};
let spin = 0;
function updateItems(dt){
  const tier = coinTier();
  spin += dt * (2.6 + tier * 1.6);
  if (coinMat) coinMat.color.setHex(COIN_TIER[tier].hex);
  const coinScale = 1 + tier * 0.16;
  const used = [0,0,0], base = nid[0];
  for (const it of items){
    if (it.taken) continue;                 // ramassé : disparaît tout de suite
    const i = it.id - base;                 // sinon il reste affiché jusqu'au bord du champ
    if (i < 0 || i >= COUNT - 1) continue;
    const pool = itemPool[it.type];
    if (used[it.type] >= pool.length) continue;
    const g = pool[used[it.type]++];
    const S = sample((i - BACK) * SEG - state.cursor, SITEM);
    g.visible = true;
    g.position.set(
      S.x + S.rx * it.lat + S.ux * 2.0,
      S.y + S.ry * it.lat + S.uy * 2.0,
      S.z + S.rz * it.lat + S.uz * 2.0
    );
    g.rotation.set(0, S.yaw, S.bank, 'YXZ');
    if (it.type === ITEM_COIN) g.scale.setScalar(coinScale);
    g.children[0].rotation.z = it.type === 0 ? 0 : spin;
    if (it.type === 0) g.children[0].rotation.y = spin * 0.5;
  }
  for (let t=0;t<3;t++)
    for (let k=used[t]; k<itemPool[t].length; k++) itemPool[t][k].visible = false;
}

/* ============================ 5. Vaisseau ============================ */
scene.add(new THREE.AmbientLight(0x2c3d59, 1.15));
const keyLight = new THREE.DirectionalLight(0xdff0ff, 1.2);
keyLight.position.set(0.45, 1, -0.5);
scene.add(keyLight);

let flameOuterMat = null, flameCoreMat = null;
const flames = [];
const ship = new THREE.Group(), shipBody = new THREE.Group();
ship.add(shipBody); scene.add(ship);
(function buildShip(){
  // silhouette en M vue de face : deux ailes hautes, une échine centrale plus basse, deux creux
  const P = {
    N:[0,0.52,2.9],
    T:[0,1.05,-0.2],  L:[-0.62,0.46,-0.2],  R:[0.62,0.46,-0.2],  B:[0,-0.02,-0.2],
    T2:[0,0.86,-2.4], L2:[-0.48,0.46,-2.4], R2:[0.48,0.46,-2.4], B2:[0,0.12,-2.4]
  };
  function poly(list, pts){
    const v = [];
    for (const [a,b,c] of list) v.push(...pts[a], ...pts[b], ...pts[c]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }
  const hullGeo = poly([
    ['N','T','R'], ['N','R','B'], ['N','B','L'], ['N','L','T'],
    ['T','L','L2'], ['T','L2','T2'], ['R','T','T2'], ['R','T2','R2'],
    ['B','R','R2'], ['B','R2','B2'], ['L','B','B2'], ['L','B2','L2'],
    ['T2','L2','B2'], ['T2','B2','R2']
  ], P);
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({
    color:0x36485f, side:THREE.DoubleSide }));

  // aile en flèche, racine basse et saumon relevé
  const W = {
    A: [0.52, 0.44,  1.00], B: [0.52, 0.44, -1.90],   // emplanture
    K1:[1.50, 1.30, -0.15], K2:[1.52, 1.30, -2.15],   // coude, point haut
    T1:[1.88, 1.02, -0.80], T2:[1.90, 1.02, -2.35]    // saumon redescendu
  };
  const WL = {}; for (const k in W) WL[k] = [-W[k][0], W[k][1], W[k][2]];
  const wingFaces = [['A','K1','K2'], ['A','K2','B'], ['K1','T1','T2'], ['K1','T2','K2']];
  const wingMat = new THREE.MeshLambertMaterial({ color:0x2b3b52, side:THREE.DoubleSide });
  const wingR = new THREE.Mesh(poly(wingFaces, W), wingMat);
  const wingL = new THREE.Mesh(poly(wingFaces, WL), wingMat);

  // nacelles au deux tiers de l'envergure
  const podGeo = new THREE.CylinderGeometry(0.26, 0.22, 1.15, 8);
  podGeo.rotateX(Math.PI / 2);
  const podMat = new THREE.MeshLambertMaterial({ color:0x1d2836 });
  const pods = [-1.15, 1.15].map(x => {
    const m = new THREE.Mesh(podGeo, podMat);
    m.position.set(x, 1.00, -1.7);
    return m;
  });
  const glowMat = new THREE.MeshBasicMaterial({ color:0x8af4ff, transparent:true, opacity:0.95 });
  const glowGeo = new THREE.CircleGeometry(0.23, 8);
  const glows = [-1.15, 1.15].map(x => {
    const m = new THREE.Mesh(glowGeo, glowMat);
    m.position.set(x, 1.00, -2.29); m.rotation.y = Math.PI;
    return m;
  });

  // panaches : un cône large et diffus, un cœur étroit et vif, par tuyère
  const plumeGeo = new THREE.ConeGeometry(1, 1, 12, 1, true);
  plumeGeo.rotateX(-Math.PI / 2);
  plumeGeo.translate(0, 0, -0.5);
  flameOuterMat = new THREE.MeshBasicMaterial({ color:0x5fd8ff, transparent:true, opacity:0.4,
    blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide });
  flameCoreMat = new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.8,
    blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide });
  for (const x of [-1.15, 1.15]){
    const o = new THREE.Mesh(plumeGeo, flameOuterMat);
    const c = new THREE.Mesh(plumeGeo, flameCoreMat);
    o.position.set(x, 1.00, -2.3); c.position.set(x, 1.00, -2.3);
    flames.push(o, c);
    shipBody.add(o, c);
  }

  // verrière, échine lumineuse, dérives de saumon
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 1.05),
    new THREE.MeshLambertMaterial({ color:0x0d1620 }));
  canopy.position.set(0, 0.96, 0.75); canopy.rotation.x = -0.12;
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 2.0),
    new THREE.MeshBasicMaterial({ color:0x25e2ff }));
  spine.position.set(0, 1.07, -0.9);
  const strakeGeo = new THREE.BoxGeometry(0.09, 0.36, 0.72);
  const strakeMat = new THREE.MeshBasicMaterial({ color:0xff2f9a });
  const strakes = [-1.51, 1.51].map(x => {      // au coude, sur le point haut de l'aile
    const m = new THREE.Mesh(strakeGeo, strakeMat);
    m.position.set(x, 1.46, -1.2);
    m.rotation.z = x < 0 ? 0.16 : -0.16;
    return m;
  });

  shipBody.add(hull, wingL, wingR, canopy, spine, ...pods, ...glows, ...strakes);
})();

/* halo de ramassage : sphère additive, indépendante de l'orientation de la caméra */
const halo = new THREE.Mesh(
  new THREE.SphereGeometry(2.6, 14, 10),
  new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0,
                                blending:THREE.AdditiveBlending, depthWrite:false })
);
halo.position.y = 0.8; halo.visible = false;
ship.add(halo);
function flashHalo(hex, power){
  halo.material.color.set(hex);
  state.halo = 1; state.haloPow = power || 1;
}
function holdHalo(hex, level, power){          // frottement prolongé : lueur maintenue
  halo.material.color.set(hex);
  if (state.halo < level) state.halo = level;
  state.haloPow = power;
}

/* Traînée attachée au vaisseau plutôt que posée dans le monde.
   En repère monde, une bouffée émise au vaisseau traverse forcément la caméra,
   placée 19 m en arrière, et remplit alors tout l'écran. Ici la chaîne de
   bouffées reste entre le vaisseau et la caméra, elle ne peut plus la croiser. */
const SMOKE = 18, TRAIL_LEN = 11, smokeSprites = [];
let smokePhase = 0;
(function buildSmoke(){
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  grd.addColorStop(0,    'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.40)');
  grd.addColorStop(1,    'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 96, 96);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < SMOKE; i++){
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    sp.visible = false;
    ship.add(sp);
    smokeSprites.push(sp);
  }
})();

function clearSmoke(){
  smokePhase = 0;
  for (let i = 0; i < SMOKE; i++) smokeSprites[i].visible = false;
}

function updateSmoke(dt, level){
  if (state.speed < 1){ for (let i = 0; i < SMOKE; i++) smokeSprites[i].visible = false; return; }
  smokePhase = (smokePhase + state.speed * dt / TRAIL_LEN) % 1;
  const half = SMOKE / 2;
  const base = 0.20 + level * 0.11;
  for (let i = 0; i < SMOKE; i++){
    const sp = smokeSprites[i];
    const side = i < half ? -1 : 1;
    const p = (smokePhase + (i % half) / half) % 1;     // 0 au moteur, 1 en fin de traînée
    sp.visible = true;
    sp.position.set(side * (1.15 + p * 1.05), 1.0 + p * 0.85, -2.6 - p * TRAIL_LEN);
    sp.scale.setScalar(0.45 + p * 1.35);
    sp.material.opacity = base * Math.pow(Math.sin(p * Math.PI), 1.3);
  }
}

function updateThrust(dt, level){
  const LV = [
    { len:1.1, rad:0.30, op:0.35, col:0x5fd8ff },
    { len:3.0, rad:0.44, op:0.75, col:0xbdf0ff },
    { len:5.0, rad:0.56, op:0.95, col:0xff8ae0 }
  ][level];
  const flick = 0.86 + Math.random() * 0.28;
  for (let i = 0; i < flames.length; i++){
    const m = flames[i], core = (i % 2) === 1;
    const tl = LV.len * (core ? 0.62 : 1) * flick;
    const tr = LV.rad * (core ? 0.5 : 1);
    m.scale.x += (tr - m.scale.x) * Math.min(1, dt * 12);
    m.scale.y = m.scale.x;
    m.scale.z += (tl - m.scale.z) * Math.min(1, dt * 12);
  }
  flameOuterMat.opacity += (LV.op * 0.55 - flameOuterMat.opacity) * Math.min(1, dt * 8);
  flameCoreMat.opacity  += (LV.op - flameCoreMat.opacity) * Math.min(1, dt * 8);
  flameOuterMat.color.lerp(TMPCOL.setHex(LV.col), Math.min(1, dt * 6));
  flameCoreMat.color.lerp(TMPCOL2.setHex(level === 2 ? 0xffe6fb : 0xffffff), Math.min(1, dt * 6));
}
const TMPCOL = new THREE.Color(), TMPCOL2 = new THREE.Color();
