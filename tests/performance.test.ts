/**
 * The frame governor: refresh detection and automatic quality.
 *
 * There used to be more here — a frame rate target, an integer-ratio throttle,
 * and tests for both. The whole mechanism was removed by decision: the game
 * renders at whatever the display gives, and quality adapts to hold it. These
 * tests cover what remains, which are the behaviours the code claims in its
 * comments.
 */
import { describe, expect, it } from 'vitest';
import { PerformanceGovernor, type PerformanceOptions } from '../src/client/performance.js';

/** Options stateful et enregistreuses, pour observer ce que le régulateur fait. */
function harness(overrides: Partial<PerformanceOptions> = {}) {
  const calls: string[] = [];
  let skyDetail = true;
  let renderScale = 1;
  const options: PerformanceOptions = {
    isPlaying: () => true,
    getSkyDetail: () => skyDetail,
    setSkyDetail: (high) => {
      skyDetail = high;
      calls.push(`sky:${high}`);
    },
    getRenderScale: () => renderScale,
    setRenderScale: (value) => {
      renderScale = value;
      calls.push(`scale:${value}`);
    },
    ...overrides,
  };
  const governor = new PerformanceGovernor(options);
  return {
    governor,
    calls,
    get skyDetail() {
      return skyDetail;
    },
    get renderScale() {
      return renderScale;
    },
  };
}

/**
 * Une fenêtre de mesure d'une seconde à `fps` images.
 *
 * Le régulateur compte des images réelles, donc simuler une cadence demande
 * autant d'appels que d'images. La dernière tranche absorbe l'erreur
 * d'accumulation flottante pour que la fenêtre se ferme exactement une fois.
 */
function window_(governor: PerformanceGovernor, fps: number): void {
  const dt = 1 / fps;
  for (let i = 0; i < fps - 1; i++) governor.update(dt);
  governor.update(1 - (fps - 1) * dt + 1e-9);
}

describe('refresh detection', () => {
  it('snaps the median interval to the nearest known rate', () => {
    const { governor } = harness();
    for (let i = 0; i < 90; i++) governor.detect(1 / 144);
    expect(governor.refreshHz).toBe(144);
  });

  it('is robust to long frames, because it takes a median and not a mean', () => {
    const { governor } = harness();
    for (let i = 0; i < 90; i++) governor.detect(i % 9 === 0 ? 0.15 : 1 / 144);
    // Ten frames of 150 ms would drag a mean to ~45 Hz; the median ignores them.
    expect(governor.refreshHz).toBe(144);
  });

  it('rejects absurd samples instead of counting them', () => {
    const { governor } = harness();
    for (let i = 0; i < 89; i++) governor.detect(1 / 60);
    governor.detect(0.5); // > 0.2 s : rejeté, ne complète pas l'échantillon
    governor.detect(-1);
    expect(governor.refreshHz).toBe(0);
    governor.detect(1 / 60); // le quatre-vingt-dixième valide
    expect(governor.refreshHz).toBe(60);
  });

  it('re-detects when frames arrive well above the known rate', () => {
    // The window moved to a faster display: the old detection is wrong.
    const { governor } = harness({ isPlaying: () => false });
    governor.refreshHz = 60;
    window_(governor, 90);
    expect(governor.refreshHz).toBe(0);
  });
});

describe('automatic quality', () => {
  /** Trois fenêtres de chauffe (compilation des shaders), jamais évaluées. */
  function warmUp(governor: PerformanceGovernor): void {
    for (let i = 0; i < 3; i++) window_(governor, 60);
  }

  it('judges against the display itself: holding the native rate is good', () => {
    const h = harness();
    h.governor.refreshHz = 144;
    warmUp(h.governor);
    // 100 fps sur un écran 144 : sous 78 % de la cadence native, donc mauvais.
    for (let i = 0; i < 3; i++) window_(h.governor, 100);
    expect(h.calls).toEqual(['sky:false']);
  });

  it('waits out shader compilation before judging the machine', () => {
    const h = harness();
    h.governor.refreshHz = 60;
    for (let i = 0; i < 3; i++) window_(h.governor, 10);
    expect(h.calls).toEqual([]);
  });

  it('needs three consecutive bad windows, then lowers detail before resolution', () => {
    const h = harness();
    h.governor.refreshHz = 60;
    warmUp(h.governor);

    window_(h.governor, 30);
    window_(h.governor, 30);
    expect(h.calls).toEqual([]); // deux ne suffisent pas
    window_(h.governor, 30);
    expect(h.calls).toEqual(['sky:false']); // le détail d'abord, la résolution ensuite
    expect(h.renderScale).toBe(1);
  });

  it('a good window in between resets the count', () => {
    const h = harness();
    h.governor.refreshHz = 60;
    warmUp(h.governor);

    window_(h.governor, 30);
    window_(h.governor, 30);
    window_(h.governor, 60); // bonne fenêtre : le compte repart
    window_(h.governor, 30);
    window_(h.governor, 30);
    expect(h.calls).toEqual([]);
  });

  it('steps resolution down to 0.7 and never further, and never touches the sky itself', () => {
    const h = harness();
    h.governor.refreshHz = 60;
    warmUp(h.governor);

    // Cinquante fenêtres mauvaises : bien plus qu'il n'en faut pour épuiser
    // tous les crans. Le fond n'a pas de cran « éteint », par conception.
    for (let i = 0; i < 50; i++) window_(h.governor, 30);

    expect(h.skyDetail).toBe(false);
    expect(h.renderScale).toBeCloseTo(0.7, 12);
    const scales = h.calls.filter((c) => c.startsWith('scale:')).map((c) => Number(c.slice(6)));
    expect(Math.min(...scales)).toBeCloseTo(0.7, 12);
    expect(scales.every((v) => v >= 0.7)).toBe(true);
  });

  it('recovers in the reverse order, resolution first and detail last', () => {
    const h = harness();
    h.governor.refreshHz = 60;
    warmUp(h.governor);
    for (let i = 0; i < 50; i++) window_(h.governor, 30); // au plancher

    h.calls.length = 0;
    for (let i = 0; i < 80; i++) window_(h.governor, 60);

    expect(h.renderScale).toBe(1);
    expect(h.skyDetail).toBe(true);
    // Le détail ne revient qu'une fois la résolution pleine.
    const detailBack = h.calls.indexOf('sky:true');
    const lastScale = h.calls.map((c) => c.startsWith('scale:')).lastIndexOf(true);
    expect(detailBack).toBeGreaterThan(lastScale);
  });

  it('does nothing at all outside a run', () => {
    const h = harness({ isPlaying: () => false });
    h.governor.refreshHz = 60;
    for (let i = 0; i < 20; i++) window_(h.governor, 10);
    expect(h.calls).toEqual([]);
  });
});
