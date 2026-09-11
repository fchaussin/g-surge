# G-SURGE — instructions for Claude Code

Endless antigrav runner. TypeScript, Vite, three.js pinned to r128.
`npm run build` compiles `src/` into `public/`, which is what is deployed.

Read `docs/ARCHITECTURE.md` before the first non-trivial change.
`docs/TECH-DEBT.md` is the honest state of the codebase.
`docs/ROADMAP.md` says what to do first and in what order.
`docs/GAMEPLAY.md` is the design reference. Its tables are generated from
`src/sim/tuning.ts` by `npm run docs:tuning` and a test fails if they drift —
do not edit them by hand. The line counts of `ARCHITECTURE.md` and the
oversize table of `TECH-DEBT.md` are generated the same way by
`npm run docs:layout`, and the same test fails if a source module is missing
from the architecture map.
`.claude/rules/versioning.md` says when the version bumps and by how much:
every push that changes the bundle, patch at least.
`docs/NETWORK.md` is the online design: ranked boards and multiplayer as a
layer over the offline game, which stays as it is; what a server can and
cannot prove, and why the client sends a trace, never a score.
`docs/MULTIPLAYER-ROADMAP.md` is its plan, milestone by milestone.
`docs/FX-PALETTE.md` is a resource palette to draw effects from, mainly for
the sense of speed — not a feature backlog. Its own header records what the
code already does, since drift and superboost are implemented and what they
lack is the sensory layer, not the mechanic.

## Ground rules

- **One codebase, compiled.** `src/` is TypeScript, Vite builds it into
  `public/`, and that is what Cloudflare Pages serves. No hand-written
  JavaScript is left in the deployed artefact.
- **`src/sim/` must run without a browser.** Its `tsconfig.json` drops `DOM`
  from `lib` and empties `types`, so `document`, `window` or `fetch` are
  compile errors, not review comments. ESLint additionally rejects
  `Math.random`, `Date.now`, every `Math` transcendental and any `three` import
  there. The core has to stay replayable in Node; that is what makes it
  testable, and what keeps a server option open.
- **The core owns its primitives, it does not borrow the host's.** Randomness
  is `rng.ts`, time is a parameter, and trigonometry is `trig.ts`. `Math.cos`
  looks pure, and is — per engine. ECMAScript does not require correct rounding
  for transcendentals, and Chromium and Node were measured disagreeing on 3 to
  4 % of the arguments a run produces. Use `sin`, `cos` and `atan` from
  `src/sim/trig.ts`; the lint rule will tell you if you forget. See
  `TECH-DEBT.md` §17.
- **The simulation is seeded, and its references are frozen.**
  `tests/e2e/fixtures/` pins track generation over sixty seeds and physics over
  three difficulties. `tests/sim-parity.test.ts` replays them against the
  source in Node, `tests/e2e/bundle.spec.ts` against the built bundle in a
  browser. Neither is regenerated to make a change pass: a change that moves
  them is a change of behaviour and gets its own commit saying so.
- **The two clocks never mix.** `simulate` only ever receives the fixed step,
  `render` only ever the real frame delta. Camera lag, smoke, thrust and every
  other easing use the latter. That separation is the shape of `Loop`.
- **three.js is pinned to r128.** The code depends on its behaviour. Upgrading
  past r151 changes colour management and lighting defaults and is a re-tuning
  pass, not a version bump. It would also not make the game faster — measured,
  see `docs/TECH-DEBT.md` §7.
- **Documents and UI in English, code comments in French.** That is this
  repository's convention, and mixing the two inside one file is worse than
  either.
- **A dockerised dev environment sits alongside**, `Dockerfile` +
  `compose.yaml`. The repository is bind-mounted and Vite runs inside, so a
  change is a reload away. `docker compose run --rm tools npm run verify` runs
  the checks in the image; Playwright does not, the image carries no browser.
- **Verify before claiming.** This codebase has produced several bugs whose
  obvious explanation was wrong. Measure, do not reason from the symptom. Every
  guard rail here was checked by breaking what it protects, and several were
  found to test nothing at all that way.

## After any change

