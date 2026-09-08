# Void Runner

Endless antigrav runner. Three.js r128, no build step, no framework.

## Layout

```
public/            everything that gets deployed, as is
  index.html       markup, all the CSS, the splash, the service worker hook
  engine.js        scene, track generation, meshes, ship, effects
  game.js          physics, score, screens, input, audio, main loop
  sw.js            offline cache
  manifest.webmanifest
  icons/
scripts/
  build-codepen.mjs  splits the sources into three CodePen panels
```

## Local

    npm run dev      # serves public/ on http://localhost:5173
    npm run check    # syntax check on both scripts

A plain static server is enough. Open over http, not file://, or the service
worker and the manifest are ignored.

## Cloudflare Pages

Connect the repository and set:

- Build command: *(leave empty)*
- Build output directory: `public`

Nothing is compiled. `public/_headers` is picked up by Pages and sets the cache
policy: `index.html` and `sw.js` are never cached, icons are immutable.

## CodePen

    npm run build

Writes `dist/codepen/pen.html`, `pen.css` and `pen.js`. Paste each into its
panel, then add three.js r128 under Settings, JS, Add External Scripts:

    https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js

Fullscreen is refused inside the embedded preview but works in debug view.

## Docs

| File | What it answers |
|---|---|
| `CLAUDE.md` | Rules for an agent working on this repo, and the traps already paid for |
| `docs/ARCHITECTURE.md` | How it works, and why the ship never moves |
| `docs/TECH-DEBT.md` | Honest state of the codebase, measured |
| `docs/ROADMAP.md` | What to do first, in order, without breaking things |
| `docs/GAMEPLAY.md` | Scoring, difficulty, handling, and the constants that matter |

## Known constraints

- three.js is pinned to r128 and loaded from cdnjs. The code relies on r128
  behaviour, see CLAUDE.md before upgrading.
- The leaderboard lives in `localStorage` under `voidrunner.scores.v1`. Private
  browsing falls back to memory for the session.
- `navigator.vibrate` does not exist on iOS, the haptics switch hides itself.
