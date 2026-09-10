# Roadmap

State as of 10 September 2026. This replaces the earlier phase 0-3 plan, whose
numbering had drifted from the work actually done.

## Where we are

Eight commits, merged into `main`.

| Done | Effect |
|---|---|
| Tooling | Strict TypeScript, Vitest, ESLint, `npm run verify` |
| Playwright net | 53 tests, three profiles, visual references at zero tolerance |
| Rename to G-SURGE | UI, manifest, Docker, leaderboard migrated |
| Deterministic simulation | Seeded PRNG, `?seed=`, frozen track and physics references |
| Extracted core | `src/sim/` in strict TypeScript, parity proven against the game |
| Fixed step | 720 Hz, no interpolation, refresh targets derived from the device |

Debt closed: 4 (time step). Largely covered: 3 (tests), 13 (tooling), 8 and 9
inside `src/sim/`. Untouched: 1, 5, 6, 10, 11, 12, 14, 15, 16.

## Legacy and new code

`public/engine.js`, `public/game.js` and `public/index.html` are the **legacy**
version. It is frozen — nothing new is written there. It is not a second
implementation to keep in sync with `src/sim/`, it is the old version, and it
will be deleted at the switch.

Three consequences, and they drive everything below:

- **No fix goes into the legacy.** The functional gaps — settings persistence,
  accessibility, dead code, reverb — wait for the new client. The deployed game
  therefore receives nothing until the switch. That is the price, and it is
  deliberate.
- **No throwaway intermediate state.** We do not rename two large files to
  `.ts` and split them afterwards: the new code is written straight into the
  target structure, one subsystem at a time.
- **Port, do not rewrite.** `CLAUDE.md` lists traps paid for the hard way in the
  shaders, the ribbon geometry, the camera and the trail. The code that avoids
  them is correct; it changes file and language, not content.
- **Structure is allowed to change, behaviour is not.** Porting means keeping
  the numerics and the traps, while the layering follows the standards in
  `CLAUDE.md` — ports and adapters, events rather than calls into the audio,
  input as data, no allocation in the frame loop. Patterns that do not remove a
  real problem here are refused by name in that same section.

The frozen references in `tests/e2e/fixtures/` are the **behavioural contract**,
and they outlive the legacy. The day the new client satisfies them, the three
files go away and nothing is lost.

## The target

One codebase, TypeScript, compiled to `dist/`.

```
index.html            Vite entry point
src/
  sim/                the core, already written — no DOM, no three.js
  client/             rendering, UI, audio, input, loop
static/               copied verbatim: _headers, manifest, icons, sw
dist/                 produced by `npm run build`, not committed
```

The static directory is `static/`, not `public/`: keeping the Vite convention
would have meant the same folder holding the legacy sources and the new assets
at the same time during the migration. `public/` disappears at step 4 instead
of changing meaning.

Cloudflare Pages moves from no build command to `npm run build` with `dist` as
output.

Direct consequence: the "`public/` is the artefact, no build step" ground rule
in `CLAUDE.md` goes away. That is a deliberate change, not a side effect.

## The invariant that makes this safe

**The references in `tests/e2e/fixtures/` are not regenerated**, except at
step 7, which declares its behavioural change. The new client has to satisfy
them, not redefine them: that is what separates a port from a rewrite.

During steps 2 and 3 the new client is only partly testable — that is the trough
inherent to porting in parallel. What covers the gap: the core parity tests,
already green, and the legacy, which stays the executable reference while it is
there.

Visual references will move when the UI moves. Every regeneration must be a
commit that does nothing else.

## Steps

Estimates in days of focused work, one person.

### Step 0 — get the documents straight — ½ d

Corrections found at the start of the session and never applied:

- `TECH-DEBT.md` §2: `engine.js` reads one symbol from `game.js`, `state`.
  `step` and `L` were false positives — a GLSL builtin and vertex labels.
- `TECH-DEBT.md` §1, §6, §8, §10: wrong counts — 251 bindings not 178, 70
  `getElementById` not 72, 27 state fields not 25, 8 toggles and 2 segmented
  groups not 9 and 3.
- `ARCHITECTURE.md`: line counts, including `sw.js` given as 60 instead of 74.
- `GAMEPLAY.md`: the "share of steering authority" row, 62/80/98 %, is wrong.
  The numerator is right, the divisor matches nothing in the code. The real
  figures are 51/66/80 % of full stick, and more importantly the metric is the
  wrong one: the ceiling is `gripLimit`, crossed from Medium onwards.
- Settle the language. Documents and UI in English, code comments stay French
  as they have always been.

