# Technical debt

Measured on the current tree, not estimated. Every number below came from
scanning the sources. Severity is about risk of breaking something or of
slowing future work, not about how ugly it looks.

Several items below were retired by the switch rather than fixed: they
described the hand-written classic scripts, which no longer exist. They are
kept, struck through, because the numbering is referenced elsewhere and because
what a codebase stopped having is worth knowing.

## Summary

The switch retired seven items outright: they described the hand-written
classic scripts, and those are gone.

| # | Item | Severity | Status |
|---|---|---|---|
| 1 | No module system, 251 shared globals | — | **gone with the legacy** |
| 2 | Engine reads game state | — | **gone with the legacy** |
| 3 | No tests at all | Low | largely covered, gaps below |
| 4 | Variable time step | — | **done**, fixed 720 Hz |
| 5 | Settings are not persisted | — | **done** |
| 6 | Hardcoded DOM ids, no UI layer | Low | halved: modules split, ids remain — and are reconciled by a test |
| 7 | three.js pinned to r128, no SRI | Low | SRI gone with the CDN; the pin stands |
| 8 | No types | — | **gone**, the codebase is TypeScript |
| 9 | Long functions | — | **gone with the legacy** |
| 10 | Accessibility is absent | Low | mostly done, colour-only signals remain |
| 11 | Tuning coverage | Low | most keys on sliders, the rest live on the console — counted in §11 |
| 12 | Dead code | — | **gone with the legacy** |
| 13 | No lint, no formatter, no CI | — | **done** |
| 14 | All strings hardcoded in English | Low | deferred by decision |
| 19 | Documents state figures nothing checks | — | **closed** for `GAMEPLAY.md` and for the counts of the tree |
| 15 | Reverb built on the main thread | — | **done**, built on the first gesture |
| 16 | Missing PWA icons | — | **done** |
| 17 | `Math` transcendentals are not bit-identical across engines | — | **done**, the core carries its own |
| 18 | Service worker cannot name a hashed bundle | — | **done**, generated at build |
| 20 | Modules over the 300-line rule | Low | seven; `main.ts` split from 824 to 517, the rest one thing each |
| 21 | Comment language | — | **done**, every code file is French; interface and documents stay English |
| 22 | The generated track can cross itself | Medium | measured, not fixed — four approaches tried, see `TRACK-CROSSING.md` |

## 3. Tests

There were none. There is now a net:

- Playwright, 66 tests over three profiles, of which 6 are skipped because
  the scene references run on the desktop profile alone: boot, canvas geometry at `devicePixelRatio` 2,
  state machine, keyboard navigation, visual references of the screens at zero
  pixel tolerance, the bundle replayed against the frozen traces, and the
  core's trigonometry compared between Chromium and Node.
- Frozen references for track generation over sixty seeds and for physics over
  three difficulties, captured by `__gs.trace` at fixed step. Each was validated
  by deliberately breaking what it protects: a physics constant, a generation
  probability to one percent, and a PRNG misalignment all bring down the
  matching reference.
- Vitest, one file per concern under `tests/`: the PRNG, the clock, the
  trigonometry and parity against those references on the core; the event
  emission, the speed tiers, the climb, the earned super boost and the surge, which the frozen
  traces cannot see; on the client side the quality governor, the drift scale
  and the spray envelope, the gauge's layers, the feedback observer against
  doubles, the camera's aspect fit and the preferences' sanitiser — every
  presentation module that can be reached without a browser; and two that
  read the tree as text — the documents' counts and the element ids shared
  with `index.html`; and the service worker, evaluated as a file against fake
  caches.

Formerly listed as missing, and closed since:

- `buildPath` and `sample` are pinned directly by the `track-geometry`
  reference, replayed in Node against the source.
- The frame governor has eleven tests over the median-based detection and
  the quality stepping with its floor and ordering, validated by mutation — a
  mean for the median and cutting the background both fail by name. The frame
  rate target and its throttle were then removed outright: the game renders at
  the display's native rate and quality adapts to hold it, which retires the
  144-asked-for-120-got-72 class of bug rather than guarding it.
