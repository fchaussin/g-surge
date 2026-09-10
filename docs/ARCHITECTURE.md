# Architecture

Two codebases coexist during the migration described in `ROADMAP.md`.

`legacy/` is the **legacy** version: three classic scripts, no bundler, deployed
as is. It is frozen — nothing new is written there — and it stays until the new
client reaches parity, because until then it is the executable reference.

`src/` is where the project is going: TypeScript, compiled. `src/sim/` already
holds the simulation core and is proven equivalent to the legacy one.

| File | Lines | Role |
|---|---|---|
| `legacy/engine.js` | 771 | Scene, track generation, meshes, ship, effects |
| `legacy/game.js` | 1340 | Physics, score, screens, input, audio, main loop |
| `legacy/index.html` | 674 | Markup, all CSS (373 lines), splash, service worker hook |
| `legacy/sw.js` | 74 | Offline cache |
| `src/sim/` | 1061 | The simulation core, TypeScript, no DOM and no three.js |

## The one idea that explains everything

**The ship never moves.** It sits at the world origin facing `+Z`. The track is
rebuilt in front of it every frame and scrolls past. Nothing accumulates a world
position, so there is no floating point drift after an hour of play, and
frustum culling is irrelevant because everything is always near the origin.

Everything odd in this codebase follows from that choice:

- **World `+X` is on the left of the screen.** The camera looks down `+Z`, so its
  local X axis is the world's `-X`. Steering input is inverted on purpose.
- **There is no heading.** A corner is the track bending ahead. The sky would
  therefore stay motionless in a turn, so `skyYaw` integrates
  `curvature × speed` by hand to rotate the background.
- **Anything dropped in the world crosses the camera**, which sits 19 m behind.
  That is why the smoke trail is parented to the ship rather than emitted into
  the world.
- **Slope, not pitch.** Nodes store a gradient, not an angle, so the track can
  never exceed vertical. Corkscrews work because they are roll, not pitch. A
  true vertical loop would require replacing the integrator with quaternion
  frames, with a degeneracy at the vertical.

It is also what makes several ships on one track cheap later: `state` holds no
world coordinate at all, only track-space ones. The ship at the origin is a
rendering convention, not a model.

## Track model

Four parallel ring buffers of `COUNT = 130` entries, one entry per 12 m segment:

```
nk[]   curvature, rad/m          nb[]   bank angle, rad (unbounded, corkscrews add turns)
ng[]   gradient, dy/ds           nid[]  absolute segment id, drives patterns and pickups
```

`push()` shifts them left by one with `copyWithin` and appends a fresh node.
That happens every time the ship travels 12 m. `BACK = 10` segments are kept
behind the ship, giving 120 m of history and 1440 m of visibility.

`buildPath(cursor)` integrates positions from the ship outwards, backwards first
then forwards, filling `px/py/pz/pyaw`. `sample(cursor, d, out)` interpolates a
point at `d` metres from the ship and returns position, yaw, bank and the banked
right and up vectors. Everything else — camera, pickups, smoke, gantries — is
placed through `sample`. Both take the cursor as an argument rather than reading
it from `state`.

`nextNode()` is the generator. It picks curvature bounded by a target lateral
load, so corner radius grows with speed and difficulty stays constant. Gradient
alternates gentle undulation with deliberate ramps followed by a sharp crest,
which is what produces jumps. Corkscrews accumulate `rollPhase` over 44 segments.

Everything the generator draws comes from a seeded PRNG, so a seed reproduces a
track exactly. **It is not yet a function of the seed alone**: `genSpeed` carries
the player's actual speed and bounds both curvature and gradient, so two players
on one seed at different speeds get different geometry. Removing that coupling is
step 7 of the roadmap.

## Frame pipeline

`frame(now)` in `game.js`, in order:

1. Frame rate throttle, then `detectHz`.
2. Fixed-step accumulator: the simulation only ever advances by whole `SIM_DT`
   steps, `dt` stays the real frame delta and drives display smoothing only.
3. `step(SIM_DT, attract)` — the whole simulation, 176 lines. Returns bank angle.
4. `buildPath`, `updateRibbons`, `updateGantries`, `updateItems`.
5. `updateThrust`, `updateSmoke`, `audioUpdate`.
6. Ship pose, camera placement and roll.
7. Sky rotation, then field of view.
8. HUD, tips, performance sampling.
9. `renderer.render`.

`frame()` is 136 lines.

## Timing

The simulation runs at a fixed 720 Hz. That is the smallest integer divisible by
60, 72, 90, 120, 144 and 240, so a rendered frame always lands on an exact
simulation state and nothing needs interpolating: twelve steps per frame at
60 Hz, five at 144. A step costs 0.45 µs measured, 0.03 % of a core at that
rate, which is why the choice was free.

