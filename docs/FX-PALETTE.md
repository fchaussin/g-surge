# Extensions système — Drift & Superboost

> **Ce document est une base de ressources, pas une liste de features à
> implémenter.** Il sert de palette où puiser — surtout pour les FX qui
> renforcent l'impression de vitesse. Rien ici n'est un engagement, et l'ordre
> des sections n'est pas un ordre de travail.
>
> **Ce qui existe déjà dans le code** (relevé le 2026-09-10), parce que
> plusieurs concepts ci-dessous sont des extensions de mécaniques en place et
> non des ajouts :
>
> - **Le drift est implémenté et boucle déjà avec le boost.** `state.drift` et
>   `state.slip` dans la simulation, recharge à `driftCharge` = 17 points/s,
>   sortie sous `driftExit`. Retours existants : lacet du vaisseau via
>   `driftYaw`, mention « DRIFT » et jauge de charge au HUD, bande de bruit
>   dédiée à 2600 Hz dans `audio.ts`. Manquent surtout les *événements* —
>   entrée, sortie, réalignement — le drift n'a aujourd'hui qu'un retour continu.
> - **Le superboost est implémenté**, ramassé sur la piste (`supChance`), d'une
>   durée `supTime` = 2,6 s. Mais il n'est pas différencié : `supFactor` = 1,08
>   ne le place que 8 % au-dessus d'un boost normal, et côté sensoriel il est
>   **identique** — même `+7` de champ de vision dans `camera.ts`, même `uWarp`
>   dans le ciel, seule la plume du réacteur change de palier. C'est exactement
>   ce contre quoi la section 15 met en garde.
> - **L'état `G_SURGE` n'existe pas.** Le jeu porte le nom d'un état qu'il n'a
>   pas encore.


## 1. Nouveaux concepts gameplay

| Terme | Définition | Fonction gameplay |
|---|---|---|
| `DRIFT` | Dérapage contrôlé du véhicule | Permet de recharger plus efficacement le boost |
| `DRIFT_CHARGE` | Charge générée pendant un drift valide | Alimente ou accélère la récupération du boost |
| `DRIFT_CHAIN` | Maintien ou enchaînement de drifts | Peut augmenter progressivement le rendement de recharge |
| `SUPERBOOST_PICKUP` | Ressource collectée directement sur la piste | Donne accès à un Superboost |
| `SUPERBOOST` | Boost spécial, plus puissant qu'un boost normal | Accélération exceptionnelle et ressource limitée |
| `SUPERBOOST_CHARGE` | Quantité de Superboost disponible | Dépend des pickups collectés |
| `SUPERBOOST_START` | Déclenchement du Superboost | Événement instantané |
| `SUPERBOOST_END` | Fin du Superboost | Déclenche une phase de recovery |

---

# 2. Hiérarchie des accélérations

| Niveau | État | Intensité perceptive | Origine |
|---:|---|---|---|
| 0 | `CRUISE` | Faible | Propulsion normale |
| 1 | `FAST` | Moyenne | Vitesse naturelle |
| 2 | `BOOST` | Forte | Ressource boost rechargeable |
| 3 | `SUPERBOOST` | Très forte | Pickup collecté sur la piste |
| 4 | `G_SURGE` | Extrême | État signature du jeu |

Le joueur doit pouvoir identifier chaque niveau sans regarder l'interface.

---

# 3. Nouveaux Trigger Tags

| Tag | Définition | Paramètres |
|---|---|---|
| `DRIFT` | Drift actif | `DriftIntensity` |
| `DRIFT_START` | Entrée en drift | Event |
| `DRIFT_END` | Fin du drift | Event |
| `DRIFT_CHARGE` | Recharge boost générée par drift | `DriftChargeRate` |
| `DRIFT_ANGLE` | Angle entre orientation et trajectoire | `DriftAngle` |
| `DRIFT_SPEED` | Vitesse pendant drift | `DriftSpeed` |
| `DRIFT_CHAIN` | Durée / qualité d'un drift continu | `DriftChain` |
| `SUPERBOOST_PICKUP` | Pickup Superboost récupéré | Event |
| `SUPERBOOST_AVAILABLE` | Superboost disponible | Bool / count |
| `SUPERBOOST_START` | Activation Superboost | Event |
| `SUPERBOOST` | Superboost actif | `SuperboostIntensity` |
| `SUPERBOOST_END` | Fin Superboost | Event |

