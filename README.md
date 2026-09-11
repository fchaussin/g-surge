# G-SURGE

[![CI](https://github.com/fchaussin/g-surge/actions/workflows/ci.yml/badge.svg)](https://github.com/fchaussin/g-surge/actions/workflows/ci.yml)

Endless antigrav runner. TypeScript, Vite, three.js pinned to r128.

## Layout

```
index.html         Vite entry point, markup and all the CSS
src/
  sim/             the simulation — no DOM, no three.js, no Math.cos, runs in Node
  client/          rendering, UI, audio, input, loop
static/            copied verbatim into the build: _headers, manifest, sw.js
tests/
  *.test.ts        Vitest: PRNG, clock, parity against the frozen references
  e2e/             Playwright against the built artefact
scripts/
  serve-static.mjs dependency-free static server, used by the e2e suite
public/            build output, gitignored — what Cloudflare Pages serves
```

## Local

    npm install
    npm run dev          # http://localhost:5173, hot reload
    npm run build        # compiles src/ into public/
    npm run verify       # types, lint, unit tests
    npm run test:e2e     # Playwright, in Docker

`npm run verify` is the command to run after any change; `test:e2e` before
anything that touches rendering or the interface.

**`test:e2e` runs in the official Playwright container, and that is deliberate.**
Interface screenshots are compared at zero pixel tolerance and text rendering
depends on the system's fonts, so the references have to be generated and
verified in one pinned environment — the same image CI uses. `npm run
test:e2e:host` skips Docker for a quick loop, at the cost of failing every
reference that contains text.

`npm run test:e2e:update` regenerates the visual references and
`npm run fixtures:update` the simulation ones. Neither is routine.

The `?seed=` parameter pins the track: `http://localhost:5173/?seed=alpha`
replays exactly the same generation on every load. Without it, each run draws
its own seed.

## Docker

Same thing without installing anything on the machine — Node and Vite live in
the image:

    docker compose up --build          # http://localhost:5173
    docker compose run --rm tools npm run verify
    docker compose run --rm tools npm run build
    docker compose down

Sources are mounted, not copied: an edit is picked up by hot reload, and the
image only needs rebuilding when the `Dockerfile` changes. Change the port with
`GSURGE_PORT=8080`.

The local daemon runs rootless, where uid 0 inside the container is already the
host user, and `compose.yaml` assumes that. On a rootful daemon, run with
`GSURGE_USER="$(id -u):$(id -g)"` so that build output is not owned by root.

Playwright is not in the image. Run `npm run test:e2e` on the host.

## Deploying

Live at <https://g-surge.pages.dev/>, on Cloudflare Pages:

- Build command: `npm run build`
- Build output directory: `public`
- Node version: pinned by `.nvmrc`

`static/_headers` is copied into the build and sets the cache policy: `/`,
`index.html` and `sw.js` are never cached, icons are immutable. The service
worker only registers over https, so it stays out of the way in development,
and `src/client/updates.ts` reloads an installed app when a new version takes
control.

## Docs

| File | What it answers |
|---|---|
| `CLAUDE.md` | Rules for an agent working on this repo, and the traps already paid for |
| `docs/ARCHITECTURE.md` | How it works, and why the ship never moves |
| `docs/TECH-DEBT.md` | Honest state of the codebase, measured |
| `docs/ROADMAP.md` | What to do first, in order, without breaking things |
| `docs/GAMEPLAY.md` | Scoring, difficulty, handling, and the constants that matter |
| `docs/FX-PALETTE.md` | The sensory palette, and the G-SURGE specification in its §16 |
| `docs/TODO.md` | Decisions waiting on the author, with options and a recommendation |

## Known constraints

- three.js is pinned to r128 and bundled from npm. The code relies on r128
  behaviour, see `CLAUDE.md` before upgrading.
- The leaderboard lives in `localStorage` under `gsurge.scores.v2`, a key that tracks
  the scoring rules rather than the release. Private browsing falls back to
  memory for the session.
- Settings are persisted under `gsurge.prefs.v1`; the advanced tuning sliders
  are deliberately not.
- `navigator.vibrate` does not exist on iOS; the haptics switch hides itself.
