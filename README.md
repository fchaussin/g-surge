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

## Docker

Même chose sans rien installer sur la machine, Node et le serveur statique
vivent dans l'image :

    docker compose up --build          # http://localhost:5173
    docker compose run --rm tools npm run check
    docker compose run --rm tools npm run build
    docker compose down

Les sources sont montées, pas copiées : une édition est servie au rechargement
suivant, l'image n'est à reconstruire que si le `Dockerfile` change. Le port se
change avec `VOIDRUNNER_PORT=8080`.

Le démon local est en mode rootless, où l'uid 0 du conteneur est déjà
l'utilisateur de l'hôte, et `compose.yaml` en tient compte. Sur un démon
classique, lancer avec `VOIDRUNNER_USER="$(id -u):$(id -g)"` pour que `dist/` ne
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

## Known constraints

- three.js is pinned to r128 and loaded from cdnjs. The code relies on r128
  behaviour, see CLAUDE.md before upgrading.
- The leaderboard lives in `localStorage` under `voidrunner.scores.v1`. Private
  browsing falls back to memory for the session.
- `navigator.vibrate` does not exist on iOS, the haptics switch hides itself.