```
npm run verify              # types, lint, unit tests — seconds
npm run test:e2e            # Playwright in Docker, three profiles — minutes
```

Both run in CI on every push and pull request, in `.github/workflows/ci.yml`.

| | |
|---|---|
| `typecheck` | `tsc` on `src/sim`, `src/client` and `tests` |
| `lint` | `eslint .` |
| `test` | `vitest run` — PRNG, clock, and parity against the frozen references |
| `test:e2e` | boot, screens, interface and scene references, plus the bundle check |

`npm run test:e2e:update` regenerates the visual references and
`npm run fixtures:update` the simulation ones. Neither is routine: visual
references move when the interface moves, in a commit that does nothing else,
and simulation references only when behaviour is deliberately changed.

**Visual references are compared at zero pixel tolerance, and generated inside
the official Playwright container.** Text rendering depends on the system's
fonts, so a reference made on a host does not match one made in CI — that is
why `test:e2e` goes through Docker rather than running Playwright directly.
`test:e2e:host` exists for a quick loop and will fail every reference
containing text.

Upgrading Playwright changes the image tag, the antialiasing and therefore all
the references at once. Change `compose.yaml` and the workflow together, and
regenerate in a commit that does nothing else.

## Where things live

`docs/ARCHITECTURE.md` is the map. In short: `src/sim/` is the simulation and
touches nothing else, `src/client/` draws it and plays it, `index.html` holds
the markup and all the CSS, `static/` is copied verbatim into the build.

## The coordinate system, read this first

The ship sits at the world origin facing `+Z` and never moves. The track is
rebuilt in front of it every frame. Consequences:

- World `+X` appears on the **left** of the screen. Steering input is inverted
  on purpose in `step()`.
- There is no heading. A turn is the track bending ahead, so the sky is rotated
  by hand from integrated curvature, otherwise a corner shows no lateral motion.
- Anything left in the world crosses the camera 19 m behind the ship. The smoke
  trail is parented to the ship for exactly that reason.

## Traps already paid for. Do not reintroduce them.

- **Canvas CSS size.** The canvas needs explicit `width:100%; height:100%`. With
  `position:fixed; inset:0` alone, a replaced element keeps its intrinsic size,
  so at devicePixelRatio 2 you see the top-left quarter of the frame. This one
  cost two wrong diagnoses before it was found.
- **Chevron aliasing.** Track markings need a period above twice the per frame
  travel. At 409 m/s — the super boost, which is the real ceiling — and 60 fps
  that is 13.6 m. Below it the track decomposes and
  it looks like a frame rate problem, which it is not.
- **Shader precision.** Never declare `precision mediump float` in the sky
  shader. The hash loses its spread and stars fuse into large blobs. Let
  three.js apply its default `highp`.
- **`filter: blur` on a 3D transformed element** rasterises at low resolution and
  looks pixelated. Blur in screen space with `backdrop-filter` instead.
- **`MeshLambertMaterial` has no `flatShading`** in r128. Non-indexed geometry is
  already flat shaded; the property only logs a warning. The ship hull is built
  from loose triangles for that reason.
- **Sprite scale must be clamped.** An age factor out of range produced a
  negative scale, hence a mirrored sprite filling the screen.
- **A run reset must clear anything holding a distance.** `clearSmoke()` exists
  because puffs from the attract mode landed in front of the ship after a reset.
- **`setMode` builds keyboard navigation.** The start state must be set by
  calling `setMode('menu')`, not by classes in the HTML alone.
- **Presentation state that eases over frames must be reset for a capture.**
  Plume scales, pickup spin and the camera's field of view all converge over
  many frames, so a frozen frame lands wherever the frames before the reset
  left it — however many the page happened to take to load. Three separate
  bugs, all found by tightening a screenshot tolerance to zero.
- **Auto quality never turns the background off** and needs several consecutive
  bad measurements. A single dip used to kill the visual signature.
- **There is no frame rate target and no throttle, by decision.** The game
  renders at whatever the display gives `requestAnimationFrame`, and automatic
  quality adapts the rendering cost to hold that. A target picker and an
  integer-ratio throttle existed and were removed: the machinery served a need
  nobody had, and its subtleties had already produced the 144-asked-for-120-
  landed-at-72 bug once. Do not reintroduce a scheduler; adapt cost, not
  cadence.