On 75 and 165 Hz, which do not divide 720, the step count per frame alternates
between two neighbours and the per-frame displacement varies by ±11 %. A 120 Hz
simulation on a 144 Hz display would have alternated between zero and one step,
±120 %. Step fineness is what removes the need for interpolation, not the
nominal rate.

The display target list is built from the detected refresh rate, in integer
divisions of it, because the throttle can only skip one frame in n. The old
fixed 60 / 120 / 240 list meant a 144 Hz display set to "120" was in fact
running at 144.

## Physics

Two-stage lateral model in track space. The stick commands a yaw angle relative
to the track, and the trajectory catches up with the nose at a rate limited by
grip. Two time constants in series, 0.20 s and 0.67 s, which is what makes the
ship feel heavy rather than teleporting sideways.

Grip breaks when the demanded lateral acceleration exceeds `gripLimit`, which
starts a drift: grip drops, the ship slides wide while still pointing into the
corner, and the boost reserve refills fast.

Airborne state is triggered physically: when the track falls away faster than
`airThresh × g`, the ship keeps its vertical velocity and the gap opens.

## The extracted core, `src/sim/`

A strict TypeScript port of the simulation, no DOM and no three.js, runnable in
Node as well as in a browser. It is **not wired into the game yet**; `legacy/`
still runs it.

| File | Role |
|---|---|
| `rng.ts` | Seeded sfc32, serialisable, separate streams |
| `tuning.ts` | `DEFAULTS`, `DIFF`, `tuningFor` — the source of truth for settings |
| `clock.ts` | The fixed-step accumulator and the reasoning behind 720 Hz |
| `track.ts` | Ring buffers, generation, `gradeAt` |
| `state.ts` | Simulation state, track space only |
| `events.ts` | What the simulation reports, instead of calling the audio |
| `step.ts` | One physics step, ported line by line |
| `sim.ts` | The assembly |

Two deliberate differences from the legacy code:

- the fourteen presentation calls that sat inside `step()` — `SFX`, `buzz`,
  `flashHalo`, `pop` — became events. That is what makes the step runnable
  outside a page;
- `halo` and `haloPow` left the simulation state; they were display values.

Parity is checked in both directions. `tests/e2e/determinism.spec.ts` compares,
from the browser, the two PRNGs, the seventy tuning constants and the fixed-step
constants; `tests/sim-parity.test.ts` replays in Node the references captured
against the game. Both must stay green while the two implementations coexist.

Not ported yet: `buildPath` and `sample`, which move to the core at step 2 of
the roadmap.

## Rendering

Everything except the ship uses `MeshBasicMaterial`, unlit. The ship uses
`MeshLambertMaterial` lit by one directional key light plus a dim ambient, added
so it reads as a solid object and so its rotation is legible during corkscrews.

Ribbons are `BufferGeometry` with positions rewritten every frame, 130 × 2
vertices each: road, two edges, two skirts. The road carries a procedural canvas
texture whose UVs are driven by `nid`, so chevrons are attached to the track and
scroll with it.

The background is a shader on an inverted sphere centred on the camera:
value noise fbm for the nebula plus two hashed star layers. The star dust in
front of it is generated from a constant seed, so the sky is identical on every
load.

## Audio

Web Audio, fully synthesised, no files. The engine is three bands of filtered
noise — low rumble, mid body, high hiss — plus a very quiet sine for turbine
whine. Oscillators were tried first and sounded like a piston engine, hence
noise. The crash builds a 3 s convolution reverb on first use.

## UI

A `mode` string drives everything: `menu`, `run`, `pause`, `over`, `settings`,
`help`, `fpsinfo`. `setMode` toggles layer classes and rebuilds keyboard
navigation. Navigation is a flat list of elements per screen, with groups of
buttons treated as a single stop.

## Storage

`localStorage`, key `gsurge.scores.v1`, top five runs with score, coin count,
difficulty letter and date. A board written under the previous name,
`voidrunner.scores.v1`, is picked up once and the old key removed. Guarded by a
write probe because private browsing throws on access. Settings are not
persisted.

## Debug surface

`window.__gs`, built by `engine.js` and extended by `game.js`. It exists for the
tests and for the replay features to come, and it is not a game API.

| | |
|---|---|
| `seed()` / `setSeed(v)` | current run seed; `?seed=` pins one from the URL |
| `makeRng(seed, stream)` | the generator itself, for cross-checking against `src/sim` |
| `defaults()` / `diff()` | the tuning tables, likewise |
| `clock()` | fixed-step constants |
| `nodes()` / `items()` | the ring buffers and live pickups |
| `trace(opts)` | replays a run at fixed step outside the render loop |
