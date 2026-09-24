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

// Configuration du partage (projet Firebase) : absente du dépôt. Sur GitHub, elle vient du secret
// SOHRI_CLOUD_CONFIG ({ "apiKey": ..., "projectId": ... }) ; en local, de www/js/cloud-config.js.
// Sans elle, le partage est simplement masqué dans l'appli.
const cloudConfigPath = path.join(output, 'js', 'cloud-config.js');
if (process.env.SOHRI_CLOUD_CONFIG) {
  const config = JSON.parse(process.env.SOHRI_CLOUD_CONFIG);
  if (typeof config.apiKey !== 'string' || typeof config.projectId !== 'string') throw new Error('SOHRI_CLOUD_CONFIG : apiKey et projectId attendus');
  const kept = { apiKey: config.apiKey, projectId: config.projectId }; // rien d'autre n'est publié
  fs.writeFileSync(cloudConfigPath, `window.SOHRI_CLOUD = window.SOHRI_CLOUD || ${JSON.stringify(kept)};\n`);
} else if (!fs.existsSync(cloudConfigPath)) {
  fs.writeFileSync(cloudConfigPath, 'window.SOHRI_CLOUD = window.SOHRI_CLOUD || null;\n');
}

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
