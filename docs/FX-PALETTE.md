# Extensions système — Drift & Superboost

> **Ce document est une base de ressources, pas une liste de features à
> implémenter.** Il sert de palette où puiser — surtout pour les FX qui
> renforcent l'impression de vitesse. Rien ici n'est un engagement, et l'ordre
> des sections n'est pas un ordre de travail.

Ce document a été traduit dans le vocabulaire du code le 2026-09-10 : chaque
effet nomme désormais le symbole réel qui le porte, ou dit qu'il n'en existe
aucun. Les termes d'origine venaient d'un middleware audio (`RTPC`, `Trigger
Tag`, `Bundle`) qui n'a pas de référent ici, et on ne peut pas sélectionner un
effet dont on ignore s'il coûte une ligne ou une boucle de jeu.

Les colonnes `Statut` ont été revues après l'étape 1 de la roadmap, qui a
différencié le superboost. Elles disent l'état du code, pas une intention : un
effet ne passe à « existe » qu'une fois écrit, mesuré, et vérifié contre les
références figées.

Les chiffres cités le sont toujours avec leur symbole, et `src/sim/tuning.ts`
reste la source de vérité — voir la dette §19, qui existe précisément parce
qu'un document a porté un chiffre faux pendant des mois.

## Comment lire les tables

- **Déclencheur** — le symbole d'état ou l'événement qui porte l'effet.
  « à créer » quand l'instant existe dans le code mais que rien ne l'émet ;
  « n'existe pas » quand le concept lui-même est absent.
- **Module** — le fichier où l'effet se pose.
- **Classe** — ce que l'effet coûte en références figées, et c'est la seule
  chose qui distingue une après-midi d'une semaine :

| Classe | Ce que ça touche | Coût |
|---|---|---|
| **A** | client seul — `camera.ts`, `ship.ts`, `sky.ts`, `hud.ts`, `audio.ts`, `haptics.ts` | aucune fixture de simulation. Mais si l'effet apparaît dans une des trois captures de scène, il doit être remis à zéro dans `freeze()` (`main.ts`) — le piège que `CLAUDE.md` documente trois fois |
| **B** | un événement dans `events.ts`, ou un champ d'état non-physique | **gratuit en références** : `physics-*.json` enregistre une liste blanche de dix-sept champs et **aucun événement**. Tant que l'arithmétique ne bouge pas, rien ne bouge |
| **C** | la physique ou le tuning | changement de comportement déclaré : `npm run fixtures:update`, commit dédié qui ne fait que ça, `GAMEPLAY.md` se régénère |

- **Statut** — `existe` / `partiel` / `absent`.
- **Prio** — inchangée. C'est un jugement de design, pas un relevé.

## Ce que le code contient déjà

- **Le drift est implémenté et boucle avec le boost.** `state.drift` (booléen)
  et `state.slip` dans la simulation. Entrée et sortie sont une hystérésis dans
  `step.ts` : on entre quand `|dv| * gripHold > gripLimit`, on sort sous
  `driftExit`. Impossible en l'air, `state.drift` y est forcé à faux.
- **`state.slip` n'est pas un angle.** C'est `dv`, l'écart entre la vitesse
  latérale que le nez réclame et celle que les appuis encaissent, en m/s. La
  palette d'origine en parlait comme d'un `DRIFT_ANGLE` ; tout effet qui veut un
  angle devra le dériver, et tout effet normalisé devra choisir un plafond —
  le rendu prend aujourd'hui `driftYaw` puis sature à ±0,42 rad, donc à 35 m/s.
- **`DRIFT_CHARGE` et la réserve de boost sont la même variable**, `state.energy`,
  de 0 à 100. La recharge de drift vaut `driftCharge` = 17 points/s, à comparer à
  `boostRecharge` = 10. Deux concepts dans la palette, un seul champ dans le code.
