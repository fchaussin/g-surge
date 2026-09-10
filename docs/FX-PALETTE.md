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
  Et la vitesse a suivi à l'étape 5 : `supFactor` = 1,22 le place 22 % au-dessus
  d'un boost, soit à peu près la même marche que le boost au-dessus de la
  croisière. Il reste sous le plafond auquel `audio.ts` borne le moteur, ce qui
  est une contrainte du code et pas un goût.
- **`uWarp` ne déforme toujours rien** : le shader n'en fait qu'un gain de
  luminosité, `col *= 1.0 + uWarp * 0.55`, désormais gradué par palier. Le filé
  du superboost est un effet distinct, `uStreak`, qui prélève la couche
  d'étoiles en dix points le long de la ligne radiale. Une première version
  étirait la cellule et ne pouvait pas marcher : la grille vaut 2,4 px par
  cellule à l'écran et `fract` y boucle, donc la traînée saturait à 2,9 px sur
  une étoile de 0,8 px. Mesurer avant de régler, ici comme ailleurs.
- **La dérive a une échelle, et une seule.** `src/client/drift.ts` porte
  `SLIP_CEILING` = 35 m/s, `driftIntensity` de 0 à 1 et `driftSide`. Ce n'est pas
  un chiffre neuf : c'est celui auquel le lacet de la coque saturait déjà. On
  décroche vers 22,7 m/s, donc un drift commence aux deux tiers de l'échelle.
- **Il n'y a pas de post-process.** Aucun `EffectComposer`, aucune passe : tout
  blur ou aberration est un ajout de pipeline, pas un réglage.
- **Les seules particules sont la traînée de fumée** : 18 sprites parentés au
  vaisseau, placés par phase le long d'une traînée, pas un émetteur événementiel.
  Le halo (`ship.setHalo`) est une sphère additive déjà pilotée par les
  événements, et c'est le support le plus proche d'une onde de choc.
- **Les deux extrémités du drift sont des événements depuis l'étape 3.**
  `driftStart` et `driftEnd`, à la bascule qui existait déjà, avec son
  hystérésis. `driftEnd` porte `held`, la durée : un drift d'un seul pas existe,
  mesuré à 1 ms, et sans cette durée son entrée et sa sortie se superposeraient
  en un clic.
- **N'existent pas du tout, et sont des mécaniques, pas des FX** : la chaîne de
  drift, le stock de superboost avec sa disponibilité et son activation — le
  pickup déclenche l'effet immédiatement — la phase de recovery, et l'état
  `G_SURGE`. Le jeu porte toujours le nom d'un état qu'il n'a pas, mais la §16
  dit maintenant lequel : ce qu'il exige, ce qu'il coûte, et ce qui reste à
  trancher avant d'en écrire une ligne.

## 1. Concepts, et leur référent dans le code

| Terme de la palette | Dans le code | Statut |
|---|---|---|
| `DRIFT` | `state.drift` | existe |
| `DRIFT_ANGLE` | `state.slip`, en m/s et non en radians | existe, à convertir |
| `DRIFT_CHARGE` | `driftCharge` → `state.energy` | existe, confondu avec la réserve de boost |
| `DRIFT_CHAIN` | — | **n'existe pas** — spécifiée en §16, c'est la condition d'entrée du G-SURGE |
| `SUPERBOOST_PICKUP` | événement `pickup` de `kind: 'sup'` | existe |
| `SUPERBOOST` | `state.superT`, `supTime`, `supFactor` | existe |
| `SUPERBOOST_CHARGE` | — | **n'existe pas** : pas de stock |
| `SUPERBOOST_START` | — | **n'existe pas** : le ramassage déclenche |
| `SUPERBOOST_END` | événement `supEnd` | existe depuis l'étape 2 |
| `RECOVERY` | — | **n'existe pas** |
| `G_SURGE` | — | **n'existe pas**, spécifié en §16 |
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
| 4 | `G_SURGE` | — | absent, spécifié en §16 |

Le joueur doit pouvoir identifier chaque niveau sans regarder l'interface. Le
palier 3 se distingue maintenant du 2 par le champ, la caméra, le ciel et le
son ; le palier 1 reste confondu avec le 0, et le 4 n'existe pas.

## 3. Déclencheurs

`events.ts` porte une union discriminée, drainée une fois par pas. Ce qui existe :
`land`, `badLanding`, `wallImpact`, `scrape`, `pickup` (`coin` / `fix` / `sup`),
`supEnd`, `driftStart`, `driftEnd`, `wreck`.

