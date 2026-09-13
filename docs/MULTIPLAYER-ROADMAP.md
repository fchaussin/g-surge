# Multiplayer roadmap

Written 11 September 2026. `NETWORK.md` is the design — what a server can
prove, the trace, the three boards, the three protocol phases, the hosting
and its cost. This document is the plan: milestones in order, what each one
delivers to the player, what proves it done, what it needs from the author,
and what could go wrong. No dates; the order is the commitment, as with
`ROADMAP.md`.

## What does not move, at any milestone

- **The offline game is the base and stays as it is.** Every milestone adds
  a layer that is absent when the network is; a run with no network starts,
  plays and ends on the local board exactly as today. A milestone that
  cannot say this of itself is not done.
- **One core.** The server runs `src/sim/` unmodified. A milestone that needs
  a server-only or client-only fork of the simulation is designed wrong and
  goes back to `NETWORK.md`.
- **The frozen references do not move** for any of this. Track and physics
  fixtures, scene captures: the online layer sits beside the simulation, it
  does not touch a number in it. A milestone that moves one is a retune that
  happened to land in the same week and gets its own commit saying so.
- **Versioning as usual.** Player-visible features are minor bumps, plumbing
  is patch, and a new board key or a broken preference is major.
- **Measure, do not assume.** Each milestone names its proof; the proof is a
  test that fails when the property it guards is broken, checked by breaking
  it once.

## The milestones at a glance

| # | Milestone | Player sees | Needs from the author | Phase in `NETWORK.md` |
|---|---|---|---|---|
| M0 | The trace and its replay | nothing | — | primitive — **done** |
| M1 | Ghosts, locally | their best run racing beside them | taste on the ghost's look | primitive for M4 and M7 — **done**, 1.16.0 |
| M2 | The server skeleton | nothing | `wrangler` as a dependency; a Cloudflare account for `deploy`, none for `dev` | phase 1 plumbing — **done**, 1.16.2 |
| M5 | The streamed track | nothing, if done right | — | phase 2 — **done**, 1.16.1 and 1.16.3; the menu switch is M3's |
| M3 | The weekly board | a ranked mode and a board that resets every week | — | phase 1 on the streamed track — **done**, 1.17.0 and 1.18.0 |
| M4 | Public ghosts | any board entry can be watched | storage policy: how many traces, how long | proof made visible — **done**, 1.22.0 and 1.22.1 |
| M6 | Identity and the global board | sign-in, an all-time board, a report button | identity provider; moderation; data policy | phase 1 + levers |
| M7 | Rooms | racing others live on the same track | room size; how a race ends | phase 3 |
| M8 | Hardening | nothing, or that it keeps working | budget ceiling and alerts | — |

M1 and M2 are independent and can run in either order. M5's core half — the
node source — needs neither and is done; its server half needs M2. M3 needs
M2 and M5: ranked runs stream their track from day one rather than start on
a sent seed and retrofit — decided on 12 September 2026, when the author
asked for tracks served in chunks with enough buffer to retry a failed
request before the join. M6 needs M3 and M4. M7 needs M5, and M6 if rooms
are ranked. M8 runs alongside from M3 on.

## M0 — The trace and its replay — done

1.15.6 and 1.15.7. `src/sim/replay.ts`: the `Trace`, the `Recorder` inside
`Sim`, `validTrace`, `replay()`. `CORE_DIGEST` stamped at build. The
browser-to-Node proof in `bundle.spec.ts`: a run recorded in Chromium
replays in Node to the same outcome. Nothing visible; the offline game
records its trace and does nothing with it.

## M1 — Ghosts, locally — done

1.16.0. `ghost.ts`, `ghosts.ts`, `trace-bytes.ts`; the stick quantised to
1/1024 in `input.ts` so a run packs to two bytes a steer. The e2e round
trip is `ghost.spec.ts`. The per-frame budget with a ghost on was not
measured on the compact profile — open, below.

**Goal.** Replay a stored trace as a second ship on the same track, at frame
rate, beside the live one. This is the presentation half of multiplayer —
another ship, drawn from another simulation's numbers on a shared track —
built with no server at all, against the player's own best run.

