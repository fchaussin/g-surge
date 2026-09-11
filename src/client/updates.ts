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
 * fois que la page redevient visible, et **annoncer** quand le contrôleur
 * change — pas recharger. Le rechargement est au joueur, par `apply()`, depuis
 * un bouton que le client montre hors partie : une page qui se recharge seule,
 * même au menu, prend l'écran sous les yeux de quelqu'un.
 *
 * Le premier contrôle n'est pas une mise à jour. À la première visite le
 * worker s'installe, réclame la page, `controllerchange` part, et l'annoncer là
 * serait annoncer une mise à jour à une page qui vient d'arriver. On ne compte
 * donc que les changements d'un contrôleur déjà en place.
 */
export class Updates {
  private registration: ServiceWorkerRegistration | null = null;
  /** Une nouvelle version contrôle la page, et le bundle chargé est l'ancien. */
  private ready = false;

  /** @param onChange appelé quand une mise à jour devient prête. */
  constructor(private readonly onChange: (ready: boolean) => void) {}

  /** Vrai quand un rechargement apporterait une nouvelle version. */
  get pending(): boolean {
    return this.ready;
  }

  register(): void {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    const sw = navigator.serviceWorker;

    let controlled = sw.controller !== null;
    sw.addEventListener('controllerchange', () => {
      if (controlled && !this.ready) {
        this.ready = true;
        this.onChange(true);
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
    });
  }

  /** Le joueur a demandé la nouvelle version : recharge, si elle est là. */
  apply(): void {
    if (!this.ready) return;
    location.reload();
  }
}
