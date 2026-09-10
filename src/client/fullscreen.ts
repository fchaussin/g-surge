/**
 * Fullscreen, with its two awkward realities.
 *
 * The prefixed WebKit spelling is still what iPad Safari answers to, and a
 * request from inside an iframe without `allow="fullscreen"` rejects rather
 * than throwing — which is how this game is usually embedded, so the refusal
 * has to be said out loud instead of failing silently.
 */
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

const root = document.documentElement as FsElement;
const doc = document as FsDocument;

export class Fullscreen {
  /** False where the API is missing entirely; the controls then hide. */
  readonly available = !!(root.requestFullscreen || root.webkitRequestFullscreen);

  constructor(private readonly onChange: (active: boolean, blocked: boolean) => void) {
    if (!this.available) return;
    const notify = () => this.onChange(this.active, false);
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

  private blocked(): void {
    this.onChange(false, true);
    setTimeout(() => this.onChange(this.active, false), 2200);
  }
}
