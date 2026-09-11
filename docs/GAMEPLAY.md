# Gameplay and tuning

Written so nobody has to reverse engineer the numbers again. Every value below
lives in `DEFAULTS` in `src/sim/tuning.ts`.

**The tables between the `generated:` markers are computed from that file** by
`npm run docs:tuning`, and a test fails if they drift. Do not edit them by
hand. This document carried a wrong figure for months precisely because every
number in it was typed and nothing could contradict it.

## Scoring

```
score = ∫ speed × multiplier × difficultyCoefficient dt
```

Distance on its own is worth little. Speed is what pays, and the multiplier is
what makes it pay a lot.

The multiplier starts at 1 and:

- **rises** with each coin, by an amount that depends on the thrust rung you
  take it on — see the tiers below,
- **erodes** continuously by `multDecay` of its distance above 1, per second,
- **erodes half as fast** above `fastLane`, so holding top speed protects it,
- **is halved** by a wall impact or a bad landing (`multWallCut`),
- is capped at `multMax`, default 30.

**The Perfect Drift** pays on top of that. Drifts chained without a wall count
up a combo; a drift counts if it lasted `comboMinHeld`, and the next one has to
start within a window that narrows from `comboWindow` to `comboWindowMin` as the
combo grows. From `comboArm` drifts on, each further drift pays
`speed × combo × comboScore` points straight into the score, and the climb
towards the next rung runs `1 + comboClimb × level` faster, capped at
`comboClimbMax`. A wall, a bad landing or an expired window drop the combo to
zero. It measures regularity, not angle: no drift is "perfect" on its own, the
sequence is.

**The Near Miss** pays for a wall skimmed and not touched. Within `nearBand`
metres of the edge the pass is armed; leaving that band after at least
`nearMinHeld` seconds with no contact in between pays
`speed × nearScore × closeness` points and `nearCharge × closeness` reserve,
where closeness is how deep into the band the ship got, 0 to 1. A touch during
the pass cancels it without ending it: the band re-arms on the next pass. Nothing
counts in the air, where the edge is a different object. No new gauge, as the
specification asked.

**Invincibility and wall riding.** A violet pickup grants `rideTime` seconds in
which the walls are harmless — no hull lost, no speed cut, no multiplier halved,
no climb or combo dropped, and a landing beyond the edge is just a landing. A
wall then *pushes*: each second of contact adds `rideGain` of the speed, and the
ship hugs the edge instead of bouncing off it, so the contact is a line you can
hold. The target speed pulls back at `speedGain` per second, so the push settles
at about `rideGain / speedGain` above the target on its own. The pickups live in
a second list, `extras`, drawn from their own stream and never before
`extrasFrom` metres: the frozen track references record the original list as it
was, and the physics traces end before any extra can exist.

**Fuel** is a permanent resource, 0 to 100, shown as the thin orange bar under
the hull bar. It burns per second at a rate set by the thrust rung —
`fuelCruise`, `fuelBoost`, `fuelSup`, `fuelSurge` — and by the difficulty, which
overrides them: on Easy cruising burns nothing, on Medium and Hard it burns a
little. Cans on the track return `fuelCan` points, and the G-SURGE refills the
tank when it starts. **On an empty tank the boost is unavailable and the
cruise continues** — that was the design decision, and `fuelDryFactor` exists
so a cruise penalty can be tried by moving a value; at 1 it does nothing. A
super boost found on an empty tank still fires: it is a reward, it burns what
is left. Fuel is meant to stay a secondary constraint, and the numbers were
chosen so that it cannot run dry within the fifteen seconds of a frozen trace.

Equilibrium is `1 + gainPerSecond / decay`. A coin appears roughly every 119 m,
so a faster ship both collects more per second and gets more per coin.

That 119 m is one cycle of `1 / coinChance` segments without a coin plus a run
of five to ten with one on every segment: no fresh roll happens while a run is
playing out. Dividing `1 / coinChance` by the run length gives 107 m and is
wrong for exactly that reason.

## Speed tiers

<!-- generated:speed-tiers -->
| Tier | Reached by | Coin colour | Multiplier gain |
|---|---|---|---|
| 0 | cruising | bronze | +0.13 |
| 1 | holding boost, reserve above `boostMin` | gold | +0.3 |
| 2 | a pickup, or 450 m of clean drift under boost | white | +0.55 |
| 3 | 600 m of clean drift under a super boost | warm white | +1.35 |

The tier is the thrust rung, not a speed threshold. Top speeds are 929 km/h
cruising, 1207 under boost and 1473 under a super boost, which the surge
matches without exceeding.

The ladder is climbed rung by rung, and the climb is measured in metres of
drift with nothing touched — a wall empties it, and off drift it drains at 100
m/s. Whether a rung is reachable is a matter of the window it is climbed in:
450 m is 35 % of the 1290 m a full reserve covers under boost (3.8 s at 26
points per second, before drifting refills it), and 600 m is 29 % of the 2046 m
a 5 s super boost covers. Earned or found, a super boost lasts the same and
pins a full reserve, so the gauge reads the same either way.

Cruising and boost climb with the speed ramp over the opening of a run. A super
boost does not: it reaches its own ceiling from the first metre, because
multiplying a target that is still climbing had it showing less than an
ordinary cruise while wearing the loudest presentation in the game.

It used to be a speed threshold, and that was measured to be a poor stand-in
for what it meant. Damage cuts the target speed, so a battered hull lost the
tier its speed would have opened — paying twice for the same mistake. The rung
says the same thing without the approximation, and it is what the tiers always
meant: the top one has always required boosting.

The top gain jumps rather than rises. Holding the surge means drifting, which
costs collection, so that rung is paying for coins that are not there — the
ladder is calibrated on multiplier earned per second, not per coin.

