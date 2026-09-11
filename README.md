# G-SURGE

## ▶ [**PLAY — g-surge.w23.fr**](https://g-surge.w23.fr/)

[![Play](https://img.shields.io/badge/play-g--surge.w23.fr-ff2f9a?style=for-the-badge)](https://g-surge.w23.fr/)
[![PWA](https://img.shields.io/badge/PWA-installable%20%C2%B7%20offline-ffc24a?style=for-the-badge)](#install-it)
[![Version](https://img.shields.io/github/package-json/v/fchaussin/g-surge?label=version&color=25e2ff&style=for-the-badge)](package.json)
[![CI](https://github.com/fchaussin/g-surge/actions/workflows/ci.yml/badge.svg)](https://github.com/fchaussin/g-surge/actions/workflows/ci.yml)

An endless antigrav runner. One ship, one track that never repeats and never
ends — banked corners, corkscrews, jumps — and a score that is speed multiplied
by a live multiplier, added up every instant. Drift to charge, boost to score,
climb the ladder to the state the game is named after.

[![G-SURGE, mid super boost](docs/media/screenshot.png)](https://g-surge.w23.fr/)

Every run opens on a straight, then bends; the corkscrews wait until you are
five kilometres in.

No account, no download, nothing to fetch: it runs in any browser, installs as
an app on a phone or a desktop, and works offline once installed. Free, and it
stays free. The latest build, before it reaches the main address, is at
<https://g-surge.pages.dev/> — the version and commit are stamped in the menu.

## How to play

**Steer, boost, brake.** On a keyboard, left and right arrows steer, Space or
up boosts, down brakes, Esc pauses. On a phone, a thumb anywhere on the lower
left is the stick — it appears where you press and steers left and right —
and the BOOST and BRAKE pads sit in the lower right, with the boost gauge up
by the speed where no thumb covers it. A left-handed layout is in Settings.

**The score is speed × multiplier, every instant.** Distance on its own is
worth little; speed is what pays, and the multiplier is what makes it pay a
lot. Coins raise it, it erodes on its own, and **hitting a wall halves it**.
Above 1000 km/h it erodes half as fast, so holding top speed protects what you
built. The HUD shows distance and time, not the score: that is revealed at the
end, with your average speed next to it — high with a high score, that is
control.

**Drifting is the engine of everything.** Push hard into a corner until grip
breaks: the ship slides wide while pointing into the turn, the hull glows, the
gauge pulses. A drift refills the boost reserve much faster than cruising, and
it is the only way up the ladder. Chain them without touching a wall and the
**Perfect Drift** kicks in from the third: every drift pays points and the
climb runs faster, as long as the next drift starts before the window closes.
Skim a wall without touching it and the **Near Miss** pays points and a little
boost, more the closer and the faster. A rainbow prism grants a few seconds of
**invincibility**, during which a wall pushes instead of biting: lean on the
outside of a corner and ride it.

**The ladder has four rungs, and the vertical gauge is the ladder.**

| Rung | How you get there | The gauge | Coins pay |
|---|---|---|---|
| Cruise | where you start | the gold reserve, refilled by drifting | a little |
| Boost | hold BOOST while the reserve lasts | spent while you hold | more |
| Super boost | a magenta pickup — or **earn it**: drift cleanly under boost until the white layer reaches the top | white, counting down five seconds | more again |
| G-SURGE | **earned only**: keep drifting cleanly during a super boost until the warm white layer reaches the top | warm white, counting down five seconds | the most |

Found or earned, a super boost lasts the same and pins a full reserve. The
G-SURGE does not go faster — it goes quiet and white: the engine drops away,
the edges of the screen blur, and for five seconds the world closes in.
Touching a wall empties whatever you were climbing. As a rung ends, its layer
drains and uncovers the one below.

**Fuel.** The thin red bar under the hull is the tank. Boosting burns it,
a super boost burns it faster, and on Medium and Hard even cruising sips at it.
Red cans refill it, a G-SURGE fills it to the brim, and running dry takes
the boost away and drops you to about 200 km/h until the next can.

**Damage.** The green bar along the top is your hull. Impacts cost in
proportion to how hard you hit, scraping along a wall drains it, landing off
track after a jump hurts, and damage takes a little of your top speed and
steering. It heals on its own, slowly — a hit is remembered for a dozen
seconds — and green pickups heal it at once. At zero the run ends. This is an
arcade game: it forgives a mistake, not a habit, and Easy forgives most.

**Three difficulties.** Easy is the reference. Medium tightens the corners,
reaches top speed sooner, makes impacts cost more, the multiplier fade faster
and the tank leak at cruise. Hard does all of that harder, with scarce
repairs and fewer cans. A harder level
scores its runs with a coefficient, so it is never worth less.

The full reference, with every number and where it lives in the code, is
[`docs/GAMEPLAY.md`](docs/GAMEPLAY.md) — its tables are generated from the
tuning and a test fails if they drift.

## Install it

It is a progressive web app. On Android and desktop Chrome the menu offers
**INSTALL APP** when the browser allows it; on iPhone and iPad, use Share, then
**Add to Home Screen**. If it is already installed on the device, the menu
says so. The installed app runs full screen in landscape, works offline, and
tells you when a new version is ready — you choose when to restart.

`?seed=anything` pins the track: <https://g-surge.w23.fr/?seed=alpha> is the
same track for everyone who opens it.

## Documentation

Everything about how the game is built lives in [`docs/`](docs/README.md):

| | |
|---|---|
| [`docs/README.md`](docs/README.md) | For developers: layout, running it locally, Docker, deploying |
| [`docs/GAMEPLAY.md`](docs/GAMEPLAY.md) | Every rule with its number — the tables are generated from the tuning |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it works, and why the ship never moves |
| [`docs/FX-PALETTE.md`](docs/FX-PALETTE.md) | The sensory palette, and the G-SURGE specification |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What was done, in what order, and what remains |
| [`docs/TECH-DEBT.md`](docs/TECH-DEBT.md) | The honest state of the codebase, measured |
| [`docs/TODO.md`](docs/TODO.md) | Decisions waiting on the author |
| [`CLAUDE.md`](CLAUDE.md) | The rulebook for working on this repository |

TypeScript, Vite, three.js r128. The simulation is a seeded, fixed-step core
that runs without a browser and is bit-identical across engines; the client
draws it.
