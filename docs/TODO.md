# Decisions waiting on the author

Kept by Claude while working autonomously: each entry is a point where the
work needed a judgement that is not mine — a value to feel in play, a design
choice, an outward action. Each has the options and a recommendation, so it
can be answered in one pass. An answered entry moves to the log at the bottom
with where its answer went: the code, `GAMEPLAY.md`, or the palette.

Three sections: what is **open**, ordered by how much a play session would
settle; what was **asked for and is not possible** as asked; and the **log** of
what was answered, newest first.

## Open — to be judged by playing

### 1. Damage, third setting

Set on 11 September 2026 after two plays that landed on the two extremes.
`hullImpact` 1.6 / 2.0 / 2.6, `hullScrape` 11 / 14 / 18, `hullRegen`
1.5 / 1.1 / 0.7 for Easy / Medium / Hard; `badLandingHull` 12, `damageSpeed`
0.22 and `damageSteer` 0.2 unchanged from the second setting. The invariant
this one respects: passive repair is always well under a scrape, so leaning on
a wall is always a loss.

Measured with the scripted pilot, which touches the walls fifty times in ten
minutes and never aims for a repair — a lower bound on a human:

| difficulty | walls / 10 min | wrecks | alive |
|---|---|---|---|
| easy | 54 – 57 | 0 – 1 of 3 | 293 – 300 s |
| medium | 54 – 104 | 1 – 2 of 3 | 180 – 240 s |
| hard | 80 – 83 | 3 of 3 | 100 – 135 s |

What to judge: on Easy, is a run lost to a habit and never to a single
mistake? If Easy still bites, `hullRegen` is the knob that changes the feel
most for the least — 1.5 → 2 — and it must stay under `hullScrape / 3`. If it
is still soft, `hullImpact` first: it is the one the pilot's numbers move with.

### 2. The invincibility item

Now a rainbow prism, 8 s instead of 6, with a SHIELD bar under the fuel bar
that counts it down. `rideChance` still equals the super boost's, which makes
it as rare: about one every 4.8 km. What to judge: whether it should be more
common now that it has a gauge to fill — 0.004 would put one every 3 km.

### 3. The climb thresholds and the super boost's length

`climbSup` 450 m, `climbSurge` 600 m, `climbDecay` 100 m/s, `supTime` 5 s —
starting values, dosed as 35 % and 29 % of their windows (`GAMEPLAY.md`
recomputes them). All four are on the Advanced tab; the gauge shows the climb.
What to judge: does a clean drift under boost reach the super boost often
enough to feel earnable, and rarely enough to still feel earned?

Measured with the scripted pilot (`npm run measure:ladder`, before the damage
retune):

| difficulty | earned / 10 min | found / 10 min | surges / 10 min |
|---|---|---|---|
| easy | 6.2 – 6.7 | 11 – 12 | 3.3 – 6.7 with the combo |
| medium | 3.5 – 4.9 | 12 – 14 | 1.4 |
| hard | 1.8 – 2.3 | ~7 | ~2 |

Recommendation: if the super boost is never earned on Hard by a human either,
lower `climbSup` first, not `climbDecay` — the pilot reaches the top of a climb
on every difficulty, so reach is not the problem, walls are.

### 4. Fuel numbers

Easy 0 / 3 / 6 per second at cruise / boost / super boost, cans every 1.5 km;
Medium 1 / 5 / 10, cans every 2.4 km; Hard 1.5 / 6 / 12 with 2 during a
surge, cans every 4 km. The pilot, which never aims for a can, is dry 0 % of
the time on Easy, 21 – 28 % on Medium, 34 – 53 % on Hard. If Medium feels
starved, raise `fuelCanChance` there first — 0.005 → 0.007 halves the gap
between cans — before touching the burn rates. `fuelDryFactor` is at 1: a
cruise penalty while dry exists as a key and does nothing until moved.

### 5. The drift camera