Ce que la palette réclame en plus — tous classe **B**, donc sans effet sur les
références. `supEnd` en est la démonstration : ajouté à l'étape 2, il n'a
déplacé ni une fixture de physique ni un pixel de capture.

| Événement | Où l'émettre | Note |
|---|---|---|
| `driftStart` | `step.ts`, à la bascule de `state.drift` à vrai | **fait**, étape 3 |
| `driftEnd` | même bascule, à faux | **fait**, étape 3 — porte `held`, la durée |
| `supEnd` | `step.ts`, quand `superT` atteint zéro | **fait**, étape 2 |
| `supStart` | — | **n'existe pas** tant que le ramassage déclenche l'effet ; c'est le même instant que `pickup kind:'sup'` |
| ~~`boostFull`~~ | — | **essayé à l'étape 4, puis retiré.** Écrit, il se déclenchait dix-huit fois là où trois étaient voulues : un frottement de mur ôte 0,036 point par pas et la réserve resature aussitôt. « À 100 » est un fait du noyau ; « assez creusé pour mériter un son » est un jugement de présentation, et il vit maintenant dans `main.ts` |

Les grandeurs continues (`DriftIntensity`, `SuperboostRemaining`) ne sont pas des
événements : elles se lisent dans l'état, voir §12.

## 4. Regroupements Drift

| Regroupement | Objectif | Déclencheur | Statut |
|---|---|---|---|
| `DRIFT_ENTRY` | donner un impact clair au début du drift | `driftStart` | **existe** — transient et impulsion haptique |
| `DRIFT_FLOW` | faire sentir le déplacement latéral | `state.drift`, `state.slip` | **existe** — lacet, gerbe latérale, souffle proportionnel |
| `DRIFT_CHARGE` | montrer que le drift recharge le boost | `state.energy` montant | **existe** — HUD et ton qui monte avec la réserve |
| `DRIFT_CHAIN` | valoriser un drift long et propre | chaîne — n'existe pas | absent, classe C |
| `DRIFT_RELEASE` | marquer la sortie | `driftEnd` | **existe** — whoosh dosé et recentrage caméra |
| `DRIFT_FULL_CHARGE` | signaler le boost rechargé | `energy` repassée à 100 après 95 | **existe** — classe `.full` et confirmation à deux notes |

## 5. VFX Drift

| ID | Effet | Déclencheur | Module | Classe | Statut | Prio |
|---|---|---|---|---|---|---|
| `SHIP_DRIFT_YAW` | Lacet visuel du vaisseau | `state.slip * driftYaw` | main.ts, ship.ts | A | **existe**, sature à 35 m/s | — |
| `HUD_DRIFT_LABEL` | Mention « DRIFT » | `state.drift` | hud.ts | A | **existe**, masquée par « WALL HIT » | — |
| `HUD_DRIFT_CHARGE` | Jauge de recharge | `state.energy`, classes `.charge` | hud.ts + CSS | A | **existe** | P0 |
| `CAM_DRIFT_YAW` | Retard d'orientation de caméra | `state.slip` | camera.ts | A | absent — la caméra ne lit ni `slip` ni `drift` | P0 |
| `CAM_DRIFT_ROLL` | Roll selon la dérive | `state.slip` | camera.ts | A | absent — le roll ne suit que le dévers | P0 |
| `CAM_DRIFT_EXIT_SNAP` | Recentrage à la sortie | `driftEnd` | camera.ts | B | **existe** — rattrapage × 2,4 sur 0,32 s | P1 |
| `FX_DRIFT_PARTICLES` | Particules projetées latéralement | `driftIntensity`, `driftSide` | drift-spray.ts | A | **existe** — 32 sprites, hasard semé, 13,5 m de portée | P0 |
| `FX_DRIFT_CHARGE` | Énergie visible sur le vaisseau | `state.energy` + `state.drift` | ship.ts | A | absent | P0 |
| `FX_DRIFT_WAKE` | Turbulence derrière le vaisseau | `state.slip` | ship.ts | A | absent | P1 |
| `PP_DRIFT_BLUR` | Blur dirigé | `state.slip` | — | A | absent, **et il n'y a pas de pipeline de post-process** | P1 |

## 6. SFX et haptique Drift

