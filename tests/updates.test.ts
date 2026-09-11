/**
 * Le chemin de mise à jour d'une application installée, joué sans navigateur.
 *
 * La suite de bout en bout tourne en http, où le worker ne s'enregistre pas ;
 * ce qui se passe côté page — ne pas recharger à la première installation,
 * recharger au changement de contrôleur, attendre la fin de la partie — n'était
 * couvert par rien. Ici `navigator`, `window`, `document` et `location` sont
 * des doublures, et le worker n'existe pas : seule la logique de la page est
 * sous test, ce qui est exactement ce que la suite e2e ne peut pas atteindre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Updates } from '../src/client/updates.js';
import { InstallPrompt } from '../src/client/install.js';

class Bus extends EventTarget {}

function stubBrowser(opts: { controller?: object | null; protocol?: string } = {}) {
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

  vi.stubGlobal('navigator', { serviceWorker: sw, standalone: false });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('location', { protocol: opts.protocol ?? 'https:', reload });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  return { sw, win, doc, reload, registration };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the update path', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it('registers the worker on load, over https only', async () => {
    const b = stubBrowser();
    new Updates(() => true).register();
    expect(b.sw.register).not.toHaveBeenCalled();
    b.win.dispatchEvent(new Event('load'));
    await tick();
    expect(b.sw.register).toHaveBeenCalledWith('sw.js');

    vi.unstubAllGlobals();
    const c = stubBrowser({ protocol: 'http:' });
    new Updates(() => true).register();
    c.win.dispatchEvent(new Event('load'));
    await tick();
    expect(c.sw.register).not.toHaveBeenCalled();
  });

  it('does not reload when the very first worker takes control', () => {
    const b = stubBrowser({ controller: null });
    new Updates(() => true).register();
    b.sw.dispatchEvent(new Event('controllerchange'));
    expect(b.reload).not.toHaveBeenCalled();
  });

  it('reloads at once when a new worker replaces one already in control, if nothing is running', () => {
    const b = stubBrowser({ controller: {} });
    new Updates(() => true).register();
    b.sw.dispatchEvent(new Event('controllerchange'));
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the run to end, then reloads once on settle', () => {
    let playing = true;
    const b = stubBrowser({ controller: {} });
    const updates = new Updates(() => !playing);
    updates.register();
    b.sw.dispatchEvent(new Event('controllerchange'));
    expect(b.reload).not.toHaveBeenCalled();

    updates.settle();
    expect(b.reload).not.toHaveBeenCalled(); // toujours en partie

    playing = false;
    updates.settle();
    updates.settle();
    expect(b.reload).toHaveBeenCalledTimes(1); // une seule fois, pas à chaque écran
  });

  it('counts the first install as a control change once it has happened', () => {
    // Première visite : le premier contrôleur ne recharge pas, le second oui.
    const b = stubBrowser({ controller: null });
    new Updates(() => true).register();
    b.sw.dispatchEvent(new Event('controllerchange'));
    b.sw.dispatchEvent(new Event('controllerchange'));
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it('asks the registration to look for a new worker whenever the page becomes visible', async () => {
    const b = stubBrowser();
    new Updates(() => true).register();
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

describe('the install prompt', () => {
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

  it('shows the button when the browser offers to install, and hides it after the choice', async () => {
    const b = stubBrowser();
    const shown: boolean[] = [];
    const install = new InstallPrompt((v) => shown.push(v));
    expect(install.available).toBe(false);

    const e = fireBeforeInstall(b.win);
    expect(e.defaultPrevented).toBe(true);
    expect(install.available).toBe(true);
    expect(shown).toEqual([true]);

    await install.prompt();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(install.available).toBe(false);
    expect(shown).toEqual([true, false]);
  });

  it('hides the button on appinstalled, and does nothing at all when already installed', () => {
    const b = stubBrowser();
    const shown: boolean[] = [];
    new InstallPrompt((v) => shown.push(v));
    fireBeforeInstall(b.win);
    b.win.dispatchEvent(new Event('appinstalled'));
    expect(shown).toEqual([true, false]);

    vi.unstubAllGlobals();
    const c = stubBrowser();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone') }));
    const quiet: boolean[] = [];
    new InstallPrompt((v) => quiet.push(v));
    fireBeforeInstall(c.win);
    expect(quiet).toEqual([]);
  });

  it('prompting twice does not ask the browser twice', async () => {
    const b = stubBrowser();
    const install = new InstallPrompt(() => undefined);
    const e = fireBeforeInstall(b.win);
    await install.prompt();
    await install.prompt();
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });
});
