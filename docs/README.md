# G-SURGE — developer notes

The root `README.md` speaks to the player. This one speaks to whoever opens the
repository: how it is laid out, how to run it, how it is deployed, and where
the rest of the documentation is. `CLAUDE.md` at the root is the rulebook — the
ground rules, the traps already paid for, the coding standards — and it applies
to a person as much as to an agent.

## The documentation, and what each file answers

| File | What it answers |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | The rules for working on this repository, and the traps already paid for |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How it works, and why the ship never moves |
| [`GAMEPLAY.md`](GAMEPLAY.md) | Scoring, the ladder, difficulty, handling, damage, fuel — every rule with its number, the tables generated from the tuning |
| [`FX-PALETTE.md`](FX-PALETTE.md) | The sensory palette, and the G-SURGE specification in its §16 |
| [`ROADMAP.md`](ROADMAP.md) | What was done in what order, and what remains |
| [`TECH-DEBT.md`](TECH-DEBT.md) | The honest state of the codebase, measured |
| [`TODO.md`](TODO.md) | Decisions waiting on the author, with options and a recommendation |
| [`GAMEPLAY-FEATURES-SUGGESTIONS_26-09-11.md`](GAMEPLAY-FEATURES-SUGGESTIONS_26-09-11.md) | The gameplay proposal of 11 September 2026, and its arbitration in `TODO.md` |
| [`.claude/rules/versioning.md`](../.claude/rules/versioning.md) | When the version bumps, and by how much |

## Layout

```
index.html         Vite entry point, markup and all the CSS
src/
  sim/             the simulation — no DOM, no three.js, no Math.cos, runs in Node
  client/          rendering, UI, audio, input, loop
static/            copied verbatim into the build: _headers, manifest, sw.js
tests/
  *.test.ts        Vitest: the core, the client modules that run without a browser, the documents' counts
  e2e/             Playwright against the built artefact, and the frozen references
scripts/
  serve-static.mjs dependency-free static server, used by the e2e suite
docs/              this file, and the documents indexed above
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

On Cloudflare Pages. Every push to `main` builds and deploys
<https://g-surge.pages.dev/>; <https://g-surge.w23.fr/> is the same project
under its own domain. The stamp in the menu — version and commit — says which
build is running.

- Build command: `npm run build`
- Build output directory: `public`
- Node version: pinned by `.nvmrc`

`static/_headers` is copied into the build and sets the cache policy: `/`,
`index.html` and `sw.js` are never cached, icons are immutable. The service
worker only registers over https, so it stays out of the way in development,
and `src/client/updates.ts` announces a new version to an installed app — the
player restarts when they choose.

The root README's screenshot is taken by `npm run readme:shot`, in the Playwright
container, from a seeded run; `README_SHOT_SEEDS=a,b,c` shoots several
candidates into `test-results/` to choose from.

## Known constraints

- three.js is pinned to r128 and bundled from npm. The code relies on r128
  behaviour, see `CLAUDE.md` before upgrading.
- The leaderboard lives in `localStorage` under `gsurge.scores.v2`, a key that tracks
  the scoring rules rather than the release. Private browsing falls back to
  memory for the session.
- Settings are persisted under `gsurge.prefs.v1`; the advanced tuning sliders
  are deliberately not.
- `navigator.vibrate` does not exist on iOS; the haptics switch hides itself.
