# Network

Design for the online layer: ranked leaderboards and simultaneous
multiplayer. State as of 11 September 2026. What exists is the first stone,
the input trace and its replay; the rest is specification, written down
before any server so the limits are agreed rather than discovered.

## Two constraints that shape everything

**The game as it is today is the offline mode, and it is not touched.** A
run must start, play and end with no network at all, on the local board
(`scores.ts`) exactly as now. Online is a layer over that run, never a second
game: when the network is absent, the layer is absent and nothing else
changes.

**Everything that can be shared is shared.** One `Sim`, one trace format,
one `replay()`. The server runs the same `src/sim/` the client runs — that
is the point of the core having no DOM, no clock, no `Math.random` and its
own trigonometry. An online feature that needs a fork of the core is
designed wrong.

## What the server can and cannot prove

Read this before adding any "anti-cheat".

A client never sends a score. It sends the run — seed, difficulty and every
input `step()` received — and the server replays it with the same core and
computes the score itself. That removes the whole class of attacks the
question started with: Postman, devtools, a proxy. There is no score field to
edit. A forged trace is a run that was genuinely playable, and it is worth
exactly what that run is worth.

What remains is the bot: a trace produced by a program rather than a thumb.
**No design makes that impossible**, on any platform. The client is the
attacker's machine; anything the honest client can produce, a modified one
can produce. A real-time authoritative server changes nothing here — the bot
sends its inputs live instead of at the end. So the replay is not a weak
form of an authoritative server; it is the same guarantee, without the
latency and without giving up offline.

What the design can do is bound the bot and price it:

| lever | what it buys | what it costs |
|---|---|---|
| **Replay** | the score is computed, never trusted | nothing: the core already replays |
| **Ticket** | the seed is issued by the server with a validity window; a run must arrive after at least its simulated duration and not long after — one run per ticket, in real time, no offline search over a known seed | a request at run start; offline runs are unranked |
| **Streamed track** | the seed is never sent; the server serves the track segment by segment, as far as the screen shows. A bot then sees no further than a player and its ceiling is "a perfect player of the visible game", set by the design rather than by compute | the server is in the loop for ranked runs — which the multiplayer needs anyway |
| **Public ghosts** | the replay *is* the proof, so every board entry can be watched. A bot's run looks like one: no hesitation, no correction. It is what speedrun boards rely on, and it is also a feature | storage of traces, a ghost renderer |
| **Identity** | a global board needs an account that costs something to obtain (Google or Apple sign-in) so that a ban is a price | accounts, and their obligations |
| **Plausibility** | reaction latency before a corner, steer jitter, corrections — a flag that holds an entry for review, never an automatic refusal | tuning that the attacker can also read |

Refused, explicitly: obfuscating the bundle, encrypting the trace with a key
in the client, client-side "signatures", attestation (none exists for a PWA).
All of it is security by obscurity, all of it fails, and it costs maintenance
to give a false impression.

The honest statement: a determined individual can always put one superhuman
but plausible run on a board. What the design prevents is that being free,
anonymous, invisible and repeatable — the same standard as any serious
competitive board.

## The primitive: the trace

`src/sim/replay.ts`. A `Trace` is the seed, the difficulty, the number of
steps, and the inputs by span — an input holds until the next change, so a
three-minute run is a few thousand entries rather than 130 000 steps. Steer
is kept in double precision because a stick produces arbitrary floats and
the replay must be bit-exact. The step is `DT`, always; the tuning is the
difficulty's, never the client's — a run played with the Advanced tab's
sliders replays to a different score, and that is intended.

`Sim` records every non-attract step into a `Recorder` — one comparison per
step, an append per input change, no allocation while the input holds. The
offline mode pays that and nothing else. `sim.trace()` freezes the run;
`replay(trace)` reproduces it from a fresh simulation and reports the
`Outcome` — the end screen's numbers. `validTrace` is what a server checks
before spending a replay. `tests/replay.test.ts` proves the round trip, the
JSON wire, the compactness, and that a tampered trace scores differently.

`window.__gsNext.record()` exposes the live trace to the browser suite, and
`bundle.spec.ts` holds the cross-engine proof: a run recorded in Chromium,
replayed in Node by `replay()`, the same outcome on the three difficulties.
That is what a server does, done once in CI on every push.

## Versioning the core, not the game

The server must replay with exactly the core that produced the trace. The
package version moves on visual touches too, so it is the wrong key. The
key is the **digest of `src/sim/`**, `scripts/core-digest.mjs`: twelve hex
of a SHA-256 over the core's files, stamped into `src/client/core.ts` at
build by `vite.config.ts` — a marked line rewritten by a plugin, the build
failing if the marker is gone, the same mechanism as the service worker's
cache name. `tests/core-digest.test.ts` proves it moves with a byte of the
core and with nothing else; the browser suite checks the bundle announces
the digest of the tree it was built from. The submission will carry it; the
server keeps the few digests it can replay and refuses the rest. A retune
that moves a physics fixture changes the digest and starts a new board
epoch, which is what `scores.ts`'s key suffix already does locally.

## Boards

Three, from the least to the most exposed. The first exists; the others are
layers over the same trace.

1. **Local** — `scores.ts`, `localStorage`, unchanged. Every run, online or
   not, still lands here.
