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

/** Reverb impulse length, seconds. Built once, on first use. */
const REVERB_SECONDS = 3;

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
        case 'land': this.thud(0.16, 700); break;
        case 'badLanding': this.thud(0.5, 1400); break;
        case 'wallImpact': this.thud(Math.min(0.5, 0.12 + e.force * 0.4), 1400); break;
        case 'pickup':
          if (e.kind === 'coin') this.coin(1 + e.gain * 3);
          else if (e.kind === 'fix') this.fix();
          else this.superBoost();
          break;
        case 'wreck': this.crash(); break;
        default: break;
      }
    }
  }

  /**
   * The continuous layers, followed once a frame.
   *
   * `setTargetAtTime` rather than direct assignment: a step change on a gain
   * at audio rate is an audible click, and there is one of these per frame.
   */
  update(playing: boolean, speed: number, speedMax: number, boosting: boolean, drifting: boolean): void {
    const ctx = this.ctx;
    const eng = this.engine;
    if (!ctx || !eng || !this.wind || !this.driftNoise) return;

    const t = ctx.currentTime;
    // Above 1 under boost, which is what keeps the top end from flattening.
    const r = Math.min(1.7, speed / speedMax);
    const bst = boosting ? 1 : 0;

    eng.rumble.filter.frequency.setTargetAtTime(90 + r * 190, t, 0.10);
    eng.rumble.gain.gain.setTargetAtTime(playing ? 0.13 + r * 0.20 : 0, t, 0.18);

    eng.body.filter.frequency.setTargetAtTime(250 + r * 850 + bst * 380, t, 0.10);
    eng.body.gain.gain.setTargetAtTime(playing ? 0.05 + r * 0.12 + bst * 0.05 : 0, t, 0.16);

    eng.hiss.filter.frequency.setTargetAtTime(2600 + r * 2400, t, 0.14);
    eng.hiss.gain.gain.setTargetAtTime(playing ? 0.012 + r * 0.055 + bst * 0.02 : 0, t, 0.18);

    eng.whine.frequency.setTargetAtTime(430 + r * 2000, t, 0.12);
    eng.whineGain.gain.setTargetAtTime(playing ? 0.004 + r * 0.016 + bst * 0.008 : 0, t, 0.20);

    this.wind.filter.frequency.setTargetAtTime(650 + r * 1500, t, 0.25);
    this.wind.gain.gain.setTargetAtTime(playing ? 0.02 + r * 0.10 : 0, t, 0.18);

    this.driftNoise.gain.gain.setTargetAtTime(playing && drifting ? 0.09 : 0, t, 0.07);
  }

  private init(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ??
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

  private blip(freq: number, dur: number, type: OscillatorType, vol: number,
               sweep = 0, delay = 0): void {
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

  private noiseHit(t0: number, vol: number, type: BiquadFilterType, f0: number, f1: number,
                   q: number, dur: number, send: boolean): void {
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
    this.blip(1180 * k, 0.07, 'square', 0.10);
    this.blip(1760 * k, 0.10, 'square', 0.09, 0, 0.055);
    if (mul > 2) this.blip(2400 * k, 0.12, 'square', 0.07, 0, 0.11);
  }

  private fix(): void {
    this.blip(520, 0.12, 'triangle', 0.18);
    this.blip(780, 0.20, 'triangle', 0.16, 0, 0.10);
  }

  private superBoost(): void {
    this.blip(180, 0.55, 'sawtooth', 0.20, 1500);
    this.blip(360, 0.5, 'square', 0.07, 2400, 0.04);
  }

  private crash(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    this.reverb();
    this.noiseHit(t, 0.35, 'highpass', 2400, 900, 0.7, 0.09, true);      // sheet metal
    this.noiseHit(t, 0.45, 'lowpass', 2600, 90, 1.0, 0.40, true);        // impact
    this.noiseHit(t + 0.015, 0.18, 'lowpass', 700, 55, 0.9, 1.5, true);  // low tail

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.32);
    g.gain.setValueAtTime(0.40, t);
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
        'bandpass', 900 + Math.random() * 2800, 0, 7,
        0.09 + Math.random() * 0.13, true,
      );
    }
  }
}
