/**
 * Le service worker, joué en Node contre des doublures de `self`, `caches` et
 * `fetch`.
 *
 * C'était la dernière pièce du chemin de mise à jour que seul le déploiement
 * vérifiait : la suite de bout en bout tourne en http, où le worker ne
 * s'enregistre pas. Le fichier est du JavaScript ordinaire qui ne touche que
 * quatre globaux, donc on l'évalue tel quel — la version de développement, dont
 * les deux lignes marquées `build:` gardent leurs valeurs de repli — et on lui
 * envoie les trois événements qu'un navigateur lui enverrait.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOT } from './helpers/layout-tables.js';

const SOURCE = readFileSync(join(ROOT, 'static', 'sw.js'), 'utf8');

/**
 * Ce qu'un navigateur fournit et que Node ne fournit pas tel quel : un
 * `Response` dont `type` vaut `basic` — celui de Node dit `default`, et le
 * worker refuse à juste titre de le mettre en cache — et une requête en mode
 * `navigate`, qu'undici interdit de construire. Des objets nus suffisent : le
 * worker ne lit que `method`, `mode`, `url`, `ok`, `status` et `type`.
 */
interface FakeResponse {
  ok: boolean;
  status: number;
  type: string;
  text(): Promise<string>;
  clone(): FakeResponse;
}
function response(body: string, status = 200): FakeResponse {
  const r: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    text: async () => body,
    clone: () => r,
  };
  return r;
}
interface FakeRequest {
  method: string;
  mode: string;
  url: string;
}
const request = (url: string, init: Partial<FakeRequest> = {}): FakeRequest => ({
  method: 'GET',
  mode: 'cors',
  url,
  ...init,
});
const strip = (url: string) => url.split('?')[0]!;

/** Un CacheStorage de poche : des Map de Map, clés par URL. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, FakeResponse>>();
  async open(name: string) {
    let store = this.stores.get(name);
    if (!store) this.stores.set(name, (store = new Map()));
    const s = store;
    return {
      async add(url: string) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`add ${url}: ${res.status}`);
        s.set(url, res);
      },
      async put(req: string | FakeRequest, res: FakeResponse) {
        s.set(typeof req === 'string' ? req : req.url, res);
      },
      async match(req: string | FakeRequest) {
        return s.get(typeof req === 'string' ? req : req.url);
      },
    };
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  /** `caches.match` cherche dans tous les caches, comme le vrai, et honore `ignoreSearch`. */
  async match(req: string | FakeRequest, opts: { ignoreSearch?: boolean } = {}) {
    const url = typeof req === 'string' ? req : req.url;
    for (const s of this.stores.values()) {
      if (s.has(url)) return s.get(url);
      if (opts.ignoreSearch) for (const [k, v] of s) if (strip(k) === strip(url)) return v;
    }
    return undefined;
  }
}

interface Worker {
  self: EventTarget & {
    skipWaiting: ReturnType<typeof vi.fn>;
    clients: { claim: ReturnType<typeof vi.fn> };
  };
  caches: FakeCaches;
  fetch: ReturnType<typeof vi.fn>;
  install(): Promise<void>;
  activate(): Promise<void>;
  request(req: FakeRequest): Promise<FakeResponse | undefined>;
}

