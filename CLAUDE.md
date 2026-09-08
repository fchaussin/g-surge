# Void Runner — notes for Claude Code

Endless antigrav runner. Three.js r128, plain scripts, no bundler, no framework.
Everything in `public/` is deployed as is.

## Ground rules

- **No build step.** `public/` is the artefact. Do not introduce a bundler
  without being asked; the two scripts rely on sharing top-level declarations.
- **Load order matters.** `engine.js` must run before `game.js`. They are
  classic scripts, not modules, so top-level `const` and `let` are shared
  between them. A name declared in both files throws at parse time. To check:
  `cat public/engine.js public/game.js > /tmp/x.js && node --check /tmp/x.js`.
- **three.js is pinned to r128.** Behaviour differs in later versions and the
  code is calibrated on it. See the r128 traps below.
- After any edit: `npm run check`.
- A dockerised dev environment sits alongside, `Dockerfile` + `compose.yaml`.
  It changes nothing to the sources: the repository is bind-mounted and served
  as is. `docker compose run --rm tools npm run check` is the same check inside
  the image. See the Docker section of the README.

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

## The coordinate system, read this first

The ship sits at the origin facing `+Z` and never moves. The track scrolls past
it. Consequences that trip people up:

- World `+X` appears on the **left** of the screen, because the camera looks
  down `+Z`. Steering input is inverted on purpose in `step()`.
- There is no heading. A turn is the track bending in front of the ship, so the
  sky has to be rotated by hand (`skyYaw`, integrated from curvature × speed)
  or a corner would show no lateral motion at all.
- Anything placed in the world and left behind will cross the camera, which sits
  19 m back. That is why the smoke trail is parented to the ship instead.

## Traps already paid for. Do not reintroduce them.

- **Canvas CSS size.** The canvas needs explicit `width:100%; height:100%`. With
  `position:fixed; inset:0` alone a replaced element keeps its intrinsic size,
  so at devicePixelRatio 2 you see the top-left quarter of the frame.
- **Chevron aliasing.** Track markings must have a period above twice the
  per-frame travel, otherwise the track visually falls apart. At 335 m/s and
  60 fps that is 5.6 m per frame, hence `stripeEvery: 2` for a 24 m period.
- **Shader precision.** Do not declare `precision mediump float` in the sky
  shader. The hash loses its spread and stars fuse into large blobs. Let
  three.js apply its default `highp`.
- **`filter: blur` on a 3D transformed element** rasterises at low resolution and
  looks pixelated. Blur in screen space with `backdrop-filter` instead.
- **`MeshLambertMaterial` has no `flatShading`** in r128. Non-indexed geometry
  is already flat shaded; the property only logs a warning.
- **Sprite scale must be clamped.** A puff whose age factor goes out of range
  produced a negative scale, so a mirrored sprite filling the screen.
- **`resetRun` must clear anything holding a distance**, `clearSmoke()` for
  instance, or leftovers from the attract mode land in front of the ship.
- **`setMode` is what builds keyboard navigation.** The start state has to be
  set by calling `setMode('menu')`, not by classes in the HTML alone.
- **Auto quality never turns the background off** and needs several consecutive
  bad measurements. A single dip used to kill the visual signature of the game.

## Tuning and difficulty

`DIFF` in `game.js` holds three levels. Each one rewrites a subset of `TUNING`
on top of `DEFAULTS`, and carries a score coefficient because a harder level
caps the reachable multiplier. `applyDifficulty` is also what the global reset
calls, so resetting restores the current level rather than Easy.

`renderScale` is a display setting: keep it out of anything that bulk-assigns
`TUNING`.

## Scoring model

Score is the integral of `speed × multiplier × difficulty coefficient`. The
multiplier starts at 1, rises with each coin by an amount that depends on the
speed tier, erodes continuously, erodes half as fast above 1000 km/h, and is
halved by a wall. Distance alone is worth little; that is deliberate.

## Storage

`localStorage`, key `voidrunner.scores.v1`, guarded by a probe because private
browsing throws. Failure falls back to memory for the session. There is no
server side; do not add one without being asked.

## Audio

Everything is synthesised, no files. The engine is filtered noise in three
bands, never oscillators, or it sounds like a piston engine. The context is
created on the first START click to satisfy autoplay policy. The crash builds a
3 s convolution reverb on first use.

## Deploying

Cloudflare Pages, no build command, output directory `public`. `_headers` keeps
`index.html` and `sw.js` uncached so updates land. Bump `VERSION` in `sw.js`
whenever a cached asset changes, otherwise clients keep the old one.
