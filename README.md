# G-SURGE

Endless antigrav runner on three.js r128.

A migration is under way, see `docs/ROADMAP.md`. `public/` is the frozen legacy
version and is what ships today; `src/` is the TypeScript codebase replacing it.

## Layout

```
public/            everything that gets deployed, as is
  index.html       markup, all the CSS, the splash, the service worker hook
  engine.js        scene, track generation, meshes, ship, effects
  game.js          physics, score, screens, input, audio, main loop
  sw.js            offline cache
  manifest.webmanifest
  icons/           MISSING: referenced by the manifest and sw.js, absent from the repo
src/
  sim/             deterministic core, strict TypeScript, no DOM and no three.js
tests/
  *.test.ts        Vitest: PRNG, clock, parity against the frozen references
  e2e/             Playwright: boot, screens, visual and simulation references
scripts/
  build-codepen.mjs  splits the legacy sources into three CodePen panels
  check-globals.mjs  catches a name declared in both engine.js and game.js
  serve-static.mjs   dependency-free static server, used by the e2e suite
```

`public/` still runs on its own and is what Cloudflare Pages serves. `src/sim/`
is proven equivalent to it but is not wired in yet.

## Local

    npm install      # dev tooling only, the game itself has no dependency
    npm run dev      # serves public/ on http://localhost:5173
    npm run verify   # syntax, name collisions, types, lint, unit tests
    npm run test:e2e # Playwright: boot, screens, visual and simulation references

`npm run verify` is the command to run after any change. The five steps are also
callable on their own: `check`, `check:globals`, `typecheck`, `lint`, `test`.
`npm run verify:all` adds the Playwright suite.

End-to-end tests run on the host only, the dev image carries no browser. They
replay three.js from a local copy rather than from cdnjs, so the suite works
offline and a failure points at the game rather than at the network.

`npm run fixtures:update` regenerates the frozen simulation references. It is
not a routine command: those references are the behavioural contract of the
port, see `docs/ROADMAP.md`.

A plain static server is enough. Open over http, not file://, or the service
worker and the manifest are ignored.

The `?seed=` parameter pins the track: `http://localhost:5173/?seed=alpha`
replays exactly the same generation on every load. Without it, each run draws
its own seed.

## Docker

Same thing without installing anything on the machine — Node and the static
server live in the image:

    docker compose up --build          # http://localhost:5173
    docker compose run --rm tools npm run check
    docker compose run --rm tools npm run build
    docker compose down

Sources are mounted, not copied: an edit is served on the next reload, and the
image only needs rebuilding when the `Dockerfile` changes. Change the port with
`GSURGE_PORT=8080`.

The local daemon runs rootless, where uid 0 inside the container is already the
host user, and `compose.yaml` assumes that. On a rootful daemon, run with
`GSURGE_USER="$(id -u):$(id -g)"` so that build output is not owned by root.

The server forces `Cache-Control: no-cache` (`docker/serve.json`); without it
the browser's heuristic cache serves a stale `engine.js`. The service worker
keeps its own copy, but it only registers over https, so it is out of the way on
localhost. On a deployed build, tick *Update on reload* in the Application tab
or bump `VERSION` in `sw.js`.

Playwright is not available in the image. Run `npm run test:e2e` on the host.

## Cloudflare Pages

Connect the repository and set:

- Build command: *(leave empty)*
- Build output directory: `public`

Nothing is compiled. `public/_headers` is picked up by Pages and sets the cache
policy: `index.html` and `sw.js` are never cached, icons are immutable.

## CodePen

    npm run build

Writes `dist/codepen/pen.html`, `pen.css` and `pen.js`. Paste each into its
panel, then add three.js r128 under Settings, JS, Add External Scripts:

    https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js

Fullscreen is refused inside the embedded preview but works in debug view.

## Docs

| File | What it answers |
|---|---|
| `CLAUDE.md` | Rules for an agent working on this repo, and the traps already paid for |
| `docs/ARCHITECTURE.md` | How it works, and why the ship never moves |
| `docs/TECH-DEBT.md` | Honest state of the codebase, measured |
| `docs/ROADMAP.md` | What to do first, in order, without breaking things |
| `docs/GAMEPLAY.md` | Scoring, difficulty, handling, and the constants that matter |

## Known constraints

- three.js is pinned to r128 and loaded from cdnjs. The code relies on r128
  behaviour, see CLAUDE.md before upgrading.
- The leaderboard lives in `localStorage` under `gsurge.scores.v1`. A board
  written under the previous name, `voidrunner.scores.v1`, is picked up once and
  the old key removed. Private browsing falls back to memory for the session.
- Settings are not persisted at all yet. That is deliberate for now: fixing it
  in the legacy files would be thrown away at the switch.
- `navigator.vibrate` does not exist on iOS, the haptics switch hides itself.