/** Charge le worker avec ses globaux remplacés et rend de quoi lui parler. */
function loadWorker(network: (url: string) => FakeResponse | Error): Worker {
  const self = new EventTarget() as Worker['self'];
  self.skipWaiting = vi.fn();
  self.clients = { claim: vi.fn(() => Promise.resolve()) };
  const caches = new FakeCaches();
  const fetchFn = vi.fn(async (input: string | FakeRequest) => {
    const url = typeof input === 'string' ? input : input.url;
    const out = network(url);
    if (out instanceof Error) throw out;
    return out;
  });
  vi.stubGlobal('self', self);
  vi.stubGlobal('caches', caches);
  vi.stubGlobal('fetch', fetchFn);
  vi.stubGlobal('clients', self.clients);
  new Function(SOURCE)();

  const extendable = (type: string, extra: Record<string, unknown> = {}) => {
    const pending: Promise<unknown>[] = [];
    const e = Object.assign(new Event(type), extra, {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
    });
    return { e, done: () => Promise.all(pending) };
  };

  return {
    self,
    caches,
    fetch: fetchFn,
    async install() {
      const { e, done } = extendable('install');
      self.dispatchEvent(e);
      await done();
    },
    async activate() {
      const { e, done } = extendable('activate');
      self.dispatchEvent(e);
      await done();
    },
    async request(req: FakeRequest) {
      let answer: Promise<FakeResponse> | undefined;
      const e = Object.assign(new Event('fetch'), {
        request: req,
        respondWith: (p: Promise<FakeResponse>) => void (answer = p),
      });
      self.dispatchEvent(e);
      return answer ? await answer : undefined;
    },
  };
}

const ok = (body: string) => response(body);
const BASE = 'https://g-surge.test/';
const navigate = (url = BASE) => request(url, { mode: 'navigate' });

afterEach(() => vi.unstubAllGlobals());

describe('the service worker', () => {
  it('precaches each asset on its own, so one missing does not fail the install', async () => {
    const w = loadWorker((url) =>
      url.endsWith('manifest.webmanifest') ? response('', 404) : ok(url),
    );
    await w.install();
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
    const store = w.caches.stores.get('dev')!;
    expect([...store.keys()].sort()).toEqual(['./', './index.html']);
  });

  it('drops every cache but its own on activate, and claims the clients', async () => {
    const w = loadWorker(ok);
    await w.caches.open('gs-old');
    await w.activate();
    expect(await w.caches.keys()).toEqual([]);
    expect(w.self.clients.claim).toHaveBeenCalledTimes(1);
    await w.caches.open('dev');
    await w.caches.open('gs-older');
    await w.activate();
    expect(await w.caches.keys()).toEqual(['dev']);
  });

  it('answers a navigation from the network, bypassing the HTTP cache, and refreshes the shell', async () => {
    const w = loadWorker(() => ok('fresh'));
    const res = await w.request(navigate());
    expect(await res!.text()).toBe('fresh');
    // Par l'URL et avec no-cache : une navigation ne se reconstruit pas, et
    // sans la directive le cache HTTP du navigateur pouvait répondre à la
    // place du serveur — c'est le bug de mise à jour que 1.3.0 a fermé.
    expect(w.fetch).toHaveBeenCalledWith(BASE, expect.objectContaining({ cache: 'no-cache' }));
    expect(await w.caches.match('./index.html')).toBeDefined();
  });

  it('serves the cached shell when a navigation fails offline', async () => {
    let online = true;
    const w = loadWorker(() => (online ? ok('shell') : new TypeError('offline')));
    await w.request(navigate());
    online = false;
    const res = await w.request(navigate());
    expect(await res!.text()).toBe('shell');
  });

  it('is cache-first for assets, stores what the network gave, and ignores the query string', async () => {
    const w = loadWorker(() => ok('bundle'));
    const url = `${BASE}assets/index-abc.js`;
    const first = await w.request(request(url));
    expect(await first!.text()).toBe('bundle');
    expect(w.fetch).toHaveBeenCalledTimes(1);

    await w.request(request(url));
    await w.request(request(`${url}?v=2`));
    expect(w.fetch).toHaveBeenCalledTimes(1); // servi du cache les deux fois
  });

  it('does not cache a failed asset, and leaves non-GET requests alone', async () => {
    const w = loadWorker(() => response('', 500));
    const res = await w.request(request(`${BASE}assets/missing.js`));
    expect(res!.status).toBe(500);
    expect(await w.caches.match(`${BASE}assets/missing.js`)).toBeUndefined();

    const post = await w.request(request(`${BASE}score`, { method: 'POST' }));
    expect(post).toBeUndefined();
  });
});
