import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Écrit la liste de précache du service worker au moment du build.
 *
 * Vite émet des noms de fichiers hachés par le contenu, donc la liste ne peut
 * pas se tenir à la main — c'est pourquoi, avant ceci, le seul fichier qui
 * compte n'était jamais précaché et une première ouverture hors ligne ne
 * marchait pas.
 *
 * Le nom du cache dérive de la liste au lieu d'être incrémenté à la main. Il
 * change donc si et seulement si un actif change, ce qui retire une consigne
 * qu'on pouvait oublier.
 *
 * Les deux remplacements vérifient : un marqueur qui cesse de correspondre doit
 * faire échouer le build bruyamment, pas laisser en silence l'ancienne liste.
 */
function serviceWorkerAssets(): Plugin {
  return {
    name: 'gs-service-worker-assets',
    apply: 'build',
    closeBundle() {
      const out = 'public';
      const swPath = join(out, 'sw.js');

      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const full = join(dir, name);
          return statSync(full).isDirectory() ? walk(full) : [full];
        });

      const assets = walk(out)
        // Relatif et séparé par des barres obliques d'abord, pour que les filtres
        // ci-dessous voient un chemin propre. Préfixer par `./` avant de filtrer
        // faisait ressembler chaque chemin à un fichier caché et vidait la liste
        // en silence.
        .map((f) => relative(out, f).split(/[\\/]/).join('/'))
        // Les source maps sont pour nous, pas pour le joueur ; `_headers` est
        // une directive Cloudflare jamais téléchargée ; et le worker ne peut pas
        // utilement se précacher lui-même. Les fichiers cachés ne sont jamais
        // des actifs.
        .filter(
          (f) =>
            !f.endsWith('.map') &&
            f !== 'sw.js' &&
            f !== '_headers' &&
            !f.split('/').some((part) => part.startsWith('.')),
        )
        .sort()
        .map((f) => `./${f}`);
      assets.unshift('./');

      // FNV-1a sur la liste : court, stable, et change avec n'importe quel élément.
      let h = 0x811c9dc5;
      const text = assets.join('|');
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      const version = `gs-${(h >>> 0).toString(16).padStart(8, '0')}`;

      let sw = readFileSync(swPath, 'utf8');
      const replaceMarked = (marker: string, line: string): void => {
        const pattern = new RegExp(`/\\* ${marker} \\*/[^\\n]*`);
        if (!pattern.test(sw)) {
          throw new Error(`service worker: marker "${marker}" not found in ${swPath}`);
        }
        sw = sw.replace(pattern, `/* ${marker} */ ${line}`);
      };
      replaceMarked('build:version', `const VERSION = '${version}';`);
      replaceMarked('build:assets', `const ASSETS = ${JSON.stringify(assets)};`);
      writeFileSync(swPath, sw);

      this.info(`service worker: ${assets.length} assets, cache ${version}`);
    },
  };
}

/**
 * Estampille l'identité du build dans l'écran de démarrage.
 *
 * Le nom de cache du service worker est un condensé et n'a pas besoin d'être
 * incrémenté, ce qui est la bonne réponse pour un cache et la mauvaise pour une
 * personne : un joueur qui signale un bug, ou quiconque vérifie qu'un déploiement
 * est bien arrivé, a besoin de quelque chose de court à lire à l'écran et à
 * répéter.
 *
 * C'est donc la version du paquet et le commit, pas un numéro que quelqu'un
 * maintient. Sur Cloudflare Pages le commit vient de l'environnement, puisque le
 * build tourne sans dépôt git à interroger ; en local il vient de git ; et quand
 * ni l'un ni l'autre ne répond il dit DEV plutôt que d'inventer.
 *
 * Le remplacement vérifie, comme celui du service worker : un marqueur qui cesse
 * de correspondre fait échouer le build au lieu de livrer en silence une
 * estampille périmée. Chaque occurrence est réécrite, donc l'écran de démarrage
 * et le menu ne peuvent pas diverger — un test vérifie qu'ils s'accordent.
 */
function buildStamp(): Plugin {
  const commit = (): string => {
    const fromPages = process.env.CF_PAGES_COMMIT_SHA;
    if (fromPages) return fromPages.slice(0, 7).toUpperCase();
    try {
      return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' })
        .trim()
        .toUpperCase();
    } catch {
      return 'DEV';
    }
  };

  return {
    name: 'gs-build-stamp',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const marker = /<!-- build:stamp -->[^<]*/g;
        const found = html.match(marker)?.length ?? 0;
        if (!found) {
          throw new Error('build stamp: marker "build:stamp" not found in index.html');
        }
        const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
        return html.replace(marker, `<!-- build:stamp -->V${version} \u00b7 ${commit()}`);
      },
    },
  };
}

/**
 * `publicDir` pointe sur `static/` : le défaut de Vite, `public/`, est ici le
 * dossier de sortie, et du temps de l'ancien jeu il contenait `engine.js`,
 * `game.js` et leur `index.html`, que la migration retirait précisément.
 */
export default defineConfig({
  plugins: [buildStamp(), serviceWorkerAssets()],
  publicDir: 'static',
  build: {
    // `public/` et non `dist/`, pour que le projet Cloudflare Pages garde son
    // dossier de sortie et ne change que sa commande de build. Le nom est libre
    // depuis que l'ancien jeu est parti ; `publicDir` ci-dessus vaut
    // explicitement `static/`, donc Vite ne confond jamais les deux.
    //
    // C'est une sortie de build : ignorée par git, et vidée à chaque build.
    outDir: 'public',
    emptyOutDir: true,
    // three.js r128 précède la généralisation du await de premier niveau et du
    // chaînage optionnel dans son propre build ; cette cible garde la sortie
    // proche de ce que les anciens scripts exigeaient déjà d'un navigateur.
    target: 'es2020',
    sourcemap: true,
    // three.js r128 pèse 515 Ko à lui seul et ne s'élague pas — son build en
    // modules se référence lui-même, donc des imports nommés et `import * as
    // THREE` émettent une sortie identique à l'octet. Mesuré ; voir TECH-DEBT.md
    // §7. Découper le moteur de rendu d'un jeu n'ajouterait qu'un aller-retour.
    chunkSizeWarningLimit: 700,
  },
  // Même port sur l'hôte et dans l'image, maintenant que l'ancien jeu ne le
  // tient plus.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