**Deliverables.**

- A `Ghost` in the client: a second `Sim` fed from a `Trace` span by span,
  stepped in the same `simulate()` loop with the same fixed step, and a
  second hull mesh positioned from its `dist`, `lat`, `hop`, `yaw` relative
  to the live ship's `cursor`. The ghost never enters the live simulation.
- The best trace per difficulty stored locally. A three-minute stick run is
  ~200–300 KB of JSON, too big for the `localStorage` habit: IndexedDB, or a
  compact binary encoding — measured, one of the two, before deciding.
- A ghost toggle in Settings, off by default; a "GHOST" line on the score
  screen when a run beat the one it raced.

**Proof.** A unit test steps a ghost and a live `Sim` from the same trace and
finds them equal at every frame boundary. The e2e scene reference gains a
capture with a ghost at a known offset; the existing captures do not move
with the ghost off. The frame budget on the compact profile does not step
quality down with a ghost on — measured with `performance.ts`'s governor,
not assumed from the step's 0.45 µs.

**Risks.** A ghost's ship 19 m behind crosses the camera like anything else
in the world; it must fade or clip at the near plane. Two simulations means
two track buffers if the ghost is far ahead; a ghost is drawn only within
the `COUNT` × `SEG` window — 1 560 m — around the live ship, and shown as a
marker beyond.

**Version.** Minor.

## M2 — The server skeleton — done

1.16.2. `server/`, `scripts/build-server.mjs`, `tests/server.test.ts`. The
measurement passed: the reference track and the three physics references
replay inside workerd, through the deployed bundle, bit for bit. Miniflare
rather than the Workers vitest pool, which pins an older vitest; `wrangler`,
`miniflare`, `@cloudflare/workers-types` and `esbuild` are the dependencies.
Not yet: `server:test` as its own script (it runs in `verify`), and the
Worker-side lint of `verify` covers `server/` through `eslint .`.

**Goal.** A Worker, a Durable Object and a D1 schema that replay a trace and
answer with the outcome, running locally under `wrangler dev`, tested from
Node, deployed to nothing yet.

**Deliverables.**

- `server/` next to `src/`, a second Vite-free TypeScript project importing
  `../src/sim/index.js` directly — the same files, no copy, no package.
- The Worker: routes, envelope validation, the `CORE_DIGEST` check against
  the digests the deployment carries, and nothing else that costs CPU.
- The object: `POST /run` forwarded to it, `validTrace`, `replay`, the
  result written to D1. **The replay lives here, not in the Worker**: the
  free plan's Worker cap is 10 ms of CPU and a three-minute replay is sixty.
- D1: `entries(board, epoch, name, score, dist, time, coins, mult, digest,
  submitted_at)` and `traces(entry_id, blob)`. Migrations in the repository.
- `npm run server:dev`, `server:test`, `server:deploy`; `verify` typechecks
  and lints `server/` too.

**Proof.** The physics references of `tests/e2e/fixtures/` replayed **inside
workerd** — the third engine after Node and Chromium — equal the frozen
fixtures. This is the one measurement this milestone exists to make; if it
fails, `trig.ts` and `rng.ts` gain a case and nothing else is built on top
until it passes. Then: a trace from `tests/replay.test.ts` posted to the
local server returns the outcome Node computes; a tampered digest is
refused; a trace over the ticket window is refused.

**Needs from the author.** `wrangler` and `@cloudflare/vitest-pool-workers`
as dev dependencies; a Cloudflare account only when `deploy` comes, in M3.

