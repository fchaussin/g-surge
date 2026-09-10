# Roadmap

State as of 10 September 2026. The migration roadmap it replaces is kept in
condensed form below: it is finished, and what remains of it is a proof rather
than a plan.

## Where we are

The switch is done. One codebase, TypeScript, compiled by Vite into `public/`,
which is what Cloudflare Pages serves. `legacy/` is deleted, the game is live.

| Done | Effect |
|---|---|
| Tooling | Strict TypeScript, Vitest, ESLint, Prettier, `npm run verify` |
| Playwright net | Three profiles: boot, screens, interface and scene references |
| Deterministic simulation | Seeded PRNG, `?seed=`, frozen references |
| Extracted core | `src/sim/`, proven against those references |
| Fixed step | 720 Hz, no interpolation, rendering at the display's native rate |
| Ported client | Rendering, UI, audio, input, leaderboard — all of it |
| Switch | Legacy deleted, deployment on the compiled build |
| Owned primitives | `rng.ts`, time as a parameter, `trig.ts` — debt 17 |
| Continuous integration | `verify` and the end-to-end suite on every push |

**The invariant that held.** The frozen references in `tests/e2e/fixtures/` were
captured from the legacy before any port and were never regenerated. They pass
three ways: against the source in Node, against the built bundle in a browser,
and — since the fixed step made a frame reproducible — as full-frame scene
captures at zero pixel tolerance. That is the whole claim of the migration, and
it is checkable rather than asserted.

Anything that moves them from here is a change of behaviour and gets a commit
that says so.

## What this roadmap is now

The migration produced a game whose simulation is honest and whose sensory layer
is thin. `docs/FX-PALETTE.md` says where it is thin, in the code's own
vocabulary, and this roadmap selects from it.

Two decisions frame everything below.

**The super boost stays instant.** The pickup is the activation. There is no
stock, no availability, no build-up and no recovery phase, which removes five
entries from the palette and, more usefully, collapses `SUPERBOOST_START` onto
an event that already exists — `pickup` of `kind: 'sup'`, already delivered to
`consume()` in `main.ts`. The impact bundle therefore needs nothing from the
simulation at all.

**`G_SURGE` is specified before it is built**, and not in the steps below. The
game is named after a state it does not have; step 6 writes down what that state
is, and stops there.

### The three classes, and why the order below follows them

Cost here is measured in frozen references, not in effort:

| Class | Touches | Price |
|---|---|---|
| **A** | the client alone | no simulation fixture moves |
| **B** | an event in `events.ts`, or a non-physical field | nothing at all: `physics-*.json` records a whitelist of seventeen fields and no events |
| **C** | the physics or the tuning | a declared behaviour change: `npm run fixtures:update`, in a commit that does nothing else |

The steps run A before B before C, so that the cheapest and most visible work
lands first and the expensive decision is taken with the feedback already in
hand rather than before it.

### Rules every step below must respect

- **New eased state joins the reset list in `freeze()`.** Plume scales, pickup
  spin and the field of view all converge over many frames; a frozen frame lands
  wherever the frames before it left it. Three separate bugs, all found by
  tightening a screenshot tolerance to zero. Every effect that eases is a fourth
  unless it is reset.
- **The scene captures are attract-mode frames.** `freeze()` steps with
  `attract` true, and `step()` forces `state.boosting` false there while
  `superOn` requires `!attract`. Nothing in steps 1 and 2 can appear in a
  capture, so they must move no visual reference either. If one moves, the cause
  is a bug, not a new effect.
- **No allocation in the frame loop**, and the two clocks never mix: `simulate`
  takes the fixed step, `render` the real frame delta, and every easing added
  below belongs to the second.
- **Do not deepen debt 10.** Damage, boost tier and difficulty are signalled by
  colour alone today. An effect that differentiates by length, motion, rhythm or
  timbre pays that debt down; one that differentiates by hue alone adds to it.

### Step 1 — the super boost stops being a boost — done

Four of the nine properties in §10 of the palette separate nothing at all
between a boost and a super boost: the field of view and `uWarp` both read
`state.boosting`, `audio.update` never receives `superT`, and neither tier
shakes the camera. Only the plume is differentiated.

The spine of the step is one substitution: `main.ts` already computes a thrust
tier, `superT > 0 ? 2 : boosting ? 1 : 0`, and hands it to the ship. Pass that
tier to the sky and to the audio in place of their `boosting` boolean, and three
of the four properties become a table lookup rather than a branch — the shape
`THRUST_LEVELS` already has in `ship.ts`.

- `CAM_SUP_FOV_KICK`, `CAM_SUP_LAG` — `camera.ts` receives the whole state and
  can read `superT` without a signature change.
- `SFX_SUP_REACTOR`, `SFX_SUP_WIND` — `audio.update` takes the tier.
- `PP_SUP_WARP` — `uWarp` exists and spends itself on brightness,
  `col *= 1.0 + uWarp * 0.55`. Either it gains a tier, or a real distortion is
  written. Measure the fragment cost either way: the sky is already 46 % of the
  frame.
- `FX_SUP_SHOCKWAVE` — on the existing pickup event. `ship.setHalo` is the
  closest support that exists.

Acceptance: the four identical rows of §10 are no longer identical; every frozen
reference passes untouched, simulation **and** visual; anything that eases is in
`freeze()`. All three held. One property still separates nothing, the speed
itself, and that is step 5.

### Step 2 — the end of a super boost — done

`superT` reaches zero and nothing says so. It is the only instant in the super
boost branch the client cannot recover on its own, and the one class B item the
instant-pickup decision leaves standing.