---

# 4. Bundles Drift

| Bundle | Objectif | VFX | SFX | Activation |
|---|---|---|---|---|
| `DRIFT_ENTRY` | Donner un impact clair au début du drift | Camera yaw léger, particules latérales, petit shake | Transient aérodynamique, friction / flux latéral | `DRIFT_START` |
| `DRIFT_FLOW` | Faire sentir le déplacement latéral | Particules latérales, blur asymétrique, camera roll | Vent latéral, turbulence | `DRIFT` |
| `DRIFT_CHARGE` | Montrer que le drift recharge le boost | Réacteurs ou jauge qui accumulent de l'énergie, pulses | Charge énergétique progressive | `DRIFT_CHARGE` |
| `DRIFT_CHAIN` | Valoriser un drift long / propre | Intensification progressive du feedback | Montée harmonique / rythme de charge | Drift maintenu |
| `DRIFT_RELEASE` | Marquer la sortie du drift | Snap caméra, recentrage rapide | Whoosh de réalignement | `DRIFT_END` |
| `DRIFT_FULL_CHARGE` | Signaler boost totalement rechargé | Flash HUD / pulse réacteurs | Confirmation sonore distincte | Boost atteint 100 % |

---

# 5. VFX Drift

| ID | Effet | Tags | Priorité | Bundle |
|---|---|---|---|---|
| `CAM_DRIFT_YAW` | Léger retard d'orientation de caméra | `DRIFT`, `CAMERA` | P0 | `DRIFT_FLOW` |
| `CAM_DRIFT_ROLL` | Roll dépendant de l'angle de drift | `DRIFT`, `GFORCE` | P0 | `DRIFT_FLOW` |
| `CAM_DRIFT_EXIT_SNAP` | Recentrage caméra dynamique | `DRIFT_END` | P1 | `DRIFT_RELEASE` |
| `PP_DRIFT_DIRECTIONAL_BLUR` | Blur dirigé selon le mouvement latéral | `DRIFT`, `BLUR` | P1 | `DRIFT_FLOW` |
| `FX_DRIFT_PARTICLES` | Particules projetées latéralement | `DRIFT`, `PARTICLES` | P0 | `DRIFT_FLOW` |
| `FX_DRIFT_WAKE` | Distorsion / turbulence derrière le véhicule | `DRIFT`, `AIRFLOW` | P1 | `DRIFT_FLOW` |
| `FX_DRIFT_CHARGE` | Énergie visuelle accumulée | `DRIFT_CHARGE`, `ENERGY` | P0 | `DRIFT_CHARGE` |
| `HUD_DRIFT_CHARGE` | Feedback recharge boost | `HUD`, `DRIFT_CHARGE` | P0 | `DRIFT_CHARGE` |

---

# 6. SFX Drift

| ID | Effet | Tags | Priorité | Bundle |
|---|---|---|---|---|
| `SFX_DRIFT_ENTRY` | Transient début drift | `DRIFT_START` | P0 | `DRIFT_ENTRY` |
| `SFX_DRIFT_AIRFLOW` | Flux aérodynamique latéral | `DRIFT`, `WIND` | P0 | `DRIFT_FLOW` |
| `SFX_DRIFT_TURBULENCE` | Turbulence irrégulière | `DRIFT`, `WIND` | P1 | `DRIFT_FLOW` |
| `SFX_DRIFT_CHARGE` | Son de recharge boost | `DRIFT_CHARGE`, `ENERGY` | P0 | `DRIFT_CHARGE` |
| `SFX_DRIFT_CHAIN` | Intensification progressive | `DRIFT_CHAIN` | P1 | `DRIFT_CHAIN` |
| `SFX_DRIFT_RELEASE` | Whoosh de réalignement | `DRIFT_END` | P1 | `DRIFT_RELEASE` |
| `SFX_DRIFT_FULL_CHARGE` | Confirmation boost prêt | `DRIFT_CHARGE`, `HUD` | P0 | `DRIFT_FULL_CHARGE` |

---

# 7. Bundles Superboost

