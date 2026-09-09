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
- **`src/` is the refactor, `public/` is still the game.** The migration is
  staged: `src/sim/` holds the deterministic core in TypeScript, `public/` keeps
  running the shipped classic scripts until the client split lands. Both are
  checked by `npm run verify`. Do not wire one into the other halfway.
- **The core is ported but not yet plugged in.** `src/sim/` reproduces tuning,
  track generation and `step()` exactly; `tests/sim-parity.test.ts` replays the
  frozen references against it in Node and they match to the digit. Until the
  client split, a change to the simulation has to land on **both sides** — the
  parity test is what says so, immediately.
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
  through `makeRng` in `engine.js`, section « 1b ». A run picks a fresh seed
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
npm run test:e2e            # Playwright, 33 tests, 3 profils, ~2 min
npm run test:e2e:update     # régénère les références visuelles
npm run verify:all          # verify + test:e2e
```

Les références figées de simulation vivent dans `tests/e2e/fixtures/` et se
régénèrent avec `npm run fixtures:update`, jamais à la légère : elles décrivent
la piste sur soixante graines et la physique sur trois difficultés.

`test:e2e` ne tourne **que sur l'hôte** : l'image ne contient pas de navigateur.
Les références visuelles sont comparées à zéro pixel de tolérance ; une montée
de version de Playwright change l'anticrénelage du texte et impose de les
régénérer sciemment. Ce que la suite couvre et, tout aussi important, ce qu'elle
ne couvre pas, est écrit en tête de chaque fichier de `tests/e2e/`.

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
