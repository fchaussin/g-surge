/**
 * Le fond cosmique : un shader sur une sphère inversée centrée sur la caméra.
 *
 * Un fbm de bruit de valeur pour la nébuleuse, plus deux couches d'étoiles
 * hachées. `uSimple` supprime la seconde couche et divise les octaves par deux
 * quand la qualité automatique le demande ; le fond n'est jamais coupé
 * automatiquement, seulement dégradé, parce que le perdre coûte au jeu sa
 * signature visuelle.
 *
 * Porté tel quel depuis l'ancien moteur, GLSL compris. Deux choses ne doivent
 * pas être touchées :
 *
 * - **Pas de `precision mediump float`.** Le hachage perd son étalement et les
 *   étoiles fusionnent en grosses taches. three.js applique `highp` par
 *   défaut ; le laisser faire.
 * - La sphère est tournée à la main depuis la courbure intégrée. Le vaisseau
 *   n'a pas de cap — un virage est le ruban qui se courbe devant — donc sans
 *   `skyYaw` un virage ne montrerait aucun mouvement latéral.
 */
import {
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { Rng, type ThrustTier } from '../sim/index.js';

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
uniform float uStreak;
uniform vec3 uAxis;

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

  // Filé d'étoiles du superboost.
  //
  // La première version étirait la cellule dans l'axe de marche. Mesurée, elle
  // ne pouvait pas marcher : la grille vaut d * 150, soit 2,4 px par cellule à
  // l'écran, et fract boucle à la cellule — la traînée saturait à 2,9 px sur
  // une étoile de 0,8 px de rayon. L'allongement était juste, la maille était
  // le plafond.
  //
  // On prélève donc la couche en plusieurs points le long de la ligne radiale,
  // vers le point de fuite. Un fragment situé au-delà d'une étoile la ramasse,
  // donc la traînée pousse vers l'extérieur : c'est le sens réel, une étoile
  // qu'on dépasse s'échappe sur les bords. La longueur croît avec l'écart à
  // l'axe et s'annule au point de fuite, où rien ne bouge dans l'image.
  //
  // La branche est décidée par un uniforme : elle est cohérente sur toute la
  // surface, et elle ne coûte que pendant les 5 s d'un superboost. La couche
  // fine est laissée de côté, elle doublerait le coût pour des points de 1,4 px.
  //
  // Nombre de prélèvements et longueur choisis par recherche hors ligne sous
  // une contrainte : l'écart entre deux prélèvements ne doit jamais dépasser
  // leur diamètre, sinon la traînée se lit en pointillés sur les bords, là où
  // elle est justement la plus longue. Résultat mesuré à 1280×720, champ à
  // 114° : 14 px à 45° de l'axe, contre 2,9 px pour la version saturée.
  if (uStreak > 0.01){
    vec3 rad = d - uAxis * dot(d, uAxis);
    float off = length(rad);
    if (off > 0.001){
      rad /= off;
      float len = uStreak * 0.06 * off;
      for (int k = 1; k <= 10; k++){
        float f = float(k) / 11.0;
        vec3 dk = normalize(d - rad * (len * f));
        vec3 spk = dk * 150.0;
        // la queue s'épaissit pour que les prélèvements se touchent plutôt
        // que de laisser une file de points
        float w = pow(1.0 - f, 1.4) * 0.85;
        col += vec3(0.85, 0.92, 1.0)
               * step(0.975, hash(floor(spk)))
               * smoothstep(0.34 + f * 0.12, 0.0, length(fract(spk) - 0.5))
               * w;
      }
    }
  }

  col *= 1.0 + uWarp * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Nombre de grains de poussière, repris du champ de l'ancien moteur. */
const DUST_COUNT = 900;

/**
 * Gain de luminosité par palier de poussée. L'indice 1 est ce qu'un boost a
 * toujours eu, donc seul le superboost bouge.
 *
 * L'échelle n'est volontairement pas bâtie sur la seule luminosité : un canal
 * unique, c'est la dette 10 des signaux par la couleur seule. Le superboost
 * file aussi les étoiles, ce qui est un effet d'une autre nature plutôt que
 * davantage du même.
 */
const WARP_BY_TIER = [0, 1, 1.35, 1.6] as const;

/** Montée et retombée du filé, par seconde. Il frappe, puis il lâche. */
const STREAK_ATTACK = 16;
const STREAK_RELEASE = 3.2;

export class Sky {
  readonly group = new Group();

  private readonly material: ShaderMaterial;
  /** Cap intégré. Le vaisseau n'en a pas, donc le ciel porte le virage. */
  private yaw = 0;
  /** Amorti, donc à remettre à zéro pour une capture. Voir `reset`. */
  private streak = 0;
  /** Direction de marche dans le repère de la sphère, réécrite à chaque frame. */
  private readonly axis = new Vector3(0, 0, 1);

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: {
        uTime: { value: 0 },
        uWarp: { value: 0 },
        uSimple: { value: 0 },
        uStreak: { value: 0 },
        uAxis: { value: this.axis },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    const mesh = new Mesh(new SphereGeometry(900, 24, 16), this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    this.group.add(mesh);
    this.group.add(this.makeDust());
  }

  /** Niveau de détail. Le fond n'est jamais coupé automatiquement. */
  setDetail(high: boolean): void {
    this.material.uniforms.uSimple!.value = high ? 0 : 1;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /**
   * Remet à zéro le cap intégré et le filé.
   *
   * Le filé s'amortit sur des frames, donc une capture prise sans ceci atterrit
   * là où les frames précédentes l'ont laissé — quatrième membre d'une famille
   * de bugs que ce code a déjà payée trois fois.
   */
  reset(): void {
    this.yaw = 0;
    this.streak = 0;
    this.material.uniforms.uStreak!.value = 0;
    this.axis.set(0, 0, 1);
  }

  /**
   * Intègre le virage et suit la caméra.
   *
   * Arguments positionnels à dessein : ceci tourne à chaque frame et un objet
   * d'options serait ici une allocation par frame.
   */
  update(
    timeSeconds: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    curvature: number,
    speed: number,
    dt: number,
    tier: ThrustTier,
  ): void {
    if (!this.group.visible) return;
    this.yaw -= curvature * speed * dt;
    this.group.position.set(cameraX, cameraY, cameraZ);
    this.group.rotation.y = this.yaw;
    this.material.uniforms.uTime!.value = timeSeconds;
    this.material.uniforms.uWarp!.value = WARP_BY_TIER[tier];

    // Le ruban est reconstruit devant un vaisseau qui ne tourne jamais : la
    // direction de marche est +Z monde, et la sphère porte le cap. Dans son
    // repère, cette direction est donc Ry(-yaw) appliqué à +Z.
    this.axis.set(-Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // Plafonné à 1, et pas par timidité : la longueur du filé a été choisie
    // par recherche sous la contrainte que l'écart entre prélèvements ne
    // dépasse jamais leur diamètre. Au-delà de 1 la traînée se lit en
    // pointillés, exactement là où elle est la plus longue. Le palier 3 se
    // distingue par la luminosité et par le reste, pas en cassant ça.
    const want = tier >= 2 ? 1 : 0;
    const rate = want > this.streak ? STREAK_ATTACK : STREAK_RELEASE;
    this.streak += (want - this.streak) * Math.min(1, dt * rate);
    this.material.uniforms.uStreak!.value = this.streak;
  }

  /**
   * Graine constante, et pas celle de la partie : le champ est bâti une fois au
   * chargement, et un ciel stable est ce qui rend les références visuelles
   * plein cadre comparables.
   */
  private makeDust(): Points {
    const rng = Rng.fromSeed('g-surge', 'dust');
    const positions = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      const r = rng.range(140, 840);
      const a = rng.range(0, Math.PI * 2);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = (rng.next() - 0.45) * 460;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const points = new Points(
      geometry,
      new PointsMaterial({
        color: new Color(0x3a6a8c),
        size: 2.4,
        sizeAttenuation: true,
        fog: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    points.frustumCulled = false;
    return points;
  }
}