**Environments**, decided on 12 September 2026, hostnames revised the same
day once deployed: a branch is a Pages preview on `*.pages.dev` and talks to
the staging Worker on its default `g-surge-api-staging.fchaussin.workers.dev`
— a preview already lives on an address nobody remembers, so a fixed
subdomain bought it nothing; `main` is production on `g-surge.w23.fr` and
talks to `gsurge-api.w23.fr`. Not `api.g-surge.w23.fr`: Cloudflare's free
Universal SSL covers a zone and one level of wildcard under it, `*.w23.fr`,
not a second level — `api.g-surge.w23.fr` has no certificate to answer with
and the handshake fails, and the fix, Total TLS, is $10/month. A single-label
custom domain stays inside the free certificate. The client's `API_URL` is
stamped at build from `CF_PAGES_BRANCH` (`GS_API_URL` overrides),
`tests/api-url.test.ts`; the server's two environments are in
`server/wrangler.jsonc`. The hostname assumes the game at `g-surge.w23.fr` —
to confirm.

**Version.** None — nothing in the bundle changes.

## M3 — The weekly board — done

**Goal.** Phase 1 of `NETWORK.md` on the least exposed board: a ranked mode
where a run is played on a server-issued seed and lands, replayed, on a
board that resets weekly.

**Deliverables.**

- The ticket: `POST /ticket { difficulty }` answers a seed, an expiry and a
  token; the object keeps issued tickets in its storage with their issue
  time. A submission must arrive after at least the trace's simulated
  duration and within the expiry — one run per ticket, in real time. **Done**
  since M5, 1.16.3.
- The client: a "RANKED" toggle in Settings; when on, `btnStart`/`btnRestart`/
  `btnAgain` ask for a ticket instead of seeding locally, and `endRun` posts
  the trace with the client's outcome as `claim`. **If the ticket request
  fails, the run starts with a local seed, unranked, and the score screen
  says so** — the offline path is the fallback, not an error. **Done.**
- A board screen: this week's top entries per difficulty, the week's
  remaining time. **Done**: `board.ts`, reached from the menu, a difficulty
  selector, a countdown, and honest states for offline, loading and
  unreachable rather than a stale or fake answer. The player's own rank is
  not on this screen — the score screen already shows the rank a submission
  earned (`#3`), and duplicating it here needs the display name to double as
  an identity, which it deliberately does not.
- **Added after M3 was first called done, on the author's request:** the
  board reads by category, not only by score — the same "RANKED BY" row as
  difficulty, four buttons: score, distance, top speed, average speed. A
  hard run with a weak score can still be first on top speed; the reverse
  holds too. Categories never mix difficulty — every query keeps it in the
  `WHERE`, whatever it sorts by. `speedPeak`, the one number this needed
  that did not already exist, is now a `SimState` field mirroring
  `multPeak`'s own pattern exactly, and shown on the score screen (TOP
  SPEED) since a number the leaderboard judges a run by has to be a number
  the player can see too. Migration `0003_speed_peak.sql`.
- A display name: chosen once, stored in preferences, sent with the run. No
  account, no filter — profanity is M6's problem. **Done**: a field in
  Settings, two to sixteen letters, digits, space, `-` or `_`, blank means
  "not chosen", the server falls back to a generic name rather than refuse.
- The mismatch log: a `claim` that differs from the replay is flagged and
  kept, never refused — a tamper signal or a drift signal, and which one is
  the first thing to read after launch. **Done**, as a column rather than a
  separate table: `runs.mismatch`, `runs.claim` holds the client's outcome as
  JSON.

**Proof.** The server tests of M2 extended: the ticket window (too early,
expired, wrong difficulty), a name kept or falling back to generic, the rank
answered at submission — snapshotted at that moment, not recomputed once a
later entry outscores it — and a mismatched claim flagged without being
refused. **Not done:** an e2e test running a ranked run end to end against
`wrangler dev` inside the Playwright container, and one with the network cut
that lands on the local board with the unranked notice — the client is
reachable through the menu now, board screen included, so nothing but the
test itself is left.

**Author decisions taken while building, logged in `TODO.md`:** the reset is
Monday 00:00 UTC, the board's epoch an ISO week key (`AAAA-Wss`); the name
rule is above; the copy is "Play ranked" with a note naming the board and
that the track is the server's own. Revisit any of the three by editing
`server/src/epoch.ts`, `preferences.ts`'s `NAME_RE`, or the Settings markup —
none is load-bearing elsewhere.