- **The simulation runs at a fixed 720 Hz, the rendering does not.** In
  `frame()`, `dt` stays the real frame delta and drives the display smoothing
  — camera, smoke, thrust; the simulation only ever advances by whole `SIM_DT`
  steps. Do not pass `dt` to `step()`, and do not pass `SIM_DT` to the
  smoothing. 720 divides 60, 72, 90, 120, 144 and 240, which is why nothing is
  interpolated; changing it breaks that property.
- **`SIM_EPS` is not cosmetic.** `1/72` and `1/144` are not representable in
  binary, so without it the accumulator periodically yields one step fewer and
  the judder comes back. A test caught exactly that.

## Coding standards for the port

Pragmatic, not doctrinal. A pattern that does not remove a real problem here is
worse than none: it adds indirection for a reader who then has to unwind it.

**The patterns already carrying this codebase.** They were arrived at, not
imposed, and the port must preserve them rather than invent new ones.

- **Ports and adapters.** `src/sim/` depends on nothing — no DOM, no three.js,
  no clock. The client adapts to it, never the reverse. This is enforced by the
  compiler, not by discipline: `src/sim/tsconfig.json` drops `DOM` from `lib`
  and empties `types`. It is what lets the core run in Node, be tested against
  frozen references, and one day be executed by a server.
- **Observer.** `step()` pushes typed events instead of calling `SFX.hit` and
  `flashHalo`. Keep the discriminated union in `events.ts` and let each
  consumer — audio, haptics, HUD — read the ones it cares about. Do not promote
  this into a global publish/subscribe bus; the array is drained once per step
  and that is enough.
- **Command.** Input is data: `{ steer, brake, boost }`, passed in, never read
  from the keyboard by the simulation. That single choice is what makes replay,
  ghosts and server validation possible later. Never let the core reach for an
  input device.
- **Strategy as data.** Difficulty is a table of overrides in `DIFF`, not a
  class hierarchy. Ship profiles, when they come, follow the same shape.
- **Facade.** `Sim` is the one entry point over state, track and step. The
  client should not need to know the three exist.
- **Object pool.** Sprites, ribbons and the track buffers are allocated once and
  rewritten in place. See below.
- **Owned primitives over ambient ones.** Three services the platform offers
  free of charge — randomness, the clock, transcendental maths — are all
  refused, because each lets the host decide part of the result. The core
  carries `rng.ts`, takes time as a parameter, and carries `trig.ts`. The
  general shape: in a deterministic core, an ambient dependency is anything
  whose answer the *specification* does not pin, and purity is not the test —
  `Math.cos` is pure and still varies.

**Rules that come from this game's shape.**

- **No allocation in the frame loop.** The simulation runs at 720 Hz and the
  render at up to 240: a per-frame object is 720 garbage objects a second, and
  the collector pause lands as a visible stutter. Reuse the `SBACK`/`SFRONT`
  style of scratch objects, write into typed arrays, avoid `map`/`filter` on hot
  paths.
- **Pure functions wherever a reference tests them.** The generator, the step,
  the geometry helpers. If a function needs a clock, a random source or the
  DOM to be tested, it is in the wrong layer.
- **Data tables over branches.** `DIFF`, `COIN_GAIN`, `SLIDERS` and `NAV_IDS`
  all read as data. Prefer extending the table to adding a case.
- **Name the unit in the type or the name.** This code mixes m/s, km/h, rad/m
  and rad. Most of the bugs worth fearing here are unit confusions.
- **Modules under 300 lines, one reason to change each.** `game.js` at 1340 is
  the counter-example the split exists to remove.

**Refuse these, explicitly.**

- **An ECS.** There is one ship. It would be architecture for its own sake.
- **A dependency injection container.** Constructor arguments are enough at this
  size, and they are readable.
- **An abstraction over three.js**, in case the renderer is swapped. It will not
  be, and r128 behaviour is depended upon in half a dozen documented places.
- **Class hierarchies over meshes or screens.** Composition and plain data have
  covered every case so far.