- **Le superboost est implémenté**, ramassé sur la piste (`supChance`), d'une
  durée `supTime` = 2,6 s. **Il est différencié depuis l'étape 1** : le palier
  de poussée, `thrustTier()` dans `src/client/thrust.ts`, est lu par la caméra,
  le ciel, l'audio et le vaisseau, là où chacun relisait `state.boosting`. Ce
  qui n'est toujours pas différencié est la vitesse elle-même : `supFactor` =
  1,08 ne le place que 8 % au-dessus d'un boost, et c'est la décision laissée à
  l'étape 5 de la roadmap.
- **`uWarp` ne déforme toujours rien** : le shader n'en fait qu'un gain de
  luminosité, `col *= 1.0 + uWarp * 0.55`, désormais gradué par palier. Le filé
  du superboost est un effet distinct, `uStreak`, qui prélève la couche
  d'étoiles en dix points le long de la ligne radiale. Une première version
  étirait la cellule et ne pouvait pas marcher : la grille vaut 2,4 px par
  cellule à l'écran et `fract` y boucle, donc la traînée saturait à 2,9 px sur
  une étoile de 0,8 px. Mesurer avant de régler, ici comme ailleurs.
- **Il n'y a pas de post-process.** Aucun `EffectComposer`, aucune passe : tout
  blur ou aberration est un ajout de pipeline, pas un réglage.
- **Les seules particules sont la traînée de fumée** : 18 sprites parentés au
  vaisseau, placés par phase le long d'une traînée, pas un émetteur événementiel.
  Le halo (`ship.setHalo`) est une sphère additive déjà pilotée par les
  événements, et c'est le support le plus proche d'une onde de choc.
- **N'existent pas du tout, et sont des mécaniques, pas des FX** : la chaîne de
  drift, le stock de superboost avec sa disponibilité et son activation — le
  pickup déclenche l'effet immédiatement — la phase de recovery, et l'état
  `G_SURGE`. Le jeu porte le nom d'un état qu'il n'a pas encore.

## 1. Concepts, et leur référent dans le code

| Terme de la palette | Dans le code | Statut |
|---|---|---|
| `DRIFT` | `state.drift` | existe |
| `DRIFT_ANGLE` | `state.slip`, en m/s et non en radians | existe, à convertir |
| `DRIFT_CHARGE` | `driftCharge` → `state.energy` | existe, confondu avec la réserve de boost |
| `DRIFT_CHAIN` | — | **n'existe pas** — mécanique, classe C |
| `SUPERBOOST_PICKUP` | événement `pickup` de `kind: 'sup'` | existe |
| `SUPERBOOST` | `state.superT`, `supTime`, `supFactor` | existe |
| `SUPERBOOST_CHARGE` | — | **n'existe pas** : pas de stock |
| `SUPERBOOST_START` | — | **n'existe pas** : le ramassage déclenche |
| `SUPERBOOST_END` | `superT` retombe à zéro, sans événement | instant présent, non émis |
| `RECOVERY` | — | **n'existe pas** |
| `G_SURGE` | — | **n'existe pas** |
| `RTPC` | les paramètres de `audio.update()`, `sky.update()` | voir §12 |
| `Trigger Tag` | les variantes de `SimEvent` dans `events.ts` | voir §3 |
| `Bundle` | rien — regroupement de rédaction, conservé tel quel | — |

## 2. Hiérarchie des accélérations

La palette en voulait cinq. Le code en a **trois**, portées par une seule
variable : le palier, `thrustTier()` dans `src/client/thrust.ts`, lu par la
caméra, le ciel, l'audio et le vaisseau. Avant l'étape 1 le ternaire était
recopié à deux endroits de `main.ts` et personne d'autre ne le voyait.

