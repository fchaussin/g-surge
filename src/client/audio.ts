/**
 * Everything you hear, synthesised. No files, which is why the payload has no
 * asset pipeline at all.
 *
 * The engine is three bands of filtered noise — low rumble, mid body, high
 * hiss — plus a very quiet sine for turbine whine. Harmonic oscillators were
 * tried first and sounded like a piston engine; noise is what makes it read as
 * a reactor.
 *
 * Nothing here is created before a user gesture: browsers refuse to start an
 * `AudioContext` otherwise, and an autoplay failure in the console on every
 * load is noise of a different kind.
 */
import type { SimEvent } from '../sim/index.js';
import type { ThrustTier } from './thrust.js';

/** Reverb impulse length, seconds. Built once, on first use. */
const REVERB_SECONDS = 3;

/**
 * Engine drive by thrust tier.
 *
 * Index 1 is 1, which is what the boolean this replaced always gave a boost, so
 * a boost sounds exactly as it did and only the super boost is new. Until now
 * `update` never received `superT` at all: the reactor and the wind were the
 * plainest case of the super boost being a boost with a different plume.
 */
const DRIVE_BY_TIER = [0, 1, 2] as const;

/**
 * The wind is the one layer a boost never lifted, so there is no previous
 * value to preserve and the tier can own it outright. §10 of the palette also
 * asks for a reinforced wind under a plain boost; that is a change to how a
 * boost sounds, and it is not this step's business.
 */
const WIND_BY_TIER = [0, 0, 1] as const;

/**
 * Shortest drift, in seconds, that earns a realignment whoosh.
 *
 * Not a guess: a drift lasting a single step exists and was measured at 1 ms
 * while weaving. Its entry and its release would land on top of each other and
 * read as a click rather than as two moments. The entry transient is short
 * enough to stand alone, so only the release is gated.
 */
const DRIFT_RELEASE_MIN = 0.12;

/** Gain of the drift airflow band at full slip. It used to be flat at 0.09. */
const DRIFT_AIRFLOW = 0.12;