| ID | Effet | Déclencheur | Module | Classe | Statut | Prio |
|---|---|---|---|---|---|---|
| `SFX_DRIFT_AIRFLOW` | Flux aérodynamique latéral | `driftIntensity` | audio.ts | A | **existe** — bande 2600 Hz, proportionnelle depuis l'étape 4 | P0 |
| `SFX_DRIFT_ENTRY` | Transient d'entrée | `driftStart` | audio.ts | B | **existe** — souffle bref qui monte | P0 |
| `SFX_DRIFT_CHARGE` | Son de recharge | `state.energy`, en drift | audio.ts | A | **existe** — triangle de 300 à 860 Hz | P0 |
| `SFX_DRIFT_FULL_CHARGE` | Confirmation boost prêt | `main.ts`, hystérésis à 95 | audio.ts | A | **existe** — deux notes montantes | P0 |
| `SFX_DRIFT_TURBULENCE` | Turbulence irrégulière | `state.slip` normalisé | audio.ts | A | absent | P1 |
| `SFX_DRIFT_RELEASE` | Whoosh de réalignement | `driftEnd` | audio.ts | B | **existe** — dosé par `held`, muet sous 0,12 s | P1 |
| `SFX_DRIFT_CHAIN` | Intensification progressive | chaîne — n'existe pas | audio.ts | C | absent, mécanique | P1 |
| `HAP_DRIFT_ENTRY` | Impulsion d'entrée | `driftStart` | haptics.ts | B | **existe** — espacée de 220 ms | P1 |

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
| `SUP_END` | donner du poids à la fin | `supEnd` | **existe** — décompression et halo blanc |
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
| `SFX_SUP_RELEASE` | Décharge de fin | `supEnd` | audio.ts | B | **existe** — plus discrète que l'activation, elle referme | P0 |
| `SFX_SUP_BUILDUP` | Pré-charge | pas d'activation | audio.ts | C | absent, mécanique | P0 |
| `SFX_SUP_READY` | Feedback de disponibilité | pas de stock | audio.ts | C | absent, mécanique | P1 |

## 10. Différenciation sensorielle

| Propriété | Boost | Superboost | Aujourd'hui | G-SURGE |
|---|---|---|---|---|
| Disponibilité | rechargeable | ramassé | conforme | condition signature |
| Vitesse cible | `boostFactor` 1,3 | `× supFactor` 1,22 | **différencié** — +266 km/h, la marche du bas en vaut +279 | — |
| Champ de vision | modéré | fort | **différencié** — `+18` contre `+7` | très fort |
| Distorsion | faible | moyenne | **différencié** — luminosité graduée, filé au 3 | forte |
| Réacteurs | standard | haute puissance | **différencié** — palier 2 | extrême |
| Vent, moteur | renforcé | très fort | **différencié** — drive 2, vent au 3 seul | extrême |
| Secousse | faible | moyenne | **différencié** — à l'impact du 3, aucune au 2 | forte mais contrôlée |
| HUD | normal | disponibilité | classe `.sup` sur la vitesse | simplifié |
| Sensation visée | « accélération » | « énorme poussée » | — | « dépassement des limites » |

Avant l'étape 1, quatre propriétés sur neuf ne distinguaient rien. Il en reste
**aucune** depuis l'étape 5. La dernière était la vitesse cible, et elle a été
tranchée après la couche sensorielle et non avant, parce qu'un chiffre ne se
juge pas sans le retour qui l'accompagne. La rareté, elle, n'a pas bougé : un
superboost toutes les trente secondes reste un événement, et c'est ce que la
§7 demande.

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

- `audio.update(playing, speed, speedMax, tier, drift, charge)`
- `sky.update(time, camX, camY, camZ, curvature, speed, dt, tier)`
- `camera.update(state, track, tuning, frameDt, shake)` — reçoit l'état complet

| Grandeur | Source | Manque |
|---|---|---|
| `driftIntensity` | `src/client/drift.ts` | rien — le plafond est fixé à 35 m/s et partagé, c'est ce que l'étape 4 devait trancher |
| `driftChargeRate` | `driftCharge`, constant | vaut 17 ou 0, il n'y a pas de taux variable |
| `boostCharge` | `state.energy / 100` | rien — lu par l'audio depuis l'étape 4 |
| `superRemaining` | `state.superT / supTime` | rien, disponible, **et personne ne le lit** |
| `superAvailable` | — | pas de stock |
| `driftChain` | `state.driftHeld`, la durée du drift en cours | la chaîne elle-même, qui est une mécanique. La durée, elle, existe et `driftEnd` la porte |

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

