/**
 * La coquille hors ligne, et ses mises à jour.
 *
 * Le worker ne s'enregistre qu'en https, ce qui laisse localhost tranquille :
 * un service worker qui met le bundle en cache pendant le développement est un
 * rechargement périmé qui attend son heure, et le bénéfice y est nul. Les noms
 * d'actifs hachés par le contenu rendent le chemin cache-first sûr par
 * construction, et la liste de précache est générée au build, voir
 * vite.config.ts.
 *
 * Le worker fait déjà `skipWaiting` et `clients.claim` : une nouvelle version
 * prend le contrôle dès qu'elle est installée. Ce qui manquait était de ce
 * côté-ci. Une application installée peut rester ouverte des jours sans jamais
 * renaviguer, donc le navigateur ne revérifie jamais `sw.js` ; et quand un
 * nouveau worker prend le contrôle, la page garde son ancien bundle en mémoire
 * et rien ne le lui dit. D'où deux gestes : redemander une vérification chaque
 * fois que la page redevient visible, et recharger quand le contrôleur change
 * — tout de suite au menu, sinon au prochain retour au menu, par `settle()`.
 *
 * Le premier contrôle n'est pas une mise à jour. À la première visite le
 * worker s'installe, réclame la page, `controllerchange` part, et recharger là
 * serait un rechargement fantôme sur une page qui vient d'arriver. On ne
 * compte donc que les changements d'un contrôleur déjà en place.
 */
export class Updates {
  private registration: ServiceWorkerRegistration | null = null;
  /** Une nouvelle version contrôle la page, et le bundle chargé est l'ancien. */
  private pending = false;

  /** @param canReload vrai quand recharger ne coupe personne : au menu, et là seulement. */
  constructor(private readonly canReload: () => boolean) {}

  register(): void {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    const sw = navigator.serviceWorker;

    let controlled = sw.controller !== null;
    sw.addEventListener('controllerchange', () => {
      if (controlled) {
        this.pending = true;
        this.settle();
      }
      controlled = true;
    });

    window.addEventListener('load', () => {
      sw.register('sw.js')
        .then((registration) => {
          this.registration = registration;
        })
        .catch(() => undefined);
    });

    // Une application installée revient au premier plan sans renaviguer :
    // c'est ici, et seulement ici, qu'on peut lui faire revoir sw.js.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void this.registration?.update().catch(() => undefined);
      this.settle();
    });
  }

  /** Recharge si une mise à jour attend et que le moment s'y prête. */
  settle(): void {
    if (!this.pending || !this.canReload()) return;
    this.pending = false;
    location.reload();
  }
}
