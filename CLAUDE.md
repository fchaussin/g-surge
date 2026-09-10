# G-SURGE — instructions for Claude Code

Endless antigrav runner. Three.js r128, two classic scripts, no bundler.
Everything in `public/` is deployed as is to Cloudflare Pages.

Read `docs/ARCHITECTURE.md` before the first non-trivial change.
`docs/TECH-DEBT.md` is the honest state of the codebase.
`docs/ROADMAP.md` says what to do first and in what order.
`docs/GAMEPLAY.md` is the design reference; do not re-derive the numbers.

## Ground rules

- **`public/` is the artefact.** No build step today. Do not introduce a bundler
  as a side effect of another task; that is Phase 1 of the roadmap and it needs
  its own branch.
- **Load order matters.** `engine.js` runs before `game.js`. They are classic
  scripts, so top-level `const` and `let` are shared between them and a name
  declared in both throws at parse time.
- **three.js is pinned to r128.** The code depends on its behaviour. Upgrading
  past r151 changes colour management and lighting defaults and is a re-tuning
  pass, not a version bump.
- **`public/` is frozen legacy.** Do not write anything new there, and do not
  fix anything there either: that work is thrown away at the switch described in
  `docs/ROADMAP.md`. It stays because it is the executable reference until the
  new client reaches parity.
- **`src/` is where the project goes.** `src/sim/` already reproduces tuning,
  track generation and `step()` exactly; `tests/sim-parity.test.ts` replays the
  frozen references against it in Node and they match to the digit. It is not
  wired into the legacy game and never will be — the new client in
  `src/client/` replaces it instead.
- **Two artefacts, two commands, two test targets.** `npm run dev` is the new
  client on 5175, `npm run dev:legacy` the old one on 5173. The e2e suite aims
  at one or the other through `E2E_TARGET`; `next-*.spec.ts` are the specs for
  the new build, everything else is the legacy's. Keep them disjoint.
- **Documents and UI in English, code comments in French.** That is the existing
  convention of this repository, and mixing the two inside one file is worse
  than either.
- **`src/sim/` must run without a browser.** Its `tsconfig.json` drops `DOM`
  from `lib` and empties `types`, so `document`, `window` or `fetch` are
  compile errors, not review comments. ESLint additionally rejects `Math.random`,
  `Date.now` and any `three` import there. The core has to stay replayable in
  Node; that is what makes it testable, and what keeps a server option open.
- **A dockerised dev environment sits alongside**, `Dockerfile` + `compose.yaml`.
  It changes nothing to the sources: the repository is bind-mounted and served
  as is, so a change is a page reload away. The checks below also run inside the
  image with `docker compose run --rm tools <command>`. Note that Phase 1 of the
  roadmap replaces the static server with Vite: `compose.yaml` is part of that
  phase, not a follow-up to it.
- **The simulation is seeded.** Track generation and pickup placement go
  through `makeRng` in `engine.js`, section "1b". A run picks a fresh seed
  unless `?seed=` pins one. Never reintroduce `Math.random` there: the frozen
  references depend on it, and so does every replay feature to come. What stays
  on `Math.random` on purpose is listed in that same section.
- **`makeRng` and `src/sim/rng.ts` are the same algorithm twice.** A Playwright
  test compares three hundred draws from each. Change one without the other and
  it fails, which is exactly the point — it is what will prove the TypeScript
  extraction changes nothing.
- **Verify before claiming.** This codebase has produced several bugs whose
  obvious explanation was wrong. Measure, do not reason from the symptom. Every
  guard rail here was checked by breaking what it protects; three of them were
  found to test nothing at all that way.

## After any change

```
npm run verify
```

It chains five checks, all cheap, and the first two have caught real breakage:

| | |
|---|---|
| `check` | `node --check` on both scripts |
| `check:globals` | concatenates them and re-checks, to catch a name declared in both |
| `typecheck` | `tsc -p src/sim` |
| `lint` | `eslint .` |
| `test` | `vitest run` |