`supEnd` in `step.ts`, consumed by `audio.ts` as a decompression and by the halo
as a release. There is already something to stage: the pickup sets `energy` to
100 and the super boost does not drain it, so a super boost ends on a full boost
reserve. The transition is a hand-off, not a fall.

Acceptance: references untouched, which is also the first demonstration that a
new event costs nothing. It held — 49 unit tests and 57 end-to-end, nothing
regenerated. `tests/events.test.ts` guards the emission itself, since `superT`
is not in the trace and a wrong instant would replay identically; it was
validated by mutation, and firing every step, firing throughout, and never
firing each bring down a named test.

### Step 3 — the drift gets its two ends — half a day

The drift has continuous feedback and no events. Its bascule already exists in
`step.ts`, with hysteresis: entry at `|dv| * gripHold > gripLimit`, exit under
`driftExit`. Emitting `driftStart` and `driftEnd` there is two lines.

Consumers: `SFX_DRIFT_ENTRY` as an aerodynamic transient, `SFX_DRIFT_RELEASE` as
a realignment whoosh, `CAM_DRIFT_EXIT_SNAP`, and a haptic pulse on entry —
`haptics.ts` exists only where `navigator.vibrate` does, so it complements and
never carries.

Emit no event without its consumer in the same commit. An event nobody drains is
dead code, and this repository refuses speculative generality elsewhere.

### Step 4 — the drift becomes readable — 2 to 3 days

Of the seven stages in the palette's sensory loop, two have feedback today: the
lateral displacement, through the ship's yaw and a noise band, and the charge,
at the HUD alone. Steps 3 and 4 together close the other five.

- `SFX_DRIFT_AIRFLOW` is all-or-nothing today, a fixed gain on a 2600 Hz band.
  Make it proportional.
- `SFX_DRIFT_CHARGE` and `SFX_DRIFT_FULL_CHARGE` — the charge is audible nowhere,
  and `energy` crossing 100 is the moment the whole loop pays out.
- `FX_DRIFT_PARTICLES` — the only particles in the game are the eighteen parented
  smoke sprites. Lateral projection is a new emitter, pooled, allocated once.

**The decision this step forces**: `state.slip` is a lateral velocity error in
m/s, not an angle. Anything normalising it must choose a ceiling, and the
renderer already has an implicit one — it saturates at 35 m/s through
`driftYaw`. Pick that ceiling once, in one place, and let every effect read it.
Two effects normalising differently is the class of bug this codebase names
units to avoid.

### Step 5 — decide what `supFactor` should be — a decision, then possibly a day

`supFactor` is 1.08: a super boost is eight per cent faster than a boost. Give it
a catapult's signature and the feedback promises what the physics does not pay.

Two exits, and they do not cost the same. Accept that the sensation is the
reward — free, class A, already done by then. Or raise `supFactor`, which is
class C: frozen physics references regenerated, `GAMEPLAY.md` regenerated by
`npm run docs:tuning`, in a commit that does nothing else and says why.

Deliberately after step 1, not before. A number cannot be judged before the
feedback that goes with it exists, and this is the one step where reasoning from
the symptom is the documented way to get it wrong.

**`supChance` joins this decision**, measured while doing step 1: over 120 s at
medium, four pickups appear across 25 322 m — one every 6 331 m — a centring
pilot collects one, and the run spends 2.6 s of 120 at tier 2. Two per cent. The
effects are strong and the state is rare, which is the same complaint as
`supFactor` seen from the other side: the super boost promises more than it
gives, in time as well as in speed.

### Step 6 — specify `G_SURGE` — 1 day, no code

The palette wants a five-tier ladder. The code has three, carried by one
variable. `G_SURGE` is a mechanic, entirely class C, and the game is named after
it.

Write down, in the palette: the entry condition, the duration, the exit, what it
does to the ladder in §2, and how it interacts with a drift and with the two
boosts. Write down what it costs — which references move, and whether it needs
state the trace does not record.

Implementation is not in this roadmap. The specification is what lets the next
one decide.

**Total: five to eight days**, of which one is paper and one is a decision.

## What this roadmap does not cover

**Technical debt.** All of it is Low and none of it blocks the above. In
`TECH-DEBT.md`: the DOM id coupling (6), the tuning coverage (11), the
colour-only signals (10), the interface modules tested only through the browser
(3), and the strings (14, deferred by decision). Item 10 intersects step 1 and
step 4 — see the rules above.

**Open decisions.** CodePen, whose build script was deleted with the legacy and
which nothing depends on; and whether `static/` should follow the Vite
convention now that `public/` unambiguously means the build output.

**Multiplayer.** Both technical blockers are down: the track is a function of its
seed, and the core is bit-identical across engines, so a server can replay a
submitted run and compare for equality. What remains is specification, not
arithmetic — an equality check proves reproduction, not honesty, since the client
can be modified; and the server must compare only what the core produces, never
presentation state. When it is written, do not hand-roll state synchronisation:
Colyseus, or Cloudflare Durable Objects.

**three.js past r151.** Colour management and lighting defaults changed: a visual
re-tuning pass, not a dependency bump. It would not make the game faster either —
measured, `TECH-DEBT.md` §7. Worth doing one day for the dependency's age and for
WebGPU, as its own project.

**True vertical loops**, which need quaternion frames and degenerate at the
vertical. The corkscrew covers most of the appeal for none of the risk.

**Interpolated rendering.** The 720 Hz step divides the common refresh rates, so
interpolation has no purpose. Do not reintroduce it without measuring.