Acceptance: no figure in `docs/` that cannot be checked against the code.

### Step 1 — skeleton of the new client — done

Vite, three.js from npm at `0.128.0`, `index.html` at the root,
`src/client/{main,viewport,loop}.ts`, permissive client `tsconfig`. The e2e
suite aims at either artefact through `E2E_TARGET`.

53 tests against the legacy, 15 against the compiled build, all green. The
skeleton drives `Sim` through the fixed-step loop and renders a placeholder, so
that a frame proves the whole chain rather than just that three.js starts.

### Step 2 — port the rendering — 1 to 2 d

From `engine.js` into `src/client/`: `scene`, `sky`, `track-mesh`, `ship`,
`pickups`. Every trap from `CLAUDE.md` is re-checked on arrival — sky shader
precision, chevron period, canvas CSS size, sprite scale clamping.

`buildPath`, `sample` and `gradeAt` move into the core instead: they are pure
functions of the track buffers and have no business in the rendering layer.

Acceptance: track, ship and sky render from `src/sim/`, with no call into the
legacy.

### Step 3 — port the game client — 1 to 2 d

From `game.js`: loop and clock, HUD, screens and keyboard navigation, settings,
audio, haptics, input. All of it consuming the events from `src/sim/events.ts`
instead of the calls that used to sit inside `step()`.

The CSS in `index.html` carries over as is: the visual references pin it to the
pixel, which makes it the least risky part of the port.

Acceptance: the new client is playable, every screen responds.

### Step 4 — parity, then switch — 1 d

- The full e2e suite passes against the new build, on all three profiles.
- The simulation references pass **without being regenerated**.
- Delete `public/engine.js`, `public/game.js`, `public/index.html`.
- Cloudflare Pages: build command `npm run build`, output `dist`.

The legacy dies here and not before: while it is there, it remains the
executable reference if a divergence shows up.

### Step 5 — service worker and assets — ½ d

- Vite emits hashed filenames, so the `ASSETS` list in `sw.js` has to be
  generated at build time and `VERSION` derived from it. This is the least
  predictable part of the migration.
- Create `public/icons/`, missing since forever: the manifest and the service
  worker currently point at four 404s and the PWA has no icon.

Acceptance: offline works on a compiled build, an update is picked up without
clearing the cache by hand, the icon shows on install.

### Step 6 — the functional gaps — ½ d

Settings persistence under `gsurge.prefs.v1`, `prefers-reduced-motion`,
`aria-pressed` and `role="radiogroup"`, dead code (`fmtM`, `TUNING.coinValue`),
reverb built outside the crash.

SRI on three.js drops off the list: the package is bundled, there is no
third-party script left to seal.

### Step 7 — deterministic track — ½ d

`genSpeed = state.speed` makes the geometry depend on the player's speed.
Replacing it with the nominal speed profile, which is already deterministic,
makes the track a function of the seed alone.

**Declared behavioural change**: track and physics references are regenerated,
in a commit that does nothing else, after checking by eye.

Unblocks: run replay, shared daily track, server-side validation.

### Step 8 — generated documents — ½ d

The tables in `GAMEPLAY.md` computed from `src/sim/tuning.ts` by
`npm run docs:tuning`, and checked in a test. The 62/80/98 % could not have
happened.

### Step 9 — continuous integration — ½ d

A GitHub action running `verify` and Playwright. Prettier if wanted.

**Total: seven to nine days.** More than the six first announced: porting
properly costs more than a mechanical conversion, and saves a split that would
otherwise have to be redone.

## Open decisions

- **CodePen.** `scripts/build-codepen.mjs` slices the legacy files into three
  panels, so it dies with them at step 4 unless it is rewritten as a secondary
  IIFE target. To settle before step 4, not before step 1.

## Out of scope

- **Multiplayer.** Specifications come after these steps. Step 7 lifts the last
  technical blocker; nothing else is committed.
- **three.js past r151.** Colour management and lighting intensity defaults
  changed: that is a visual re-tuning pass, not a dependency bump. It would also
  not make the game faster — measured, see `TECH-DEBT.md` §7: 76 draw calls and
  5 591 triangles a frame, with 46 % of the time in our own sky shader. Worth
  doing one day for the dependency's age and for WebGPU, as its own project,
  after the switch.
- **True vertical loops.** They need quaternion frames and have a degeneracy at
  the vertical. The corkscrew covers most of the appeal for none of the risk.
- **Interpolated rendering.** The 720 Hz step divides the common refresh rates,
  so interpolation has no purpose. Do not reintroduce it without measuring.
