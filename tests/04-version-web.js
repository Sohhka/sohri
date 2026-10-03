// Tests de la version web (GitHub Pages, iPhone) : service worker, hors connexion, PDF, partage,
// sauvegarde / restauration, mise à jour, appli installée. Moteurs : Chromium et WebKit (Safari).
// Usage : node 04-version-web.js <racine du projet> <dossier sorties> [chromium|webkit]
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const ENGINES = process.argv[4] ? [process.argv[4]] : ['chromium', 'webkit'];
const CHROME = require("./lib/chrome");
fs.mkdirSync(OUT, { recursive: true });

// ---------- Deux versions du site, préparées comme sur GitHub ----------
function build(name, patch) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'www'), path.join(dir, 'www'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
  if (patch) patch(path.join(dir, 'www'));
  const log = execFileSync(process.execPath, [path.join(dir, 'tools', 'build-web.js')]).toString().trim();
  const sw = fs.readFileSync(path.join(dir, '_site', 'sw.js'), 'utf8');
  const version = /var VERSION = '([0-9a-f]+)'/.exec(sw)[1];
  const files = JSON.parse(/var FILES = (\[.*\]);/.exec(sw)[1]);
  console.log('   ' + name + ' : ' + log);
  return { dir: path.join(dir, '_site'), version, files };
}
const V1 = build('site-v1');
const V2 = build('site-v2', www => {
  const index = path.join(www, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<title>SOHRI</title>', '<title>SOHRI</title>\n<meta name="sohri-test" content="v2">'));
});

// ---------- Serveur façon GitHub Pages : site dans /sohri/, 10 minutes de cache ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.icc': 'application/vnd.iccprofile'
};
let site = V1;
const requests = [];
const sockets = new Set();
function startServer(port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      requests.push(p);
      if (p === '/sohri') { res.writeHead(301, { Location: '/sohri/' }); return res.end(); }
      if (!p.startsWith('/sohri/')) { res.writeHead(404); return res.end('404'); }
      p = p.slice('/sohri'.length);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(site.dir, p);
      if (!file.startsWith(site.dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
      fs.createReadStream(file).pipe(res);
    });
    server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
function stopServer(server) {
  return new Promise(resolve => { server.close(() => resolve()); for (const s of sockets) s.destroy(); });
}

const results = [];
let prefix = '';
function check(ok, msg) { results.push([!!ok, prefix + msg]); console.log((ok ? 'PASS ' : 'FAIL ') + prefix + msg); }
const norm = s => (s || '').replace(/\s/g, ' ').trim();

// PDF sans police incluse (texte japonais) : pdf.js a besoin des CMaps (fichiers de l'appli).
function makeCjkPdf() {
  const content = 'BT /F1 36 Tf 20 80 Td <67714EAC99C5> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R >>',
    '<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function makeFixtures() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  const pages = Array.from({ length: 6 }, (_, i) => `<section style="page-break-after:always;height:250mm;font-family:sans-serif">
    <h1 style="color:#C8402C;font-size:48px">Page ${i + 1}</h1><p style="font-size:28px">Billet — 東京駅 → 京都駅 ${i + 1}</p>
    <div style="width:300px;height:150px;background:#1B2140"></div></section>`).join('');
  await page.setContent(`<html><body style="margin:0">${pages}</body></html>`);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await page.setViewportSize({ width: 900, height: 600 });
  await page.setContent('<body style="margin:0;background:#1B2140"><div style="margin:100px;width:400px;height:300px;border-radius:50%;background:#C8402C"></div></body>');
  const png = await page.screenshot({ type: 'png' });
  await browser.close();
  return { pdf, png, cjk: makeCjkPdf() };
}

const canvasInk = (page, sel) => page.$eval(sel, c => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
  return n;
});
const visible = (page, sel) => page.$eval(sel, el => !el.hidden && getComputedStyle(el).display !== 'none').catch(() => false);
const ready = page => page.waitForFunction(() => document.getElementById('rateText') && document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
async function topAction(page, label) { await page.click(`#topActions button[aria-label="${label}"]`); }
async function dialogOk(page, value) { await page.waitForSelector('#dialog:not([hidden])'); if (value !== undefined) await page.fill('#dialogInput', value); await page.click('#dialogOkBtn'); }
async function openSection(page, name) { await page.evaluate(() => openDrawer()); await page.click(`.drawer-item[data-section="${name}"]`); }
const rowByName = name => `#docsContent .doc-row:has(.doc-name:text-is("${name}"))`;

// WebKit : profil sur disque (en navigation privée, Safari n'enregistre pas les fichiers dans
// IndexedDB). Chromium : contexte ordinaire de Playwright (avec un profil sur disque piloté par
// Playwright, le service worker de Chrome reste en pause au démarrage).
let profiles = 0;
async function newPhone(engineName, { standalone = false } = {}) {
  const options = { ...devices['iPhone 14 Plus'], locale: 'fr-FR' };
  let context;
  if (engineName === 'webkit') {
    const dir = path.join(OUT, 'profiles', engineName + '-' + (++profiles));
    fs.rmSync(dir, { recursive: true, force: true });
    context = await webkit.launchPersistentContext(dir, options);
    await blockExternal(context);
  } else {
    const browser = await chromium.launch({ executablePath: CHROME });
    context = await browser.newContext(options);
    await blockExternal(context);
    context.on('close', () => browser.close());
  }
  await context.addInitScript(([standalone]) => {
    if (standalone) Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
    // Feuille de partage simulée ; mode : 'ok', 'notallowed-once' (délai de toucher dépassé) ou 'abort' (annulé).
    const s = window.__share = { calls: [], files: [], mode: 'ok' };
    navigator.canShare = data => !!(data && data.files && data.files.length);
    navigator.share = data => {
      s.calls.push(data.files.map(f => f.name + '|' + f.type + '|' + f.size));
      if (s.mode === 'notallowed-once') { s.mode = 'ok'; return Promise.reject(new DOMException('Pas de toucher récent', 'NotAllowedError')); }
      if (s.mode === 'abort') return Promise.reject(new DOMException('Partage annulé', 'AbortError'));
      s.files.push(data.files[0]);
      return Promise.resolve();
    };
    window.__opened = [];
    window.open = url => { window.__opened.push(url); return null; };
  }, [standalone]);
  const page = context.pages()[0] || await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Could not connect/.test(m.text())) page.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  return { context, page };
}

async function run(engineName, fixtures) {
  prefix = '[' + engineName + '] ';
  const engine = engineName === 'webkit' ? webkit : chromium;
  const browser = await engine.launch(engineName === 'chromium' ? { executablePath: CHROME } : {});
  console.log('\n== ' + engineName + ' ' + browser.version() + ' ==');
  site = V1;
  let server = await startServer(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/sohri/`;
  const shots = path.join(OUT, 'shots-' + engineName);
  fs.mkdirSync(shots, { recursive: true });

  // ---------- Navigation privée ----------
  {
    const context = await browser.newContext({ ...devices['iPhone 14 Plus'], locale: 'fr-FR' });
    await blockExternal(context);
    const page = await context.newPage();
    await page.goto(base);
    await ready(page);
    await page.waitForTimeout(1500);
    const text = norm(await page.textContent('#bannerText'));
    const blobs = await page.evaluate(() => dbPut('settings', { key: 't', value: new Blob(['x']) }).then(() => true, () => false));
    if (blobs) check(!text.includes('navigation privée'), 'navigation privée (fichiers acceptés par ce moteur) : pas d\'avertissement');
    else {
      check(await visible(page, '#banner') && text.includes('navigation privée'), 'navigation privée (Safari) : avertissement « fichiers non enregistrés »');
      await page.screenshot({ path: shots + '/00-navigation-privee.png' });
    }
    await context.close();
  }
  await browser.close();

  const { context, page } = await newPhone(engineName);
  await page.goto(base);
  await ready(page);
  const env = await page.evaluate(() => ({
    classes: document.documentElement.className, touch: TOUCH_DEVICE, ios: IS_IOS, installed: IS_INSTALLED,
    sw: 'serviceWorker' in navigator, secure: isSecureContext, vv: !!window.visualViewport
  }));
  console.log('   environnement :', JSON.stringify(env));
  check(/\bis-web\b/.test(env.classes) && !/ios-standalone/.test(env.classes), 'page web : classe is-web, pas ios-standalone');
  check(env.ios && !env.installed, 'iPhone détecté (Safari, appli non installée)');

  // ---------- Bandeau d'installation ----------
  await page.waitForSelector('#banner:not([hidden])');
  check(norm(await page.textContent('#bannerText')).includes("Sur l'écran d'accueil") && !(await visible(page, '#bannerActionBtn')), "bandeau : comment installer l'appli");
  await page.screenshot({ path: shots + '/01-bandeau-installation.png' });
  // Le bandeau ne recouvre rien : entre le contenu et la barre de mise en forme de l'éditeur...
  await page.evaluate(() => goToSection('notes'));
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === 'Notes');
  await page.evaluate(() => openView('note-edit', {}));
  await page.waitForSelector('#mdToolbar:not([hidden])');
  await page.waitForTimeout(300);
  const layout = await page.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    return { mainBottom: document.querySelector('main').getBoundingClientRect().bottom, banner: r('banner'), toolbar: r('mdToolbar'), height: innerHeight };
  });
  check(layout.mainBottom <= layout.banner.top + 0.5 && layout.banner.bottom <= layout.toolbar.top + 0.5 && layout.toolbar.bottom <= layout.height + 0.5,
    'bandeau entre le contenu et la barre de mise en forme, sans rien recouvrir');
  await page.screenshot({ path: shots + '/01b-bandeau-editeur.png' });
  await page.evaluate(() => goBack());
  // ... et la visionneuse de documents passe par-dessus.
  await page.evaluate(() => openDocument({ name: 'essai.png', type: 'image/png', size: 70, blob: new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))], { type: 'image/png' }) }));
  await page.waitForSelector('#docZoom:not([hidden])');
  const onTop = await page.evaluate(() => {
    const r = document.getElementById('docZoomIn').getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === document.getElementById('docZoomIn');
  });
  check(onTop, 'visionneuse : boutons de zoom visibles, bandeau dessous');
  await page.evaluate(() => closeDocument());
  await page.click('#bannerCloseBtn');
  check(!(await visible(page, '#banner')) && await page.evaluate(() => localStorage.getItem('sohri.installHint')) === 'hidden', 'bandeau fermé : ne revient plus');

  // ---------- Service worker : copie hors connexion ----------
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 });
  const cache = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter(k => k.startsWith('sohri-'));
    const c = await caches.open(keys[0]);
    const entries = (await c.keys()).map(r => new URL(r.url).pathname);
    return { keys, count: entries.length, entries };
  });
  check(cache.keys.length === 1 && cache.keys[0] === 'sohri-' + V1.version, 'cache « sohri-' + V1.version + ' » créé');
  check(cache.count === V1.files.length && cache.entries.includes('/sohri/') && cache.entries.includes('/sohri/js/vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap'),
    'tous les fichiers copiés (' + cache.count + '/' + V1.files.length + ')');
  await page.evaluate(() => goToSection('settings'));
  check(norm(await page.textContent('#appVersion')) === 'SOHRI, version web, disponible hors connexion.', 'Paramètres : « disponible hors connexion »');
  check(await visible(page, '#installInfo'), "Paramètres : explication de l'installation (Safari)");

  // ---------- Données : note et documents ----------
  await page.evaluate(() => goToSection('notes'));
  await page.evaluate(() => openView('note-edit', {}));
  await page.fill('#noteTitle', 'Carnet hors connexion');
  await page.fill('#noteBody', '**Gras** et 🍣');
  await topAction(page, 'Enregistrer la note');
  await page.waitForSelector('#noteDetail .detail-title');
  await openSection(page, 'documents');
  await page.click('#docsContent .add-row');
  await dialogOk(page, 'Billets');
  await page.waitForSelector('#docsContent .list-row');
  await page.click('#docsContent .list-row');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === '📁 Billets');
  await page.setInputFiles('#docFiles', [
    { name: 'billet.pdf', mimeType: 'application/pdf', buffer: fixtures.pdf },
    { name: 'police-japonaise.pdf', mimeType: 'application/pdf', buffer: fixtures.cjk },
    { name: 'plan.png', mimeType: 'image/png', buffer: fixtures.png }
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#docsContent .doc-row').length === 3, null, { timeout: 60000 });
  const thumbs = await page.$$eval('#docsContent .doc-row', rows => rows.filter(r => r.querySelector('.doc-thumb img')).length);
  check(thumbs === 3, 'documents importés, avec miniatures (' + thumbs + '/3)');

  // ---------- Hors connexion ----------
  await stopServer(server);
  const before = requests.length;
  await page.reload();
  await ready(page);
  check(true, 'hors connexion : l\'appli se lance');
  await page.evaluate(() => goToSection('notes'));
  await page.waitForSelector('#notesContent .list-row');
  check(norm(await page.textContent('#notesContent')).includes('Carnet hors connexion'), 'hors connexion : la note est là');
  await openSection(page, 'documents');
  await page.click('#docsContent .list-row');
  await page.waitForSelector(rowByName('police-japonaise.pdf'));
  await page.click(rowByName('police-japonaise.pdf'));
  await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await page.waitForTimeout(300);
  check((await canvasInk(page, '.pdf-page canvas')) > 300, 'hors connexion : PDF japonais affiché (pdf.js et CMaps depuis la copie locale)');
  await page.screenshot({ path: shots + '/02-pdf-hors-connexion.png' });
  check(requests.length === before, 'hors connexion : aucune requête au serveur');

  // ---------- Partage (feuille de partage de l'iPhone) ----------
  await page.click('#docShareBtn');
  await page.waitForFunction(() => window.__share.calls.length === 1);
  check((await page.evaluate(() => window.__share.calls[0][0])) === 'police-japonaise.pdf|application/pdf|' + fixtures.cjk.length, 'partage : PDF transmis à la feuille de partage');
  await page.evaluate(() => { window.__share.mode = 'notallowed-once'; });
  await page.click('#docShareBtn');
  await page.waitForSelector('#dialog:not([hidden])');
  check(norm(await page.textContent('#dialogMessage')) === '« police-japonaise.pdf » est prêt.' && norm(await page.textContent('#dialogOkBtn')) === 'Partager',
    'partage refusé (délai du toucher dépassé) : « est prêt », bouton Partager');
  await page.screenshot({ path: shots + '/03-partage-pret.png' });
  await page.click('#dialogOkBtn');
  await page.waitForFunction(() => window.__share.files.length === 2);
  check(!(await visible(page, '#dialog')), 'second toucher : feuille de partage ouverte');
  await page.evaluate(() => { window.__share.mode = 'abort'; });
  await page.click('#docShareBtn');
  await page.waitForFunction(() => window.__share.calls.length === 4);
  await page.waitForTimeout(200);
  check(!(await visible(page, '#dialog')), 'partage annulé : aucun message');
  await page.evaluate(() => { window.__share.mode = 'ok'; });
  await page.click('#docMenuBtn');
  await page.click('#sheetPanel .sheet-item:has-text("Enregistrer sous")');
  await page.waitForFunction(() => window.__share.files.length === 3);
  check(true, '« Enregistrer sous… » : feuille de partage (Enregistrer dans Fichiers)');
  await page.click('#docCloseBtn');

  // ---------- Sauvegarde ----------
  await page.evaluate(() => goToSection('settings'));
  await page.click('#backupBtn');
  await page.waitForFunction(() => window.__share.files.length === 4, null, { timeout: 60000 });
  const backup = await page.evaluate(async () => {
    const f = window.__share.files[3];
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { name: f.name, type: f.type, b64: btoa(bin), progress: document.getElementById('progress').hidden };
  });
  const zip = Buffer.from(backup.b64, 'base64');
  fs.writeFileSync(path.join(OUT, engineName + '-sauvegarde.zip'), zip);
  check(/^SOHRI-sauvegarde-\d{4}-\d\d-\d\d\.zip$/.test(backup.name) && backup.type === 'application/zip' && zip.readUInt32LE(0) === 0x04034b50 && backup.progress,
    'sauvegarde : zip transmis à la feuille de partage (' + (zip.length / 1024).toFixed(0) + ' Ko)');

  // ---------- Retour du réseau, restauration dans une autre appli (autre stockage) ----------
  server = await startServer(port);
  {
    const other = await newPhone(engineName);
    await other.page.goto(base);
    await ready(other.page);
    await other.page.evaluate(() => goToSection('settings'));
    await other.page.setInputFiles('#restoreInput', { name: backup.name, mimeType: 'application/zip', buffer: zip });
    await other.page.waitForSelector('#dialog:not([hidden])');
    check(norm(await other.page.textContent('#dialogMessage')).includes('1 note, 0 adresse, 0 album, 0 photo, 3 documents'), 'restauration : contenu annoncé');
    await Promise.all([other.page.waitForNavigation(), other.page.click('#dialogOkBtn')]);
    await ready(other.page);
    const restored = await other.page.evaluate(async () => {
      const docs = await dbGetAll('documents');
      const files = await dbGetAll('documentFiles');
      const pdf = docs.find(d => d.name === 'police-japonaise.pdf');
      const file = files.find(f => f.id === pdf.fileId);
      return { notes: (await dbGetAll('notes')).map(n => n.title), docs: docs.length, pdfSize: file ? file.blob.size : -1 };
    });
    check(restored.notes.join() === 'Carnet hors connexion' && restored.docs === 3 && restored.pdfSize === fixtures.cjk.length, 'restauration : note et documents identiques');
    check(other.page.errors.length === 0, 'restauration : aucune erreur' + (other.page.errors.length ? ' : ' + other.page.errors.join(' | ') : ''));
    await other.context.close();
  }

  // ---------- Mise à jour ----------
  site = V2;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('#banner:not([hidden])', { timeout: 60000 });
  check(norm(await page.textContent('#bannerText')) === 'Une nouvelle version de SOHRI est disponible.' && norm(await page.textContent('#bannerActionBtn')) === 'Mettre à jour',
    'nouvelle version en ligne : bandeau « Mettre à jour »');
  await page.screenshot({ path: shots + '/04-mise-a-jour.png' });
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('#bannerActionBtn')]);
  await ready(page);
  const updated = await page.evaluate(async () => ({
    marker: !!document.querySelector('meta[name="sohri-test"]'),
    keys: (await caches.keys()).filter(k => k.startsWith('sohri-'))
  }));
  check(updated.marker, 'après mise à jour : nouvelle version affichée (et non l\'ancienne restée en cache)');
  check(updated.keys.join() === 'sohri-' + V2.version, 'ancienne copie effacée, nouvelle copie en place');
  const notesAfter = await page.evaluate(async () => (await dbGetAll('notes')).length);
  check(notesAfter === 1, 'après mise à jour : données conservées');

  // ---------- Clavier : l'appli suit la partie visible de l'écran ----------
  await page.setViewportSize({ width: 428, height: 480 });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim() === '480px');
  check(Math.round(await page.$eval('#app', el => el.getBoundingClientRect().height)) === 480, 'hauteur de l\'appli = partie visible (480 px)');
  await page.setViewportSize(devices['iPhone 14 Plus'].viewport);

  // ---------- Liens ----------
  const opened = await page.evaluate(() => { openExternal('https://www.google.com/maps/dir/?api=1&destination=Tokyo'); return window.__opened; });
  check(opened.length === 1 && opened[0].startsWith('https://www.google.com/maps/'), 'lien web : nouvel onglet / Safari');
  check(page.errors.length === 0, 'aucune erreur JavaScript' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
  await context.close();

  // ---------- Appli installée sur l'écran d'accueil ----------
  {
    const app = await newPhone(engineName, { standalone: true });
    await app.page.goto(base);
    await ready(app.page);
    const strip = await app.page.evaluate(() => {
      const s = getComputedStyle(document.body, '::before');
      return { classes: document.documentElement.className, bg: s.backgroundColor, position: s.position, content: s.content };
    });
    check(/ios-standalone/.test(strip.classes) && strip.bg === 'rgb(27, 33, 64)' && strip.position === 'fixed', 'appli installée : bande foncée sous la barre d\'état');
    await app.page.waitForTimeout(500);
    check(!(await visible(app.page, '#banner')), 'appli installée : pas de bandeau d\'installation');
    await app.page.evaluate(() => goToSection('settings'));
    check(!(await visible(app.page, '#installInfo')), 'appli installée : pas d\'explication d\'installation');
    await app.page.evaluate(() => setThemePreference('dark'));
    check(await app.page.getAttribute('meta[name="theme-color"]', 'content') === '#1B2140', 'thème sombre : couleur de la barre du navigateur');
    await app.page.screenshot({ path: shots + '/05-appli-installee-sombre.png' });
    check(app.page.errors.length === 0, 'appli installée : aucune erreur' + (app.page.errors.length ? ' : ' + app.page.errors.join(' | ') : ''));
    await app.context.close();
  }

  await stopServer(server);
}

(async () => {
  const fixtures = await makeFixtures();
  for (const engine of ENGINES) {
    try {
      await run(engine, fixtures);
    } catch (e) {
      check(false, 'exception : ' + (e && e.stack || e));
    }
  }
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  process.exit(failed.length ? 1 : 0);
})();
