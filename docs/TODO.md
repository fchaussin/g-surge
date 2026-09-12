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
| repair | +50 every 9 km | 11 km | 13 km |

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
between cans — before touching the burn rates. Dry, the cruise now falls to
`fuelDrySpeed`, 56 m/s — 200 km/h — since 1.15.3; that makes a can matter on
every difficulty, so Medium's starvation may read differently now.
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

### 12 September 2026, the track can cross itself — measured, not fixed

- **"The track allows self-crossing, it's a tolerated bug, fix it."**
  Confirmed and measured: `docs/TRACK-CROSSING.md` has the full record. Four
  approaches tried in `src/sim/generator.ts`, each implemented, measured
  against the sixty reference seeds, and reverted — none got below roughly
  half the seeds still crossing within 30 km, down from 57–60 out of 60
  unmodified. Nothing committed, nothing regenerated.
- **The author's read, recorded in `TRACK-CROSSING.md`:** of the two
  directions left open, bounding curvature more tightly while the track is
  still slow — where almost every measured crossing happens — is the
  pragmatic one, ahead of a longer geometric lookahead that was still
  improving when time ran out on the investigation but never got measured
  far enough to trust.
- **Waiting on the author:** whichever direction is picked moves all sixty
  track references and the three physics ones; `npm run fixtures:update`
  regenerates them in a commit that does nothing else.

### 12 September 2026, M3's ranked mode reaches the menu

