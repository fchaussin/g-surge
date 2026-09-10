# Technical debt

Measured on the current tree, not estimated. Every number below came from
scanning the sources. Severity is about risk of breaking something or of
slowing future work, not about how ugly it looks.

Read `ROADMAP.md` first: `public/` is now frozen legacy, so several items below
are not going to be fixed where they stand — they disappear with the file.

## Summary

| # | Item | Severity | Status |
|---|---|---|---|
| 1 | No module system, 251 shared global bindings | High | dies with the legacy |
| 2 | Legacy engine reads game state | Medium | reduced to one symbol |
| 3 | No tests at all | Medium | largely covered |
| 4 | Variable time step physics | — | **done**, fixed 720 Hz |
| 5 | Settings are not persisted | Medium | open, roadmap step 6 |
| 6 | 69 hardcoded DOM ids, no UI layer | Medium | dies with the legacy |
| 7 | three.js pinned to r128 from 2021, no SRI | Medium | SRI dies with the bundler |
| 8 | No types, no JSDoc | Medium | done in `src/sim/` |
| 9 | `step()` is 176 lines, `frame()` is 136 | Medium | done in `src/sim/` |
| 10 | Accessibility is absent | Medium | open, roadmap step 6 |
| 11 | 38 of 70 tuning keys unreachable from the UI | Low | open |
| 12 | Dead code | Low | open, roadmap step 6 |
| 13 | No lint, no formatter, no CI | Low | lint and types done, no CI |
| 14 | All strings hardcoded in English | Low | open |
| 15 | Reverb built on the main thread | Low | open, roadmap step 6 |
| 16 | Missing PWA icons | Medium | open, roadmap step 5 |

## 1. No module system

`engine.js` declares 94 top-level bindings, `game.js` declares 157. All 251 live
in the same lexical scope because they are classic scripts. Consequences:

- A name declared in both files is a parse error that only shows at runtime.
- Nothing states what `game.js` needs from `engine.js`.
- No dead code elimination, no minification, no code splitting.

The guard rail is `npm run check:globals`, which concatenates the two files and
re-parses them. It catches collisions and nothing else. Both the guard rail and
the problem disappear when the legacy files do.

Note that an earlier revision of this document said 178 bindings. That was a
count of declaration *statements*: a single line like
`const COUNT = 130, SEG = 12, BACK = 10, HALF = 11.5, SHIP = 1.9;` declares five.

## 2. The legacy engine reads game state

`engine.js` reads exactly one symbol that `game.js` owns, `state`, over nine
sites and three properties: `state.speed` in `coinTier` and `updateSmoke`,
`state.halo` and `state.haloPow` in the halo helpers. Load order says engine
comes first, so this only works because the reads happen inside functions called
later.

`sample` and `gradeAt` used to read `state.cursor` as well; they now take it as
an argument. In `src/sim/` the problem does not exist: `halo` is an event and
`coinTier` takes the speed.

An earlier revision claimed three symbols, `state`, `step` and `L`. The other
two were false positives — `step` is the GLSL builtin in the sky shader, `L` is
a vertex label in the ship geometry table.

## 3. Tests

There were none. There is now a net:

- Playwright, 53 tests over three profiles: boot, canvas geometry at
  `devicePixelRatio` 2, state machine, keyboard navigation, visual references of
  the screens at zero pixel tolerance.
- Frozen references for track generation over sixty seeds and for physics over
  three difficulties, captured by `__gs.trace` at fixed step. Each was validated
  by deliberately breaking what it protects: a physics constant, a generation
  probability to one percent, and a PRNG misalignment all bring down the
  matching reference.
- Vitest on `src/sim/`: the PRNG, the clock, and parity against those
  references.

Still missing:

- `buildPath` and `sample`, the geometric core, are only covered indirectly.
- The frame rate governor, which already had the bug where a 144 Hz display
  targeting 120 dropped to 72, is not covered at all.
- No pixel reference of the 3D rendering: the canvas is excluded from the
  screenshots. That is now only a matter of adding a hook that renders after a
  fixed number of steps, since the simulation itself is deterministic.

A known resolution limit, measured: swapping the two lateral terms of `step` — a
pure floating point reassociation — shifts `latVel` by about 4e-16 over 1800
steps without amplifying, and is not detected. The references catch behavioural
changes, not numerically equivalent rewrites.

## 4. Time step — done

The simulation now advances in fixed 1/720 s steps. Measured before the switch,
over fifteen seconds of play: 6.6 m of divergence between 60 and 144 Hz, and at
30 Hz the trajectory deviated enough to collect different coins. Every machine
now simulates the same thing.

720 is the smallest integer divisible by 60, 72, 90, 120, 144 and 240, so a
frame always lands on an exact simulation state and the rendering needs no
interpolation. See `src/sim/clock.ts` for the full reasoning, and
`ARCHITECTURE.md` for the residual on 75 and 165 Hz.

## 5. Settings are not persisted

Only scores are stored. Difficulty, reversed layout, sound, haptics, tips,
background quality, frame rate target and render scale all reset on every
reload. This is the single most visible gap for a returning player.

It is deliberately not being fixed in the legacy files: that work would be
thrown away at the switch. Roadmap step 6.

## 6. DOM coupling

70 `getElementById` calls over 69 distinct ids, plus 11 `querySelector` calls,
spread through `game.js`. The ids exist in three places at once: the HTML, the
lookup, and often a CSS rule.