- Full-frame pixel references of the 3D rendering exist, at zero tolerance,
  via `__gsNext.freeze`.
- The core's trigonometry is pinned by known-answer vectors and replayed in a
  browser against Node, validated by mutation: swapping two quadrants, dropping
  the second reduction round, moving a `kernelCos` threshold and removing the
  tiny-argument early return each bring down a named test. A one-ULP change to a
  polynomial coefficient does not, and provably cannot — measured at zero
  differing results over three million arguments, because fdlibm's coefficients
  carry more precision than the double result can express.

Closed since, and worth naming because nothing announced it: the frozen traces
cover 1 345 m and a super boost appears every 6 300 m, so the `superOn` branch
of `step()` was outside every reference. `supFactor` moved from 1.08 to 1.22
without a single one changing. `tests/speed.test.ts` now pins the three tiers
and brackets the value on both sides — below, the top rung stops being worth
taking; above, it crosses the ceiling `audio.ts` clamps the engine to.

Still missing:

- The interface modules — settings, HUD, screens — are covered only through
  the browser, never in isolation. Narrowed on 11 September 2026: the gauge's
  layer arithmetic left `hud.ts` for `ladder.ts`, a pure function with its own
  tests, and `settings.ts` and `screens.ts` export their id tables to
  `tests/dom-ids`. `feedback.ts` runs against counting doubles, the camera's
  aspect fit and the preferences' sanitiser are exported to be tested as the
  pure functions they are. What the DOM writes themselves do is still
  browser-only.

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

## 5. Settings — done

Difficulty, reversed layout, sound, haptics, tips, background and its detail,
render scale and the frame counter are kept under `gsurge.prefs.v1`. A
`frameTarget` stored by an earlier version is silently dropped: the sanitiser
rebuilds the object field by field, so retired keys cannot linger. Writes are coalesced and flushed on `pagehide`, since a
closing tab never runs a pending timer and mobile browsers may skip `unload`
entirely.

Every field is validated on read. Storage is shared with anything else on the
origin and outlives any one version of this code, so what comes out of it is
untrusted: a bad value is dropped for its default rather than allowed to
produce a game with a negative render scale.

The advanced tuning sliders are deliberately **not** persisted. They are a
workshop, not a preference, and a value nudged once and forgotten would follow
someone through every later session with no obvious way back. Render scale is
the exception, because it describes the machine rather than the game.

## 6. DOM coupling, halved

The interface is split into `hud.ts`, `screens.ts`, `settings.ts` and
`sliders.ts`, each with one reason to change, and the settings rows are
generated from a table rather than written as markup.

What remains is the ids themselves: seventy-odd string literals shared
between `index.html` and the modules that look them up, so renaming one is
still a two-place edit. Since 11 September 2026 it is a two-place edit that
`tests/dom-ids.test.ts` checks: every id the client looks up must be declared,
every id declared must be referred to by something — the client, the
stylesheet, the splash's inline script or the end-to-end suite — and none may
be declared twice. Text only, in Node, in milliseconds. It found no defect on
the current tree; it did find one id pair, the settings tabs, built from a
template at runtime, which it could not see and which is now spelled out.

The coupling itself stands, and is not worth a layer: seventy ids behind an
accessor would be seventy accessors.

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

The `integrity` problem went away with the CDN script tag: the package comes
from npm and is bundled.

**Bundling barely shrank the payload, and that was measured.** An earlier
revision claimed tree-shaking would cut the 603 KB CDN script down to the
twenty-odd symbols the game imports. It does not: r128's `three.module.js` is
monolithic and its internals cross-reference each other, so the renderer drags
in the materials, the geometries and the rest. Named imports and
`import * as THREE` produce byte-identical output.

