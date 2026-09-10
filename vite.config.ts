import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Writes the service worker's precache list at build time.
 *
 * Vite emits content-hashed filenames, so the list cannot be maintained by
 * hand — which is why, until this existed, the one file that matters was never
 * precached and an offline first open did not work.
 *
 * The cache name is derived from the list rather than bumped manually. It
 * therefore changes if and only if an asset changes, which retires a rule that
 * could be forgotten.
 *
 * Both replacements assert: a marker that stops matching has to fail the build
 * loudly, not silently leave the previous list in place.
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
        // Relative and slash-separated first, so the filters below see a clean
        // path. Prefixing with `./` before filtering made every path look like
        // a dotfile and silently emptied the list.
        .map((f) => relative(out, f).split(/[\\/]/).join('/'))
        // Source maps are for us, not for the player; `_headers` is a
        // Cloudflare directive that is never fetched; and the worker cannot
        // usefully precache itself. Dotfiles are never assets.
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

      // FNV-1a over the list: short, stable, and changes with any of it.
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
 * The legacy game in `legacy/` is served by its own static server and is not
 * part of this build, so `publicDir` points at `static/` instead. Vite's
 * default would have copied `engine.js`, `game.js` and their `index.html` into
 * `dist/`, which is exactly what the migration is removing.
 */
export default defineConfig({
  plugins: [serviceWorkerAssets()],
  publicDir: 'static',
  build: {
    // `public/` and not `dist/`, so that the Cloudflare Pages project keeps
    // its existing output directory and only its build command changes. The
    // name is free since the legacy moved to `legacy/`; `publicDir` above is
    // explicitly `static/`, so Vite never confuses the two.
    //
    // It is build output: gitignored, and emptied on every build.
    outDir: 'public',
    emptyOutDir: true,
    // three.js r128 predates widespread top-level await and optional chaining
    // in its own build; this target keeps the output close to what the legacy
    // scripts already required of a browser.
    target: 'es2020',
    sourcemap: true,
    // three.js r128 is 515 KB on its own and cannot be tree-shaken — its module
    // build cross-references itself, so named imports and `import * as THREE`
    // emit byte-identical output. Measured; see TECH-DEBT.md section 7. Code
    // splitting a game's renderer would only add a round trip.
    chunkSizeWarningLimit: 700,
  },
  // Same port on the host and in the image, now that the legacy no longer
  // holds it.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
