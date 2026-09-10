# G-SURGE

Endless antigrav runner. Three.js r128, no build step, no framework.

## Layout

```
public/            everything that gets deployed, as is
  index.html       markup, all the CSS, the splash, the service worker hook
  engine.js        scene, track generation, meshes, ship, effects
  game.js          physics, score, screens, input, audio, main loop
  sw.js            offline cache
  manifest.webmanifest
  icons/           MANQUANT : référencé par le manifeste et sw.js, absent du dépôt
src/               le refactor en cours, pas encore servi
  sim/             noyau déterministe en TypeScript strict, sans DOM ni three.js
tests/
  rng.test.ts      Vitest, unitaire
  e2e/             Playwright : démarrage, écrans, références visuelles
scripts/
  build-codepen.mjs  splits the sources into three CodePen panels
  check-globals.mjs  détecte un nom déclaré dans engine.js et game.js à la fois
```

`public/` reste l'artefact déployé et fonctionne seul. `src/` est construit à
côté et ne sera branché qu'une fois le noyau à parité, voir `docs/ROADMAP.md`.

## Local

    npm install      # outillage de dev uniquement, le jeu n'a aucune dépendance
    npm run dev      # serves public/ on http://localhost:5173
    npm run verify   # syntaxe, collisions de noms, types, lint, tests

    npm run test:e2e # Playwright : démarrage, écrans, références visuelles

`npm run verify` est la commande à passer après toute modification. Les cinq
étapes sont aussi appelables séparément : `check`, `check:globals`, `typecheck`,
`lint`, `test`. `npm run verify:all` y ajoute la suite Playwright.

Les tests de bout en bout tournent sur l'hôte uniquement, l'image de dev ne
contenant pas de navigateur. Ils rejouent three.js depuis une copie locale
plutôt que depuis cdnjs, pour être exécutables hors ligne et pour qu'un échec
désigne le jeu et pas le réseau.

A plain static server is enough. Open over http, not file://, or the service
worker and the manifest are ignored.

Le paramètre `?seed=` fige la piste : `http://localhost:5173/?seed=alpha` rejoue
exactement la même génération à chaque chargement. Sans lui, chaque partie tire
sa propre graine.

## Docker

Même chose sans rien installer sur la machine, Node et le serveur statique
vivent dans l'image :

    docker compose up --build          # http://localhost:5173
    docker compose run --rm tools npm run check
    docker compose run --rm tools npm run build
    docker compose down

Les sources sont montées, pas copiées : une édition est servie au rechargement
suivant, l'image n'est à reconstruire que si le `Dockerfile` change. Le port se
change avec `GSURGE_PORT=8080`.

Le démon local est en mode rootless, où l'uid 0 du conteneur est déjà
l'utilisateur de l'hôte, et `compose.yaml` en tient compte. Sur un démon
classique, lancer avec `GSURGE_USER="$(id -u):$(id -g)"` pour que `dist/` ne
sorte pas en root.

Le serveur force `Cache-Control: no-cache` (`docker/serve.json`), sans quoi le
cache heuristique du navigateur sert un `engine.js` périmé. Le service worker,
lui, garde sa propre copie : pendant une session de dev, cocher *Update on
reload* dans l'onglet Application, ou bumper `VERSION` dans `sw.js`.

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
- The leaderboard lives in `localStorage` under `gsurge.scores.v1`. A board
  written under the previous name, `voidrunner.scores.v1`, is picked up once and
  the old key removed. Private browsing falls back to memory for the session.
- `navigator.vibrate` does not exist on iOS, the haptics switch hides itself.
