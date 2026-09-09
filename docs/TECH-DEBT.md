# Technical debt

Measured on the current tree, not estimated. Every number below came from
scanning the sources. Severity is about risk of breaking something or of
slowing future work, not about how ugly it looks.

## Summary

| # | Item | Severity | Effort |
|---|---|---|---|
| 1 | No module system, 178 shared global bindings | High | L |
| 2 | Circular dependency between the two files | High | M |
| 3 | ~~No tests at all~~ Couverture partielle depuis le filet e2e | Medium | M |
| 4 | ~~Variable time step physics~~ Pas fixe à 720 Hz | — | fait |
| 5 | Settings are not persisted | Medium | S |
| 6 | 71 hardcoded DOM ids, no UI layer | Medium | L |
| 7 | three.js pinned to r128 from 2021, no SRI | Medium | M |
| 8 | No types, no JSDoc | Medium | L |
| 9 | `step()` is 176 lines, `frame()` is 123 | Medium | M |
| 10 | Accessibility is absent | Medium | M |
| 11 | 38 of 70 tuning keys unreachable from the UI | Low | S |
| 12 | Dead code | Low | S |
| 13 | No lint, no formatter, no CI | Low | S |
| 14 | All strings hardcoded in English | Low | M |
| 15 | Reverb built on the main thread | Low | S |

## 1. No module system

`engine.js` declares 67 top-level bindings, `game.js` declares 111. All 178 live
in the same lexical scope because they are classic scripts. Consequences:

- A name declared in both files is a parse error that only shows at runtime.
- Nothing states what `game.js` needs from `engine.js`. The answer happens to be
  34 symbols, but you have to grep to find out.
- No dead code elimination, no minification pipeline, no code splitting.

The guard rail today is a one-line check:
`cat public/engine.js public/game.js > /tmp/x.js && node --check /tmp/x.js`.
That catches collisions and nothing else.

## 2. Circular dependency

`engine.js` reads three symbols that `game.js` owns: `state`, `step` and `L`.
The load order says engine comes first, so this only works because the reads
happen inside functions called later. It is invisible until someone moves a
call to module scope.

The fix is to invert it: engine should receive what it needs as arguments, or
own the state it reads. `updateSmoke` and `updateItems` are the main offenders,
both reaching into `state` for speed, cursor and lateral position.

## 3. Tests, partiellement traité

Il n'y en avait aucun. Il y a désormais un filet de non régression :

- Playwright, 49 tests sur trois profils : démarrage, géométrie du canvas,
  machine à états, navigation clavier, références visuelles des écrans.
- Des références figées de la génération de piste, sur soixante graines, et de
  la physique, sur trois difficultés, capturées par `__gs.trace` à pas fixe.
  Elles ont été validées en perturbant délibérément le code : une constante de
  physique, une probabilité de génération à un pour cent près, et un décalage
  du PRNG font toutes tomber la référence correspondante.
- Vitest sur `src/sim/rng.ts`.

Ce qui manque encore :

- `buildPath` et `sample`, le cœur géométrique, ne sont couverts
  qu'indirectement par les traces.
- Le régulateur de cadence, qui avait déjà le bug du 144 Hz visant 120 et
  retombant à 72, n'est pas testé du tout.
- Aucune référence pixel du rendu 3D : le canvas est écarté des captures, faute
  d'un pas de simulation fixe côté jeu. Voir la dette 4.

Les bugs visuels se trouvaient à l'œil, sur un téléphone, après un déploiement.
Cette boucle est raccourcie, pas supprimée.

## 4. Pas de temps, traité

La simulation avance par pas fixes de 1/720 s. Mesuré avant la bascule, sur
quinze secondes de jeu : 6,6 m d'écart entre 60 et 144 Hz, et à 30 Hz la
trajectoire déviait assez pour ramasser d'autres pièces. Toutes les machines
simulent maintenant la même chose.

720 est le plus petit entier divisible par 60, 72, 90, 120, 144 et 240. Une
image tombe donc toujours sur un état de simulation exact, ce qui évite
d'interpoler le rendu : douze pas par image à 60 Hz, cinq à 144. Un pas coûte
0,45 µs mesuré, soit 0,03 % d'un cœur.

