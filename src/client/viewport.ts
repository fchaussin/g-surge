/**
 * Renderer, camera and the two things that must never be got wrong about them:
 * the size of the drawing buffer, and the resolution the fragment shaders pay
 * for.
 *
 * The game is fill-rate bound — measured at 76 draw calls and 5 591 triangles
 * a frame, with close to half the time in the sky shader — so `renderScale` is
 * the main performance lever and it lives here.
 */
import * as THREE from 'three';

/** Above this, the extra pixels cost more than they show. */
const MAX_PIXEL_RATIO = 2;

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;

  private scale = 1;
  private readonly onResize = () => this.applySize();

  constructor(fov: number) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({
      // Antialiasing buys little once the device is already oversampling, and
      // it is not free on the fill rate this game is limited by.
      antialias: dpr < MAX_PIXEL_RATIO,
    });
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.4, 3000);

    document.body.appendChild(this.renderer.domElement);
    this.applySize();
    window.addEventListener('resize', this.onResize);
  }

  /** Fraction of the native resolution to render at, 0.4 to 1. */
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
    // Fill cost goes as the square of this, which is why it is the first knob
    // auto-quality reaches for.
    this.renderer.setPixelRatio(dpr * this.scale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, true);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
