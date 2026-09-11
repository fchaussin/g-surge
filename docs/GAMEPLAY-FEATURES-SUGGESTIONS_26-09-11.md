# Spécification gameplay retenue

## 1. Boucle de gameplay existante

Le joueur pilote un vaisseau futuriste à réacteurs qui rase le sol sur une piste suspendue dans le vide intersidéral.

Le gameplay repose actuellement sur :
- collecte de pièces pour le score ;
- boost classique ;
- superboost ;
- drift pour recharger le boost classique ;
- dégâts sur collision avec les bordures ;
- système de réparation déjà présent ;
- G-SURGE déclenché depuis le superboost lorsque le joueur réussit suffisamment de drift à très haute vitesse ;
- G-SURGE donnant accès à un ultraboost / overdrive.

L’objectif général reste un gameplay arcade très rapide, basé sur la prise de risque, la maîtrise du drift et l’enchaînement des accélérations.

## 2. Carburant

Le carburant devient une ressource permanente du vaisseau.

Des bidons de carburant sont placés sur la piste et permettent de remplir la jauge de carburant.

La consommation dépend du niveau de propulsion utilisé et du niveau de difficulté.

### Easy

| État | Consommation |
|---|---|
| Vitesse normale sans accélération | Aucune |
| Boost classique | Faible |
| Superboost | Moyenne |
| G-SURGE | Gratuit + refill carburant |

Fréquence des bidons : élevée.

### Medium

| État | Consommation |
|---|---|
| Vitesse normale sans accélération | Faible |
| Boost classique | Moyenne |
| Superboost | Forte |
| G-SURGE | Gratuit + refill carburant |

Fréquence des bidons : moyenne.

### Hard

| État | Consommation |
|---|---|
| Vitesse normale sans accélération | Faible |
| Boost classique | Moyenne |
| Superboost | Forte |
| G-SURGE | Refill + faible consommation |

Fréquence des bidons : faible.

Le carburant reste une contrainte secondaire. Il ne doit pas devenir la mécanique dominante ni casser le rythme arcade.

Le superboost étant nécessaire pour atteindre le G-SURGE et consommant déjà beaucoup de carburant, le G-SURGE reste globalement favorable au joueur.

## 3. Item d’invincibilité / Wall Riding

Ajout d’un item temporaire d’invincibilité.

Pendant son activation :
- les collisions avec les bordures ne provoquent aucun dégât ;
- le joueur peut volontairement utiliser les bordures ;
- rester en contact avec une bordure provoque une accélération ;
- le joueur peut s’appuyer contre la bordure extérieure d’un virage pour conserver ou augmenter sa vitesse, dans une logique proche du wall riding en course automobile ;
- le contact prolongé avec le mur doit être exploitable volontairement et non uniquement subi.

Le wall riding devient donc temporairement une technique de conduite offensive.

L’effet doit rester contrôlable : le joueur ne doit pas être projeté de manière imprévisible après un contact.

## 4. Near Miss

Ajout d’un système de Near Miss.

Un Near Miss est déclenché lorsque le joueur passe extrêmement près :
- d’une bordure ;
- d’un obstacle ;
- ou d’un autre danger futur ;

sans entrer en collision.

Récompenses prévues :
- bonus de score ;
- éventuellement légère recharge du boost classique.

La récompense peut être proportionnelle à la vitesse du joueur.

L’objectif est de récompenser la prise de risque sans ajouter de nouvelle jauge ou de nouvelle contrainte de gestion.

## 5. Perfect Drift

Le Perfect Drift fonctionne comme un système de combo basé sur l’enchaînement des drifts.

Il ne dépend pas d’un angle précis de drift.

### Activation

Le joueur doit enchaîner plusieurs drifts valides sans collision.

Exemple de base :

Drift 1 → Drift 2 → Drift 3 → activation PERFECT DRIFT.

Le nombre exact de drifts requis reste à équilibrer.

### Maintien

Une fois le Perfect Drift activé :
- chaque drift suivant ajoute des points au combo ;
- la durée de chaque drift peut contribuer au score ;
- les drifts doivent être enchaînés suffisamment rapidement.

Une courte fenêtre de temps est autorisée entre deux drifts.

Valeur de départ à tester :
- environ 1 à 1,5 seconde entre deux drifts.

Cette fenêtre peut progressivement diminuer lorsque le combo devient élevé.

Exemple :
- début du combo : 1,5 s ;
- combo élevé : jusqu’à environ 0,8 s.

### Fin du Perfect Drift

Le Perfect Drift est immédiatement interrompu si :
- le joueur entre en collision ;
- aucun nouveau drift n’est déclenché avant expiration de la fenêtre autorisée.

Les drifts trop courts ou insignifiants ne doivent pas pouvoir être utilisés pour maintenir artificiellement le combo.

### Interaction avec le G-SURGE

Le Perfect Drift peut contribuer directement à la progression nécessaire pour déclencher le G-SURGE.

Il récompense donc :
- la régularité ;
- la prise de risque ;
- la capacité à continuer à drifter à haute vitesse ;
- la maîtrise pendant le superboost.

## 6. Features conservées pour plus tard

Les éléments suivants sont retenus comme bonnes pistes mais ne doivent pas être intégrés immédiatement.

### Draft / aspiration

À intégrer lorsque le jeu disposera :
- d’adversaires IA ;
- de ghost runs ;
- ou du multijoueur.

Le joueur pourra alors profiter de l’aspiration derrière un autre véhicule.

### Portes de vitesse / embranchements conditionnels

Certaines portions ou routes alternatives pourront être accessibles uniquement au-dessus d’un certain niveau de vitesse.

Elles pourront récompenser :
- le boost ;
- le superboost ;
- le G-SURGE.

À conserver pour une future évolution du level design.

### Anneaux de précision

Des anneaux pourront être placés sur certaines trajectoires.

Le passage précis dans ces anneaux pourra apporter :
- score ;
- boost ;
- récompenses diverses.

À conserver pour une future évolution du gameplay.

## 7. Features écartées pour l’instant

### Surchauffe des réacteurs

Non retenue à ce stade.

Elle ajouterait une contrainte supplémentaire avant d’avoir suffisamment testé les mécaniques existantes.

### Bouclier directionnel

Rejeté.

Trop orienté gestion par rapport au gameplay arcade recherché.

### Overdrive séparé

Rejeté comme mécanique indépendante.

Le G-SURGE et son ultraboost / overdrive remplissent déjà ce rôle.

## 8. Priorité de développement actuelle

Priorité immédiate :

1. Carburant.
2. Item d’invincibilité avec wall riding accélérateur.
3. Near Miss.
4. Perfect Drift.

Le reste doit attendre les premiers tests de gameplay afin d’éviter d’ajouter trop de systèmes avant de valider le rythme, la difficulté et le plaisir de conduite.