Above 1000 km/h the multiplier also decays half as fast, which is what makes
holding the top of the ladder worth more than reaching it. Boost is fed by
drifting. That is the intended loop: **drift to charge, boost to score**.
<!-- /generated:speed-tiers -->

An earlier revision closed this section with a table of "measured outcomes at
equilibrium" — multiplier and points per second for three play styles. It is
gone. Those numbers depended on how someone happened to be driving, nothing in
the code could confirm them, and they were the same kind of unverifiable
figure as the one corrected further down. Anyone who wants them can measure a
run with `window.__gsNext.trace`.

## Difficulty

`DIFF` in `src/sim/tuning.ts`. Each level overwrites a subset of `DEFAULTS`,
which is itself the easy level. The score coefficient exists because a harder
level lowers the reachable multiplier; without it, hard would score less than
easy.

<!-- generated:difficulty -->
| | Easy | Medium | Hard |
|---|---|---|---|
| Tightest corner at top speed | 189 m | 149 m | 123 m |
| Its load, banking deducted | 27.3 m/s² | 35.3 m/s² | 43.2 m/s² |
| Grip threshold, `gripLimit` | 34 | 34 | 29 |
| Share of grip that corner demands | 80 % | 104 % | 149 % |
| Distance to top speed | 9 km | 6 km | 4 km |
| Impact at 12 m/s closing | 24 pts | 31 pts | 41 pts |
| Time to repair it | 14 s | 26 s | 51 s |
| Score coefficient | ×1.00 | ×1.35 | ×1.80 |
<!-- /generated:difficulty -->

The settings reset applies the current level rather than easy. `renderScale`
is kept out of that assignment: it describes the machine, not the game.

Fuel is where the levels differ most in kind rather than degree: Easy burns
nothing at cruise and has cans often, Medium and Hard leak at cruise and have
fewer cans, and Hard alone burns a little during a G-SURGE.

## Handling

<!-- generated:handling -->
The stick commands a **yaw angle**, not a lateral force. Maximum yaw shrinks
with speed: 20.6° at 360 km/h, 8.0° at 929 km/h, 6.1° at 1207 km/h. The
trajectory then swings towards the nose at a rate set by `gripHold`.

Two time constants in series, `1/yawResponse` = 0.20 s and `1/gripHold` = 0.67
s. That lag is the whole feel of the vehicle. Raising `gripHold` makes it
darty, lowering it makes it a barge.

**Drift** starts when the demanded lateral acceleration exceeds `gripLimit`, 34
m/s². Full lock at boosted speed demands 54, half lock 27, so the driver
decides when to break traction. Steering authority is about 54 m/s² and barely
moves with speed. During a drift `gripDrift` replaces `gripHold`, the ship
slides wide, and the boost reserve refills at `driftCharge` = 17 points per
second against a passive 10.
<!-- /generated:handling -->

## Track generation

Curvature is derived from a target lateral load, `curveLoad`, so corner radius
grows with the square of speed and difficulty stays flat across the run. The
speed it uses is the nominal acceleration profile at that point of the track,
not the player's — a corner is a property of the track, so **boost does not
widen it**. Measured over four minutes of holding the line with boost on
whenever the reserve allows: on easy the hull ends at 44 instead of 100, on
hard the run ends at 32 km instead of 43. Without boost the same test is
slightly kinder than before. Banking
is the physical balance angle for that load, scaled by `bankScale`, capped at
72°. `bankAssist` decides how much of that banking actually helps the driver;
this is the knob that makes corners feel automatic or demanding, independently
of how they look.

Gradient is capped by `climbRate` in metres per second of vertical speed, again
speed dependent. Ramps are generated deliberately: a firm climb followed by a
sharp crest, which is what makes the ship leave the ground. Corkscrews are pure
roll accumulated over `rollNodes` segments, with curvature forced to zero.

## Damage

<!-- generated:damage -->
| Event | Cost |
|---|---|
| Impact | `hullImpact` × lateral closing speed, clamped 2 to 42 |
| Scraping | 15 per second |
| Bad landing off track | 18 points, plus 35 % of speed |
| Passive repair | 1.7 per second |
| Repair pickup | `fixAmount`, 40 points |

Damage reduces top speed by up to 30 %, steering by 28 % and halves boost
recharge. At zero the run ends.
<!-- /generated:damage -->

## Constants worth knowing before touching anything

<!-- generated:constants -->
- **Chevron period must stay above twice the per frame travel.** At 409 m/s
  under a super boost and 60 fps that is 13.6 m, hence `stripeEvery: 2` for a
  24 m period. Below that the track visually decomposes and no amount of GPU
  fixes it.
- **Draw distance is 1440 m**, which is 3.5 seconds at the top speed. Raising
  it without raising `COUNT` will make the track pop in.
<!-- /generated:constants -->

- **The ceiling on a corner is `gripLimit`, not the stick.** Past it the corner
  is taken sliding, not gripping. Easy stays under; Medium crosses it at its
  minimum radius; Hard crosses it on roughly a third of its corners. That is
  the drift-to-charge loop working as designed, not a flaw.

  A previous revision of this document gave an "outward push as a share of
  steering authority" of 62 / 80 / 98 % and claimed Hard sat just under an
  impossible 100 %. The numerator was right — it is the bank-corrected outward
  load above — but it was divided by 44.1 m/s², a figure that appears nowhere
  in the code. Actual steering authority is `sin(yawMax) x v x gripHold`, about
  53.8 m/s² and almost speed-independent since `yawMax` scales as `1/v`, which
  puts the three levels at 51 / 66 / 80 % of full stick. Hard therefore has
  stick left over, while being 49 % past its grip ceiling. Simulated to check:
  at its minimum radius Easy holds the line with zero drift, Medium and Hard
  slide to the wall.