Everything also runs in the image: `docker compose run --rm tools npm run verify`.

End to end, on top, with a real browser:

```
npm run test:e2e            # against the legacy: 53 tests, 3 profiles, ~3 min
npm run test:e2e:next       # against the compiled build: builds first, then runs
npm run test:e2e:update     # regenerate the visual references
npm run fixtures:update     # regenerate the simulation references
npm run verify:all          # verify + test:e2e
```

The frozen simulation references live in `tests/e2e/fixtures/` and regenerate
with `npm run fixtures:update` — never casually: they describe the track over
sixty seeds and the physics over three difficulties, and they are the
behavioural contract of the port in progress.

`test:e2e` runs **on the host only**: the image carries no browser. Visual
references are compared at zero pixel tolerance; a Playwright upgrade changes
text antialiasing and forces a deliberate regeneration. What the suite covers
and, just as important, what it does not, is written at the top of each file in
`tests/e2e/`.

## Where things live

`engine.js`
- `DEFAULTS` / `TUNING`: every tunable value. `DEFAULTS` is the Easy baseline.
- Scene, camera, renderer, `applyRenderScale`.
- Cosmic background: GLSL in `SKY_VS` / `SKY_FS`, on an inverted sphere centred
  on the camera.
- Track generation: `nextNode`, `pushNode`, `seedTrack`, `buildPath`, `sample`,
  `gradeAt`. The ship never moves; the track is rebuilt in front of it.
- Ribbons, gantries, pickups, ship mesh, exhaust plumes, smoke trail.

`game.js`
- Physics `step()`, score, damage, jumps, drift.
- Screens and state machine `setMode`, keyboard navigation, settings, audio,
  haptics, main loop.

`index.html`
- All the CSS, the splash screen and its own inline script, the service worker
  registration.

`docs/ARCHITECTURE.md` goes further; this is only the map.

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
  travel. At 335 m/s and 60 fps that is 11.2 m. Below it the track decomposes and
  it looks like a frame rate problem, which it is not.
- **Shader precision.** Never declare `precision mediump float` in the sky
  shader. The hash loses its spread and stars fuse into large blobs. Let
  three.js apply its default `highp`.
- **`filter: blur` on a 3D transformed element** rasterises at low resolution and
  looks pixelated. Blur in screen space with `backdrop-filter` instead.
- **`MeshLambertMaterial` has no `flatShading`** in r128. Non-indexed geometry is
  already flat shaded; the property only logs a warning.
- **Sprite scale must be clamped.** An age factor out of range produced a
  negative scale, hence a mirrored sprite filling the screen.
- **`resetRun` must clear anything holding a distance.** `clearSmoke()` exists
  because puffs from the attract mode landed in front of the ship after a reset.
- **`setMode` builds keyboard navigation.** The start state must be set by
  calling `setMode('menu')`, not by classes in the HTML alone.
- **Auto quality never turns the background off** and needs several consecutive
  bad measurements. A single dip used to kill the visual signature.
- **Frame rate throttling only skips on an integer ratio of at least two.**
  A 144 Hz display targeting 120 dropped to 72 before that rule existed. The
  target list is now built from the detected refresh rate for that same reason:
  only integer divisions of it are honestly reachable.
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
  payload is 130 KB. The scene graph, the maths and the renderer already come
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

- Anchor edits on unique strings and assert they exist before writing. Several
  earlier sessions lost work because a multi-edit script failed halfway and
  wrote nothing.
- Re-read the file before a second edit to the same region. Line numbers move.
- When a visual bug is reported, reproduce the geometry offline in Node before
  changing the renderer. The camera, the trail and the chevrons were all fixed
  that way, and two of the three had a cause unrelated to the first hypothesis.

## Deploying

Cloudflare Pages, no build command, output directory `public`. `_headers` keeps
`index.html` and `sw.js` uncached. **Bump `VERSION` in `sw.js` whenever a cached
asset changes**, otherwise clients keep the old build.
