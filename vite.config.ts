import { defineConfig } from 'vite';

/**
 * The legacy game in `legacy/` is served by its own static server and is not
 * part of this build, so `publicDir` points at `static/` instead. Vite's
 * default would have copied `engine.js`, `game.js` and their `index.html` into
 * `dist/`, which is exactly what the migration is removing.
 */
export default defineConfig({
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
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
});