| Niveau | Palette | Dans le code | Statut |
|---:|---|---|---|
| 0 | `CRUISE` | palier 0 | existe |
| 1 | `FAST` | — confondu avec 0, seule la vitesse change | absent |
| 2 | `BOOST` | palier 1, `state.boosting` | existe |
| 3 | `SUPERBOOST` | palier 2, `state.superT` | existe, différencié |
| 4 | `G_SURGE` | — | absent |

Le joueur doit pouvoir identifier chaque niveau sans regarder l'interface. Le
palier 3 se distingue maintenant du 2 par le champ, la caméra, le ciel et le
son ; le palier 1 reste confondu avec le 0, et le 4 n'existe pas.

## 3. Déclencheurs

`events.ts` porte une union discriminée, drainée une fois par pas. Ce qui existe :
`land`, `badLanding`, `wallImpact`, `scrape`, `pickup` (`coin` / `fix` / `sup`),
`wreck`.

Ce que la palette réclame et qu'il faudrait y ajouter — tous classe **B**, donc
sans effet sur les références :

| Événement | Où l'émettre | Note |
|---|---|---|
| `driftStart` | `step.ts`, à la bascule de `state.drift` à vrai | l'instant existe déjà |
| `driftEnd` | même bascule, à faux | idem |
| `supEnd` | `step.ts`, quand `superT` atteint zéro | idem |
| `supStart` | — | **n'existe pas** tant que le ramassage déclenche l'effet ; c'est le même instant que `pickup kind:'sup'` |
| `boostFull` | `step.ts`, au franchissement de 100 | le HUD calcule déjà le seuil de son côté |

Les grandeurs continues (`DriftIntensity`, `SuperboostRemaining`) ne sont pas des
événements : elles se lisent dans l'état, voir §12.

## 4. Regroupements Drift

| Regroupement | Objectif | Déclencheur | Statut |
|---|---|---|---|
| `DRIFT_ENTRY` | donner un impact clair au début du drift | `driftStart` — à créer | absent |
| `DRIFT_FLOW` | faire sentir le déplacement latéral | `state.drift`, `state.slip` | partiel — lacet du vaisseau et bande de bruit |
| `DRIFT_CHARGE` | montrer que le drift recharge le boost | `state.energy` montant | partiel — HUD seul |
| `DRIFT_CHAIN` | valoriser un drift long et propre | chaîne — n'existe pas | absent, classe C |
| `DRIFT_RELEASE` | marquer la sortie | `driftEnd` — à créer | absent |
| `DRIFT_FULL_CHARGE` | signaler le boost rechargé | `energy > 99.5` | partiel — classe CSS `.full` |

## 5. VFX Drift

| ID | Effet | Déclencheur | Module | Classe | Statut | Prio |
|---|---|---|---|---|---|---|
| `SHIP_DRIFT_YAW` | Lacet visuel du vaisseau | `state.slip * driftYaw` | main.ts, ship.ts | A | **existe**, sature à 35 m/s | — |
| `HUD_DRIFT_LABEL` | Mention « DRIFT » | `state.drift` | hud.ts | A | **existe**, masquée par « WALL HIT » | — |
| `HUD_DRIFT_CHARGE` | Jauge de recharge | `state.energy`, classes `.charge` | hud.ts + CSS | A | **existe** | P0 |
| `CAM_DRIFT_YAW` | Retard d'orientation de caméra | `state.slip` | camera.ts | A | absent — la caméra ne lit ni `slip` ni `drift` | P0 |
| `CAM_DRIFT_ROLL` | Roll selon la dérive | `state.slip` | camera.ts | A | absent — le roll ne suit que le dévers | P0 |
| `CAM_DRIFT_EXIT_SNAP` | Recentrage à la sortie | `driftEnd` — à créer | camera.ts | B | absent | P1 |
| `FX_DRIFT_PARTICLES` | Particules projetées latéralement | `state.drift`, `state.slip` | ship.ts | A | absent | P0 |
| `FX_DRIFT_CHARGE` | Énergie visible sur le vaisseau | `state.energy` + `state.drift` | ship.ts | A | absent | P0 |
| `FX_DRIFT_WAKE` | Turbulence derrière le vaisseau | `state.slip` | ship.ts | A | absent | P1 |
| `PP_DRIFT_BLUR` | Blur dirigé | `state.slip` | — | A | absent, **et il n'y a pas de pipeline de post-process** | P1 |