interface Band {
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface Engine {
  rumble: Band;
  body: Band;
  hiss: Band;
  whine: OscillatorNode;
  whineGain: GainNode;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: Engine | null = null;
  private wind: Band | null = null;
  private driftNoise: Band | null = null;
  private charge: { osc: OscillatorNode; gain: GainNode } | null = null;
  private reverbIn: GainNode | null = null;
  private muted = false;
  /** No graph exists before a gesture; see `unlock`. */
  private unlocked = false;

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Opens the audio, from a user gesture.
   *
   * Nothing before this creates a context. A browser suspends one created
   * outside a gesture and warns about it, which used to happen six times on
   * every load because the screen machine resumed on its own first
   * transition.
   */
  unlock(): void {
    this.unlocked = true;
    this.resume();
  }

  /**
   * Resumes a context suspended by the browser — a backgrounded tab, an
   * interrupting call. A no-op until `unlock`, so it is safe to call from any
   * screen change.
   */
  resume(): void {
    if (!this.unlocked) return;
    this.init();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Builds the reverb ahead of time.
   *
   * Its impulse response is 288 000 samples over two channels, generated in a
   * loop. Left to build itself on the first crash, that lands as a hitch at
   * the worst possible moment.
   */
  warmUp(): void {
    if (!this.unlocked) return;
    this.reverb();
  }

  /** Turns simulation events into sound. */
  play(events: readonly SimEvent[]): void {
    if (!this.ctx || this.muted) return;
    for (const e of events) {
      switch (e.type) {
        case 'land':
          this.thud(0.16, 700);
          break;
        case 'badLanding':
          this.thud(0.5, 1400);
          break;
        case 'wallImpact':
          this.thud(Math.min(0.5, 0.12 + e.force * 0.4), 1400);
          break;
        case 'pickup':
          if (e.kind === 'coin') this.coin(1 + e.gain * 3);
          else if (e.kind === 'fix') this.fix();
          else this.superBoost();
          break;
        case 'supEnd':
          this.superRelease();
          break;
        case 'driftStart':
          this.driftEntry();
          break;
        case 'driftEnd':
          if (e.held > DRIFT_RELEASE_MIN) this.driftRelease(e.held);
          break;
        case 'wreck':
          this.crash();
          break;
        default:
          break;
      }
    }
  }

  /**
   * The continuous layers, followed once a frame.
   *
   * `setTargetAtTime` rather than direct assignment: a step change on a gain
   * at audio rate is an audible click, and there is one of these per frame.
   */
  /**
   * @param drift 0 to 1, the shared slip scale from `drift.ts`. It was a
   *   boolean, and a fixed gain: the band said that a drift was happening and
   *   never how hard.
   * @param charge the boost reserve, 0 to 1.
   */
  update(
    playing: boolean,
    speed: number,
    speedMax: number,
    tier: ThrustTier,
    drift: number,
    charge: number,
  ): void {
    const ctx = this.ctx;
    const eng = this.engine;
    if (!ctx || !eng || !this.wind || !this.driftNoise || !this.charge) return;

    const t = ctx.currentTime;
    // Above 1 under boost, which is what keeps the top end from flattening.
    const r = Math.min(1.7, speed / speedMax);
    const bst = DRIVE_BY_TIER[tier];
    const wnd = WIND_BY_TIER[tier];

    eng.rumble.filter.frequency.setTargetAtTime(90 + r * 190, t, 0.1);
    eng.rumble.gain.gain.setTargetAtTime(playing ? 0.13 + r * 0.2 : 0, t, 0.18);

    eng.body.filter.frequency.setTargetAtTime(250 + r * 850 + bst * 380, t, 0.1);
    eng.body.gain.gain.setTargetAtTime(playing ? 0.05 + r * 0.12 + bst * 0.05 : 0, t, 0.16);

    eng.hiss.filter.frequency.setTargetAtTime(2600 + r * 2400, t, 0.14);
    eng.hiss.gain.gain.setTargetAtTime(playing ? 0.012 + r * 0.055 + bst * 0.02 : 0, t, 0.18);

    eng.whine.frequency.setTargetAtTime(430 + r * 2000, t, 0.12);
    eng.whineGain.gain.setTargetAtTime(playing ? 0.004 + r * 0.016 + bst * 0.008 : 0, t, 0.2);

    this.wind.filter.frequency.setTargetAtTime(650 + r * 1500 + wnd * 520, t, 0.25);
    this.wind.gain.gain.setTargetAtTime(playing ? 0.02 + r * 0.1 + wnd * 0.06 : 0, t, 0.18);

    this.driftNoise.gain.gain.setTargetAtTime(playing ? drift * DRIFT_AIRFLOW : 0, t, 0.07);

    // La recharge : elle monte avec la réserve et ne s'entend qu'en drift,
    // parce que c'est là qu'elle est trois fois plus rapide et que le joueur a
    // une raison d'écouter.
    const charging = drift > 0 && charge < 0.995;
    this.charge.osc.frequency.setTargetAtTime(300 + charge * 560, t, 0.08);
    this.charge.gain.gain.setTargetAtTime(playing && charging ? 0.018 : 0, t, 0.09);
  }

  private init(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // One white noise buffer, shared by every layer.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    const srcA = this.loop(1);
    const srcB = this.loop(0.73);
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.value = 600;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain);
    whineGain.connect(this.master);
    whine.start();

    this.engine = {
      rumble: this.band(srcA, 'lowpass', 140, 7),
      body: this.band(srcA, 'bandpass', 420, 1.1),
      hiss: this.band(srcB, 'highpass', 3200, 0.6),
      whine,
      whineGain,
    };
    this.wind = this.band(this.loop(0.55), 'bandpass', 900, 0.7);
    this.driftNoise = this.band(this.loop(1.3), 'bandpass', 2600, 2.2);

    const chargeOsc = ctx.createOscillator();
    chargeOsc.type = 'triangle';
    chargeOsc.frequency.value = 300;
    const chargeGain = ctx.createGain();
    chargeGain.gain.value = 0;
    chargeOsc.connect(chargeGain);
    chargeGain.connect(this.master);
    chargeOsc.start();
    this.charge = { osc: chargeOsc, gain: chargeGain };
  }

  private loop(rate: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start();
    return src;
  }

  private band(src: AudioNode, type: BiquadFilterType, freq: number, q: number): Band {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    return { filter, gain };
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    sweep = 0,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(25, sweep), t + dur);
    // Exponential ramps cannot touch zero, hence the near-silent floor.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private thud(vol: number, freq: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + 0.32);
  }

  private noiseHit(
    t0: number,
    vol: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    dur: number,
    send: boolean,
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    if (send) {
      const rev = this.reverb();
      if (rev) g.connect(rev);
    }
    // Random offset into the buffer, so repeats do not phase together.
    src.start(t0, Math.random() * 1.4);
    src.stop(t0 + dur + 0.05);
  }

