# Void Runner — instructions for Claude Code

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
- **A dockerised dev environment sits alongside**, `Dockerfile` + `compose.yaml`.
  It changes nothing to the sources: the repository is bind-mounted and served
  as is, so a change is a page reload away. The checks below also run inside the
  image with `docker compose run --rm tools <command>`. Note that Phase 1 of the
  roadmap replaces the static server with Vite: `compose.yaml` is part of that
  phase, not a follow-up to it.
- **Verify before claiming.** This codebase has produced several bugs whose
  obvious explanation was wrong. Measure, do not reason from the symptom.

## After any change

```
npm run check                                     # syntax, both scripts
cat public/engine.js public/game.js > /tmp/x.js
node --check /tmp/x.js                            # no name collision
```

Both are cheap and both have caught real breakage.

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
  A 144 Hz display targeting 120 dropped to 72 before that rule existed.

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
