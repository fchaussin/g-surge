# Roadmap

État au 10 septembre 2026. Ce document remplace la feuille de route en phases
0-3, dont la numérotation avait divergé du travail réellement fait.

## Où on en est

Six commits sur `refactor/tooling`, non fusionnée, arbre propre.

| Fait | Effet |
|---|---|
| Outillage | TypeScript strict, Vitest, ESLint, `npm run verify` |
| Filet Playwright | 53 tests, trois profils, références visuelles à tolérance nulle |
| Renommage G-SURGE | interface, manifeste, Docker, classement repris |
| Simulation déterministe | PRNG seedé, `?seed=`, références de piste et de physique figées |
| Noyau extrait | `src/sim/` en TypeScript strict, parité prouvée contre le jeu |
| Pas fixe | 720 Hz, sans interpolation, cibles de cadence dérivées de l'appareil |

Dettes soldées : 4 (pas de temps). Largement entamées : 3 (tests), 13
(outillage), 8 et 9 côté `src/sim/`. Intactes : 1, 5, 6, 10, 11, 12, 14, 15.

## Le legacy et le nouveau code

`public/engine.js`, `public/game.js` et `public/index.html` sont **la version
legacy**. Elle est gelée : on n'y écrit plus rien. Ce n'est pas une seconde
implémentation à tenir synchronisée avec `src/sim/`, c'est l'ancienne version
qui sera supprimée à la bascule.

Trois conséquences, et elles commandent tout le reste :

- **Aucun correctif ne descend dans le legacy.** Les manques fonctionnels —
  persistance des réglages, accessibilité, code mort, réverbération — attendent
  le nouveau client. Le jeu déployé ne reçoit donc plus rien jusqu'à la
  bascule ; c'est le prix, il est assumé.
- **Pas d'état intermédiaire jetable.** On ne renomme pas deux gros fichiers en
  `.ts` pour les découper ensuite : le nouveau code naît directement à la
  structure cible, sous-système par sous-système.
- **On porte, on ne réécrit pas.** `CLAUDE.md` recense des pièges payés cher
  dans les shaders, la géométrie des rubans, la caméra et la traînée. Le code
  qui les évite est juste ; il change de fichier et de langage, pas de contenu.

Les références figées de `tests/e2e/fixtures/` sont le **contrat de
comportement**, et elles survivent au legacy. Le jour où le nouveau client les
satisfait, les trois fichiers disparaissent sans que rien ne soit perdu.

## La cible

Un seul code source, en TypeScript, compilé vers `dist/`.

```
index.html            point d'entrée Vite
src/
  sim/                le noyau, déjà écrit — sans DOM ni three.js
  client/             rendu, interface, audio, entrées, boucle
public/               actifs copiés tels quels : _headers, manifeste, icônes, sw
dist/                 produit par `npm run build`, non versionné
```

`public/` change de sens : il ne contient plus de source, seulement des actifs
statiques, ce qui est la convention Vite. Cloudflare Pages passe d'un
déploiement sans compilation à `npm run build` avec `dist` en sortie.

Conséquence directe : la règle « `public/` is the artefact, no build step » de
`CLAUDE.md` disparaît. C'est un changement délibéré, pas un effet de bord.

## L'invariant qui rend la migration sûre

**Les références de `tests/e2e/fixtures/` ne sont pas régénérées**, sauf à
l'étape 7 qui déclare son changement de comportement. Le nouveau client doit
les satisfaire, pas les redéfinir : c'est ce qui distingue un portage d'une
réécriture.

Pendant les étapes 2 et 3, le nouveau client n'est que partiellement testable —
c'est le creux inhérent à un portage en parallèle. Ce qui le couvre pendant ce
temps : les tests de parité du noyau, déjà verts, et le legacy qui reste la
référence exécutable tant qu'il est là.

Les références visuelles bougeront quand l'interface bougera : chaque
régénération doit être un commit qui ne fait que ça.

## Étapes

Estimations en journées de travail concentré, pour un seul intervenant.

### Étape 0 — remettre les documents d'aplomb — ½ j

Les corrections relevées en début de session et jamais appliquées :

- `TECH-DEBT.md` §2 : `engine.js` ne lit qu'un symbole de `game.js`, `state`.
  `step` et `L` étaient des faux positifs, fonction GLSL et étiquettes de
  sommets.
- `TECH-DEBT.md` §1, §6, §8, §10 : comptages faux — 235 liaisons et non 178,
  74 `getElementById` et non 72, 27 champs d'état et non 25, 8 interrupteurs et
  2 groupes segmentés et non 9 et 3.
- `ARCHITECTURE.md` : nombres de lignes, dont `sw.js` donné pour 60 au lieu de
  74.
- `GAMEPLAY.md` : la ligne « share of steering authority » 62/80/98 % est
  fausse. Le numérateur est bon, le diviseur ne correspond à rien dans le code.
  Les vraies valeurs sont 51/66/80 % du manche, et surtout la métrique est la
  mauvaise : le plafond est `gripLimit`, franchi dès Medium.
- Trancher la langue des documents. Ils sont aujourd'hui bilingues, ce qui est
  pire que l'un ou l'autre.

Acceptation : plus aucun chiffre de `docs/` invérifiable dans le code.

### Étape 1 — squelette du nouveau client — 1 j