**Risks.** Clock skew between the object and the client does not matter —
the window is measured on the server's own clock at issue and at
submission. A ticket held across a page reload is lost; that is acceptable
and said on screen. The ticket endpoint is the first thing a bot hammers:
rate limit by IP in the Worker from day one — **not done**, still open.

**Version.** Minor — 1.17.0 for ranked reaching the menu, 1.18.0 for the
board screen, 1.19.0 for reading it by category: each is a feature a player
can reach, not plumbing.

## M4 — Public ghosts — done

**Goal.** Every board entry can be watched. The replay is the proof; this
makes the proof visible and turns it into a feature.

**Deliverables.**

- `GET /trace/:entry` from the traces table; a "WATCH" action on a board
  entry that downloads the trace and runs a watch mode: the M1 ghost alone
  on the track, camera following it, HUD reading its numbers, no input.
- "RACE" on a board entry: the same trace as a ghost beside a ranked run on
  the same seed — only while the week's seed is that entry's seed.
- Storage policy: traces of the top N per board and difficulty, dropped
  when they fall off; the local best traces of M1 unaffected.

**Proof.** A watched entry's final numbers equal its board row — the client
replays what the server replayed. Storage growth measured after a simulated
week of submissions against the 5 GB free ceiling.

**Needs from the author.** N. And a look at a bot's ghost next to a human's,
because that comparison is what plausibility flags in M6 will be tuned on.

**Version.** Minor.

**Done**, 1.22.0 for the server and 1.22.1 for the screen. What landed, and
where it differs from the plan above:

- **N is 20, per category rather than overall.** The author set the number;
  the shape came from the board itself. Four criteria are ranked, so keeping
  the top twenty *by score* would drop the run that leads on top speed and
  make its column lie. What is kept is the union of the top twenty of each:
  at most eighty rows per difficulty per week, fewer in practice.
- **Nothing accumulates any more.** Before this, every ranked run wrote a row
  that stayed for ever. Pruning happens at each submission, so the board is
  bounded by design rather than by a cleanup nobody runs.
- **Traces live in their own table** and only for the current week. A row is
  a few hundred bytes and stays as the record; a trace is seventy kilobytes
  and only serves to be watched, which the board stops offering when the week
  turns.
- **Storage, measured rather than estimated.** A trace is ~70 kB packed —
  `packTrace`, which this milestone also put on the wire, `1.21.2`. Three
  difficulties, at most eighty traces each: of the order of ten megabytes at
  any instant, against 5 GB free.
- **Watching replays the run itself, not a ghost beside one.** The player's
  own `Sim` is reset on the trace's seed and difficulty and fed by a
  `TraceCursor` instead of the keyboard, so track, camera, HUD and sound all
  work without knowing. Simpler than animating the ghost mesh alone, and it
  is literally the run.
- **RACE is not built.** Racing a board entry needs the week's seed to be
  that entry's, which the streamed track makes rare by design — every ranked
  run gets its own. It waits for a reason to exist rather than for code.

## M5 — The streamed track

**Goal.** Phase 2: the seed of a ranked run is never sent. The server serves
the track ahead of the ship, as far as the screen shows, so a bot sees no
further than a player.

**Deliverables.**

- ~~`Track` takes a **node source**~~ — done, 1.16.1: `generator.ts` holds
  `SeededNodes`, the generator moved out of `Track` unchanged, and
  `QueuedNodes`, a queue fed in chunks addressed by absolute segment id that
  keeps only what extends it — retries, duplicates and overlaps are no-ops.
  The node carries its items, so `spawnItems` already runs on whichever side
  generates. `Track.dry` goes straight on the last node when the queue is
  empty, so the simulation keeps its invariants while the client ends the
  run. The offline path never sees the queue.
- ~~The object generates from a seed it keeps; `GET /track/:ticket/:from`
  serves 256-segment chunks idempotently; the first chunk comes with the
  ticket~~ — done, 1.16.3: `server/src/tickets.ts`, `track.ts`, the arbiter's
  `/ticket`, `/track`, `/run`. HTTP, not a WebSocket: retryable, cacheable
  per ticket (`cache-control: private`), one request per 3 km.