`DRIFT_AIM` 4 m and `DRIFT_ROLL` 0.07 rad in `camera.ts`, eased over 0.3 s.
Chosen small so the surge stays the top of the ladder. If the slide is not
felt, raise the aim before the roll — the roll is the one that risks nausea.

### 6. The compact camera

Below 520 px of height the camera sits at 70 % of `camDist`, 85 % of height
and look-ahead. Judged on a Pixel 9 in landscape — say if it is still far, or
now too close; both are one constant.

### 7. The charge voice's registers

300, 400 and 520 Hz per rung in `audio.ts`. Deliberately close; if the rung is
not audible, widen the steps rather than raising the gain.

## Asked for, and not possible as asked

- **A hybrid install / launch button on the web version.** Install is done:
  the menu carries an invitation card with a button where the browser offers
  `beforeinstallprompt`, the Share → Add to Home Screen hint on iOS, silence
  once installed or dismissed. *Launch* the installed app from a tab has no API
  in any browser — a page cannot open a PWA — so the hybrid reduces to the
  install half. Chrome on Android shows its own "open in app" affordance in the
  address bar, which is the closest that exists.

## Housekeeping

- **Pushing.** I push only when asked. The versioning rule is respected commit
  by commit, so any moment is a safe one.

## Log — answered, newest first

### 11 September 2026, after the second play — 1.13.0

- **Damage went from one extreme to the other.** The second setting let the
  hull heal faster than a scrape drained it. Retuned to the middle, entry 1
  above; the fixtures moved, in their own commit.
- **The fuel can** — red, not orange, so it stops reading as a coin from afar;
  larger; a cylinder with a neck and two bands rather than a box. The fuel bar
  and its pop went red with it.
- **The invincibility item** — a diamond with an animated rainbow shader
  instead of a violet ring; 8 s instead of 6; and a SHIELD bar stacked under
  hull and fuel, present all the time and filled while it lasts. The pause and
  mute buttons moved down 14 px to clear the third row.
- **Documentation** — `GAMEPLAY.md` gains a generated pickups table, this file
  is regrouped by what is open and what is logged.

### 11 September 2026, after the first play — 1.10.0 to 1.12.0

- **Damage halved** after Easy was found near unplayable — superseded above.
- **The track opens straight**: 200 m flat and straight, no corkscrew before
  5 km.
- **The compact camera** on phones, the desktop HUD without pads, labelled
  bars, the installed notice in the menu.

### 11 September 2026, the four gameplay suggestions — 1.6.0 to 1.9.0

`GAMEPLAY-FEATURES-SUGGESTIONS_26-09-11.md` listed four features; all four are
in, in the reverse of its order because that order was measured against the
frozen references. The design questions it left open, and their answers:

- **Fuel at zero** — (a): boost and super boost unavailable, cruise continues,
  a dry-cruise penalty as a key at 1. (c), ending the run, contradicted "must
  not break the arcade rhythm".
- **Fuel and the surge** — the tank refills to full when the surge starts; no
  consumption during it on Easy and Medium, a slow one on Hard.
- **Fuel gauge placement** — a second thin bar under the hull bar.
- **The invincibility item** — 6 s, violet, a push of 8 % of the speed per
  second of contact, settling a quarter above the target speed; superseded
  above for look and length.

### 11 September 2026, earlier

- **Speed readout at the edge** — stays.
- **The brake** — stays. The one-axis stick is the reason it may be reached
  for more, not less: through corners, corkscrews and the ship's own lateral
  offset, a thumb aligns itself with the ship's axis rather than the stick's,
  and a two-axis stick read that lean as a weaker turn. Recorded in `input.ts`.
- **`FX_DRIFT_WAKE` and `SFX_DRIFT_TURBULENCE`** — built, 1.4.6.
- **The blur layer** — on by default, off as soon as quality has stepped down.
- **Comment language** — the interface stays English, the code went French,
  whole files. `TECH-DEBT.md` §21 is closed.