Measured: 603 KB raw and 149 KB gzipped for the CDN file alone, against
565 KB and 147 KB for the whole bundle, game included. The
figures in an earlier revision of this paragraph were wrong, which is its own
small lesson: a replacement without an assertion had silently matched nothing.

The bundle was worth it for the other reasons — no third-party script to seal,
one dependency graph, a build that can be typechecked — not for the payload.

## 10. Accessibility, mostly done

`aria-pressed` on the eight toggles, `role="radiogroup"` and `role="radio"` with
labels on the two segmented controls, and a `prefers-reduced-motion` block that
stops the HUD pulses and every transition while leaving the game itself
running — stopping that would not be an accessibility win but a refusal to
run.

What remained was that damage, boost tier and difficulty were signalled by
colour alone. Re-read on 11 September 2026, most of that has moved without
being aimed at: the hull bar is a *length* first, its hue second, and it pulses
under 22; the thrust rung is a stacked height on the gauge, a pitch register in
the charge voice, a plume length on the ship and a speed on the readout, with
colour as one channel among five; difficulty is three labelled radio buttons.
What is still colour alone is the multiplier's colour, which repeats the rung
the gauge already shows. The coin is no longer: it grows 16 % per rung with its
hue (`coinScale` in `pickups.ts`), so which rung it pays for is told by size as
well as colour before it is taken. Both are minor, and a shape per coin tier
remains the obvious next step if it ever matters.

The keyboard navigation is custom and hijacks Tab; that stands.

## 11. Tuning coverage

Generated by `npm run docs:layout`, because this section, the summary table
above and the header of `sliders.ts` once carried three different pairs of
figures and the tree agreed with none of them:

<!-- generated:coverage -->
| | |
|---|---|
| Keys in `DEFAULTS` | 98 |
| Exposed as sliders | 49 |
| Reachable only through `__gsNext.tuning()` | 49 |
<!-- /generated:coverage -->

The eight the previous revision named as what a designer wants first — camera
distance and height, field of view and its speed gain, pickup radius, jump
gravity, scrape damage, boost minimum — are on the Advanced tab now.

The rest are reachable **live** through `window.__gsNext.tuning()`, which
mutates the running game. That capability had quietly died at the switch: the
legacy exposed `window.TUNING` and the port only handed out a copy of the
defaults, so the console tweaking this document promised did nothing.
Restored, and this time the docs say where it lives.

What keeps this item open at Low: the keys off the panel are mostly
fine-grained generation constants and internal thresholds, and a panel that
carries every one would bury the ones that matter. The line is judgement, not
tooling.

## 13. Tooling

Lint, types, format and tests run behind `npm run verify`, Playwright behind
`npm run test:e2e`, and both run in CI on every push and pull request.
Formatting is Prettier at the repository's width. Three deliberate exclusions,
each explained in `.prettierignore` — and the two marked lines in
`static/sw.js` are pinned with `prettier-ignore`, because the build plugin
replaces them with a single-line regex that a reformat would have half-matched
into a broken service worker.

The end-to-end job runs inside the official Playwright container, which is also
where the references are generated. That is not a convenience: interface
screenshots are compared at zero pixel tolerance and text rendering depends on
the system's fonts, so a reference made on a developer's machine does not match
one taken on a runner. Pinning the image is what lets the tolerance stay at
zero instead of being loosened until it catches nothing — which this project
has already done once by accident.


## 14. Strings

Every label is inline, split between `index.html` and three tables
in `src/client/` — `tips.ts`, `sliders.ts` and the difficulty blurbs in
`settings.ts`. Localising means touching all four. `src/sim/` deliberately
holds none of them.

**Deferred by decision, not by neglect.** Extracting a string table with no
second language in sight is the same speculative generality this project
refuses elsewhere — a layer of indirection every reader pays for, serving a
need nobody has expressed. The day localisation is wanted, the work is
mechanical and this paragraph says where all four homes are. Until then the
item stays here so the decision is visible, not silently forgotten.

## 16. PWA icons — done

