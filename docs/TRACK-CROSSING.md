# The track can cross itself

A known, tolerated defect since the port: nothing in `src/sim/generator.ts`
stops a run of same-signed curvature from bending the track back into itself
within the ~1 560 m visible at once. Investigated on 12 September 2026 after
it was raised in play; not fixed. This page is the record of what was tried,
measured, and why each attempt was set aside — so a future pass does not
re-walk the same ground.

## Measuring it

A disposable probe (never committed) integrated `SeededNodes`' curvature the
same way `Track.buildPath` does — sine and cosine of the mid-segment heading
— over 30 km per seed, and checked every new edge against the others still
inside a 130-segment sliding window (`COUNT`, the buffer `Track` actually
keeps) for a strict line-segment intersection. Run against the sixty frozen
reference seeds, all three difficulties:

**Unmodified generator: 57 to 60 of 60 seeds cross at least once before
30 km, the first crossing as early as 984 m.**

A single diagnosed case (`ref-2`, easy) showed 253° of net heading change
accumulated over 61 segments (732 m) — three quarters of a full turn, well
short of the 360° a naive model would expect to need, because the path does
not have to close a full loop to run back into itself, only to curl tightly
enough at a short enough radius.

## Why it happens

`nextNode()` picks a signed curvature target every 10 to 36 segments,
`rng.sign()` deciding the side with no memory of which way the track has
already been bending. `kMax`, the curvature ceiling, is clamped to
`curveMax` (0.011 rad/m) whenever the nominal speed is at or below the
3 600 m² floor built into `v2 = Math.max(3600, speed * speed)` — in
practice, for all three difficulties, until the speed ramp has carried the
track a few hundred metres past the opening straight. At that ceiling the
turn radius is about 91 m; a few consecutive same-signed draws are enough to
curl the path back on itself well inside the visible window. Almost every
measured first crossing lands in exactly that early stretch.

## What was tried

Four approaches, each implemented in `src/sim/generator.ts`, measured with
the same probe, and reverted — none shipped, nothing here moved a frozen
reference.

| # | Approach | Seeds still crossing | Why it fell short |
|---|---|---|---|
| 1 | A leaky exponential memory of net heading turned, biasing the next turn's sign away from it past a threshold | 57–60 / 60 | The leak under-weighted a turn that builds up fast — precisely the dangerous case — enough that it never crossed the threshold before the measured crossing did. |
| 2 | The same idea with an exact windowed sum instead of a leak | 44–49 / 60 | Real improvement, but the check only ran at each new curvature *decision* (every 10–36 segments); a single decision's own commitment can turn past the danger before the next check ever runs. |
| 3 | A geometric lookahead at each decision point — simulate the candidate curvature forward a fixed 40 segments, reject it (try the opposite sign, then straight) if it would cross | 47–58 / 60 | A crossing often builds across *several* decisions chained together, each one safe simulated alone; a single decision's lookahead cannot see a danger that only exists once two or three later, unrelated draws land the same way. |
| 4a | A reactive per-node guard: check the very next edge before committing it, fall back to straight or a hard turn away if it would cross | 57–59 / 60 | Diagnosed directly: by the time the *next* edge alone would cross, the heading is already committed. On the measured case, neither straight nor a full turn the other way avoided it — no choice left for one segment was enough. |
| 4b | The same guard, but re-checked at *every* node with a 24-segment lookahead on the curvature already in effect, not just at decisions | 53–57 / 60 | Better again, and slower (every node now re-simulates ~24 steps), but still short of eliminating it — the same one seed (`ref-2`) crossed at nearly the same point in every variant tried, suggesting the effective anticipation window needed is longer than what was measured. |

All four keep the geometry a pure function of the seed, difficulty and
segment id — nothing here needed the player's actual play to decide
anything, so a fix along these lines stays compatible with the streamed
track and a server-side replay.

## What's left, and which way looks most promising

Two directions, neither built:

1. **A longer, smarter lookahead.** Variant 4b's trend (more lookahead, fewer
   crossings) did not plateau before time ran out on the investigation. A
   window past 100 segments, with an actual evasive choice of direction
   rather than a fallback to straight, was never measured. More expensive
   per node, and the amount of lookahead actually needed is still unmeasured
   — it might be large enough to erase most of the track's turn variety
   before it stops helping.
2. **Bound curvature more tightly while the track is still slow.** Nearly
   every measured crossing happens in the low-speed stretch right after the
   opening, where `kMax` sits at its `curveMax` ceiling for a few hundred
   metres regardless of difficulty. Tightening that ceiling specifically
   while `nominalSpeed(id)` is still near its floor — rather than trying to
   out-think every possible chain of turns after the fact — trades some of
   the sharpness of the earliest corners for a much simpler, more clearly
   correct guarantee. Less faithful to the original turn-radius intent, but
   mechanically easier to get right and to verify.

**The author's read, 12 September 2026: option 2 is the pragmatic one** —
worth trying first, on its own, measured with the same probe before it is
trusted.

Whichever direction is picked, it changes `src/sim/generator.ts`'s output:
all sixty track references and the three physics references move, and
`npm run fixtures:update` regenerates them in a commit that does nothing
else, per `CLAUDE.md`.