| Bundle | Objectif | VFX | SFX | Activation |
|---|---|---|---|---|
| `SUPERBOOST_PICKUP` | Donner de la valeur au pickup | Flash local, absorption énergétique | Pickup énergétique distinct | Collecte |
| `SUPERBOOST_READY` | Indiquer discrètement sa disponibilité | Réacteur / HUD spécifique | Hum ou tonalité très légère | Stock disponible |
| `SUPERBOOST_BUILDUP` | Préparer l'activation | Compression visuelle très courte | Aspiration plus agressive que boost normal | Juste avant activation |
| `SUPERBOOST_IMPACT` | Rupture sensorielle forte | Shockwave, FOV kick, flash, distorsion | Impact grave + snap énergétique | Activation |
| `SUPERBOOST_SUSTAIN` | Maintenir une accélération supérieure | Trails longues, particules accélérées, glow | Réacteur Superboost + vent extrême | Superboost actif |
| `SUPERBOOST_END` | Donner du poids à la fin | Retour FOV / trails | Décompression sonore | Fin |
| `SUPERBOOST_RECOVERY` | Retour progressif vers vitesse normale | Nettoyage progressif des effets | Retour mix normal | Après Superboost |

---

# 8. VFX Superboost

| ID | Effet | Tags | Priorité | Bundle |
|---|---|---|---|---|
| `FX_SUPERBOOST_PICKUP` | Absorption pickup | `SUPERBOOST_PICKUP` | P0 | `SUPERBOOST_PICKUP` |
| `HUD_SUPERBOOST_READY` | Indication disponibilité | `SUPERBOOST_AVAILABLE`, `HUD` | P0 | `SUPERBOOST_READY` |
| `CAM_SUPERBOOST_FOV_KICK` | Kick FOV supérieur au boost normal | `SUPERBOOST_START`, `FOV` | P0 | `SUPERBOOST_IMPACT` |
| `CAM_SUPERBOOST_LAG` | Forte inertie caméra | `SUPERBOOST`, `ACCEL` | P0 | `SUPERBOOST_IMPACT` |
| `PP_SUPERBOOST_WARP` | Distorsion spatiale temporaire | `SUPERBOOST`, `DISTORTION` | P1 | `SUPERBOOST_SUSTAIN` |
| `FX_SUPERBOOST_TRAIL` | Traînées beaucoup plus longues | `SUPERBOOST`, `REACTOR` | P0 | `SUPERBOOST_SUSTAIN` |
| `FX_SUPERBOOST_PARTICLES` | Flux particulaire accéléré | `SUPERBOOST`, `PARTICLES` | P0 | `SUPERBOOST_SUSTAIN` |
| `FX_SUPERBOOST_SHOCKWAVE` | Onde de choc d'activation | `SUPERBOOST_START`, `IMPACT` | P0 | `SUPERBOOST_IMPACT` |

---

# 9. SFX Superboost

| ID | Effet | Tags | Priorité | Bundle |
|---|---|---|---|---|
| `SFX_SUPERBOOST_PICKUP` | Son de collecte | `SUPERBOOST_PICKUP` | P0 | `SUPERBOOST_PICKUP` |
| `SFX_SUPERBOOST_READY` | Feedback disponibilité | `SUPERBOOST_AVAILABLE` | P1 | `SUPERBOOST_READY` |
| `SFX_SUPERBOOST_BUILDUP` | Pré-charge | `SUPERBOOST_START` | P0 | `SUPERBOOST_BUILDUP` |
| `SFX_SUPERBOOST_IMPACT` | Signature d'activation | `SUPERBOOST_START`, `IMPACT` | P0 | `SUPERBOOST_IMPACT` |
| `SFX_SUPERBOOST_REACTOR` | Réacteurs en Superboost | `SUPERBOOST`, `REACTOR` | P0 | `SUPERBOOST_SUSTAIN` |
| `SFX_SUPERBOOST_WIND` | Vent très haute vitesse | `SUPERBOOST`, `WIND` | P0 | `SUPERBOOST_SUSTAIN` |
| `SFX_SUPERBOOST_RELEASE` | Décharge fin Superboost | `SUPERBOOST_END` | P0 | `SUPERBOOST_END` |

---

# 10. Différenciation sensorielle Boost / Superboost / G-SURGE

