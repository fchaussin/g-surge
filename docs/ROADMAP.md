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

### Step 3 — the drift gets its two ends — done

The drift has continuous feedback and no events. Its bascule already exists in
`step.ts`, with hysteresis: entry at `|dv| * gripHold > gripLimit`, exit under
`driftExit`. Emitting `driftStart` and `driftEnd` there is two lines.

Consumers: `SFX_DRIFT_ENTRY` as an aerodynamic transient, `SFX_DRIFT_RELEASE` as
a realignment whoosh, `CAM_DRIFT_EXIT_SNAP`, and a haptic pulse on entry —
`haptics.ts` exists only where `navigator.vibrate` does, so it complements and
never carries.

Emit no event without its consumer in the same commit. An event nobody drains is
dead code, and this repository refuses speculative generality elsewhere.

`driftEnd` carries `held`, the duration, which was not in the plan and came out
of measuring first. The toggle rate is low — ten entries a minute at worst — but
a drift can last a single step, measured at 1 ms, and its entry and release
would then land on top of each other as a click. The event carries the quantity
its consumers need to dose or to stay silent, which is the shape `wallImpact`
and `pickup` already had.

Acceptance: references untouched, held. `state.driftHeld` is a new field and
costs nothing, because the trace records a whitelist that does not include it —
the class B claim a second time, on state rather than on an event.

### Step 4 — the drift becomes readable — done

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

`src/client/drift.ts` is that place: `SLIP_CEILING` = 35 m/s, taken from where
the hull's own yaw already saturated rather than invented, plus `driftIntensity`
and `driftSide`. The side was measured, not deduced — full stick left gives
`yaw +0.397`, `latVel −4.69`, `slip +23.72`, so the nose points one way and the
path goes the other, and the spray leaves on the side opposite `slip`.

**The step ended up class A, and one thing was reversed to keep it there.**
`boostFull` was written as a simulation event and removed again: it fired
eighteen times where three were meant, because a wall scrape shaves 0.036 off
the reserve and it resaturates three steps later. Whether a refill is large
enough to deserve a sound is a presentation judgement, so `main.ts` owns it with
an explicit hysteresis. The test that caught it was written before the code was
believed.

Acceptance: `src/sim/` untouched — 58 unit tests and 57 end-to-end, nothing
regenerated. The spray is parented to the ship and its reach is a checked
constant rather than a comment: `tests/drift.test.ts` fails if a longer life or
a faster recoil pushes it near the camera 19 m behind.

### Step 5 — decide what `supFactor` should be — done

`supFactor` is 1.08: a super boost is eight per cent faster than a boost. Give it
a catapult's signature and the feedback promises what the physics does not pay.

Two exits, and they do not cost the same. Accept that the sensation is the
reward — free, class A, already done by then. Or raise `supFactor`, which is
class C: frozen physics references regenerated, `GAMEPLAY.md` regenerated by
`npm run docs:tuning`, in a commit that does nothing else and says why.

Deliberately after step 1, not before. A number cannot be judged before the
feedback that goes with it exists, and this is the one step where reasoning from
the symptom is the documented way to get it wrong.

**`supChance` joined this decision**, measured while doing step 1: over 120 s at
medium, four pickups appear across 25 322 m — one every 6 331 m — a centring
pilot collects one, and the run spends 2.6 s of 120 at tier 2. Two per cent. The
effects are strong and the state is rare, which looked like the same complaint
as `supFactor` seen from the other side.

**Decided: `supFactor` 1.08 → 1.22, `supChance` unchanged.**

The measurement reframed it. Boost adds +279 km/h to the cruise and the super
boost added +97 to that — the top rung was a third of the one below it, and that
is what made the feedback a promise the physics did not keep. At 1.22 it adds
+266, so the ladder is even end to end.

Two things bounded the choice rather than taste. `audio.ts` clamps the engine's
speed ratio at 1.7, so `boostFactor * supFactor` must stay under it or every
layer flattens while the ship keeps accelerating — that caps `supFactor` at
1.308, and 1.22 keeps margin against a later change to `speedMax`. And steering
authority costs nothing: `yawMax` reaches its floor at 360 m/s, which the super
boost already passed at 1.08. What does grow is the corner load, ×1.49 against
boost, which is the right price for a catapult.

The rarity stays. The two per cent came from a centring autopilot that collected
one pickup in four, which is not a player, and the palette asks for a super boost
that is met rather than relied on. What the pickup already gives is worth 1.68
full reserves — 100 refilled plus 68 not drained — and none of that was ever
legible; the sensory layer, not the frequency, was the thing missing.

**The frozen references did not move, and that is a finding rather than a
relief.** The traces cover 1 345 m and a super boost appears every 6 300 m, so
`superOn` was outside every reference and this change was invisible to all of
them. `tests/speed.test.ts` now pins the three tiers and brackets the value from
both sides: at 1.08 the top rung stops being worth taking, at 1.31 it crosses the
engine's ceiling, and each brings down a named test.

`GAMEPLAY.md` gained the super boost, and its two generated constants now
compute against the true top speed instead of the boost — the chevron margin was
being stated against 335 m/s while the game reached 362, quietly wrong before
this step and less quietly after.

### Step 6 — specify `G_SURGE` — done, no code

The palette wants a five-tier ladder. The code has three, carried by one
variable. `G_SURGE` is a mechanic, entirely class C, and the game is named after
it.