`static/icons/` now holds an SVG source and the four PNGs the manifest and the
Apple meta tag ask for, rasterised from it by `npm run icons`. The SVG doubles
as the favicon, which browsers that understand it scale to any size.

The mark is the game's own silhouette — a track receding under a gantry —
rather than a letter, because a wordmark is unreadable at the 48 pixels a
browser tab actually gives it.

## 17. Transcendentals are not bit-identical across engines — done

ECMAScript does not require correct rounding for the transcendental `Math`
functions. Each engine picks an implementation, and two engines can return a
different last bit for the same argument. `Math.cos` looks pure — it is pure,
for a given engine — but it is not *specified*, which makes it exactly the same
kind of leak as `Math.random` and `Date.now`: a dependency on the host, sitting
inside a core whose determinism is the property that makes it replayable and
arbitrable by a server.

**The earlier measurement here was too small to support what it concluded.** It
sampled four track yaw values, found two `cos` disagreements and no `sin` one,
and wrote down "cos yes, sin no". Measured properly — 4 000 arguments drawn
across the range a run actually produces, the browser against Node, in
`tests/e2e/trig.spec.ts`:

| | sin | cos | atan |
|---|---|---|---|
| Chromium vs Node, \|x\| < 45 | 3.8 % | 3.3 % | 3.1 % |
| Chromium vs Node, \|x\| < 1000 | 4.0 % | 3.5 % | 0.1 % |

`sin` drifts as much as `cos`, and `atan`, which the old entry never mentioned,
drifts too. The four-sample figure was the same species of error as the one
§19 exists for.

### What was done

`src/sim/trig.ts` carries the core's own `sin`, `cos` and `atan`, and ESLint
rejects the whole `Math` transcendental family inside `src/sim/`. The module is
a port of fdlibm and uses only `+ - * /`, comparisons and bit reads —
operations ECMAScript specifies as IEEE 754 binary64, round-to-nearest-even,
with no FMA and no extended precision. Their results are identical on every
conforming engine, so the transcendental becomes a sequence of steps that
cannot vary.

- **Nothing moved.** fdlibm is also what V8 derives `Math` from, so on this
  engine the two agree bit for bit: measured at 100 % over 3.06 million
  arguments, including every value a run produces. The frozen references —
  physics, track, geometry, and the full-frame scene captures at zero pixel
  tolerance — all passed unchanged. This was not a behavioural change, and it
  did not need to be one.
- **The claim is tested where it lives.** `tests/trig.test.ts` pins the results
  against frozen bit patterns rather than against `Math`, because comparing to
  `Math` would put the dependency straight back into the net.
  `tests/e2e/trig.spec.ts` runs the shipped bundle in Chromium and checks it
  returns Node's bits.
- **Cost, measured**: `buildPath` went from 4.3 to 10.5 µs and `sample` from 37
  to 124 ns; `step` moved 4 %. At 240 fps that is 0.36 % of a core against
  0.19 %. The obvious optimisation was the wrong one — a `Uint32Array` view over
  the double is 8× *slower* than `DataView` here, so `DataView` stayed, and it
  is also the one that does not depend on the machine's endianness.

### What is left of the item

- **Domain.** The port is faithful to fdlibm's medium path, |x| < 2^20·π/2
  ≈ 1.6e6 rad. Beyond that fdlibm switches to a Payne-Hanek reduction that is
  deliberately not ported: results there stay perfectly deterministic, they
  merely lose accuracy. A run reaches 44 rad, and the yaw cannot grow — the
  ribbon is rebuilt from the ship every frame.
- **The frozen references still round**, physics at 1e-6 and geometry at 1e-9.
  Not for this reason any more: they were captured from the legacy, which did
  call `Math`, and rounding is what lets that historical capture keep being
  replayed.
- **Server validation is unblocked but not free.** A Node replay of a browser
  run now agrees bit for bit through the core, which is what an equality check
  needs. Two things still have to be settled in the multiplayer specification:
  the client can be modified, so an equality check proves reproduction and not
  honesty; and anything the server compares must come from the core, never from
  presentation code, which is under no such discipline.