- Vite, three.js depuis npm épinglé à `0.128.0`, version identique.
- `index.html` à la racine, `src/client/main.ts`, `tsconfig` client permissif.
- Le filet e2e doit pouvoir viser soit le legacy, soit le nouveau build : c'est
  lui l'outil de migration, pas une vérification de fin de course.

Acceptation : `npm run build` produit un `dist/` servi par le serveur statique,
la page monte une scène et rend une image, les 53 tests contre le legacy
passent toujours.

### Étape 2 — porter le rendu — 1 à 2 j

Depuis `engine.js`, vers `src/client/` : `scene`, `sky`, `track-mesh`, `ship`,
`pickups`. Chaque piège de `CLAUDE.md` traversé est vérifié en arrivant —
précision du shader de ciel, période des chevrons, taille CSS du canvas,
bornage de l'échelle des sprites.

`buildPath`, `sample` et `gradeAt` rejoignent le noyau : ce sont des fonctions
pures des tampons de piste, elles n'ont rien à faire dans la couche de rendu.

Acceptation : la piste, le vaisseau et le ciel s'affichent depuis `src/sim/`,
sans un seul appel au legacy.

### Étape 3 — porter le client de jeu — 1 à 2 j

Depuis `game.js` : boucle et horloge, HUD, écrans et navigation clavier,
réglages, audio, haptique, entrées. Le tout consommant les événements de
`src/sim/events.ts` à la place des appels qui étaient dans `step()`.

Le CSS de `index.html` est repris tel quel : les références visuelles le figent
au pixel, c'est la partie la moins risquée du portage.

Acceptation : le nouveau client se joue, tous les écrans répondent.

### Étape 4 — parité, puis bascule — 1 j

- La suite e2e complète passe contre le nouveau build, sur les trois profils.
- Les références de simulation passent **sans être régénérées**.
- Suppression de `public/engine.js`, `public/game.js`, `public/index.html`.
- Cloudflare Pages : commande `npm run build`, sortie `dist`.

C'est ici que le legacy meurt, et pas avant : tant qu'il est là, il reste la
référence exécutable si une divergence apparaît.

### Étape 5 — service worker et actifs — ½ j

- Vite produit des noms de fichiers avec empreinte : la liste `ASSETS` de
  `sw.js` doit être engendrée à la compilation, et `VERSION` en découler. C'est
  la partie la moins prévisible de la migration.
- Créer `public/icons/`, absent depuis toujours : le manifeste et le service
  worker pointent aujourd'hui sur quatre 404 et la PWA n'a pas d'icône.

Acceptation : le mode hors ligne fonctionne sur un build compilé, une mise à
jour est prise sans vider le cache à la main, l'icône apparaît à l'installation.

### Étape 6 — les manques fonctionnels — ½ j

Persistance des réglages sous `gsurge.prefs.v1`, `prefers-reduced-motion`,
`aria-pressed` et `role="radiogroup"`, code mort (`fmtM`, `TUNING.coinValue`),
réverbération construite hors de l'impact.

Le SRI sur three.js sort de la liste : le paquet étant compilé dans le bundle,
il n'y a plus de script tiers à sceller.

### Étape 7 — piste déterministe — ½ j

`genSpeed = state.speed` fait dépendre la géométrie de la vitesse du joueur.
Le remplacer par le profil de vitesse nominal, déjà déterministe, rend la piste
fonction de la seule graine.

**Changement de comportement assumé** : les références de piste et de physique
sont régénérées, dans un commit qui ne fait que ça, après validation à l'œil.

Débloque : rejeu de partie, piste du jour partagée, arbitrage serveur.

### Étape 8 — documents engendrés — ½ j

Les tableaux de `GAMEPLAY.md` calculés depuis `src/sim/tuning.ts` par
`npm run docs:tuning`, et vérifiés en test. Le 62/80/98 % n'aurait pas pu
exister.

### Étape 9 — intégration continue — ½ j

Une action GitHub qui exécute `verify` et Playwright. Prettier si voulu.

**Total : sept à neuf journées.** Plus que les six annoncées avant : porter
proprement coûte davantage qu'une conversion mécanique, et c'est ce qui évite
un découpage à refaire ensuite.

## Décisions ouvertes

- **CodePen.** `scripts/build-codepen.mjs` découpe les fichiers legacy en trois
  panneaux. Il meurt donc avec eux à l'étape 4, sauf à le réécrire en cible
  IIFE secondaire. À trancher avant l'étape 4, pas avant l'étape 1.
- **Langue des documents.** Français ou anglais, mais un seul.
- **`dist/` versionné ou non.** Recommandation : non, Cloudflare Pages compile.
- **Fusion de `refactor/tooling`.** Six commits qui tiennent debout. Les
  fusionner dans `main` avant l'étape 1 évite une branche de trois semaines.

## Hors périmètre

- **Multijoueur.** Les spécifications viendront après ces étapes. L'étape 6 en
  lève le dernier verrou technique ; rien d'autre n'est engagé.
- **three.js au-delà de r151.** Gestion des couleurs et intensités lumineuses
  changées : c'est une passe de retouche visuelle, pas une montée de version.
- **Boucles verticales.** Demandent des repères en quaternions et une
  dégénérescence à la verticale. La vrille couvre l'essentiel de l'intérêt.
- **Rendu interpolé.** Le pas à 720 Hz divise les cadences d'écran courantes,
  l'interpolation n'a plus d'objet. Ne pas la réintroduire sans mesurer.
