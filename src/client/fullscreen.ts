/**
 * Fullscreen, with its two awkward realities.
 *
 * The prefixed WebKit spelling is still what iPad Safari answers to, and a
 * request from inside an iframe without `allow="fullscreen"` rejects rather
 * than throwing — which is how this game is usually embedded, so the refusal
 * has to be said out loud instead of failing silently.
 *
 * It also carries the orientation lock, because that is where the browser will
 * accept one: `screen.orientation.lock` is refused outside fullscreen. The
 * manifest asks an installed app for landscape; this is what asks for it in a
 * tab, and it is a request in both cases — desktop refuses it, iOS has no such
 * API at all, and neither is an error worth showing anyone.
 */
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
/** Structural, like the two above: the API is absent on several targets. */
type LockableOrientation = {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

const root = document.documentElement as FsElement;
const doc = document as FsDocument;

export class Fullscreen {
  /** False where the API is missing entirely; the controls then hide. */
  readonly available = !!(root.requestFullscreen || root.webkitRequestFullscreen);

  constructor(private readonly onChange: (active: boolean, blocked: boolean) => void) {
    if (!this.available) return;
    const notify = () => {
      this.applyOrientation();
      this.onChange(this.active, false);
    };
    document.addEventListener('fullscreenchange', notify);
    document.addEventListener('webkitfullscreenchange', notify);
  }

  get active(): boolean {
    return !!(document.fullscreenElement ?? doc.webkitFullscreenElement);
  }

  toggle(): void {
    if (!this.available) return;
    try {
      if (!this.active) {
        const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
        const result = request?.call(root, { navigationUI: 'hide' });
        if (result instanceof Promise) result.catch(() => this.blocked());
      } else {
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        const result = exit?.call(doc);
        if (result instanceof Promise) result.catch(() => undefined);
      }
    } catch {
      this.blocked();
    }
    // The change event does not always fire on a refusal.
    setTimeout(() => this.onChange(this.active, false), 150);
  }

  /**
   * Landscape while fullscreen, free again on the way out.
   *
   * Hung off the change event rather than off `toggle`, so it also covers the
   * ways fullscreen is entered and left without going through this class — the
   * Escape key, and the browser's own controls.
   */
  private applyOrientation(): void {
    const orientation = screen.orientation as unknown as LockableOrientation | undefined;
    if (!orientation) return;
    try {
      if (this.active) void orientation.lock?.('landscape')?.catch(() => undefined);
      else orientation.unlock?.();
    } catch {
      // Refused, which is the normal answer on a desktop. Nothing to do.
    }
  }

  private blocked(): void {
    this.onChange(false, true);
    setTimeout(() => this.onChange(this.active, false), 2200);
  }
}