| Propriété | Boost | Superboost | G-SURGE |
|---|---|---|---|
| Disponibilité | Rechargeable | Collecté sur piste | Condition / mécanique signature |
| Fréquence | Élevée | Moyenne / rare | Rare ou exceptionnelle |
| Impact FOV | Modéré | Fort | Très fort / spécifique |
| Blur | Modéré | Fort | Très périphérique / focalisé |
| Distorsion | Faible | Moyenne | Forte / signature |
| Camera shake | Faible | Moyen | Fort mais contrôlé |
| Réacteurs | Boost standard | Mode haute puissance | Mode énergétique extrême |
| Vent | Renforcé | Très fort | Extrême + filtrage spécifique |
| Mix audio | Léger ducking | Ducking marqué | Recomposition complète du mix |
| HUD | Normal | Feedback disponibilité | Simplifié / déformé |
| Signature sonore | Courte | Massive | Unique et immédiatement identifiable |
| Sensation | « accélération » | « énorme poussée » | « dépassement des limites » |

---

# 11. Règles de stacking

| Combinaison | Autorisée | Comportement recommandé |
|---|---|---|
| `DRIFT + HIGH_SPEED_FLOW` | Oui | Cas normal |
| `DRIFT + BOOST` | Oui | Potentiellement très intéressant en gameplay |
| `DRIFT + SUPERBOOST` | À décider | Peut être autorisé mais doit rester contrôlable |
| `DRIFT + G_SURGE` | À tester | Risque important de surcharge visuelle |
| `DRIFT_CHARGE + BOOST` | Non | La recharge devrait être suspendue pendant consommation |
| `BOOST + SUPERBOOST` | Non recommandé | Superboost remplace le boost |
| `BOOST + G_SURGE` | Non recommandé | G-SURGE prend priorité |
| `SUPERBOOST + G_SURGE` | Selon design | Soit interdit, soit utilisé comme condition d'accès au G-SURGE |
| `NEARMISS + DRIFT` | Oui | Très bon événement de skill |
| `TURN_GFORCE + DRIFT_FLOW` | Oui | Fusionner les effets communs |
| `SUPERBOOST + NEARMISS` | Oui | Near-miss doit rester perceptible |
| `SUPERBOOST + COLLISION` | Oui | Collision prend temporairement la priorité |

---

# 12. Paramètres RTPC supplémentaires

| Paramètre | Plage | Usage |
|---|---:|---|
| `DriftIntensity` | `0 → 1` | Intensité générale du drift |
| `DriftAngleNormalized` | `0 → 1` | VFX/SFX latéraux |
| `DriftSpeedNormalized` | `0 → 1` | Importance du flux aérodynamique |
| `DriftChargeRate` | `0 → 1` | Feedback de recharge |
| `DriftChainNormalized` | `0 → 1` | Intensification pendant drift prolongé |
| `BoostChargeNormalized` | `0 → 1` | Niveau de boost disponible |
| `SuperboostAvailable` | `0 / 1` ou compteur | HUD / feedback |
| `SuperboostIntensity` | `0 → 1` | Effets Superboost |
| `SuperboostRemaining` | `0 → 1` | Feedback de durée restante |

---

# 13. Cycle gameplay mis à jour

```text
CRUISE
   ↓
FAST
   ↓
DRIFT
   ↓
DRIFT_CHARGE
   ↓
BOOST READY
   ↓
BOOST
   ↓
FAST
```

Branche Pickup :

```text
SUPERBOOST PICKUP
       ↓
SUPERBOOST READY
       ↓
SUPERBOOST
       ↓
RECOVERY
```

État extrême :

```text
FAST / BOOST / SUPERBOOST
          ↓
     SURGE BUILDUP
          ↓
       G-SURGE
          ↓
       RECOVERY
```

---

# 14. Boucle sensorielle recommandée du drift

Le drift ne doit pas uniquement être identifié par l'orientation du véhicule.

```text
ENTRÉE DRIFT
    ↓
rupture aérodynamique
    ↓
déplacement latéral perceptible
    ↓
montée de la recharge
    ↓
intensification progressive
    ↓
BOOST READY
    ↓
sortie / réalignement
```

L'objectif est que le joueur ressente naturellement :

**« plus mon drift est maîtrisé, plus mon véhicule accumule de puissance. »**

---

# 15. Principe de différenciation du Superboost

Le Superboost ne doit pas être simplement :

`BOOST × 2`

Il doit posséder sa propre signature.

Recommandation :

```text
BOOST
= poussée / accélération

SUPERBOOST
= catapulte / propulsion brutale

G-SURGE
= altération complète de la perception de vitesse
```

Cette distinction permet de conserver une progression sensorielle claire et d'éviter que le G-SURGE perde son statut d'état ultime.