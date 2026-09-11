/**
 * Le chemin de mise à jour et l'invitation à installer, joués sans navigateur.
 *
 * La suite de bout en bout tourne en http, où le worker ne s'enregistre pas ;
 * ce qui se passe côté page — ne rien annoncer à la première installation,
 * annoncer au changement de contrôleur, ne recharger que sur demande — n'était
 * couvert par rien. Ici `navigator`, `window`, `document` et `location` sont
 * des doublures, et le worker n'existe pas : seule la logique de la page est
 * sous test, ce qui est exactement ce que la suite e2e ne peut pas atteindre.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Updates } from '../src/client/updates.js';
import { InstallPrompt, IOS_HINT } from '../src/client/install.js';

class Bus extends EventTarget {}

function stubBrowser(opts: { controller?: object | null; protocol?: string; ios?: boolean } = {}) {
  const sw = new Bus() as EventTarget & {
    controller: object | null;
    register: ReturnType<typeof vi.fn>;
  };
  sw.controller = opts.controller ?? null;
  const registration = { update: vi.fn(() => Promise.resolve()) };
  sw.register = vi.fn(() => Promise.resolve(registration));

  const win = new Bus();
  const doc = new Bus() as EventTarget & { visibilityState: string };
  doc.visibilityState = 'visible';
  const reload = vi.fn();

  const nav: Record<string, unknown> = { serviceWorker: sw };
  // `standalone` n'existe que sur Safari iOS, et c'est ainsi qu'iOS se reconnaît.
  if (opts.ios) nav.standalone = false;
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('location', { protocol: opts.protocol ?? 'https:', reload });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  return { sw, win, doc, reload, registration };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the update path', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers the worker on load, over https only', async () => {
    const b = stubBrowser();
    new Updates(() => undefined).register();
    expect(b.sw.register).not.toHaveBeenCalled();
    b.win.dispatchEvent(new Event('load'));
    await tick();
    expect(b.sw.register).toHaveBeenCalledWith('sw.js');

    vi.unstubAllGlobals();
    const c = stubBrowser({ protocol: 'http:' });
    new Updates(() => undefined).register();
    c.win.dispatchEvent(new Event('load'));
    await tick();
    expect(c.sw.register).not.toHaveBeenCalled();
  });

  it('announces nothing when the very first worker takes control', () => {
    const b = stubBrowser({ controller: null });
    const seen: boolean[] = [];
    const u = new Updates((r) => seen.push(r));
    u.register();
    b.sw.dispatchEvent(new Event('controllerchange'));
    expect(seen).toEqual([]);
    expect(u.pending).toBe(false);
    expect(b.reload).not.toHaveBeenCalled();
  });

  it('announces once when a new worker replaces one already in control, and never reloads on its own', () => {
    const b = stubBrowser({ controller: {} });
    const seen: boolean[] = [];
    const u = new Updates((r) => seen.push(r));
    u.register();
    b.sw.dispatchEvent(new Event('controllerchange'));
    b.sw.dispatchEvent(new Event('controllerchange'));
    expect(seen).toEqual([true]);
    expect(u.pending).toBe(true);
    expect(b.reload).not.toHaveBeenCalled();
  });

  it('reloads only when the player applies, and only if something is pending', () => {
    const b = stubBrowser({ controller: {} });
    const u = new Updates(() => undefined);
    u.register();
    u.apply();
    expect(b.reload).not.toHaveBeenCalled(); // rien de prêt : rien à faire

    b.sw.dispatchEvent(new Event('controllerchange'));
    u.apply();
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it('counts the first install as a controller once it has happened', () => {
    const b = stubBrowser({ controller: null });
    const u = new Updates(() => undefined);
    u.register();
    b.sw.dispatchEvent(new Event('controllerchange'));
    b.sw.dispatchEvent(new Event('controllerchange'));
    expect(u.pending).toBe(true);
  });

  it('asks the registration to look for a new worker whenever the page becomes visible', async () => {
    const b = stubBrowser();
    new Updates(() => undefined).register();
    b.win.dispatchEvent(new Event('load'));
    await tick();

    b.doc.visibilityState = 'hidden';
    b.doc.dispatchEvent(new Event('visibilitychange'));
    expect(b.registration.update).not.toHaveBeenCalled();

    b.doc.visibilityState = 'visible';
    b.doc.dispatchEvent(new Event('visibilitychange'));
    expect(b.registration.update).toHaveBeenCalledTimes(1);
  });
});

describe('the install invitation', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fireBeforeInstall(win: EventTarget) {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: ReturnType<typeof vi.fn>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    };
    e.prompt = vi.fn(() => Promise.resolve());
    e.userChoice = Promise.resolve({ outcome: 'accepted' as const });
    win.dispatchEvent(e);
    return e;
  }

  it('offers nothing until the browser does, then a prompt, then nothing after the choice', async () => {
    const b = stubBrowser();
    const kinds: string[] = [];
    const install = new InstallPrompt(false, (o) => kinds.push(o.kind));
    expect(install.offer.kind).toBe('none');

    const e = fireBeforeInstall(b.win);
    expect(e.defaultPrevented).toBe(true);
    expect(install.offer.kind).toBe('prompt');

    await install.prompt();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(install.offer.kind).toBe('none');
    expect(kinds).toEqual(['prompt', 'none']);
  });

  it('offers the manual hint on iOS from the start, where no event ever fires', () => {
    stubBrowser({ ios: true });
    const install = new InstallPrompt(false, () => undefined);
    expect(install.offer).toEqual({ kind: 'manual', hint: IOS_HINT });
  });

  it('stays silent once dismissed, once installed, and when already running installed', () => {
    const b = stubBrowser({ ios: true });
    const dismissedBefore = new InstallPrompt(true, () => undefined);
    expect(dismissedBefore.offer.kind).toBe('none');

    const kinds: string[] = [];
    const install = new InstallPrompt(false, (o) => kinds.push(o.kind));
    install.dismiss();
    expect(install.offer.kind).toBe('none');
    fireBeforeInstall(b.win);
    expect(install.offer.kind).toBe('none'); // fermée, l'événement ne la rouvre pas

    vi.unstubAllGlobals();
    const c = stubBrowser();
    const other = new InstallPrompt(false, () => undefined);
    fireBeforeInstall(c.win);
    c.win.dispatchEvent(new Event('appinstalled'));
    expect(other.offer.kind).toBe('none');

    vi.unstubAllGlobals();
    stubBrowser({ ios: true });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone') }));
    const running = new InstallPrompt(false, () => undefined);
    expect(running.offer.kind).toBe('none');
  });

  it('prompting twice does not ask the browser twice', async () => {
    const b = stubBrowser();
    const install = new InstallPrompt(false, () => undefined);
    const e = fireBeforeInstall(b.win);
    await install.prompt();
    await install.prompt();
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });
});
