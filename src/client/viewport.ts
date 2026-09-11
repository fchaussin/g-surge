/**
 * Le rendu, la caméra, et les deux choses à ne jamais rater à leur sujet : la
 * taille du tampon de dessin, et la résolution que les shaders de fragment
 * paient.
 *
 * Le jeu est limité par le taux de remplissage — mesuré à 76 appels de dessin
 * et 5 591 triangles par frame, près de la moitié du temps dans le shader du
 * ciel — donc `renderScale` est le principal levier de performance, et il vit
 * ici.
 */
import * as THREE from 'three';

/** Au-delà, les pixels supplémentaires coûtent plus qu'ils ne montrent. */
const MAX_PIXEL_RATIO = 2;

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;

  private scale = 1;
  private readonly onResize = () => this.applySize();

  constructor(fov: number) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({
      // L'anticrénelage rapporte peu quand l'appareil suréchantillonne déjà, et
      // il n'est pas gratuit sur le taux de remplissage qui limite ce jeu.
      antialias: dpr < MAX_PIXEL_RATIO,
    });
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.4, 3000);

    document.body.appendChild(this.renderer.domElement);
    this.applySize();
    window.addEventListener('resize', this.onResize);
  }

  /** Fraction de la résolution native à laquelle rendre, de 0,4 à 1. */
  setRenderScale(value: number): void {
    this.scale = Math.max(0.4, Math.min(1, value));
    this.applySize();
  }

  get renderScale(): number {
    return this.scale;
  }

  render(scene: THREE.Scene): void {
    this.renderer.render(scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applySize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    // Le coût de remplissage va comme le carré de ceci, d'où le premier bouton
    // que la qualité automatique tourne.
    this.renderer.setPixelRatio(dpr * this.scale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, true);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
