# Gameplay and tuning

Written so nobody has to reverse engineer the numbers again. Every value below
lives in `DEFAULTS` in `engine.js` and is reachable at runtime through
`window.TUNING`.

## Scoring

```
score = ∫ speed × multiplier × difficultyCoefficient dt
```

Distance on its own is worth little. Speed is what pays, and the multiplier is
what makes it pay a lot.

The multiplier starts at 1 and:

- **rises** with each coin, by an amount that depends on the speed tier,
- **erodes** continuously by `multDecay` of its distance above 1, per second,
- **erodes half as fast** above `coinTier3`, so holding top speed protects it,
- **is halved** by a wall impact or a bad landing (`multWallCut`),
- is capped at `multMax`, default 30.

Equilibrium is `1 + gainPerSecond / decay`. A coin appears roughly every 119 m,
so a faster ship both collects more per second and gets more per coin.

That 119 m is one cycle of `1 / coinChance` segments without a coin plus a run
of five to ten with one on every segment: no fresh roll happens while a run is
playing out. Dividing `1 / coinChance` by the run length gives 107 m and is
wrong for exactly that reason.

## Speed tiers

| Tier | Speed | Coin colour | Multiplier gain |
|---|---|---|---|
| 1 | under 500 km/h | bronze | +0.1 |
| 2 | 500 to 1000 | gold | +0.3 |
| 3 | above 1000 | white | +0.6 |

Top speed without boost is 929 km/h, so tier 3 requires boosting. Boost is fed
by drifting. That is the intended loop: **drift to charge, boost to score**.

Measured outcomes at equilibrium, easy difficulty:

| Play style | Multiplier | Points per second |
|---|---|---|
| 432 km/h, 85 % of coins | ×2.0 | 235 |
| 900 km/h, 65 % of coins | ×5.6 | 1 393 |
| 1206 km/h, 50 % of coins | ×19.8 | 6 648 |

## Difficulty

`DIFF` in `game.js`. Each level overwrites a subset of `TUNING` on top of
`DEFAULTS`, which is itself the easy level. The score coefficient exists because
a harder level lowers the reachable multiplier; without it, hard would score
less than easy.

| | Easy | Medium | Hard |
|---|---|---|---|
| Corner radius at top speed | 189 m | 149 m | 123 m |
| Load in that corner, bank deducted | 27.3 m/s² | 35.3 | 43.2 |
| Grip threshold, `gripLimit` | 34 | 34 | 29 |
| Share of grip demanded | 80 % | 104 % | 149 % |
| Distance to top speed | 9 km | 6 km | 4 km |
| Average impact cost | 24 pts | 31 pts | 41 pts |
| Repair time for that impact | 14 s | 26 s | 51 s |
| Stable multiplier | ×5.7 | ×4.4 | ×3.4 |
| Score coefficient | ×1.0 | ×1.35 | ×1.8 |

`applyDifficulty` is also what the global settings reset calls, so a reset
restores the current level rather than easy. Keep `renderScale` out of any bulk
assignment to `TUNING`; it is a display value.

## Handling

The stick commands a **yaw angle**, not a lateral force. Maximum yaw shrinks with
speed: 20.6° at 360 km/h, 8.0° at 929, 6.2° at 1206. The trajectory then swings
towards the nose at a rate set by `gripHold`.

Two time constants in series, `1/yawResponse` = 0.20 s and `1/gripHold` = 0.67 s.
That lag is the whole feel of the vehicle. Raising `gripHold` makes it darty,
lowering it makes it a barge.

**Drift** starts when the demanded lateral acceleration exceeds `gripLimit`,
34 m/s². Holding half lock in a fast corner demands 27, full lock demands 54, so
the driver decides when to break traction. During a drift `gripDrift` replaces
`gripHold`, the ship slides wide, and the boost reserve refills at
`driftCharge` = 17 points per second against a passive 10.

## Track generation

Curvature is derived from a target lateral load, `curveLoad`, so corner radius
grows with the square of speed and difficulty stays flat across the run. Banking
is the physical balance angle for that load, scaled by `bankScale`, capped at
72°. `bankAssist` decides how much of that banking actually helps the driver;
this is the knob that makes corners feel automatic or demanding, independently
of how they look.

Gradient is capped by `climbRate` in metres per second of vertical speed, again
speed dependent. Ramps are generated deliberately: a firm climb followed by a
sharp crest, which is what makes the ship leave the ground. Corkscrews are pure
roll accumulated over `rollNodes` segments, with curvature forced to zero.

## Damage

| Event | Cost |
|---|---|
| Impact | `hullImpact` × lateral closing speed, clamped 2 to 42 |
| Scraping | `hullScrape` per second |
| Bad landing off track | 18 points, plus 35 % of speed |
| Passive repair | `hullRegen` per second |
| Repair pickup | `fixAmount`, 40 points |

Damage reduces top speed by up to `damageSpeed`, steering by `damageSteer` and
halves boost recharge. At zero the run ends.

## Constants worth knowing before touching anything

- **Chevron period must stay above twice the per frame travel.** At 335 m/s and
  60 fps that is 11.2 m, hence `stripeEvery: 2` for a 24 m period. Below that the
  track visually decomposes and no amount of GPU fixes it.
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
- **Draw distance is 1440 m**, which is 4.3 seconds at full boost. Raising top
  speed without raising `COUNT` will make the track pop in.