Same-engine determinism was never in question: a given build always agreed with
itself, which is what the seeded PRNG and the fixed step guarantee.

## 18. Service worker precache — done

A Vite plugin walks the build output and rewrites two marked lines in `sw.js`:
the asset list, and the cache name. Both replacements assert, so a marker that
stops matching fails the build rather than silently leaving the previous list.

The cache name is the digest of the list, so it changes if and only if an asset
changes. That retires the rule that used to sit in `CLAUDE.md` — there is no
`VERSION` left to remember to bump.

One bug worth remembering from writing it: the dotfile filter ran on paths that
had already been prefixed with `./`, so every path looked like a dotfile and
the list came out empty. The build reported success.

A second, found by use on 11 September 2026: an installed app did not pick up
new versions. The worker was right — `skipWaiting` and `clients.claim` on
install — and the page was wrong: an installed app stays open for days, never
re-navigates, so the browser never re-checks `sw.js`, and when a new worker did
take control the page kept its old bundle with nothing to tell it. Three
fixes, all outside the worker's own logic: `updates.ts` re-checks the
registration whenever the page becomes visible and, on a controller change,
announces the update in a bar the player restarts from — never on the first
install, never on its own since 1.5.0; the worker's navigation fetch asks for `cache: 'no-cache'`, so
the browser's HTTP cache cannot answer for the server; and `_headers` covers
`/`, which is what a navigation requests, not `/index.html`. None of it is
checkable in the end-to-end suite, which runs over http where the worker does
not register. The page's side is covered since by `tests/updates.test.ts`
against stubbed browser globals — nothing announced on the first install, one
announcement on a later controller change, a reload only on `apply()`, the
re-check on visibility — and the install invitation beside it. The worker's own logic is
covered by `tests/sw.test.ts`, which evaluates `static/sw.js` as it is against
fake `caches` and `fetch` and sends it the three events a browser would:
per-asset precache that survives a missing file, activation that drops the
other caches, a navigation that bypasses the HTTP cache and falls back to the
cached shell offline, cache-first assets that ignore the query string, no
caching of a failed response. Validated by mutation — dropping `no-cache`,
caching a failed response and switching to `addAll` each bring down a named
test. What deployment alone still proves is the build plugin's two rewritten
lines, which the unit test reads in their development form.

## 19. Documents that state figures nothing checks

The whole reason this list exists in its current form: an audit found that
`GAMEPLAY.md` gave a ratio divided by a figure appearing nowhere in the code,
`TECH-DEBT.md` counted declaration statements and called them bindings, and
`ARCHITECTURE.md` was off by fourteen lines on a seventy-four line file. None
of it was checkable, so none of it was wrong for long enough to notice.

`GAMEPLAY.md` is now generated from `src/sim/tuning.ts` between markers, with
a test that fails on drift. The rest of `docs/` is prose and counts that are
still typed: they were all re-measured, but nothing stops them rotting again.
Generating a handful of them — line counts, the tuning coverage figures — would
be cheap, and is the obvious next move if this recurs.

It recurred, mildly, on 11 September 2026: `ARCHITECTURE.md` had not been
touched through steps 3 to 7 of the roadmap, so five client modules and the
core's barrel were missing from its tables, the client's line count stood at
2 100 against 5 200 measured, and the debug surface listed nine of its fifteen
entries. Nothing was wrong, everything was incomplete. Re-measured and
completed by hand — and then the next move was taken the same day:
`tests/layout-doc.test.ts` generates the line counts of `ARCHITECTURE.md`, the
table of item 20 and the tuning coverage of item 11 between markers, and fails
if a source module is not named in the map. What it cannot check is a role that is stale rather than absent;
that stays prose, and stays a judgement.

## 20. Modules over the 300-line rule

`CLAUDE.md` asks for modules under 300 lines with one reason to change each,
and names the legacy `game.js` at 1 340 as the counter-example. Measured on the
current tree, comments included, and regenerated by `npm run docs:layout`:

