# Roadmap

Ordered so that each phase leaves the game shippable. Do not start a phase
before the one above is merged; several of them touch the same lines.

## Phase 0 — Quick wins, half a day

No architecture change. Pure gain.

- **Persist settings.** One `localStorage` key, `voidrunner.prefs.v1`, holding
  difficulty, layout, sound, haptics, tips, sky quality, frame target, render
  scale. Reuse the existing write probe. This is the most visible gap today.
- **Delete dead code.** `fmtM`, `TUNING.coinValue`.
- **Add SRI** to the three.js script tag, or vendor the file into `public/vendor/`
  and cache it with the service worker as a same-origin asset.
- **Add `prefers-reduced-motion`.** Freeze the splash animations and the HUD
  pulses. The gameplay itself can stay.
- **`aria-pressed` on toggles, `role="radiogroup"` on segmented controls.**
  Ten attributes, no logic change.
- **Move the reverb build** off the crash. Build it lazily during the run, or on
  the first pause.

## Phase 1 — Build and modules, two to three days

This is the unlock for everything after it.

- **Vite, three.js from npm pinned to `0.128.0`.** Same version exactly, so no
  behaviour changes. Verify against the r128 notes in `CLAUDE.md`.
- **Convert to ES modules.** Split along the lines that already exist:

  ```
  src/
    main.js            boot, mode machine, frame loop
    engine/
      scene.js         renderer, camera, lights, resize, render scale
      sky.js           shader background
      track.js         generator, ring buffers, buildPath, sample, gradeAt
      meshes.js        ribbons, gantries
      ship.js          model, thrust, smoke
      pickups.js       spawn, update, collect
    game/
      state.js         the state object and its reset
      physics.js       step, split into steering, jumps, collisions, damage
      score.js         multiplier, tiers, leaderboard
      tuning.js        DEFAULTS, DIFF, applyDifficulty
    ui/
      screens.js       setMode, navigation
      settings.js      slider generation, toggles
      hud.js           the per frame DOM writes
      audio.js         graph, sfx, haptics
  ```

- **Break the circular dependency while splitting.** `engine` modules must not
  import `state`; pass what they need. `updateSmoke(dt, level, ship)` rather than
  reaching for `state.speed`.
- **Keep the CodePen script working** if it is still wanted, by building a single
  IIFE target. If it fights the module split, drop it, it was always a nice to
  have.

Acceptance: the game plays identically, `npm run build` produces a `dist/` that
Cloudflare Pages serves, and the frame time on a mid range phone has not moved.

## Phase 2 — Safety net, two days

- **Fixed time step**, 120 Hz accumulator, render interpolated. Makes the
  simulation deterministic and identical across machines, which the leaderboard
  currently assumes but does not get.
- **Vitest** on the pure parts: generator with a seeded RNG, `buildPath` and
  `sample` geometry, scoring integral, multiplier erosion, frame throttle ratios.
  Aim for the logic, not the rendering.
- **JSDoc plus `checkJs`** on the shared shapes: `TUNING`, `state`, the object
  returned by `sample`. Full TypeScript is optional and can wait.
- **ESLint and Prettier**, plus a GitHub Action running lint, types and tests.

## Phase 3 — Product, open ended

Only after the above. Rough order of value:

- **Ghost replay.** Record input and seed, replay the best run as a translucent
  ship. The generator is already deterministic given a seed, which makes this
  cheaper than it sounds.
- **Seeded daily track.** Same seed for everyone for 24 hours, with its own
  leaderboard. Needs the generator to accept an injected RNG.
- **Server leaderboard** on Cloudflare Workers plus KV or D1. Note that scores
  are trivially forgeable from the console; either accept it, or submit the
  input trace and validate it server side against a headless simulation, which
  is only possible once the step is fixed.
- **More track vocabulary.** Tunnels, splits with a choice of line, moving
  obstacles, boost pads.
- **Ship progression.** Alternative hulls with different grip and boost curves,
  unlocked by score. The tuning system already supports per profile overrides.
- **Localisation.** Extract strings first, see debt item 14.

## Explicitly out of scope for now

- **three.js upgrade past r151.** Colour management and lighting defaults
  changed. Doable, but it is a visual re-tuning pass, not a dependency bump.
- **True vertical loops.** Requires quaternion frames and a degeneracy at the
  vertical. The corkscrew covers most of the appeal for none of the risk.
- **Multiplayer.** Nothing in the architecture is ready for it.
