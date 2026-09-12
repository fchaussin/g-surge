/**
 * Le bouton retour du système, branché sur la machine à écrans.
 *
 * Sur Android, le geste ou le bouton « retour » est la façon normale de
 * remonter d'un écran, et sans rien il quitte l'application à la première
 * pression — au milieu d'une partie comme depuis un réglage. Le procédé est
 * toujours le même : garder en permanence une entrée d'historique de plus que
 * ce que la page a besoin, et lire son retrait comme un « recule ».
 *
 * La garde est remise après chaque recul, sauf quand on laisse partir. C'est
 * pourquoi elle est réécrite dans `onPop` plutôt que posée une fois : une
 * entrée consommée ne revient pas.
 *
 * **Aucune API ne ferme une application web.** `window.close()` ne vaut que
 * pour une fenêtre ouverte par un script. Ce qui ferme une PWA installée sur
 * Android, c'est un retour depuis son entrée de départ — donc `history.go(-2)`
 * une fois la sortie confirmée : la garde, puis l'entrée de départ. Dans un
 * onglet, le même geste ramène simplement à la page d'avant le jeu, ce qui est
 * exactement ce que le joueur demandait.
 *
 * La confirmation ne s'affiche qu'installé. Dans un onglet, détourner le
 * retour pour demander « vous partez ? » est une nuisance, pas un service :
 * l'historique appartient au navigateur, et le joueur a une autre page
 * derrière.
 */

export interface BackDeps {
  /**
   * Recule d'un écran. Faux si rien à quitter : on est déjà à la racine, et
   * c'est là que la sortie se pose.
   */
  back: () => boolean;
  /** Vrai quand le jeu tourne comme une application installée. */
  installed: () => boolean;
  /** Montre la demande de confirmation de sortie. */
  confirmQuit: () => void;
}

export class BackButton {
  /** Vrai une fois la sortie confirmée : plus de garde, le retour passe. */
  private leaving = false;

  constructor(private readonly deps: BackDeps) {}

  /** Pose la première garde et écoute. À appeler une fois, au démarrage. */
  start(): void {
    this.guard();
    window.addEventListener('popstate', () => this.onPop());
  }

  /**
   * Sortie confirmée : la garde et l'entrée de départ d'un coup. Installé,
   * c'est ce qui ferme l'application ; dans un onglet, ce qui ramène à la page
   * précédente.
   */
  leave(): void {
    this.leaving = true;
    history.go(-2);
  }

  private guard(): void {
    if (this.leaving) return;
    history.pushState({ gs: 1 }, '');
  }

  private onPop(): void {
    if (this.leaving) return;
    const consumed = this.deps.back();
    this.guard();
    if (!consumed && this.deps.installed()) this.deps.confirmQuit();
  }
}