Sur 75 et 165 Hz, qui ne divisent pas 720, le compte alterne entre deux entiers
voisins et le déplacement d'une image varie de ±11 %. Une simulation à 120 Hz
sur un écran 144 aurait alterné entre zéro et un pas, soit ±120 % : c'est la
finesse du pas qui rend l'interpolation superflue, pas sa cadence nominale.

Ce qui reste : le rendu n'est pas interpolé, donc sur ces deux cadences le
résidu subsiste. Il est sous le seuil de perception, mais il est là.

## 5. Settings are not persisted

Only scores are stored. Difficulty, reversed layout, sound, haptics, tips,
background quality, frame rate target and render scale all reset on every
reload. This is the single most visible gap for a returning player, and the
cheapest to close.

## 6. DOM coupling

72 `getElementById` calls over 71 distinct ids, plus 10 `querySelector` calls,
spread through `game.js`. The ids exist in three places at once: the HTML, the
lookup, and often a CSS rule. Renaming anything means a three way search.

There is no UI module. Screen logic, settings generation, audio switches and
HUD updates are interleaved in the same file.

## 7. three.js r128

Released April 2021. It is pinned deliberately: the code depends on r128
behaviour, including `MeshLambertMaterial` ignoring `flatShading` and the
absence of colour management. Upgrading is a real project, not a version bump,
because r152 changed colour space handling and lighting intensity by default.

Separately, the CDN script tag has no `integrity` attribute. A compromised cdnjs
would execute arbitrary code. Either add SRI or vendor the file.

## 8. No types

70 tuning keys, a `state` object with 25 fields, and geometry helpers that
return bare objects with eleven properties. Nothing declares any of it.
JSDoc plus `checkJs` would catch most of it without moving to TypeScript.

## 9. Long functions

`step()` is 176 lines and does input, boost, difficulty erosion, distance,
jumps, lateral dynamics, walls, pickups and damage. `frame()` is 123 lines.
Both are readable today because they were written linearly, but neither can be
tested in pieces and both are where merge conflicts will land.

## 10. Accessibility

No `aria-pressed` on the nine custom toggles, no `role="radiogroup"` on the
three segmented controls, no `prefers-reduced-motion` handling despite a splash
screen and a HUD full of animation. Damage, boost tier and difficulty are all
signalled by colour alone. The keyboard navigation is custom and hijacks Tab.

## 11. Tuning coverage

70 keys in `DEFAULTS`, 32 exposed as sliders. The 38 hidden ones include things
a designer will want first: camera distance and height, field of view, coin
pickup radius, jump gravity, damage from scraping, boost minimum. They are
reachable from the console through `window.TUNING` but nothing says so.

## 12. Dead code

- `fmtM` is declared and never called. It was orphaned when the score screen
  moved from metres to points.
- `TUNING.coinValue` survives in `DEFAULTS` but nothing reads it since coins
  started feeding the multiplier instead of a fixed bonus.
- Six ids exist in the HTML that no script reads: `boot`, `bootBar`,
  `bootLabel`, `diffEasy`, `diffMedium`, `diffHard`. The first three are used by
  the inline splash script, the last three only by CSS, but that is not obvious.

## 13. No tooling

No linter, no formatter, no CI, no dependencies at all. `npm run check` is two
`node --check` calls. A `git push` can break the build and nothing will say so.

## 14. Strings

Every label is inline, split between the HTML and two JavaScript tables
(`TIPS`, `SLIDERS`, `DIFF`). Localising means touching all three.

## 15. Reverb on the main thread

The 3 s impulse response is 288000 samples over two channels, generated with a
`Math.random` loop the first time the player crashes. That is a visible hitch at
the worst possible moment. Generate it during the run or offload it.

## What is deliberately not debt

- **No bundler** is a choice, not an accident, and it is why the project has
  zero install and deploys as static files. It becomes debt the moment the
  codebase grows past two files.
- **The ship at the origin** is unusual but correct, and it removes a whole class
  of precision bugs.
- **Synthesised audio** keeps the payload at 192 KB with no asset pipeline.
- **`MeshBasicMaterial` everywhere** is what makes the neon look work and keeps
  the fragment cost low.