## 16. Spécification du G-SURGE

**Écrit à l'étape 6 de la roadmap, et rien n'en est implémenté.** C'est une
spécification, pas un engagement : elle existe pour que la décision d'implémenter
puisse être prise en connaissance de cause, ce qui n'était pas possible tant que
le G-SURGE n'était qu'un nom.

## Ce que la mesure a déjà tranché

Deux choses ne sont plus ouvertes, et aucune des deux n'est un avis.

**Le G-SURGE ne peut pas être « encore plus vite ».** Le superboost atteint
1 473 km/h et `audio.ts` borne le rapport du moteur à `ENGINE_R_MAX` = 1,7, soit
1 579 km/h. Il reste **7,2 %** de marge. Au-delà, toutes les couches sonores
cessent de bouger pendant que le vaisseau accélère encore : le palier suprême
sonnerait comme le précédent. Monter le plafond est possible mais c'est un
re-réglage complet de la courbe du moteur, pas une constante à pousser.

C'est exactement ce que la §15 disait déjà par le design — « altération complète
de la perception de vitesse » et non « accélération » — et les deux raisons sont
indépendantes. Quand la contrainte du code et le principe de conception
désignent la même sortie, la sortie est probablement la bonne.

**La condition d'entrée ne peut pas reposer sur le multiplicateur, la vitesse ni
le superboost.** Mesuré sur 180 s avec un pilote qui va chercher les objets :

| | facile | moyen | difficile |
|---|---|---|---|
| Multiplicateur crête | 30 (plafond) | 18,2 | 5,7 |
| Temps au palier 3 de vitesse | 62 % | 42 % | 7 % |
| Fins de superboost propres au palier 3 | 4 | 2 | 1 |
| **Drifts** | **24** | **25** | **23** |
| **Drifts tenus ≥ 0,6 s** | **4** | **10** | **13** |

Tout s'effondre en difficile sauf le drift, qui est plat en nombre et
*s'améliore* en durée — `gripLimit` y vaut 29 contre 34, donc on décroche plus
tôt et on reste décroché plus longtemps. Un seuil absolu sur le multiplicateur
serait atteint en permanence en facile et jamais en difficile.

## Entrée : le haut de la chaîne de drift

Le G-SURGE se gagne par la chaîne de drift, ce qui fait d'une pierre deux coups :
`DRIFT_CHAIN` est listé absent depuis le début de ce document, et c'est la seule
grandeur candidate qui résiste à la difficulté.

- `state.chain` monte pendant un drift, proportionnellement à `driftIntensity`,
  et redescend lentement hors drift. Elle est remise à zéro par un contact de
  mur ou une réception hors piste — la chaîne récompense la propreté, pas
  l'obstination.
- Le G-SURGE s'arme quand `chain` franchit `surgeHold`. Ordre de grandeur à
  régler : les drifts font 104 / 189 / 853 ms de médiane et 772 / 1 322 /
  1 457 ms au neuvième décile, donc une chaîne de l'ordre de deux à trois
  secondes cumulées est un exploit dans les trois difficultés sans être hors
  d'atteinte dans aucune.
- **`surgeHold` est un candidat à une surcharge par difficulté**, comme
  `gripLimit`. Les tables de `DIFF` sont faites pour ça.

Une variante à considérer, plus lisible pour le joueur et plus chère : exiger en
plus le palier 3 de vitesse. Elle rendrait le G-SURGE presque inatteignable en
difficile, où le palier 3 n'occupe que 7 % du temps. À trancher, pas à supposer.

## Durée, sortie, recovery

- Durée fixe, `surgeTime`, de l'ordre de la seconde et demie à trois secondes —
  plus court que le superboost serait incohérent, beaucoup plus long userait
  l'effet. À régler une fois le retour en place, jamais avant : c'est la leçon
  de l'étape 5.
- La sortie est un événement, `surgeEnd`, sur le modèle de `supEnd` : c'est le
  seul instant que le client ne peut pas retrouver seul.
- La phase de recovery de la §7 reste hors périmètre. Le superboost s'est
  finalement passé de la sienne, et rien ne prouve que celle-ci soit nécessaire
  avant d'avoir vu l'état tourner.

## Ce qu'il fait, palier par palier

L'échelle de `src/client/thrust.ts` passe de trois paliers à quatre. Chaque table
indexée par palier gagne une case, et l'invariant tenu depuis l'étape 1
s'applique : **les indices existants ne bougent pas**, seul le nouveau est neuf.