  /** Exponentially decaying noise, built once. */
  private reverb(): GainNode | null {
    if (this.reverbIn || !this.ctx) return this.reverbIn;
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * REVERB_SECONDS);
    const impulse = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (1 - Math.exp(-i / 220));
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.85;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.reverbIn.connect(conv);
    conv.connect(wet);
    wet.connect(this.master!);
    return this.reverbIn;
  }

  private coin(mul: number): void {
    const k = 1 + (mul - 1) * 0.16;
    this.blip(1180 * k, 0.07, 'square', 0.1);
    this.blip(1760 * k, 0.1, 'square', 0.09, 0, 0.055);
    if (mul > 2) this.blip(2400 * k, 0.12, 'square', 0.07, 0, 0.11);
  }

  private fix(): void {
    this.blip(520, 0.12, 'triangle', 0.18);
    this.blip(780, 0.2, 'triangle', 0.16, 0, 0.1);
  }

  /**
   * The super boost, which is also its own activation: the pickup fires it.
   *
   * A rising sweep alone reads as "faster". The detonation under it is what
   * makes it read as a catapult, which is the distinction §15 of the palette
   * asks for and the one the game did not make.
   */
  private superBoost(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;

    this.noiseHit(t, 0.3, 'lowpass', 1900, 130, 0.9, 0.24, true);

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.3);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + 0.46);

    this.blip(180, 0.55, 'sawtooth', 0.2, 1500);
    this.blip(360, 0.5, 'square', 0.07, 2400, 0.04);
  }

  /**
   * The reserve is full: two rising notes, and not the coin's square wave.
   *
   * Called by the client, which owns the decision of when a refill is worth
   * announcing. The simulation only knows that the reserve is at 100, and it is
   * at 100 again three steps after a wall has shaved 0.036 off it.
   */
  boostReady(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.blip(660, 0.09, 'triangle', 0.075);
    this.blip(990, 0.14, 'triangle', 0.065, 0, 0.07);
  }

  /**
   * Entering a drift: an aerodynamic rupture, not an impact.
   *
   * The drift already had a continuous voice — a noise band at 2600 Hz that
   * fades in — and no moments at all. This is the first of the two ends.
   */
  private driftEntry(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.noiseHit(ctx.currentTime, 0.13, 'bandpass', 900, 2600, 1.8, 0.13, false);
  }

  /**
   * Leaving one: the grip comes back, and the whoosh falls rather than rises.
   *
   * Scaled by how long the drift was held, which is what the event carries. A
   * long slide earns a longer, louder realignment; that is also the seed of the
   * chain the palette describes, without the mechanic behind it.
   */
  private driftRelease(held: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const k = Math.min(1, held / 0.9);
    this.noiseHit(
      ctx.currentTime,
      0.08 + k * 0.09,
      'bandpass',
      2800,
      700,
      1.5,
      0.22 + k * 0.12,
      true,
    );
  }

  /**
   * The end of a super boost: a decompression, not a fall.
   *
   * Quieter than the activation on purpose. It closes the beat rather than
   * competing with it, and what it announces is a hand-off — the pickup filled
   * the reserve and the super boost never drained it, so the run carries
   * straight on into a boost.
   */
  private superRelease(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.noiseHit(ctx.currentTime, 0.14, 'bandpass', 2400, 620, 1.2, 0.3, true);
    this.blip(760, 0.28, 'triangle', 0.075, 280);
  }

  private crash(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    this.reverb();
    this.noiseHit(t, 0.35, 'highpass', 2400, 900, 0.7, 0.09, true); // sheet metal
    this.noiseHit(t, 0.45, 'lowpass', 2600, 90, 1.0, 0.4, true); // impact
    this.noiseHit(t + 0.015, 0.18, 'lowpass', 700, 55, 0.9, 1.5, true); // low tail

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.32);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g);
    g.connect(this.master!);
    const rev = this.reverb();
    if (rev) g.connect(rev);
    o.start(t);
    o.stop(t + 0.55);

    for (let i = 0; i < 6; i++) {
      this.noiseHit(
        t + 0.04 + Math.random() * 0.5,
        0.07 + Math.random() * 0.06,
        'bandpass',
        900 + Math.random() * 2800,
        0,
        7,
        0.09 + Math.random() * 0.13,
        true,
      );
    }
  }
}
