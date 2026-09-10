# Roadmap

State as of 10 September 2026. This replaces the earlier phase 0-3 plan, whose
numbering had drifted from the work actually done.

## Where we are

The switch is done. One codebase, TypeScript, compiled by Vite into `public/`,
which is what Cloudflare Pages serves. `legacy/` is deleted.

| Done | Effect |
|---|---|
| Tooling | Strict TypeScript, Vitest, ESLint, `npm run verify` |
| Playwright net | Three profiles: boot, screens, interface and scene references |
| Rename to G-SURGE | UI, manifest, Docker, leaderboard migrated |
| Deterministic simulation | Seeded PRNG, `?seed=`, frozen references |
| Extracted core | `src/sim/`, proven against those references |
| Fixed step | 720 Hz, no interpolation, rendering at the display's native rate |
| Ported client | Rendering, UI, audio, input, leaderboard — all of it |
| Switch | Legacy deleted, deployment on the compiled build |

Debt closed outright: 1, 2, 8, 9, 12 (they described the classic scripts), plus
4, 15, 16, 17 and 18. Largely covered: 3, 6, 10. Open: 6, 10, 11, 14.

## The shape it landed on

```
index.html            Vite entry point, markup and all the CSS
src/
  sim/                the simulation — no DOM, no three.js, runs in Node
  client/             rendering, UI, audio, input, loop
static/               copied verbatim: _headers, manifest, service worker
public/               build output, gitignored — what Cloudflare Pages serves
```

The static directory kept the name `static/` rather than the Vite convention:
during the migration `public/` already meant "the deployed legacy", and two
meanings of one folder was the confusion the move was removing. `public/` is
now the build output, which is what let the Pages project keep its output
directory and change only its build command.

## The invariant that held

**The frozen references in `tests/e2e/fixtures/` were never regenerated.** They
were captured from the legacy before any port and they now pass three ways:
against the source in Node, against the built bundle in a browser, and — since
the fixed step made a frame reproducible — as full-frame scene captures at zero
pixel tolerance.

That is the whole claim of the migration, and it is checkable rather than
asserted. Anything that moves them from here is a change of behaviour and gets
a commit that says so.

Interface references are a different matter and always were: they move when the
interface moves, in a commit that does nothing else, and they are judged by
looking.

## Steps

Estimates in days of focused work, one person.

### Step 0 — get the documents straight — done

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

### Steps 1 to 4 — done

Vite and the skeleton, the rendering port, the client port, then parity and the
switch. The proof that the switch changed nothing: the frozen references were
never regenerated, and they now pass three ways — against the source in Node,
against the built bundle in a browser, and as full-frame scene captures at zero
pixel tolerance.

The one deliberate difference is a single line of text. The legacy leaderboard
said "a distance enters the board" where the board shows a score.

### Step 5 — service worker and assets — done

- Vite emits hashed filenames, so the `ASSETS` list in `sw.js` has to be
  generated at build time and `VERSION` derived from it. This is the least
  predictable part of the migration.
- Create `legacy/icons/`, missing since forever: the manifest and the service
  worker currently point at four 404s and the PWA has no icon.

Acceptance: offline works on a compiled build, an update is picked up without
clearing the cache by hand, the icon shows on install.

### Step 6 — the functional gaps — done

Also worth folding in here, now that the splash does real work: it is the
natural place to prewarm anything else the first seconds need.


Settings persistence under `gsurge.prefs.v1`, `prefers-reduced-motion`,
`aria-pressed` and `role="radiogroup"`, dead code (`fmtM`, `TUNING.coinValue`),
reverb built outside the crash.

SRI on three.js drops off the list: the package is bundled, there is no
third-party script left to seal.

### Step 7 — deterministic track — done

`genSpeed = state.speed` makes the geometry depend on the player's speed.
Replacing it with the nominal speed profile, which is already deterministic,
makes the track a function of the seed alone.

**Declared behavioural change**: track and physics references are regenerated,
in a commit that does nothing else, after checking by eye.

Unblocks: run replay, shared daily track, server-side validation.

### Step 8 — generated documents — done

The tables in `GAMEPLAY.md` are computed from `src/sim/tuning.ts` by
`npm run docs:tuning` and a test fails if they drift. The 62/80/98 % could not
have happened.

Two things were removed rather than generated: a "measured outcomes at
equilibrium" table and a "stable multiplier" row. Both depended on how someone
happened to be driving, neither could be derived from the tuning, and they
were the same species as the figure that started all this. Anyone who wants
them can measure a run with `window.__gsNext.trace`.

### Step 9 — continuous integration — done

Two jobs on every push and pull request: `verify` on a plain Node runner, and
the end-to-end suite inside the official Playwright container — the same image
the references are generated in, which is what makes a zero pixel tolerance
survive leaving this machine.

Both were simulated locally against a clean checkout before being written down,
`npm ci` included.

Prettier is still absent and is the only piece of item 13 left.

**Total: seven to nine days.** More than the six first announced: porting
properly costs more than a mechanical conversion, and saves a split that would
otherwise have to be redone.

## After the roadmap

The steps above completed, one autonomous pass closed what remained closeable:
Prettier wired into verify and CI, the frame governor tested and then
simplified — no frame rate target, no throttle, the display's native rate and
adaptive quality — eight designer-first sliders plus live console tuning
restored, and debt 14 recorded as deferred by decision.

Debt 17 has since been closed too. The core carries its own `sin`, `cos` and
`atan` in `src/sim/trig.ts` instead of borrowing the host's, which removes the
last way an engine could decide part of the result. It cost the frozen
references nothing — a port of fdlibm agrees bit for bit with what V8 already
does — and it turned a four-sample finding into a measured one: the two engines
disagree on 3 to 4 % of arguments, `sin` as much as `cos`.

What is genuinely open now sits in `TECH-DEBT.md`: the DOM id coupling (6, low),
the tuning coverage (11, low), the colour-only signals (10, low), and the
strings (14, deferred).

## Open decisions

- **CodePen.** `scripts/build-codepen.mjs` sliced the legacy files into three
  panels and was deleted with them. Bringing it back means a secondary IIFE
  build target, which is a new feature rather than a port. Nothing depends on
  it today.
- **`static/` or `public/`.** The static directory kept the name `static/` to
  avoid two meanings of `public/` living side by side during the migration.
  `public/` is now the build output. Renaming `static/` back would follow the
  Vite convention, at the cost of one more churn.

## Out of scope

- **Multiplayer.** Specifications come after these steps. Both technical
  blockers are down now: step 7 made the track a function of its seed, and
  debt 17 made the core bit-identical across engines, so a server can replay a
  submitted run and compare for equality. What remains is not arithmetic and
  belongs in the specification rather than in the code: an equality check
  proves reproduction, not honesty, since the client can be modified; and the
  server must compare only what the core produces, never presentation state.
  When it is written, do not hand-roll state synchronisation — Colyseus or
  Cloudflare Durable Objects.
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