- **"Advance the roadmap, M3."** The weekly board's server half and the
  client wiring, decided and built without stopping to ask, since each call
  was low-stakes and reversible:
  - **Reset day and hour:** Monday 00:00 UTC. `server/src/epoch.ts`'s
    `epoch(now)` keys the ISO week (`AAAA-Wss`), `nextReset(now)` is the
    board's countdown. Change either function alone to move it.
  - **Name rule:** two to sixteen letters, digits, space, `-` or `_`; blank
    means "not chosen". Enforced twice — `preferences.ts`'s `NAME_RE` before
    it leaves the client, `arbiter.ts`'s copy server-side, since a client is
    never trusted — an invalid or missing name falls back to `PILOT` rather
    than refusing the run.
  - **The mismatch log** is a column, not the separate table `NETWORK.md`
    sketched: `runs.claim` (the client's own outcome, JSON) and
    `runs.mismatch`, set when it disagrees with the replay. Simpler for one
    extra table's worth of rows nobody queries yet; revisit if M6's
    plausibility flags need more than a boolean.
  - **The "RANKED" copy** is "Play ranked", noting the board and that the
    track is the server's own.
  - **Rank is a snapshot at submission**, not recomputed as later runs beat
    it — the board itself, `GET /board/:difficulty`, is always current; only
    the number a score screen already showed can go stale, same as any
    leaderboard.
  `Ranked` on the client now drives from the menu: a "RANKED" toggle and a
  name field in Settings, `btnStart`/`btnRestart`/`btnAgain` asking for a
  ticket when it's on. Previously reachable only through
  `__gsNext.startRanked()`, still there for the console. 1.17.0.
- **Waiting on the author:** the board screen itself — reading
  `GET /board/:difficulty` and showing it, reached from the menu — is not
  built. It needs a look, the way the ghost's did at M1; the score screen's
  new `#3` after a ranked score is the only place a rank shows today. Also
  open: an e2e proof of a ranked run and of the offline fallback, both
  waiting on that screen to have something to assert against through the
  UI rather than the console; and rate-limiting `/ticket` by IP, named a
  risk in `MULTIPLAYER-ROADMAP.md` and not yet done.
- **A pre-existing flake, found while checking `main` merged in cleanly:**
  `tests/e2e/ghost.spec.ts` on the `mobile` project timed out four times
  running the full suite back to back, each at a different line — a click
  that never resolves, a wait that never sees `travel` advance, a mid-test
  browser closure. A full run also once failed `visual.spec.ts`'s HUD
  capture on `desktop` waiting on fonts — and passed in under four seconds
  run alone straight after. Both read as this sandbox's resources under a
  full suite's load, not a regression: neither touches code this session or
  the `main` merge changed, both pass alone, and `screens.spec.ts`'s own
  mobile run exercises the same start-a-run path the ghost test times out
  on, stably. Not chased further; worth a second look if either reproduces
  on a real machine.

### 12 September 2026, the D1 databases and the first deploy

- **"Go on Cloudflare, staging and prod."** `gsurge` and `gsurge-staging`
  created, migrated, their ids in `server/wrangler.jsonc`; staging deployed.
  The assumed hostnames did not survive contact: `api.g-surge.w23.fr` has no
  certificate under the free plan (Universal SSL is the zone plus one level
  of wildcard, not two) and Total TLS is $10/month. Production moved to
  `gsurge-api.w23.fr`, one label, inside the free certificate. Staging
  dropped its custom domain entirely — a preview already lives at an
  unmemorable `*.pages.dev` address, so a fixed subdomain bought it nothing
  — and answers on its default `g-surge-api-staging.fchaussin.workers.dev`.
  One near miss: `env.staging` without an explicit empty `routes` inherits
  the top-level route and a staging deploy reassigns production's custom
  domain to itself; `server/wrangler.jsonc` now says why in a comment.
  Production deployed on the corrected hostname and the dead `api.g-surge.w23.fr`
  domain record removed from the account.

### 12 September 2026, the streamed track, server and client — 1.16.3

- **"Push `multiplayer` and continue on M5."** Pushed; the chantier had
  landed on `main` by mistake and was moved to its branch, `main` back on
  `origin/main`. M5 built end to end: tickets, chunks by segment id, the
  ranked run with the seed withheld and the ticket window — proven in
  workerd; the client's stream under a failing network, the unranked
  endings, the server's verdict on the end screen. Reachable through
  `__gsNext.startRanked()` until M3's menu switch.
- **"A branch deployed on .pages.dev and production on .w23.fr."** Two
  environments, client and server: the API URL is stamped at build from
  `CF_PAGES_BRANCH`; `server/wrangler.jsonc` has `staging` with its own D1.
  Assumed hostnames, to confirm: `g-surge.w23.fr` for the game,
  `api.g-surge.w23.fr` and `api-staging.g-surge.w23.fr` for the Worker —
  both custom domains, which need `w23.fr` on Cloudflare DNS.
- **Waiting on the author:** `wrangler login`, `wrangler d1 create gsurge`
  and `gsurge-staging`, the two `database_id`s into `server/wrangler.jsonc`;
  then `npm run server:deploy:staging` first.

### 12 September 2026, the server skeleton — 1.16.2

- **"Go"** on M2. `server/`: a Worker that checks size, envelope and core
  digest and forwards; an arbiter Durable Object that validates, replays
  and writes the outcome to D1; the schema; one esbuild bundle that stamps
  the digest and serves tests, `wrangler dev` and `deploy`. The measurement
  M2 existed for passed first time: workerd replays the frozen references
  bit for bit. Dependencies added: `wrangler`, `miniflare`,
  `@cloudflare/workers-types`, `esbuild` — the Docker `tools` image needs a
  rebuild to carry them. Nothing deployed: `server:deploy` waits on a
  Cloudflare account, a `wrangler d1 create gsurge` and its id in
  `server/wrangler.jsonc`.

### 12 September 2026, the streamed track's seam — 1.16.1

- **"Tracks generated progressively by the server and served in chunks,
  with enough buffer to fail and retry requests before the join."** Yes —
  it was phase 2 of `NETWORK.md`, unsized; now sized (3 km chunks, two to
  three ahead, 15 to 22 s to retry at the ceiling) and moved before the
  weekly board so ranked runs stream from day one. The core half is built:
  `generator.ts` — the generator out of `Track` behind a `NodeSource`, and
  a queue addressed by segment id that makes retries and duplicates no-ops.
  The frozen references pass through it under a deliberately ragged network.
  The cost estimate moved: ~1 500 free daily players with the streamed
  track, not 8 000 — the chunk requests are what the free plan counts.

### 12 September 2026, the ghost — 1.16.0

- **"Go"** on the multiplayer roadmap, M1 first. Built: the best run of each
  difficulty is kept on the device and, with *Race your ghost* on in
  Settings, the next run plays on that run's track with the ghost riding
  beside — a translucent cyan hull, a second `Sim` fed by the same
  `TraceCursor` a server uses, never inside the player's simulation. The
  HUD's record slot reads the gap, the end screen says by how much the
  ghost was beaten or not. Off by default; the offline game is unchanged
  with it off. To judge in play: the ghost's tint and opacity (`ghost.ts`,
  two constants), and whether starting on the ghost's seed rather than a
  fresh one reads as fair — it is the only way to race it.

