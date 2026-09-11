# Decisions waiting on the author

Kept by Claude while working autonomously: each entry is a point where the
work needed a judgement that is not mine — a value to feel in play, a design
choice, an outward action. Each has the options and a recommendation, so it
can be answered in one pass. Answered entries are removed, and what they
decided goes where it belongs: the code, `GAMEPLAY.md`, or the palette.

## Tuning, to be judged by playing

1. **The climb thresholds and the super boost's length.** `climbSup` 450 m,
   `climbSurge` 600 m, `climbDecay` 100 m/s, `supTime` 5 s — starting values,
   dosed as 35 % and 29 % of their windows (`GAMEPLAY.md` recomputes them).
   All four are on the Advanced tab; the gauge shows the climb. What to judge:
   does a clean drift under boost reach the super boost often enough to feel
   earnable, and rarely enough to still feel earned?

   Measured with a scripted pilot — `npm run measure:ladder`, three seeds,
   five minutes each, a lower bound since it never aims for a pickup and
   hits walls a human would not:

   | difficulty | earned / 10 min | found / 10 min | surges / 10 min | alive |
   |---|---|---|---|---|
   | easy | 6.2 – 6.7 | 11 – 12 | 3.3 | 300 s |
   | medium | 3.5 – 4.9 | 12 – 14 | 1.4 | ~285 s |
   | hard | 1.8 – 2.3 | ~7 | ~2 | 90 – 110 s, all three wrecked |

   So the earned path exists and yields about one earned super boost for two
   found on easy and medium, and a surge every three to seven minutes. On
   hard the pilot dies before the numbers mean much. Recommendation: play
   five minutes per difficulty at the defaults; if the super boost is never
   earned on hard by a human either, lower `climbSup` first, not
   `climbDecay` — the pilot reaches the top of a climb on every difficulty,
   so reach is not the problem, walls are.

2. **The drift camera.** `DRIFT_AIM` 4 m and `DRIFT_ROLL` 0.07 rad in
   `camera.ts`, eased over 0.3 s. Chosen small so the surge stays the top of
   the ladder. If the slide is not felt, raise the aim before the roll — the
   roll is the one that risks nausea.

3. **The charge voice's registers.** 300, 400 and 520 Hz per rung in
   `audio.ts`. Deliberately close; if the rung is not audible, widen the
   steps rather than raising the gain.

## Answered on 11 September 2026, and where the answer went

- **Speed readout at the edge** — stays. Nothing to change.
- **The brake** — stays. The one-axis stick is the reason it may be reached
  for more, not less: through corners, corkscrews and the ship's own lateral
  offset, a thumb tends to align itself with the ship's axis rather than the
  stick's, and a two-axis stick read that lean as a weaker turn. The rationale
  is recorded in `input.ts`.
- **`FX_DRIFT_WAKE` and `SFX_DRIFT_TURBULENCE`** — built, version 1.4.6.
- **The blur layer** — on by default, off as soon as quality has been stepped
  down; confirmed.
- **Comment language** — the interface stays English, the code went French,
  whole files, the bundle's hashed name checked unchanged after each batch.
  Done; `TECH-DEBT.md` §21 is closed.

## The gameplay suggestions of 11 September, and how they land

`GAMEPLAY-FEATURES-SUGGESTIONS_26-09-11.md` lists four features in priority
order. Measured against the frozen references before touching anything:

- Track items already draw from their own PRNG stream, one number per segment
  against cumulative thresholds. A new pickup added **after** the coin
  threshold, with its lateral position from a third stream, leaves the sixty
  track references identical. Fuel cans and the invincibility item cost no
  track fixture.
- The physics traces reach |lat| = 9.60 m, the wall: the reference pilot hits
  the sides. A near miss must not fire on an approach that ends in contact,
  or the traces move; whether it fires elsewhere in them is measured by
  `sim-parity` the moment it exists.

Order of integration, least constraining first: **Perfect Drift** (done,
1.6.0 — class B, no reference moved), **Near Miss** (done, 1.7.0 — class B,
`sim-parity` now asserts the reference pilot never skims cleanly),
**Invincibility with wall riding** (done, 1.8.0 — the extras list keeps the
references intact), **Fuel**. The reverse of the document's priority, because fuel
carries the one design gap below and the other three carry none.

10. **Fuel at zero — what happens?** The specification gives consumption per
    thrust level and per difficulty, and says fuel must stay secondary, but
    not what an empty tank does. Options: (a) boost and super boost become
    unavailable, cruise continues unchanged — fuel is thrust fuel, and on
    Medium and Hard the cruise leak only means a can is needed eventually
    even without boosting; (b) as (a) plus a cruise speed penalty while dry,
    like damage does; (c) the run ends. Recommendation: **(a)**, with the
    penalty of (b) as a tuning key defaulting to zero, so it becomes a value
    to play rather than a decision to reopen. (c) contradicts "must not break
    the arcade rhythm". **Answered: (a)**, penalty key at zero by default.

11. **Fuel and the surge.** "G-SURGE: free + refill" on Easy and Medium,
    "refill + low consumption" on Hard. Read as: the tank refills to full when
    the surge starts; during it, no consumption on Easy and Medium, a slow one
    on Hard. Say if the refill was meant to be continuous instead.

12. **Fuel gauge placement.** A second thin bar under the hull bar at the top,
    amber. Not a decision that blocks; the HUD reference regenerates.

13. **The invincibility item.** Defaulted: 6 s, violet, and a push of 8 % of
    the speed per second of contact, which settles a fifth above the target
    speed; a landing beyond the edge is harmless too while it lasts. All three
    on the Advanced tab. One thing to judge in play: `rideChance` equals the
    super boost's, which makes it as rare — say if it should be more common.

## Asked for, and not possible as asked

- **A hybrid install / launch button on the web version.** Install is done:
  the menu carries an invitation card with a button where the browser offers
  `beforeinstallprompt`, the Share → Add to Home Screen hint on iOS, silence
  once installed or dismissed. *Launch* the installed app from a tab has no API
  in any browser — a page cannot open a PWA — so the hybrid reduces to the
  install half. Chrome on Android shows its own "open in app" affordance in the
  address bar, which is the closest that exists.

## Housekeeping

7. **Pushing.** I push only when asked. The versioning rule is respected
   commit by commit, so any moment is a safe one.
