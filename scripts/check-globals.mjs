/* Les deux scripts de public/ partagent une portée globale : un nom déclaré des
   deux côtés est une erreur de syntaxe qui n'apparaît qu'au chargement de la
   page. Ce contrôle la fait apparaître en ligne de commande.
   Usage : node scripts/check-globals.mjs */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const files = ['public/engine.js', 'public/game.js'];
const merged = files.map((f) => readFileSync(f, 'utf8')).join('\n');
const tmp = join(tmpdir(), `g-surge-globals-${process.pid}.js`);

writeFileSync(tmp, merged);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  console.log(`ok — ${files.join(' + ')} : aucune collision de nom global`);
} catch (err) {
  const detail = (err.stderr?.toString() ?? '').replace(new RegExp(tmp, 'g'), '<concaténation>');
  console.error(detail.trim() || err.message);
  console.error('\nUn nom est déclaré dans les deux fichiers. Voir CLAUDE.md, « Load order matters ».');
  process.exitCode = 1;
} finally {
  unlinkSync(tmp);
}
