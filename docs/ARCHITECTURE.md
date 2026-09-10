# Architecture

Three.js r128, two classic scripts, no bundler. 1876 lines of JavaScript,
675 lines of HTML of which 373 are CSS.

| File | Lines | Role |
|---|---|---|
| `public/engine.js` | 675 | Scene, track generation, meshes, ship, effects |
| `public/game.js` | 1201 | Physics, score, screens, input, audio, main loop |
| `public/index.html` | 675 | Markup, all CSS, splash, service worker hook |
| `public/sw.js` | 60 | Offline cache |

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

## Track model

Four parallel ring buffers of `COUNT = 130` entries, one entry per 12 m segment:

```
nk[]   curvature, rad/m          nb[]   bank angle, rad (unbounded, corkscrews add turns)
ng[]   gradient, dy/ds           nid[]  absolute segment id, drives patterns and pickups
```

`pushNode()` shifts them left by one with `copyWithin` and appends a fresh node.
That happens every time the ship travels 12 m. `BACK = 10` segments are kept
behind the ship, giving 120 m of history and 1440 m of visibility.

`buildPath(cursor)` integrates positions from the ship outwards, backwards first
then forwards, filling `px/py/pz/pyaw`. `sample(d, out)` interpolates a point at
`d` metres from the ship and returns position, yaw, bank and the banked right and
up vectors. Everything else — camera, pickups, smoke, gantries — is placed
through `sample`.

`nextNode()` is the generator. It picks curvature bounded by a target lateral
load, so corner radius grows with speed and difficulty stays constant. Gradient
alternates gentle undulation with deliberate ramps followed by a sharp crest,
which is what produces jumps. Corkscrews accumulate `rollPhase` over 44 segments.

## Frame pipeline

`frame(now)` in `game.js`, in order:

1. Frame rate throttle, then `detectHz`.
2. `step(dt, attract)` — the whole simulation, 176 lines. Returns bank angle.
3. `buildPath`, `updateRibbons`, `updateGantries`, `updateItems`.
4. `updateThrust`, `updateSmoke`, `audioUpdate`.
5. Ship pose, camera placement and roll, field of view.
6. Sky rotation, HUD, tips, performance sampling.
7. `renderer.render`.

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

## Rendering

Everything except the ship uses `MeshBasicMaterial`, unlit. The ship uses
`MeshLambertMaterial` with a single directional light, added so it reads as a
solid object and so its rotation is legible during corkscrews.

Ribbons are `BufferGeometry` with positions rewritten every frame, 130 × 2
vertices each: road, two edges, two skirts. The road carries a procedural canvas
texture whose UVs are driven by `nid`, so chevrons are attached to the track and
scroll with it.

The background is a shader on an inverted sphere centred on the camera:
value noise fbm for the nebula plus two hashed star layers.

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

## Le noyau extrait, `src/sim/`

Portage TypeScript strict de la simulation, sans DOM ni three.js, exécutable en
Node comme en navigateur. Il n'est **pas encore branché** : `public/` fait
toujours tourner le jeu.

| Fichier | Rôle |
|---|---|
| `rng.ts` | sfc32 seedé, sérialisable, flux séparés |
| `tuning.ts` | `DEFAULTS`, `DIFF`, `tuningFor` — la source de vérité des réglages |
| `track.ts` | tampons circulaires, génération, `gradeAt` |
| `state.ts` | l'état de simulation, en espace piste uniquement |
| `events.ts` | ce que la simulation raconte, à la place des appels audio |
| `step.ts` | un pas de physique, portage ligne à ligne |
| `sim.ts` | l'assemblage |

Deux différences assumées avec `public/` :

- les quatorze appels de présentation qui étaient au milieu de `step()`
  — `SFX`, `buzz`, `flashHalo`, `pop` — sont devenus des événements ;
- `halo` et `haloPow` ne sont plus des champs d'état, c'était de l'affichage.

Ce qui n'est pas encore porté : `buildPath` et `sample`, qui servent au rendu et
au placement des objets, et resteront avec le client.

La parité est vérifiée dans les deux sens. `tests/e2e/determinism.spec.ts`
compare depuis le navigateur les deux PRNG et les soixante-dix constantes de
réglage ; `tests/sim-parity.test.ts` rejoue dans Node les références capturées
sur le jeu. Les deux doivent rester vertes tant que les deux implémentations
coexistent.

## Storage

`localStorage`, key `gsurge.scores.v1`, top five runs with score, coin count,
difficulty letter and date. Guarded by a write probe because private browsing
throws on access. Settings are not persisted.