## 6. SFX et haptique Drift

| ID | Effet | Déclencheur | Module | Classe | Statut | Prio |
|---|---|---|---|---|---|---|
| `SFX_DRIFT_AIRFLOW` | Flux aérodynamique latéral | paramètre `drifting` de `update()` | audio.ts | A | **existe** — bande 2600 Hz, mais tout ou rien | P0 |
| `SFX_DRIFT_ENTRY` | Transient d'entrée | `driftStart` — à créer | audio.ts | B | absent | P0 |
| `SFX_DRIFT_CHARGE` | Son de recharge | `state.energy` montant | audio.ts | A | absent | P0 |
| `SFX_DRIFT_FULL_CHARGE` | Confirmation boost prêt | `energy > 99.5` | audio.ts | A | absent | P0 |
| `SFX_DRIFT_TURBULENCE` | Turbulence irrégulière | `state.slip` normalisé | audio.ts | A | absent | P1 |
| `SFX_DRIFT_RELEASE` | Whoosh de réalignement | `driftEnd` — à créer | audio.ts | B | absent | P1 |
| `SFX_DRIFT_CHAIN` | Intensification progressive | chaîne — n'existe pas | audio.ts | C | absent, mécanique | P1 |
| `HAP_DRIFT_ENTRY` | Impulsion d'entrée | `driftStart` — à créer | haptics.ts | B | absent | P1 |

`haptics.ts` n'existe que là où `navigator.vibrate` existe : ni iOS, ni bureau.
Un retour haptique est un complément, jamais le seul porteur d'une information.

## 7. Regroupements Superboost

| Regroupement | Objectif | Déclencheur | Statut |
|---|---|---|---|
| `SUP_PICKUP` | donner de la valeur au ramassage | `pickup kind:'sup'` | **existe** — onde de choc, secousse, détonation |
| `SUP_READY` | indiquer la disponibilité | pas de stock | **absent — mécanique, classe C** |
| `SUP_BUILDUP` | préparer l'activation | pas d'activation | **absent — mécanique, classe C** |
| `SUP_IMPACT` | rupture sensorielle | le ramassage **est** l'activation | **existe** — classe A, aucun événement neuf |
| `SUP_SUSTAIN` | maintenir une accélération supérieure | `state.superT` | **existe** — plume, champ, caméra, ciel, moteur, vent |
| `SUP_END` | donner du poids à la fin | `supEnd` — à créer | absent |
| `SUP_RECOVERY` | retour progressif | pas de phase de recovery | absent, mécanique |

## 8. VFX Superboost

| ID | Effet | Déclencheur | Module | Classe | Statut | Prio |
|---|---|---|---|---|---|---|
| `FX_SUP_TRAIL` | Traînées de réacteur | `state.superT` → `thrust` 2 | ship.ts | A | **existe** — palier 2 des plumes | P0 |
| `FX_SUP_PICKUP` | Absorption au ramassage | `pickup kind:'sup'` | ship.ts, hud.ts | A | **existe** — halo à puissance 1,8 | P0 |
| `FX_SUP_PARTICLES` | Flux particulaire accéléré | `state.superT` | ship.ts | A | partiel — la fumée densifie avec le palier | P0 |
| `CAM_SUP_FOV_KICK` | Kick de champ supérieur au boost | palier | camera.ts | A | **existe** — `+18` contre `+7`, convergence 11 contre 6, soit 22,5 % de vue en plus | P0 |
| `CAM_SUP_LAG` | Forte inertie caméra | palier | camera.ts | A | **existe** — `camLag` × 0,55, la caméra décroche | P0 |
| `FX_SUP_SHOCKWAVE` | Onde de choc à l'activation | `pickup kind:'sup'` | ship.ts, main.ts | A | **existe** — halo à 1,8 plus une secousse côté client | P0 |
| `PP_SUP_WARP` | Distorsion spatiale | `uWarp`, `uStreak` | sky.ts | A | **existe** — luminosité graduée et filé d'étoiles, 14 px à 45° de l'axe | P1 |
| `HUD_SUP_READY` | Indication de disponibilité | pas de stock | hud.ts | C | absent, mécanique | P0 |