| Table | Fichier | Aujourd'hui | Case à ajouter |
|---|---|---|---|
| `FOV_KICK`, `FOV_EASE`, `LAG_SCALE` | camera.ts | 0, 7, 18 | champ très large, convergence brutale, caméra qui décroche franchement |
| `WARP_BY_TIER`, `uStreak` | sky.ts | 0, 1, 1,35 | filé maximal, et c'est le seul palier qui mérite une vraie distorsion |
| `DRIVE_BY_TIER`, `WIND_BY_TIER` | audio.ts | 0, 1, 2 / 0, 0, 1 | **bloqué par `ENGINE_R_MAX`** — voir plus haut |
| `THRUST_LEVELS` | ship.ts | trois paliers de plume | quatrième palier, couleur signature |

Le mix audio est le point dur. La §10 demande une « recomposition complète du
mix », ce qui est la seule façon de différencier un palier quand le rapport de
vitesse est déjà au plafond : baisser le moteur et le vent au lieu de les
monter, et laisser la place à autre chose. C'est un travail de conception
sonore, pas un réglage de table.

## Empilement

Les lignes correspondantes de la §11, tranchées :

| Combinaison | Décision |
|---|---|
| drift + G-SURGE | **autorisé** — le drift est ce qui y mène, l'interdire serait absurde |
| boost + G-SURGE | le G-SURGE prime, comme le superboost prime sur le boost |
| superboost + G-SURGE | **interdit**, et l'ordre importe : un superboost ramassé pendant un G-SURGE est mis en attente, pas perdu |
| collision + G-SURGE | la collision sort du G-SURGE, et remet la chaîne à zéro |

## Ce que ça coûte, en références figées

C'est la partie que l'étape 6 devait établir, et le résultat est meilleur que
prévu.

- **`state.chain` est de classe B.** La trace enregistre une liste blanche de
  dix-sept champs qui ne la contient pas, exactement comme `driftHeld`. Tant que
  la chaîne ne fait que *conditionner* le G-SURGE, elle ne déplace rien.
- **Les événements `surgeStart` et `surgeEnd` sont de classe B.** Aucun
  événement n'est enregistré.
- **Toute la couche sensorielle est de classe A**, comme les étapes 1 et 4.
- **Seul le G-SURGE lui-même est de classe C**, et seulement s'il touche la
  vitesse, le multiplicateur ou le score — trois champs de la liste blanche. S'il
  ne touche que la perception, ce que la §15 demande, **il ne déplace aucune
  référence**.

Avec une réserve à écrire noir sur blanc : les traces figées couvrent 1 345 m et
ne rencontrent ni superboost ni chaîne de drift longue, donc **elles ne
verraient pas non plus une erreur** dans cette branche. C'est le trou consigné
dans `TECH-DEBT.md` §3. Un G-SURGE de classe C devra venir avec ses propres
tests, comme `tests/speed.test.ts` a dû être écrit pour l'étape 5.

## Ce qui reste ouvert, et doit être décidé avant d'écrire une ligne

1. Le palier 3 de vitesse est-il exigé en plus de la chaîne ? Il rendrait l'état
   presque inatteignable en difficile.
2. Le G-SURGE paie-t-il autre chose que de la perception — un bonus de score,
   par exemple ? C'est ce qui fait basculer tout le projet en classe C.
3. `ENGINE_R_MAX` est-il relevé, avec le re-réglage du moteur que cela implique,
   ou le palier suprême se différencie-t-il en *retirant* du son plutôt qu'en en
   ajoutant ?
4. `surgeHold` est-il surchargé par difficulté ?

# 15. Principe de différenciation du superboost

Le superboost ne doit pas être un boost multiplié. Il doit avoir sa signature.

```text
BOOST      = poussée, accélération
SUPERBOOST = catapulte, propulsion brutale
G-SURGE    = altération complète de la perception de vitesse
```

C'est ce qui garde une progression sensorielle lisible et empêche le G-SURGE de
perdre son statut d'état ultime. Le tableau §10 mesure l'écart entre ce principe
et l'état du code. L'étape 1 l'a refermé partout sauf sur une ligne : la vitesse
elle-même, et l'étape 5 l'a refermée aussi. Le superboost se ressent comme une
catapulte et en est une : +266 km/h sur le boost, quand le boost en ajoute +279
à la croisière. La progression est régulière d'un bout à l'autre.
