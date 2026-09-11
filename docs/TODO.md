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

### 1. Damage, fifth setting

Set on 11 September 2026 after the fourth play: "under 500 km/h I touch the
edge and lose 50 % — that is not an easy mode, we are nowhere near *scrape
the wall for 20 s to lose 100 %*; be coherent". Right: the fourth setting
fixed the budget (passive repair, repair pickups) but left the hit under a
ceiling of 42 that dated from the first set, so a sideways hit on Easy was
half the bar. The fifth scales the hit to the scrape:

| | Easy | Medium | Hard |
|---|---|---|---|
| `hullImpact` (hit at 12 m/s) | 1.4 (17) | 2.0 (24) | 2.6 (31) |
| `hullImpactMax`, the worst hit | 24 | 34 | 42 |
| … in seconds of scraping | 3 s | 2.4 s | 2.3 s |
| `hullScrape` per second | 8 | 14 | 18 |
| `hullRegen` per second | 0.25 | 0.2 | 0.15 |
| repair | +30 every 9 km | 11 km | 13 km |

What a hit costs is the lateral closing speed into the wall — the same slam
costs the same at 300 km/h and at 900 — capped at `hullImpactMax`; the run's
speed is what the wall takes away, not the hull. On Easy: four to five clean
hits with no repair lose the run, two do not; scraping alone takes 13 s.

What to judge: does a hit now read as a slice of the bar rather than half of
it, and does a careless minute still end the run? If the hit is still too
sharp, `hullImpactMax` is the knob — 24 → 18 caps it at two seconds of
scraping without touching the small hits. If it is soft, `hullImpact` 1.4 →
1.8 first.

The scripted pilot, which never aims for a repair (`npm run measure:ladder`):

| difficulty | walls / 10 min | wrecks | alive |
|---|---|---|---|
| easy | 12 – 29 | 0 of 3 | 600 s |
| medium | 9 – 47 | 2 – 3 of 3 | 33 – 600 s |
| hard | 5 – 22 | 3 of 3 | 28 – 167 s |

### 2. The climb thresholds and the super boost's length

`climbSup` 450 m, `climbSurge` 600 m, `climbDecay` 100 m/s, `supTime` 5 s —
starting values, dosed as 35 % and 29 % of their windows (`GAMEPLAY.md`
recomputes them). All four are on the Advanced tab; the gauge shows the climb.
Third play: "leave it like this for now" — kept open, not urgent. What to
judge, when it comes up: does a clean drift under boost reach the super boost
often enough to feel earnable, and rarely enough to still feel earned?

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

### 3. Fuel numbers

Easy 0 / 3 / 6 per second at cruise / boost / super boost, cans every 1.5 km;
Medium 1 / 5 / 10, cans every 2.4 km; Hard 1.5 / 6 / 12 with 2 during a
surge, cans every 4 km. The pilot, which never aims for a can, is dry 0 % of
the time on Easy, 21 – 28 % on Medium, 34 – 53 % on Hard. If Medium feels
starved, raise `fuelCanChance` there first — 0.005 → 0.007 halves the gap
between cans — before touching the burn rates. `fuelDryFactor` is at 1: a
cruise penalty while dry exists as a key and does nothing until moved.
Third play: Medium "to be seen later" — kept open.

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

### 11 September 2026, after the fifth play — 1.15.1

- **"Not bad"** on the fifth damage setting — entry 1 stays open only for a
  later fine touch. **The can, a little lower**: 3.6 m floated too high,
  2.8 m is the middle between that and the 2 m of the other pickups.

### 11 September 2026, after the fourth play — 1.15.0

- **Damage, a fifth time.** The fourth setting's hit was half the bar on
  Easy; the ceiling of 42 dated from the first set. A per-difficulty ceiling,
  `hullImpactMax` 24 / 34 / 42, the coefficient back to 1.4 / 2.0 / 2.6 and
  Easy's scrape to 8, so a hit is at most three seconds of scraping. The
  budget of the fourth setting stays. Entry 1 above; physics references
  moved, in their own commit.

### 11 September 2026, after the third play — 1.14.0 and 1.14.1

- **The prism stays as rare as it is** — "no, not more frequent". Entry
  closed, `rideChance` 0.0025.
- **The drift camera, the compact camera and the charge voice** — "yes,
  better like this". All three closed as they stand.
- **The fuel can** was more detailed than any other pickup — two dark bands
  on top of the neck, where every other item is one solid shape — and stood
  low enough to read as an obstacle. The bands are gone, the neck stays, and
  it hovers at 3.6 m against 2 m for the rest. 1.14.1.

- **Damage, a fourth time.** "I never lose." The third setting kept the hit
  cheap and the refill generous; this one cuts passive repair by six, halves
  the repair pickups and their amount by a quarter, and raises the hit by a
  third. Entry 1 above has the table and what to judge next; the physics and
  the track references moved, in their own commit.

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
