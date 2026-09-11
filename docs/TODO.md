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
- **Comment language** — the interface stays English, the code goes French;
  the ported client is being translated file by file, whole files, with the
  bundle's hashed name checked unchanged after each (`TECH-DEBT.md` §21).

## Housekeeping

7. **Pushing.** I push only when asked. The versioning rule is respected
   commit by commit, so any moment is a safe one.