<!-- generated:oversize -->
| File | Lines |
|---|---|
| `src/client/audio.ts` | 900 |
| `src/client/main.ts` | 742 |
| `src/client/ship.ts` | 548 |
| `src/sim/step.ts` | 471 |
| `src/client/sliders.ts` | 424 |
| `src/sim/generator.ts` | 421 |
| `src/sim/tuning.ts` | 384 |
| `src/client/track-mesh.ts` | 344 |
| `src/client/hud.ts` | 309 |
<!-- /generated:oversize -->

Why each grew, which is a judgement and therefore typed: `audio.ts` is one
synthesised engine with ten event responses, the drift band and the surge
white-out; `main.ts` is construction, the settings glue, the per-frame assembly
and boot; `track.ts` is ring buffers, generation, path integration and
sampling; `ship.ts` is hull, plumes, smoke, halo and the drift glow;
`sliders.ts` is the tuning workshop, mostly the table itself; `step.ts` is one
physics step; `track-mesh.ts` is five ribbons and the gantries.

Low. `main.ts` was the only one with several reasons to change, and it was
split on 11 September 2026: the debug surface went to `debug.ts` and the
observer end of `events.ts` — halo, shake, haptics, HUD pops and the
boost-ready hysteresis — to `feedback.ts`. What is left is wiring, at length:
sixty lines of it are the settings glue alone. The split also collapsed two
reset lists, the run start's and the capture's, into one function, which
closes the way three visual reference bugs were made. No reference moved.

The rest are one thing each written at length, and splitting `step.ts` or
`track.ts` to satisfy a number would cost the reader more than it saves. A
module that crosses the line joins the table on its own, and the test that
generates it will say so.

## 21. Comment language

`CLAUDE.md` says code comments are French, and that mixing the two languages
inside one file is worse than either. Measured on 11 September 2026 by
counting comment lines with French diacritics against ones with English
function words: the core is French throughout; in the client, every module
written since the surge — drift, spray, surge, overlay, feedback, debug — is
French, and every module that came through the port is English.

Four files mixed the two. `sky.ts`, `hud.ts` and `main.ts` were made French,
the convention; `audio.ts` was made English, because it had four French lines
against a hundred and forty English ones and uniformity was the rule being
served. The bundle's hashed name did not move, which is how a comment-only
change is checked here.

Closed on 11 September 2026, on the author's decision: interface English,
code French. The ported client, `vite.config.ts` and the tests went over in
batches of whole files, each batch checked the one way a comment-only change
can be — the built bundle kept its hashed name throughout. `audio.ts`, made
English the day before for uniformity's sake, went the other way once the rule
was settled. What stays English in code is what the player reads: labels,
hints, tips, difficulty notes, test titles, and the generated prose of
`GAMEPLAY.md`.

## 22. The generated track can cross itself

Measured, not fixed, on 12 September 2026: `TRACK-CROSSING.md` has the full
record — how it was measured (57 to 60 of the sixty reference seeds cross
within 30 km, first as early as 984 m), why (a run of same-signed curvature
has nothing pulling it back toward the centre, and the curvature ceiling
alone is enough to curl the path back on itself well inside the visible
window), the four approaches tried and why each fell short, and the two
directions left. The author's read there favours the simpler one: bound
curvature more tightly while the track is still slow, rather than trying to
out-think every chain of turns after the fact.

## What is deliberately not debt

- **The ship at the origin** is unusual but correct, it removes a whole class of
  precision bugs, and it is what makes several ships on one track cheap later.
- **Synthesised audio** means there is no asset pipeline at all: no models, no
  textures, no sound files.
- **`MeshBasicMaterial` everywhere** is what makes the neon look work and keeps
  the fragment cost low.
- **One runtime dependency.** three.js, and nothing else. A game engine was
  evaluated and declined; the reasoning is in `CLAUDE.md`.
