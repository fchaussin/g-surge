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

## Layout and interface

4. **The speed readout at the top right edge.** You noted that a number that
   changes every frame at the edge of the screen may be the wrong place for
   it, independently of its size. Options: leave it; move it next to the
   score under the multiplier; show it only when it changes tier. My reading:
   leave it until the HUD scaling has been seen on the large screen, then
   decide once — moving it costs a reference regeneration and nothing else.

5. **Whether the brake stays.** You observed it is rarely used. It is now
   beside the boost, where it costs no height. Removing it is a controls
   break in the versioning rule's sense — a major — and the simulation would
   keep `brake` in its input either way, so the cost is small and reversible.
   Recommendation: keep it one more round of play; the one-axis stick may
   change how often it is reached for.

## Presentation, in the palette but not yet built

6. **`FX_DRIFT_WAKE` and `SFX_DRIFT_TURBULENCE`**, both P1. A turbulence
   behind the ship in a drift, and an irregular texture on the drift band.
   Both are class A and could be built without asking; I have not, because
   the drift now has a glow, a spray, a camera and a voice, and a fifth
   channel may be one too many. Say if you want either.

## Decided by a default, say if you disagree

9. **The blur layer.** Open question 2 of the palette's §16: on by default or
   behind a frame budget. Resolved by the palette's own line — "behind the
   performance governor from day one" — as a rule rather than a budget: the
   blur is on, and drops the moment quality has already been stepped down,
   whether the governor did it or the player set sky detail low or render
   scale under 1. The veil stays. A budget would need a frame-time probe the
   governor does not expose per effect.

## Housekeeping

7. **Translating the ported client's comments to French**, file by file
   (`TECH-DEBT.md` §21). Bulk work with no player-visible effect; I do it
   only when a file is opened for another reason unless told otherwise.

8. **Pushing.** I push only when asked. The versioning rule is respected
   commit by commit, so any moment is a safe one.