Write down, in the palette: the entry condition, the duration, the exit, what it
does to the ladder in §2, and how it interacts with a drift and with the two
boosts. Write down what it costs — which references move, and whether it needs
state the trace does not record.

Implementation is not in this roadmap. The specification is what lets the next
one decide.

It is §16 of the palette, and measuring first settled two things that were not
opinions. The super boost reaches 1 473 km/h and `audio.ts` clamps the engine at
1 579, so there is 7.2 % of speed left: `G_SURGE` cannot be "faster" without
retuning the whole engine curve. Which is what §15 of the palette already said
by design — an altered perception, not an acceleration — and two independent
reasons pointing at one answer is worth more than either.

And the entry condition cannot rest on the multiplier, the speed tier or the
super boost. Over 180 s with a pilot that goes for the pickups, peak multiplier
runs 30 / 18.2 / 5.7 across the difficulties and time at the top speed tier 62 /
42 / 7 per cent. Everything collapses on hard except the drift: 24 / 25 / 23
drifts, and drifts held past 0.6 s going 4 / 10 / 13 — it *improves*, because
`gripLimit` is lower there. So the gate is the drift chain, which also closes the
one palette entry that has been marked absent since the beginning.

The costing is better than expected. `state.chain` and the two events are class
B, the whole sensory layer is class A, and only the state itself is class C —
and only if it touches speed, multiplier or score. A `G_SURGE` that changes
perception alone moves no reference at all. With the caveat that the traces
would not catch an error there either, which is the gap recorded in TECH-DEBT
§3.

**The design settled after review, and it settled cheaply.** The speed stack is
capped at two degressive rungs — 1.3 then 1.22, which is 1 473 km/h, exactly
where the super boost already sits. So `G_SURGE` gains no speed at all: it gains
duration, five seconds instead of 2.6, and an entire sensory world. That keeps
the engine ratio at 1.586 under its 1.7 ceiling, which means no clamp to raise,
no intermediate tier to retune, and **no frozen reference to regenerate**. The
whole thing is class A and B.

The third rung is therefore not a third stack but a state riding on the second:
the boost is bought, the super boost is found, the surge is earned, and all
three run at the same top speed.

Two things came out of the review that the specification could not have
invented. The audio cannot go up, so it goes down — engine and wind laid flat,
a single low-passed breath left, swollen eardrums; it is the only way to
differentiate a rung when the ratio is already at the ceiling, and `audio.ts`
already has the filter and the gain per layer. And the peripheral blur, which
the repository had already answered before it was asked: `CLAUDE.md`'s trap list
says to blur in screen space with `backdrop-filter`, so it is a masked DOM layer
over the canvas rather than a post-process pass the renderer has no pipeline
for.

Three choices are left open rather than guessed, and they are named at the end
of §16.

### Step 7 — build the surge — the mechanic and its sound are done

Not in the original plan: the roadmap ended at specifying the state. It is being
built in the two slices §16 describes, and the first is in.

The chain, the fourth rung across the four tier tables, the two events, and the
audio white-out — engine layers ducked to 0.16, the drift band cut, the wind
pushed through a low pass at 340 Hz until only a breath is left. The mix cannot
go up, so it goes down.

The class B claim held and is now pinned rather than assumed: `sim-parity`
asserts that no reference run drifts, in any of the three difficulties, at any
of its 1 800 steps. If that ever stops being true, a drift-gated mechanic can
reach the frozen traces and they need revisiting — the test says so by name.

The trigger took two goes, and the second came from playing it. Gated on the
chain alone, the state fired every 25 seconds on easy with nothing on screen to
say why. It now requires a super boost to be running, and the chain only decides
whether that super boost escalates — which turns out to be the better gate on
every count. Super boosts collected run 10 / 12 / 11 per ten minutes across the
difficulties, flat, because collecting depends on steering rather than on grip;
and the chain's median at the moment of pickup is 0.00 s, so it is built *during*
the super boost. That gives the player something to do inside a window instead
of a state that arrives on its own.

It also retired a fix I had been forced into. `surgeHold` was overridden per
difficulty because the chain alone had to carry all the rarity, and the
reachable chain tops out at 0.95 s on easy against 2.65 on medium — a knife
edge. With the pickup carrying rarity, one uniform 0.45 does the job and three
overrides are gone. Measured after the change: one surge every 150 s on easy,
75 on medium, 86 on hard, against every 25 s on easy before.

A second super boost taken during the first escalates without any chain at all,
and taken during the state extends it, capped at twice its length. Measured once
per ten minutes: a bonus path, never a main one. The cap is not caution — the
white-out is an absence, and an absence that runs long stops reading as an event.

The drift finally has a world-space cue: a faint cyan glow on the hull, held
while it lasts, flickering irregularly rather than pulsing — the HUD already
pulses at a fixed period, and copying that rhythm would read as interface stuck
to the ship instead of friction. Its brightness follows the chain, so one
element says both "you are drifting" and "you are nearly there", which is what
made the escalation legible without adding any UI at all. It stays faint on
purpose: the drift and the surge are two rungs of one ladder, and a bright
charge would eat the rung above it.

The surge needed no gauge of its own. During the state the boost gauge measures
nothing — the reserve is pinned, nothing drains — so it becomes the countdown.
§10 asks for a simplified HUD there, not an augmented one.

What is left is the rest of the visual half: the masked `backdrop-filter` layer,
a shake held through the state rather than struck at its two ends, and the HUD
offset in CSS.

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