- ~~The client: a `QueuedNodes` attached to `sim.track`, a fetch loop driven
  by `queue.ahead`, the unranked ending when `track.dry` is seen~~ — done:
  `api.ts`, `stream.ts`, `ranked.ts`; `startRanked()` on the debug surface
  until M3 gives the menu its switch. The HUD's record slot reads `ranked`,
  `unranked · connection lost`, and the end screen's note the server's
  verdict when it comes.
- ~~The trace of a streamed run carries the ticket, not the seed~~ — done:
  the object puts its seed on the trace and replays against its own
  generator; the ticket's window is checked on the object's clock, both
  ways; a ticket serves once.

**Proof.** ~~The frozen track fixtures replayed through the queue source~~ —
done, `streamed-track.test.ts`: sixty seeds and the three physics
references through a queue fed in ragged chunks with lost requests, late
duplicates and overlaps, bit-identical; and the dry queue ending straight.
~~A run played against the local server with the seed withheld replays on
the server to the client's claim~~ — done, `server.test.ts`, in workerd.
`stream.test.ts`: the client's queue under lost requests, garbage and
duplicates stays bit-identical to the seeded track, and runs dry cleanly at
the metre the buffer geometry predicts. Still to prove: a throttled
connection in Playwright ends the run cleanly with no frame over budget —
needs the Playwright container to reach a `wrangler dev`, M3. The scene
captures did not move.

**Risks.** A stalled tab longer than the buffer ends the run — right, and
said on screen. The buffer gives a bot 6 to 9 km of lookahead against the
player's 1.4; a constant to tighten once the real failure rate is measured,
`NETWORK.md`.

**Version.** Patch if invisible, as intended; minor if the ranked mode's
behaviour on a lost connection counts as a feature.

## M6 — Identity and the global board

**Goal.** The most exposed board, with the levers that price a cheat:
accounts, public ghosts (M4), the streamed track (M5), a report button,
plausibility flags, and a moderation queue.

**Deliverables.**

- Sign-in with Google and Apple — OpenID Connect in the Worker, a session
  cookie, the account row in D1. No password ever. Data kept: the provider's
  opaque subject, a display name, nothing else; deletable by the player from
  the menu, which the law requires and the design wants anyway.
- The global board per difficulty, all-time within the current core digest
  — a new digest is a new epoch, the previous one archived and readable.
- Ranked runs on the global board require sign-in; the weekly board keeps
  its name-only entry.
- A report on any entry; a moderation page listing reports and plausibility
  flags with the ghost one click away; hide, ban, restore. The flags: time
  to first steer after a curvature change, steer jitter, correction count —
  computed at submission from the trace, stored, never used to refuse.
- Rate limits per account on `/ticket` and `/run`.

**Proof.** The plausibility metrics run over the scripted pilot's traces
(`tests/helpers/pilot.ts`) and over recorded human runs and separate them —
measured before any threshold is set. Sign-in tested against the providers'
test tenants in CI. Deletion removes every row that names the account.

**Needs from the author.** Provider apps registered under their name; a
privacy note in the menu; who moderates; the archive policy.

**Risks.** This is the milestone with obligations attached — accounts mean
a data controller. Keep the data to two fields and the deletion one click,
and the obligations stay small.

**Version.** Minor. Major only if a board key breaks, which the epoch design
avoids.

## Before M7 — the review of 13 September 2026

Four independent readers went over the core, the client, the server and the
tests; every finding that mattered was re-verified on the code. What follows
is the part that gates the roadmap, in the order to do it. M7 builds on the
run lifecycle in `main.ts`, and three of these findings come from that
lifecycle having four owners of "a run ended" — building rooms on it first
would compound them.

**Live, fix first — a patch on its own.**

1. Watching a board entry to its wreck runs the player's end-of-run path:
   `watch` hands `sim.events` to `feedback.consume`, `wreck` calls `endRun()`,
   `submit()` writes the watched score into the player's local top five and
   offers the stranger's trace as their ghost. Route `wreck` away from
   `onWreck` in the `watch` branch. `main.ts:663-668`.
