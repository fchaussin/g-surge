/**
 * Cosmic background: a shader on an inverted sphere centred on the camera.
 *
 * Value-noise fbm for the nebula, plus two hashed star layers. `uSimple` drops
 * the second layer and halves the octaves when auto-quality asks for it; the
 * background is never switched off automatically, only detailed down, because
 * losing it costs the game its visual signature.
 *
 * Ported verbatim from the legacy engine, GLSL included. Two things must not
 * be touched:
 *
 * - **No `precision mediump float`.** The hash loses its spread and the stars
 *   fuse into large blobs. three.js applies `highp` by default; leave it.
 * - The sphere is rotated by hand from integrated curvature. The ship has no
 *   heading — a corner is the track bending ahead — so without `skyYaw` a turn
 *   would show no lateral motion at all.
 */
import {
  BackSide, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, Points,
  PointsMaterial, ShaderMaterial, SphereGeometry,
} from 'three';
import { Rng } from '../sim/index.js';

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

/** Star dust radius and vertical spread, from the legacy field. */
const DUST_COUNT = 900;

export class Sky {
  readonly group = new Group();

  private readonly material: ShaderMaterial;
  /** Integrated heading. The ship has none, so the sky carries the turn. */
  private yaw = 0;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: { uTime: { value: 0 }, uWarp: { value: 0 }, uSimple: { value: 0 } },
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

  /** Detail level. The background is never switched off automatically. */
  setDetail(high: boolean): void {
    this.material.uniforms.uSimple!.value = high ? 0 : 1;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  reset(): void {
    this.yaw = 0;
  }

  /**
   * Integrates the turn and follows the camera.
   *
   * Positional arguments on purpose: this runs every frame and an options
   * object here would be one allocation per frame.
   */
  update(
    timeSeconds: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    curvature: number,
    speed: number,
    dt: number,
    boosting: boolean,
  ): void {
    if (!this.group.visible) return;
    this.yaw -= curvature * speed * dt;
    this.group.position.set(cameraX, cameraY, cameraZ);
    this.group.rotation.y = this.yaw;
    this.material.uniforms.uTime!.value = timeSeconds;
    this.material.uniforms.uWarp!.value = boosting ? 1 : 0;
  }

  /**
   * Constant seed, not the run's: the field is built once at load, and a
   * stable sky is what will make full-frame visual references comparable.
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
