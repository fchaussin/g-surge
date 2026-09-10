# Architecture

One codebase, TypeScript, compiled by Vite. `src/sim/` is the simulation and
knows nothing of the browser; `src/client/` draws it, plays it and takes input.

```
index.html         entry point, all the CSS, the splash
src/
  sim/             the simulation — no DOM, no three.js, runs in Node
  client/          rendering, UI, audio, input, loop
static/            copied verbatim: _headers, manifest, service worker
tests/             Vitest on the core, Playwright on the built artefact
public/            build output, gitignored — what Cloudflare Pages serves
```

| File | Lines | Role |
|---|---|---|
| `src/sim/` | ~1 200 | Tuning, PRNG, clock, track, state, events, step |
| `src/client/` | ~2 100 | Viewport, loop, camera, sky, track mesh, ship, pickups, HUD, screens, settings, audio, input, scores |
| `index.html` | 665 | Markup and all the CSS |

## The one idea that explains everything

**The ship never moves.** It sits at the world origin facing `+Z`. The track is
rebuilt in front of it every frame and scrolls past. Nothing accumulates a world
position, so there is no floating point drift after an hour of play, and
frustum culling is irrelevant because everything is always near the origin.

Everything odd in this codebase follows from that choice:

- **World `+X` is on the left of the screen.** The camera looks down `+Z`, so its
  local X axis is the world's `-X`. Steering input is inverted on purpose.
- **There is no heading.** A corner is the track bending ahead. The sky would
  therefore stay motionless in a turn, so it integrates `curvature × speed` by
  hand to rotate the background.
- **Anything dropped in the world crosses the camera**, which sits 19 m behind.
  That is why the smoke trail is parented to the ship rather than emitted into
  the world.
- **Slope, not pitch.** Nodes store a gradient, not an angle, so the track can
  never exceed vertical. Corkscrews work because they are roll, not pitch.

It is also what makes several ships on one track cheap later: `SimState` holds
no world coordinate at all, only track-space ones. The ship at the origin is a
rendering convention, not a model.

## The core, `src/sim/`

Strict TypeScript, and its `tsconfig` drops `DOM` from `lib` and empties
`types`, so `document`, `window` or `fetch` are compile errors rather than
review comments. ESLint additionally rejects `Math.random`, `Date.now` and any
`three` import. That is what lets it run in Node, be tested against frozen
references, and one day be executed by a server.

| File | Role |
|---|---|
| `tuning.ts` | `DEFAULTS`, `DIFF`, `tuningFor` — the source of truth for every number |
| `rng.ts` | Seeded sfc32, serialisable, separate streams |
| `clock.ts` | The fixed-step accumulator and the reasoning behind 720 Hz |
| `track.ts` | Ring buffers, generation, `buildPath`, `sample`, `gradeAt` |
| `state.ts` | Simulation state, track space only |
| `events.ts` | What the simulation reports, instead of calling the audio |
| `step.ts` | One physics step |
| `sim.ts` | The assembly |

### Track model

Four parallel ring buffers of `COUNT = 130` entries, one per 12 m segment:

```
nk[]   curvature, rad/m          nb[]   bank angle, rad (unbounded, corkscrews add turns)
ng[]   gradient, dy/ds           nid[]  absolute segment id, drives patterns and pickups
```

`push()` shifts them left with `copyWithin` and appends a fresh node, every
12 m travelled. `BACK = 10` segments are kept behind the ship, giving 120 m of
history and 1440 m of visibility.

`buildPath(cursor)` integrates positions outwards from the ship, backwards then
forwards. `sample(cursor, d, out)` interpolates a point `d` metres away and
writes into `out` rather than allocating. Everything — camera, pickups, ribbons
— is placed through those two.

`nextNode()` picks curvature bounded by a target lateral load, so corner radius
grows with speed and difficulty stays constant. Everything it draws comes from
the seeded PRNG, so a seed reproduces a track exactly. **It is not yet a
function of the seed alone**: `genSpeed` carries the player's actual speed and
bounds curvature and gradient. Removing that coupling is step 7 of the roadmap.

### Timing

The simulation runs at a fixed 720 Hz — the smallest integer divisible by 60,
72, 90, 120, 144 and 240 — so a rendered frame always lands on an exact
simulation state and nothing needs interpolating. A step costs 0.45 µs
measured, 0.03 % of a core at that rate, which is why the choice was free.

### Physics