2. `watchEntry`/`stopWatching` call `sim.setDifficulty` without the
   `renderScale` save/restore that the settings path does; after a watch the
   tuning says 1 while the viewport is at what the governor set. Extract the
   save/restore, it already exists twice. `main.ts:425, 442`.
3. RESTART from pause never records the run: `startRun` submits only when
   the mode is `run`. `main.ts:350`.

**In 1.24.0, before it is deployed — sign-in hardening, one commit.**

4. The callback is not bound to the browser that started the flow, and the
   client stores any `#session=` fragment: a link plants a session, an
   intercepted callback URL signs the victim in as the attacker. At `/start`
   set an `HttpOnly; Secure; SameSite=Lax` cookie on the API origin holding
   `hmac(state)` and require it at `/callback`; on the client, accept the
   fragment only when a `sessionStorage` flag set before navigating to
   `/start` is present. `auth.ts:285-320`, `session.ts:91-99`.
5. `finish` trusts `state.r` on the HMAC alone; re-check `allowedOrigin`
   there, refuse to start under 32 characters of `SESSION_SECRET`, compare
   digests in constant time. `auth.ts:296, 319`.
6. A ticket is not bound to the account that submits it: compare
   `x-gs-account` with `ticket.account` in `run()`, 403 otherwise.
   `arbiter.ts:148-183`.

**Live — the single arbiter can be taken down by one host.**

7. The replay-only `/run` needs no account; `/track/:ticket/:from` is not
   rate-limited and regenerates from segment 0 (48 ms at `from=100000`,
   measured); the limiter keys on the exact IPv6 address. Session or `DEBUG`
   for replay-only, `track` in `PER_MINUTE` with `from` bounded by the
   ticket's age, /64 keys and a hard cap on the table.

**Validation edges, one commit.**

8. `validTrace` uses `in` on `DIFF` (`"toString"` is a difficulty) and
   throws on a trace without arrays; `CATEGORY_ORDER[category]` reaches
   prototype members (`?by=constructor` → 500). `Object.hasOwn`,
   `Array.isArray` in `asTrace`.

**Deploy plumbing.**

9. `vars` are not inherited by `env.staging` — repeat the block there.
10. Nothing deploys the Worker on a push; a `src/sim/` change leaves it on
    the old digest and every ranked run gets a 409 after a full run — the
    incident of 12 September. A `deploy-server` job on push to `main` after
    `verify` and `e2e`; needs `CLOUDFLARE_API_TOKEN` and
    `CLOUDFLARE_ACCOUNT_ID` as repository secrets, from the author.

**Tests that lie, or are missing.**

11. `sim-parity` recreates a missing fixture and passes: throw instead.
12. The mobile ghost "flake" is a 30 s budget on a three-run test under the
    frame cap (6/6 measured, passes at 45 s): `test.slow()`, and no CI
    retry to hide it. `measure:ladder` has the same shape of bug, a 5 s
    vitest timeout.
13. The browser path a real ranked run takes — `toBase64`, the bearer, `/run`,
    the 401 that forgets the token — is stubbed nowhere: a `base64.test.ts`
    and a `/ticket`+`/run` route in `session.spec`.

**Noted, not gating:** prune not atomic (one `DELETE` with four `NOT IN`
subqueries in a `db.batch`); sessions never swept and `claim` stored raw;
bodies read before the size check; no auto-pause on `visibilitychange`;
double-tap START starts two ranked runs; two unguarded DOM writes a frame;
the one per-step allocation in the core (`scrape`/`ride` events); the
`setDifficulty`-after-`reset` footgun; `history.go(-2)` on a fresh PWA;
the core digest is not recursive. The full write-up with scenarios and
confidence per finding was delivered on 13 September; the actionable part
is this list.

## M7 — Rooms

**Goal.** Phase 3: several players on one track at once, each running their
own `Sim`, each seeing the others as ghosts fed live.

**Deliverables, in three steps.**