La caméra reçoit `state` en entier, donc elle lit le palier sans changer de
signature. `audio.update()` et `sky.update()` prennent des scalaires et ont reçu
un paramètre de plus, le palier à la place du booléen — c'est délibéré, ces
deux-là tournent à chaque frame et un objet d'options y serait une allocation
par frame.

## 9. SFX Superboost

| ID | Effet | Déclencheur | Module | Classe | Statut | Prio |
|---|---|---|---|---|---|---|
| `SFX_SUP_PICKUP` | Son de collecte | `pickup kind:'sup'` | audio.ts | A | **existe** — détonation grave sous la montée | P0 |
| `SFX_SUP_REACTOR` | Réacteur en superboost | palier | audio.ts | A | **existe** — drive 2 sur le corps, le souffle et la turbine | P0 |
| `SFX_SUP_WIND` | Vent très haute vitesse | palier | audio.ts | A | **existe** — le vent ne montait pour aucun palier, il est au superboost seul | P0 |
| `SFX_SUP_IMPACT` | Signature d'activation | le ramassage **est** l'activation | audio.ts | A | **existe** — fondu dans le son de collecte | P0 |
| `SFX_SUP_RELEASE` | Décharge de fin | `supEnd` — à créer | audio.ts | B | absent | P0 |
| `SFX_SUP_BUILDUP` | Pré-charge | pas d'activation | audio.ts | C | absent, mécanique | P0 |
| `SFX_SUP_READY` | Feedback de disponibilité | pas de stock | audio.ts | C | absent, mécanique | P1 |

## 10. Différenciation sensorielle

| Propriété | Boost | Superboost | Aujourd'hui | G-SURGE |
|---|---|---|---|---|
| Disponibilité | rechargeable | ramassé | conforme | condition signature |
| Vitesse cible | `boostFactor` 1,3 | `× supFactor` 1,08 | **+8 %** | — |
| Champ de vision | modéré | fort | **différencié** — `+18` contre `+7` | très fort |
| Distorsion | faible | moyenne | **différencié** — luminosité graduée, filé au 3 | forte |
| Réacteurs | standard | haute puissance | **différencié** — palier 2 | extrême |
| Vent, moteur | renforcé | très fort | **différencié** — drive 2, vent au 3 seul | extrême |
| Secousse | faible | moyenne | **différencié** — à l'impact du 3, aucune au 2 | forte mais contrôlée |
| HUD | normal | disponibilité | classe `.sup` sur la vitesse | simplifié |
| Sensation visée | « accélération » | « énorme poussée » | — | « dépassement des limites » |

Avant l'étape 1, quatre propriétés sur neuf ne distinguaient rien. Il en reste
**une** : la vitesse cible, à `+8 %`. Le retour promet donc une catapulte que la
physique ne paie pas, et c'est exactement la décision que l'étape 5 de la
roadmap garde ouverte — délibérément après, parce qu'un chiffre ne se juge pas
avant le retour qui l'accompagne.

## 11. Règles d'empilement

