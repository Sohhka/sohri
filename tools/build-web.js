/* Prépare la version web (GitHub Pages) dans _site/ : copie de www/, et liste des fichiers à garder
   hors connexion écrite dans le service worker, avec une version tirée de leur contenu (toute
   modification déclenche la mise à jour de l'appli sur le téléphone).
   Usage : node tools/build-web.js   (lancé automatiquement par GitHub à chaque envoi, voir
   .github/workflows/pages.yml) */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const source = path.join(root, 'www');
const output = path.join(root, '_site');

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, { recursive: true });

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(path.relative(output, full).split(path.sep).join('/'));
  }
})(output);

// Tout, sauf le service worker lui-même et les textes de licence (inutiles hors connexion).
const precache = files.filter(f => f !== 'sw.js' && !/(^|\/)LICENSE|\.LICENSE\./.test(f)).sort();
const swPath = path.join(output, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('/* @precache */')) throw new Error('Repère « @precache » introuvable dans www/sw.js');

const hash = crypto.createHash('sha256').update(sw);
for (const f of precache) hash.update(f + '\0').update(fs.readFileSync(path.join(output, f)));
const version = hash.digest('hex').slice(0, 12);

fs.writeFileSync(swPath, sw.replace('/* @precache */',
  `var VERSION = '${version}';\nvar FILES = ${JSON.stringify(['./'].concat(precache))};`));

const size = precache.reduce((sum, f) => sum + fs.statSync(path.join(output, f)).size, 0);
console.log(`Version web ${version} : ${precache.length} fichiers (${(size / 1048576).toFixed(1)} Mo) dans _site/`);