### 11 September 2026, the online layer — 1.15.6

- **"The leaderboard is multiplayer now; a score sent at the end is forged
  in two minutes with devtools, so a backend has to compute it."** Yes, and
  the core was built for it: the client sends the run — seed, difficulty,
  inputs — and the server replays it. **"This must not prevent standalone
  offline play; keep the current mode and override nothing, but share all
  that can be shared."** The offline game is the base and is untouched; the
  trace accumulates inside `Sim` so both modes run one code path. **"Both
  boards, global and friends/weekly — and simultaneous multiplayer is
  coming, so no dodging."** Both, in that order, then rooms. **"If possible
  on Cloudflare."** Workers, Durable Objects, D1 — the core imports neither
  `node:*` nor the DOM, so it runs in a Worker as it is.

  What went where: the design and its honest limits — a bot cannot be made
  impossible, it can be bounded and priced — in `NETWORK.md`; the trace, its
  recorder and `replay()` in `src/sim/replay.ts`, proven bit-exact by
  `tests/replay.test.ts`; `__gsNext.record()` for the browser-to-Node proof
  to come. Nothing changes for the player yet: patch.

### 11 September 2026, the repair — 1.15.5

- **"The damage seems fairly balanced now, but the repair pickups are
  stingy: two should bring you back to full, not four or five."** Easy
  only, played; `fixAmount` 30 → 50 on every difficulty — the amount is not
  overridden by `DIFF`, the frequency is. Entry 1 stays open for Medium and
  Hard.

### 11 September 2026, the HUD readout — 1.15.4

- **"I don't like watching the points tick up so regularly; show distance
  and a stopwatch instead, and at the end the average speed says something
  about risk and control when the score is high."** Done: the HUD's big
  number is the distance in km to the hundredth, a `m:ss` clock under it
  from `state.time` — fixed-step seconds, paused with the game — and the
  end screen counts distance, time, average speed, coins, peak multiplier,
  then the score. The average speed is a reading, not a score input;
  nothing in the leaderboard's format changed.

### 11 September 2026, the dry tank — 1.15.3

- **"Dry, no boost is right, but the speed must not stay that high: it
  should fall to around 200 km/h."** The factor at 1 becomes a ceiling,
  `fuelDrySpeed` 56 m/s, applied last so damage cannot lower it further, and
  the same anywhere on the ramp where a factor would not have been. The fall
  runs at `speedGain`: 900 km/h to 200 in about eight seconds. On the
  Advanced tab.

### 11 September 2026, the shield's presentation — 1.15.2

- **"Invincibility: a Tesla coil in a sphere, halo-style, a low sound with
  it, and the side rails lit — keep the diamond's translucent rainbow, keep
  the violet halo on rail contact."** Built as one state with three outputs,
  `shield.ts`: a plasma globe — a fresnel bubble in the prism's rainbow with
  arcs crackling from the hull to its wall — a 46 Hz beating hum chopped at
  27 Hz with a spark of noise, and the track's neon edges flowing rainbow
  around the ship. All three read the same eased intensity, which blinks
  over the last second and a half. The violet contact halo is untouched and
  shows through the bubble. Nothing to judge but taste: the arc count, the
  hum's level and the rails' reach are constants at the top of `shield.ts`,
  `audio.ts` and `track-mesh.ts`.

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