1. **Two ships, one track, live.** A room object owns the track generator
   (M5), issues the same nodes to every member, receives each member's
   trace in chunks — one per frame or per 100 ms, whichever is fewer — and
   replays them authoritatively. It relays to the room what the core
   produces and nothing else: `dist`, `lat`, `hop`, `yaw`, thrust tier,
   wrecked. The client draws the others with the M1 ghost, positions eased
   between relayed states over the frame delta — the render clock, never
   the simulation's. A member whose chunks diverge from the object's replay
   is dropped.
2. **A race.** A lobby with a countdown; a race ends when every ship is
   wrecked or after a fixed distance; a result screen ranking the room by
   the object's outcomes; the entries go to the weekly or global board as
   ranked runs, since they are.
3. **Getting in.** Invite links to a room; a "play with anyone" queue that
   fills rooms of the chosen size by difficulty; friends as a list of names
   or accounts, depending on M6.

**Proof.** A room test with N scripted members in workerd where every
member's relayed states equal a Node replay of its chunks. Playwright with
two pages in one room, both drawing the other. The message budget measured
against `NETWORK.md`'s cost table — a player-hour at the chosen cadence —
before the cadence is fixed.

**Needs from the author.** Room size; how a race ends; whether rooms are
ranked; the lobby's copy.

**Risks.** The relayed ship is late by the network's round trip; that is
fine for a ghost — there are no collisions between ships, by design and
stated in `CLAUDE.md`'s refusal of a physics engine — and easing over the
frame delta hides jitter. A late joiner in a race in progress cannot catch
up on nodes already consumed; joining closes at the countdown. The object's
duration is the cost driver; rooms hibernate between races.

**Version.** Minor.

## M8 — Hardening

Alongside from M3 on, never a release of its own.

- A load test against the local server: a thousand submissions a minute
  with real traces; the replay's CPU per run measured in workerd, not
  assumed from Node.
- Cost telemetry: requests, object duration and D1 rows a day, against the
  free-plan ceilings in `NETWORK.md`, with an alert at half.
- Abuse: IP and account rate limits, envelope size caps, a trace size cap
  derived from `MAX_SPANS`, refusal of a digest the deployment does not
  carry. **The IP limits and the step cap landed in 1.23.0**: twelve tickets
  and twelve runs a minute per address, counted in the arbiter's memory since
  it is the one object that sees everything, and `MAX_TRACE_STEPS` at an hour
  of play. That last one closed a hole rather than tightened a bound — a
  forty-byte trace could declare two billion steps and `replay` loops exactly
  that many times, so a message the size of an SMS pinned the single arbiter
  for minutes. The ranked path was covered by the ticket's window; the plain
  replay was not. Account limits wait for M6.
- The kill switch: a flag in the Worker that turns the ranked mode off and
  lets the menu say so, so a bad day on the server is a normal day offline.
  **Landed in 1.23.1** as `RANKED_OFF`, a plain variable flipped from the
  Cloudflare dashboard without a deploy: `/ticket` and `/run` answer 503
  `ranked-off`, `/health` reports `ranked: false`, and the client reads it as
  one more reason to be unranked — "ranked mode is off" on the HUD and the
  score card. The board stays readable: cutting the ranking does not hide
  the week's record. What is not built is a notice in the menu *before* a
  run: the client learns the state when it asks for a ticket, not at boot.

## Decisions to take before their milestone

Collected here so they can be answered in one pass; each is also in the
milestone above.

| Before | Decision | Recommendation |
|---|---|---|
| M2 | add `wrangler` and the workers test pool as dev dependencies | yes; without them nothing runs locally |
| M3 | weekly reset day and hour; display-name rules | Monday 00:00 UTC; 3–16 characters, letters, digits, spaces |
| M4 | traces kept per board | top 100 per difficulty |
| M6 | identity providers; who moderates | Google and Apple, nothing else; the author, from the moderation page |
| M7 | room size; race end; ranked rooms | 4; a fixed 10 km or every ship wrecked; yes, ranked |
| M8 | the monthly ceiling that triggers an alert | half the free plan, then $10 |