2. **Weekly and friends** — one seed for the day or the week, a board that
   expires, entries among people who know each other. The incentive to cheat
   is near zero and a solver against an entry that expires is not worth
   writing. Replay + ticket + ghosts suffice. This is the first online board
   to build: it needs no identity beyond a name and it is the more fun of the
   two.
3. **Global** — all-time, anonymous incentive at its maximum. Needs
   everything in the table above, identity included. Built second, on the
   same primitives; the streamed track is what it adds.

## Protocol, by phase

### Phase 1 — ranked solo, replay at the end

```
POST /ticket   { difficulty }            → { ticket, seed, expires }
POST /run      { ticket, trace, claim }  → { outcome, rank } | refusal
GET  /board/:kind                        → entries
```

The client asks for a ticket when a ranked run starts; if the request fails,
the run starts anyway with a local seed and is not ranked — the offline path
is the fallback, not an error. `claim` is the client's own outcome; the
server ignores it for scoring and uses a mismatch as a tamper or drift
signal. The server checks the ticket's window against the trace's simulated
duration, validates, replays, stores the trace with the entry, and answers
with its own outcome. The score screen shows the server's numbers when they
come and the local ones when they do not.

### Phase 2 — the streamed track

`Track.nextNode()` becomes a **node source**: the seeded generator offline,
a queue fed by the network online. The node is the same four numbers either
way — `k`, `g`, `b`, `id` — plus the items the segment carries, so the core
is bit-identical whichever fills the queue. The server generates from a seed
it never sends and serves nodes ahead of `cursor` with the same lookahead
the ring buffer holds, `COUNT` segments. A client that runs out of nodes has
lost the connection: the run ends as unranked, it does not stall.

This is also what multiplayer needs: one track, generated once, served to
every player in a room.

### Phase 3 — simultaneous multiplayer

Same track for everyone in a room; each client runs its own `Sim` for its own
ship — prediction is free, the core is the authority's twin — and sends its
trace live, in chunks, instead of at the end. The server replays each chunk
authoritatively and relays to the room what the core produces and nothing
else: distance, lateral offset, hop, yaw, thrust tier. Other ships are
presentation, drawn from those numbers on the shared track; they never enter
a client's simulation. A client whose chunks diverge from the server's replay
is tampered or drifted, and is dropped.

No hand-rolled synchronisation beyond that relay. A Durable Object is the
room: it owns the track generator, the tickets, the replays and the fan-out.
Colyseus stays the alternative if Durable Objects prove awkward, per
`ROADMAP.md`.

## Hosting: Cloudflare, all of it

The client is on Pages already. The server goes next to it:

| piece | what |
|---|---|
| Workers | the API: tickets, run submission, boards |
| Durable Objects | rooms and tickets — one object per room holds the track generator and the live replays, serialised by construction |
| D1 | boards and stored traces |

The core runs in a Worker as it is: `src/sim/tsconfig.json` empties `types`
and drops `DOM`, so it imports neither `node:*` nor the browser, and Workers
run V8 — the engine on which the core's bit-identity with Chromium and Node
was measured. The server's replay cost is the client's: 0.45 µs a step, a
three-minute run in about sixty milliseconds.

**The replay runs inside the Durable Object, never in the Worker.** The
free plan caps a Worker invocation at 10 ms of CPU; a three-minute replay is
sixty. A Durable Object request has 30 s on either plan, and the object is
where the ticket and the room live anyway — so the Worker validates the
envelope and forwards, the object replays.

### What it costs

Checked against Cloudflare's pricing pages on 11 September 2026, for a
player who plays five three-minute runs a day, looks at a board twice, and
in a room sends input chunks at 4 Hz.

| | free plan | binding limit | ceiling |
|---|---|---|---|
| Ranked boards | 100 k Worker requests, 100 k object requests, 100 k D1 writes, 5 M D1 reads a day; 5 GB storage | Worker requests, ~12 a player a day | **~8 000 active players a day** |
| Live rooms | 13 000 GB-s of object duration a day (a room-hour is 450 GB-s at the 128 MB billed); WebSocket messages billed 20 to 1 request | messages, ~720 requests a player-hour at 4 Hz | **~350–400 players a day**, four to a room, twenty minutes each |

The paid plan is $5 a month and includes 400 000 GB-s — about 900
room-hours — and 1 M object requests; past that, a room-hour costs $0.006
and messages are negligible ($0.15 a million). About 1 200 daily
multiplayer players fit in the $5; each further thousand adds roughly $5 a
month. Pages serves the client free at any traffic. Replaying a run costs
0.04 GB-s: the ranked boards never approach the duration limit, and stored
traces at ~50 KB compressed leave room for ~100 000 ghosts in the free 5 GB.

## Order of work

1. ~~The trace and its replay in the core, tested~~ — done.
2. ~~The core digest at build time~~ — done, `CORE_DIGEST`.
3. ~~The browser-to-Node proof~~ — done: `bundle.spec.ts` records a run in
   Chromium through `record()` and Node's `replay()` reaches the same
   outcome, on the three difficulties.
4. Phase 1 against a Worker, on the weekly board, with the ticket.
5. Ghosts, from stored traces — first as a local feature, replaying one's
   own best run against the live ship.
6. Phase 2, the node source and the streamed track.
7. Identity and the global board.
8. Phase 3.
