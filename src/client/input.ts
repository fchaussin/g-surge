/**
 * Transforme les périphériques en un `Input`.
 *
 * La simulation n'a jamais le droit de lire un clavier ou un pointeur : elle
 * prend `{ steer, brake, boost }` et rien d'autre. Cette seule règle est ce qui
 * rend une partie enregistrée rejouable, et ce qui permettrait à un serveur
 * d'en valider une. Chaque périphérique ajouté ici doit aboutir aux mêmes
 * trois champs.
 *
 * `KeyQ` et `KeyZ` ne sont pas des coquilles : avec `code` c'est la touche
 * physique qui compte, donc ce sont les positions AZERTY de `A` et `W`. Les
 * deux dispositions ont la même forme de main.
 *
 * La direction est inversée en sortie. La caméra regarde vers `+Z`, donc le
 * `+X` du monde apparaît à gauche de l'écran ; pousser le manche à droite doit
 * emmener le vaisseau vers `-X`.
 */
import type { Input } from '../sim/index.js';

/** Touches physiques, par `KeyboardEvent.code`, pour que la disposition n'importe pas. */
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

/**
 * Débattement complet du manche, en pixels, sur son unique axe.
 *
 * Le manche est horizontal seulement. Le jeu n'a aucune entrée verticale —
 * frein et boost sont des pads — donc une molette libre en deux dimensions
 * lisait un pouce en diagonale comme un virage plus faible que voulu, et
 * dessinait un cercle promettant un axe que rien n'écoutait. La diagonale
 * n'est pas de la négligence : à travers virages, vrilles et décalage latéral
 * du vaisseau, un pouce tend à s'aligner sur l'axe du vaisseau à l'écran plutôt
 * que sur celui du manche, et cette inclinaison doit compter pour un virage
 * plein. La pilule de la feuille de style fait `2 × STICK_RADIUS` plus la
 * largeur de la molette.
 */
const STICK_RADIUS = 42;
/** Sous ce seuil le manche se lit centré ; le reste est remis à l'échelle pour garder 1 à fond. */
const STICK_DEADZONE = 0.07;

export interface InputOptions {
  /** L'entrée n'est collectée que tant que ceci rend vrai. */
  isPlaying: () => boolean;
  /** Bref retour haptique sur une pression de pad. */
  buzz?: (pattern: number | number[]) => void;
  /** Si le pad de boost a quelque chose à donner, pour la force du retour. */
  canBoost?: () => boolean;
}

export class InputSource {
  /** Réutilisé : à lire à chaque pas, jamais à conserver. */
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

  /** Recalcule `value` depuis l'état courant des périphériques. */
  sample(): Input {
    const kb = (this.keys.left ? 1 : 0) - (this.keys.right ? 1 : 0);
    this.value.steer = kb !== 0 ? kb : this.stickX;
    this.value.brake = this.keys.brake || this.pads.brake;
    this.value.boost = this.keys.boost || this.pads.boost;
    return this.value;
  }

  /** Lâche tout ce qui est tenu. Appelé à la fin d'une partie ou au changement d'écran. */
  release(): void {
    this.keys.left = this.keys.right = this.keys.brake = this.keys.boost = false;
    this.pads.brake = this.pads.boost = false;
    this.endStick();
    for (const el of document.querySelectorAll('.pad.act')) el.classList.remove('act');
  }

  /** Vrai tant qu'une touche physique est tenue, pour que la couche des écrans le sache. */
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
    // Relâché sans condition : une touche lâchée en pause ne doit pas rester collée.
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) this.keys[k] = false;
    });
    // Un changement d'onglet ne livre jamais keyup, donc tout ce qui est tenu resterait bloqué.
    window.addEventListener('blur', () => this.release());
  }

  private bindStick(): void {
    const zone = document.getElementById('stickZone');
    const stick = document.getElementById('stick');
    if (!zone || !stick) return;

    const move = (e: PointerEvent) => {
      // Un axe : la composante verticale est ignorée, pas projetée, pour qu'un
      // pouce qui glisse vers le haut ou le bas en tournant garde tout son virage.
      const dx = Math.max(-STICK_RADIUS, Math.min(STICK_RADIUS, e.clientX - this.stickCx));
      const knob = stick.firstElementChild as HTMLElement | null;
      if (knob) knob.style.transform = `translateX(${dx.toFixed(1)}px)`;

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
        // Une impulsion plus faible quand le boost n'a plus rien : la main
        // l'apprend plus vite que la jauge ne se lit.
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
