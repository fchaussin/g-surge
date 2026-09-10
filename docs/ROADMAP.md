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

## Les deux risques qui commandent la suite

**R1 — deux implémentations de la simulation.** `src/sim/` reproduit la piste,
le réglage et la physique, mais `index.html` ne charge que `engine.js` et
`game.js` : rien n'est branché. Toute modification de la simulation doit donc
être écrite deux fois. Les tests de parité surveillent l'écart, ils ne le
suppriment pas. C'est le passif le plus coûteux du moment et il grossit à
chaque étape.

**R2 — pas de cible écrite.** Corrigé par ce document.

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

À chaque étape, `npm run verify` et `npx playwright test` doivent rester verts,
et **les références de `tests/e2e/fixtures/` ne doivent pas être régénérées**,
sauf à l'étape 6, qui déclare un changement de comportement. C'est ce qui
distingue une migration d'une réécriture.

Les références visuelles, elles, bougeront quand l'interface bougera : chaque
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

### Étape 1 — Vite, et sortir les sources de `public/` — 1 j

- Vite, three.js depuis npm épinglé à `0.128.0`, version identique.
- `index.html` à la racine, `engine.js` et `game.js` deviennent
  `src/client/engine.ts` et `src/client/game.ts`, en modules ES.
- Conversion **mécanique** : imports et exports, extension `.ts`, rien d'autre.
  Le `tsconfig` client reste permissif pour que ce soit une passe et pas trois.
- `public/` ne garde que `_headers`, le manifeste, `sw.js` et les icônes.

Risque principal : 235 liaisons globales partagées entre deux fichiers, dont
certaines lues avant d'être définies. Une conversion en deux modules d'abord,
un découpage fin plus tard, limite la casse. Le contrôle `check:globals`
disparaît au profit du compilateur.

Acceptation : `npm run build` produit un `dist/` que le serveur statique sert,
les 53 tests e2e passent **contre `dist/`**, aucune référence régénérée.

### Étape 2 — brancher `src/sim/` — 1 j

C'est l'étape qui supprime R1.

- Le client importe `Sim` et supprime ses copies de `step`, de la génération de
  piste et du réglage.
- Les événements de `events.ts` sont consommés par l'audio, l'haptique et le
  HUD, à la place des appels qui étaient dans `step()`.
- `__gs` est reconstruit au-dessus de `Sim`.

Acceptation : les références de simulation passent **sans être régénérées**,
les tests de parité restent verts, et `public/engine.js` comme `public/game.js`
ont disparu du dépôt.

### Étape 3 — service worker et déploiement — ½ j

- Vite produit des noms de fichiers avec empreinte : la liste `ASSETS` de
  `sw.js` doit être engendrée à la compilation, et `VERSION` en découler. C'est
  la partie la moins prévisible de la migration.
- Créer `public/icons/`, absent depuis toujours : le manifeste et le service
  worker pointent aujourd'hui sur quatre 404 et la PWA n'a pas d'icône.
- Cloudflare Pages : commande `npm run build`, sortie `dist`.

Acceptation : le mode hors ligne fonctionne sur un build compilé, une mise à
jour est prise sans vider le cache à la main, l'icône apparaît à l'installation.

### Étape 4 — découper le client — 1 à 2 j

`scene`, `sky`, `track-mesh`, `ship`, `pickups`, `hud`, `screens`, `settings`,
`audio`, `input`. Attaque les dettes 1, 6 et 9 côté client.

Acceptation : aucun module ne dépasse 300 lignes, aucune dépendance circulaire,
références inchangées.

### Étape 5 — la Phase 0 qui reste — ½ j

Persistance des réglages sous `gsurge.prefs.v1`, `prefers-reduced-motion`,
`aria-pressed` et `role="radiogroup"`, code mort (`fmtM`, `TUNING.coinValue`),
réverbération construite hors de l'impact.

Le SRI sur three.js sort de la liste : le paquet étant compilé dans le bundle,
il n'y a plus de script tiers à sceller.

### Étape 6 — piste déterministe — ½ j

`genSpeed = state.speed` fait dépendre la géométrie de la vitesse du joueur.
Le remplacer par le profil de vitesse nominal, déjà déterministe, rend la piste
fonction de la seule graine.

**Changement de comportement assumé** : les références de piste et de physique
sont régénérées, dans un commit qui ne fait que ça, après validation à l'œil.

Débloque : rejeu de partie, piste du jour partagée, arbitrage serveur.

### Étape 7 — documents engendrés — ½ j

Les tableaux de `GAMEPLAY.md` calculés depuis `src/sim/tuning.ts` par
`npm run docs:tuning`, et vérifiés en test. Le 62/80/98 % n'aurait pas pu
exister.

### Étape 8 — intégration continue — ½ j

Une action GitHub qui exécute `verify` et Playwright. Prettier si voulu.

**Total : environ six journées.**

## Décisions ouvertes

- **CodePen.** `scripts/build-codepen.mjs` produit trois panneaux à coller. Un
  build IIFE en cible secondaire peut le maintenir, sinon il disparaît. À
  trancher avant l'étape 1, cela change la configuration Vite.
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