| Combinaison | Recommandation | Ce que le code fait |
|---|---|---|
| `drift` + vitesse élevée | oui | cas normal |
| `drift` + `boosting` | oui, intéressant | autorisé |
| `driftCharge` + `boosting` | la recharge devrait être suspendue | **elle ne l'est pas** : `energy` prend `+driftCharge` et `−boostDrain` dans le même pas, soit −9/s net. Changer ça est classe C |
| `drift` + superboost | à décider | autorisé : le superboost force `boosting`, le drift reste indépendant |
| `drift` en l'air | — | **impossible**, `state.drift` est forcé à faux |
| `boosting` + superboost | le superboost remplace | conforme : `superOn` force `boosting` et coupe la consommation |
| near-miss + drift | très bon événement de skill | **le near-miss n'existe pas** |
| force latérale en virage + drift | fusionner les effets communs | pas de concept de force en virage ; `centri` agit sur `latVel` |
| superboost + collision | la collision prend la priorité | conforme : `wallImpact` est un événement |
| drift + `G_SURGE` | à tester | sans objet |

## 12. Grandeurs continues

Il n'y a pas de middleware : une grandeur continue est un paramètre de fonction.
Signatures actuelles, à étendre plutôt qu'à contourner :

- `audio.update(playing, speed, speedMax, tier, drifting)`
- `sky.update(time, camX, camY, camZ, curvature, speed, dt, tier)`
- `camera.update(state, track, tuning, frameDt, shake)` — reçoit l'état complet

| Grandeur | Source | Manque |
|---|---|---|
| `driftIntensity` | `state.slip`, normalisé | le plafond de normalisation : le rendu sature à 35 m/s, ce choix doit être partagé |
| `driftChargeRate` | `driftCharge`, constant | vaut 17 ou 0, il n'y a pas de taux variable |
| `boostCharge` | `state.energy / 100` | rien, disponible |
| `superRemaining` | `state.superT / supTime` | rien, disponible, **et personne ne le lit** |
| `superAvailable` | — | pas de stock |
| `driftChain` | — | pas de chaîne |

## 13. Cycle de jeu

Boucle principale, telle qu'elle tourne aujourd'hui :

```text
CRUISE → drift → energy monte → boost prêt → boosting → CRUISE
```

Branche pickup, telle qu'elle tourne : il n'y a pas d'étape intermédiaire, le
ramassage est l'activation.

```text
pickup 'sup' → superT = supTime → décroissance → rien
```

Ce que la palette proposait, et qui reste à écrire — chaque flèche ajoutée est
classe C :

```text
pickup → stock → disponible → activation → superboost → recovery
```

L'état extrême, entièrement à définir :

```text
FAST / BOOST / SUPERBOOST → buildup → G_SURGE → recovery
```

## 14. Boucle sensorielle visée pour le drift

Le drift ne doit pas être identifié seulement par l'orientation du vaisseau.

```text
entrée → rupture aérodynamique → déplacement latéral perceptible
       → montée de la recharge → intensification → boost prêt → réalignement
```

Sur les sept étapes, deux ont un retour aujourd'hui : le déplacement latéral,
par le lacet du vaisseau et la bande de bruit, et la montée de la recharge, au
HUD seul. Les cinq autres sont muettes, et les deux extrémités — l'entrée et le
réalignement — sont des événements que la simulation n'émet pas.

L'objectif est que le joueur ressente :

**« plus mon drift est maîtrisé, plus mon vaisseau accumule de puissance. »**

## 15. Principe de différenciation du superboost

Le superboost ne doit pas être un boost multiplié. Il doit avoir sa signature.

```text
BOOST      = poussée, accélération
SUPERBOOST = catapulte, propulsion brutale
G-SURGE    = altération complète de la perception de vitesse
```

C'est ce qui garde une progression sensorielle lisible et empêche le G-SURGE de
perdre son statut d'état ultime. Le tableau §10 mesure l'écart entre ce principe
et l'état du code. L'étape 1 l'a refermé partout sauf sur une ligne : la vitesse
elle-même. Le superboost se *ressent* maintenant comme une catapulte, il n'en
est pas encore une.
