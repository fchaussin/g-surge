/* Fabrique les trois panneaux d'un pen à partir des sources.
   Le JavaScript est la simple concaténation d'engine.js puis game.js : les deux
   fichiers partagent déjà leurs déclarations de premier niveau, l'ordre suffit.
   Usage : node scripts/build-codepen.mjs */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'public/index.html'), 'utf8');

const css = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!css) throw new Error('bloc <style> introuvable dans index.html');

// corps de page, sans les balises script de fin
let body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
body = body.replace(/<script[\s\S]*?<\/script>/g, '').trim();

const engine = readFileSync(join(root, 'public/engine.js'), 'utf8');
const game   = readFileSync(join(root, 'public/game.js'), 'utf8');

const out = join(root, 'dist/codepen');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'pen.html'), body + '\n');
writeFileSync(join(out, 'pen.css'), css[1].trim() + '\n');
writeFileSync(join(out, 'pen.js'),
  '/* Panneau JS : engine.js puis game.js, dans cet ordre.\n' +
  '   Ajouter three.js r128 dans Settings > JS > Add External Scripts :\n' +
  '   https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js */\n\n' +
  engine + '\n\n/* ---------- game.js ---------- */\n\n' + game + '\n');

const kb = n => (n / 1024).toFixed(1) + ' Ko';
console.log('dist/codepen/pen.html', kb(body.length));
console.log('dist/codepen/pen.css ', kb(css[1].length));
console.log('dist/codepen/pen.js  ', kb(engine.length + game.length));
console.log('\nLe service worker et le manifeste sont ignorés, ils n\'ont pas de sens dans un pen.');
