/**
 * Turns devices into an `Input`.
 *
 * The simulation is never allowed to read a keyboard or a pointer: it takes
 * `{ steer, brake, boost }` and nothing else. That single rule is what makes a
 * recorded run replayable, and what would let a server validate one. Every
 * device added here has to end at the same three fields.
 *
 * `KeyQ` and `KeyZ` are not typos: with `code` the physical key is what
 * matters, so those are the AZERTY positions of `A` and `W`. Both layouts get
 * the same hand shape.
 *
 * Steering is negated on the way out. The camera looks down `+Z`, so world
 * `+X` appears on the left of the screen; pushing the stick right has to move
 * the ship towards `-X`.
 */
import type { Input } from '../sim/index.js';

/** Physical keys, by `KeyboardEvent.code` so the layout does not matter. */
const KEYMAP: Record<string, 'left' | 'right' | 'brake' | 'boost'> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  KeyQ: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'boost',
  ArrowUp: 'boost',
  KeyW: 'boost',
  KeyZ: 'boost',
};

const STICK_RADIUS = 46;
/** Below this the stick reads as centred; the rest is rescaled to keep 1 at full throw. */
const STICK_DEADZONE = 0.07;

export interface InputOptions {
  /** Input is only collected while this returns true. */
  isPlaying: () => boolean;
  /** Short haptic feedback on a pad press. */
  buzz?: (pattern: number | number[]) => void;
  /** Whether the boost pad has anything to give, for the feedback strength. */
  canBoost?: () => boolean;
}

export class InputSource {
  /** Reused: read it every step, never hold on to it. */
  readonly value: Input = { steer: 0, brake: false, boost: false };

  private readonly keys = { left: false, right: false, brake: false, boost: false };
  private readonly pads = { brake: false, boost: false };
  private stickX = 0;
  private stickPointer: number | null = null;
  private stickCx = 0;
  private stickCy = 0;

  constructor(private readonly options: InputOptions) {
    this.bindKeyboard();
    this.bindStick();
    this.bindPads();
  }

  /** Recomputes `value` from the current device state. */
  sample(): Input {
    const kb = (this.keys.left ? 1 : 0) - (this.keys.right ? 1 : 0);
    this.value.steer = kb !== 0 ? kb : this.stickX;
    this.value.brake = this.keys.brake || this.pads.brake;
    this.value.boost = this.keys.boost || this.pads.boost;
    return this.value;
  }

  /** Drops everything held. Called when a run ends or the screen changes. */
  release(): void {
    this.keys.left = this.keys.right = this.keys.brake = this.keys.boost = false;
    this.pads.brake = this.pads.boost = false;
    this.endStick();
    for (const el of document.querySelectorAll('.pad.act')) el.classList.remove('act');
  }

  /** True while a physical key is held, for the screens layer to know. */
  isKeyHeld(code: string): boolean {
    return KEYMAP[code] !== undefined;
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (k && this.options.isPlaying()) {
        this.keys[k] = true;
        e.preventDefault();
      }
    });
    // Released unconditionally: a key let go while paused must not stay stuck.
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) this.keys[k] = false;
    });
    // A tab switch never delivers keyup, so anything held would latch.
    window.addEventListener('blur', () => this.release());
  }

  private bindStick(): void {
    const zone = document.getElementById('stickZone');
    const stick = document.getElementById('stick');
    if (!zone || !stick) return;

    const move = (e: PointerEvent) => {
      let dx = e.clientX - this.stickCx;
      let dy = e.clientY - this.stickCy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        dx *= STICK_RADIUS / d;
        dy *= STICK_RADIUS / d;
      }
      const knob = stick.firstElementChild as HTMLElement | null;
      if (knob) knob.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;

      let v = dx / STICK_RADIUS;
      if (Math.abs(v) < STICK_DEADZONE) v = 0;
      else v = (v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE);
      this.stickX = -v;
    };

    zone.addEventListener('pointerdown', (e) => {
      if (!this.options.isPlaying() || this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.stickCx = e.clientX;
      this.stickCy = e.clientY;
      stick.style.left = `${this.stickCx}px`;
      stick.style.top = `${this.stickCy}px`;
      stick.classList.add('on');
      move(e);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      move(e);
      e.preventDefault();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      zone.addEventListener(type, (e) => {
        if ((e as PointerEvent).pointerId === this.stickPointer) this.endStick();
      });
    }
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private endStick(): void {
    this.stickPointer = null;
    this.stickX = 0;
    const stick = document.getElementById('stick');
    if (!stick) return;
    stick.classList.remove('on');
    const knob = stick.firstElementChild as HTMLElement | null;
    if (knob) knob.style.transform = '';
  }

  private bindPads(): void {
    for (const el of document.querySelectorAll<HTMLElement>('[data-in]')) {
      const key = el.dataset.in as 'brake' | 'boost' | undefined;
      if (key !== 'brake' && key !== 'boost') continue;

      const press = (e: PointerEvent) => {
        if (!this.options.isPlaying()) return;
        this.pads[key] = true;
        el.classList.add('act');
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        // A weaker pulse when boost has nothing left: the hand learns it
        // faster than the gauge is read.
        if (key === 'boost') this.options.buzz?.(this.options.canBoost?.() ? 26 : 6);
        else this.options.buzz?.(14);
      };
      const release = () => {
        this.pads[key] = false;
        el.classList.remove('act');
      };

      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
}