- **Premature generality in the network layer.** There is no protocol yet; see
  `docs/ROADMAP.md`.
- **A game engine.** Evaluated, declined, for reasons specific to this game
  rather than taste. Its physics is a two-stage lateral model in track space
  with a ship that never moves, which no rigid-body engine models — they solve
  in world space, the coordinate system this game exists to avoid. There are no
  assets to pipeline: no models, no textures, no audio files, which is why the
  payload is about 160 KB compressed — measured on the 1.4.8 build, most of it
  three.js. The scene graph, the maths and the renderer already come
  from three.js. What is left is roughly 1 700 lines of logic no engine
  provides. Adopting one now would also be a rewrite rather than a port, and
  would destroy the visual and simulation references that make the migration
  safe.

  Three things would change that answer: wanting an editor and hand-authored
  levels; physics becoming generic, with collisions between several bodies; or
  the network layer, where the opposite is already true — when multiplayer
  arrives, do not hand-roll state synchronisation, use Colyseus or Cloudflare
  Durable Objects.

## Editing style that works here

- **Anchor edits on unique strings and assert they exist before writing.**
  Earlier sessions lost work because a multi-edit script failed halfway and
  wrote nothing. The subtler failure is worse and happens more often: a
  replacement whose anchor no longer matches does nothing at all, reports
  success, and leaves a stale document behind. Three wrong figures survived a
  correction that way in a single session. Assert the count, every time.
- Re-read the file before a second edit to the same region. Line numbers move.
- When a visual bug is reported, reproduce the geometry offline in Node before
  changing the renderer. The camera, the trail and the chevrons were all fixed
  that way, and two of the three had a cause unrelated to the first hypothesis.

## Deploying

Live at <https://g-surge.pages.dev/>, on Cloudflare Pages: build command
`npm run build`, output directory `public`, Node pinned by `.nvmrc`.

`static/_headers` is copied into the build and keeps `/`, `index.html` and
`sw.js` uncached — `/` as well as `index.html`, because a navigation asks for
`/` and a rule on the file alone does not cover it.

**Updates reach an installed app through `updates.ts`, not through the worker
alone.** The worker takes control as soon as it is installed, but a page that
stays open for days never re-navigates and would keep its old bundle; the
client re-checks `sw.js` whenever it becomes visible again and, when a new
worker takes control, **announces** it — a bar outside a run, "restart to
update" — and reloads only when the player asks. Nothing reloads on its own.
The first install is not an update and announces nothing.

**The install invitation is a card in the menu, `install.ts`.** It carries a
button where the browser fires `beforeinstallprompt`, the Share → Add to Home
Screen hint on iOS, an "installed on this device, open it from your home
screen" notice when the browser reports the app installed (Chrome, through
`related_applications` in the manifest), and nothing once running installed or
dismissed; the dismissal is a preference. There is no "launch the installed
app" from a tab: no browser has an API for it, so the notice is the most that
can honestly be offered.

**The service worker's precache list and cache name are generated at build
time**, by a plugin in `vite.config.ts` that rewrites two marked lines. The
cache name is the digest of the list, so there is no version to remember to
bump — but the markers must survive: the plugin fails the build if they stop
matching, which is deliberate.

A third, `gs-core-digest`, stamps the digest of `src/sim/` into
`src/client/core.ts` the same way — the key a run's trace carries so a server
replays it with the core that produced it, `docs/NETWORK.md`.

A second plugin, `gs-build-stamp`, writes the build's identity into the splash
the same way and with the same assertion. It is the package version plus the
commit — from `CF_PAGES_COMMIT_SHA` on Pages, from git locally, `DEV` when
neither answers. Still no number anyone maintains: it exists so that a bug
report or a deploy check has something short to quote.

The manifest asks for `landscape`, which an installed app honours; in a tab it
is `Fullscreen` that requests the lock, because that is the only place a
browser accepts one.

It registers only over https, so it stays out of the way in development.
Content hashing makes the cache-first path safe by construction: a changed file
has a different URL and can never be served stale.

Icons are generated from `static/icons/icon.svg` by `npm run icons` and
committed. Edit the SVG, never the PNGs.