There is no UI module. Screen logic, settings generation, audio switches and
HUD updates are interleaved in the same file. Roadmap step 3 splits them.

## 7. three.js r128

Released April 2021, against 0.186.0 current. It is pinned deliberately: the
code depends on r128 behaviour, including `MeshLambertMaterial` ignoring
`flatShading` and the absence of colour management. Upgrading is a real project,
not a version bump, because r152 made sRGB output and physically-based light
units the default, which shifts every colour in a hand-tuned neon palette.

**Upgrading would not make it faster, and that was measured.** In a live run at
1280×720:

| | |
|---|---|
| Draw calls per frame | 76.5 |
| Triangles per frame | 5 591 |
| GLSL programs | 9 |
| Share of frame time spent on the sky | 46 % |

Seventy-six draw calls and five thousand triangles are two orders of magnitude
below where a renderer's CPU overhead starts to matter, so the parts of three.js
that got faster — batching, instancing, uniform upload — have nothing to work
on here. The cost is fill rate, and close to half of it is our own sky fragment
shader, which no version of three.js touches. The levers that would actually
work are fewer fbm octaves, rendering the sky to a half-resolution target, and
`renderScale`, which already exists and which auto-quality already uses.

There are honest reasons to upgrade eventually — a five-year-old dependency,
and WebGPU — but performance is not one of them, and the visual references that
guard the port would have to be regenerated against a moving target. Do it as
its own project, after the switch.

The CDN script tag has no `integrity` attribute, so a compromised cdnjs would
execute arbitrary code. The fix is not to add SRI but to take the package from
npm at `0.128.0` and bundle it, which roadmap step 1 does.

**Bundling barely shrinks the payload, and that was measured too.** An earlier
revision of this section claimed tree-shaking would cut the 603 KB CDN script
down to the twenty-odd symbols the game imports. It does not: r128's
`three.module.js` is monolithic and its internals cross-reference each other,
so the renderer drags in the materials, the geometries and the rest. Built with
Vite, `import * as THREE` and named imports produce byte-identical output. The
real figures are 589 KB raw and 150 KB gzipped for the CDN file, against 515 KB
raw and 131 KB gzipped for the whole bundle, game included. Nineteen kilobytes
over the wire.

Bundle for the right reasons — no third-party script to seal, one dependency
graph, a build that can be typechecked — not for the payload.

## 8. Types

70 tuning keys, a `state` object with 27 fields, and geometry helpers returning
bare objects with eleven properties. In `src/sim/` all of it is typed under
`strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. In the
legacy files nothing is, and nothing will be.

## 9. Long functions

`step()` is 176 lines and does input, boost, difficulty erosion, distance,
jumps, lateral dynamics, walls, pickups and damage. `frame()` is 136. In
`src/sim/` the step is split across `step.ts`, `track.ts` and `tuning.ts`; the
frame loop is split at roadmap step 3.

## 10. Accessibility

No `aria-pressed` on the eight custom toggles, no `role="radiogroup"` on the two
segmented controls, no `prefers-reduced-motion` handling despite a splash screen
and a HUD full of animation. Damage, boost tier and difficulty are all signalled
by colour alone. The keyboard navigation is custom and hijacks Tab.

An earlier revision said nine toggles and three segmented controls. Roadmap
step 6.

## 11. Tuning coverage

70 keys in `DEFAULTS`, 32 exposed as sliders. The 38 hidden ones include things
a designer will want first: camera distance and height, field of view, coin
pickup radius, jump gravity, damage from scraping, boost minimum. They are
reachable from the console through `window.TUNING` but nothing says so.

## 12. Dead code

- `fmtM` is declared and never called. It was orphaned when the score screen
  moved from metres to points.
- `TUNING.coinValue` survives in `DEFAULTS` but nothing reads it since coins
  started feeding the multiplier instead of a fixed bonus.
- Six ids exist in the HTML that no script reads: `boot`, `bootBar`,
  `bootLabel`, `diffEasy`, `diffMedium`, `diffHard`. The first three are used by
  the inline splash script, the last three only by CSS, but that is not obvious.

## 13. Tooling

Lint, types and tests are in place behind `npm run verify`, and Playwright
behind `npm run test:e2e`. There is still no formatter and, more importantly,
**no CI**: a push can break the build and nothing will say so. Roadmap step 9.

## 14. Strings

Every label is inline, split between the HTML and two JavaScript tables
(`TIPS`, `SLIDERS`, `DIFF`). Localising means touching all three. `src/sim/`
deliberately keeps none: difficulty labels and notes stayed with the UI.

## 15. Reverb on the main thread

The 3 s impulse response is 288000 samples over two channels, generated with a
`Math.random` loop the first time the player crashes. That is a visible hitch at
the worst possible moment. Generate it during the run or offload it.

## 16. Missing PWA icons

`public/icons/` does not exist and never has. `manifest.webmanifest` points at
three icons and `sw.js` lists four in its cache manifest, so all of them 404.
The service worker survives — each asset is cached inside its own try/catch —
but the installed app has no icon. Roadmap step 5.

## What is deliberately not debt

- **The ship at the origin** is unusual but correct, it removes a whole class of
  precision bugs, and it is what makes several ships on one track cheap later.
- **Synthesised audio** keeps `public/` at 130 KB with no asset pipeline.
- **`MeshBasicMaterial` everywhere** is what makes the neon look work and keeps
  the fragment cost low.
- **No bundler** was a defensible choice for two files and zero dependencies. It
  stopped being one, which is what `ROADMAP.md` is about.