Two-stage lateral model in track space. The stick commands a yaw angle relative
to the track, and the trajectory catches up with the nose at a rate limited by
grip. Two time constants in series, 0.20 s and 0.67 s, which is what makes the
ship feel heavy rather than teleporting sideways.

Grip breaks when the demanded lateral acceleration exceeds `gripLimit`, which
starts a drift: grip drops, the ship slides wide while still pointing into the
corner, and the boost reserve refills fast.

Airborne state is triggered physically: when the track falls away faster than
`airThresh × g`, the ship keeps its vertical velocity and the gap opens.

## The client, `src/client/`

The simulation reports; the client decides how that looks and sounds. The
fourteen presentation calls that used to sit inside `step()` are events now,
which is what makes the step runnable outside a page.

| File | Role |
|---|---|
| `main.ts` | Wiring, and nothing else |
| `loop.ts` | The frame loop, and the boundary between the two clocks |
| `viewport.ts` | Renderer, camera, resize, render scale |
| `camera.ts` | The chase camera and its roll blend |
| `sky.ts` | Shader background and star dust |
| `track-mesh.ts` | Five ribbons and the gantries |
| `ship.ts` | Hull, plumes, smoke trail, halo |
| `pickups.ts` | Pooled coin, repair and boost meshes |
| `hud.ts`, `screens.ts`, `settings.ts`, `sliders.ts` | The interface |
| `input.ts` | Devices in, `{ steer, brake, boost }` out |
| `audio.ts`, `haptics.ts` | Feedback, driven by events |
| `scores.ts`, `score-screen.ts`, `tips.ts` | Leaderboard and prompts |
| `performance.ts` | Refresh detection, frame target, automatic quality |
| `fullscreen.ts` | With its prefixed spelling and its iframe refusal |

**The two clocks never mix.** `simulate` only ever receives the fixed step;
`render` only ever the real frame delta. Camera lag, smoke, thrust and every
other easing use the latter. That separation is the shape of `Loop`, so getting
it wrong is hard rather than merely discouraged.

### Rendering

Everything except the ship uses `MeshBasicMaterial`, unlit. The ship uses
`MeshLambertMaterial` under one key light and a dim ambient, so it reads as a
solid volume and its rotation stays legible during a corkscrew.

Ribbons are `BufferGeometry` with positions rewritten every frame, 130 × 2
vertices each: road, two edges, two skirts. The road carries a procedural canvas
texture whose UVs are driven by `nid`, so chevrons are attached to the track and
scroll with it.

The background is a shader on an inverted sphere centred on the camera: value
noise fbm for the nebula plus two hashed star layers. The dust in front of it
is generated from a constant seed, so the sky is identical on every load.

### Audio

Web Audio, fully synthesised, no files. The engine is three bands of filtered
noise — low rumble, mid body, high hiss — plus a very quiet sine for turbine
whine. Oscillators were tried first and sounded like a piston engine, hence
noise. The crash reverb is built on the first gesture, not on the first crash.

## Startup

The splash holds until the game can actually run, not for a fixed time. Two
things cost a visible stall on the first frame otherwise: three.js compiles a
material's shader program the first time it draws it, and the road's canvas
texture is uploaded on first use. `renderer.compile` handles the first, drawing
one full frame handles the second, and both happen behind the splash.

Measured on a software rasteriser, which understates a real GPU: the first
frame the player sees costs 23 ms instead of 45. The splash grows by the
difference, where nobody is waiting on a frame.

The earlier version held for a minimum of 1 200 ms regardless. That existed to
make a CodePen preview watchable and had no other purpose.

## Storage

`localStorage`, key `gsurge.scores.v1`, top five runs with score, coin count,
difficulty letter and date. A board written under the previous name,
`voidrunner.scores.v1`, is picked up once and the old key removed. Guarded by a
write probe because private browsing throws on access. Settings are not
persisted yet.

## Debug surface

`window.__gsNext`, built by `main.ts`. It exists for the tests and for the
replay features to come, and it is not a game API.

| | |
|---|---|
| `seed()`, `mode()`, `state()`, `clock()`, `defaults()` | current run |
| `nodes()`, `items()` | the ring buffers and live pickups |
| `trace(opts)` | replays a run at fixed step, outside the render loop |
| `freeze(seed, steps)` | replays, then draws exactly one frame |

`trace` is what proves the shipped bundle still plays like the source, and
`freeze` is what makes a full-frame visual reference possible at all.
