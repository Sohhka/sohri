// Tests de bout en bout de SOHRI 1.1 (www/) dans Chromium, téléphone simulé + faux pont Android.
// Usage : node 02-android.js <dossier www> <dossier sorties>
const { chromium } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require("./lib/chrome");
fs.mkdirSync(OUT, { recursive: true });

// ---------- Serveur (types MIME comme WebViewAssetLoader) + page de préparation d'une base v1 ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const SEED_V1 = `<!DOCTYPE html><meta charset="utf-8"><script>
  const req = indexedDB.open('travelAppDB', 1);
  req.onupgradeneeded = e => { const db = e.target.result;
    db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('addresses', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('settings', { keyPath: 'key' }); };
  req.onsuccess = e => { const db = e.target.result; const tx = db.transaction(['notes','addresses','settings'], 'readwrite');
    tx.objectStore('addresses').put({ title: 'Ancien hôtel', description: 'desc', address: 'Kyoto', createdAt: 1 });
    tx.objectStore('notes').put({ title: 'Ancienne note', body: 'Texte v1', addressId: '1', createdAt: 2,
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='] });
    tx.objectStore('settings').put({ key: 'yenEuroRate', value: 175 });
    tx.oncomplete = () => { db.close(); document.title = 'seeded'; }; };
</script>`;
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/seed-v1.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(SEED_V1); }
      if (p === '/') p = '/index.html';
      const file = path.join(WWW, p);
      if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function check(ok, msg) { results.push([!!ok, msg]); console.log((ok ? 'PASS ' : 'FAIL ') + msg); }
const norm = s => (s || '').replace(/\s/g, ' ').trim();

// ---------- Images de test ----------
async function makeImage(page, w, h, type, label) {
  const b64 = await page.evaluate(async ([w, h, type, label]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#C8402C'); grad.addColorStop(1, '#1B2140');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(h / 5) + 'px sans-serif'; g.fillText(label || (w + 'x' + h), w * 0.08, h * 0.6);
    const blob = await new Promise(r => c.toBlob(r, type, 0.92));
    return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
  }, [w, h, type, label]);
  return Buffer.from(b64, 'base64');
}
// Ajoute une date de prise de vue EXIF (DateTimeOriginal) à un JPEG, après le segment APP0.
function withExifDate(jpeg, date) {
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0, 'ascii'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x8769, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18); tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26); tiff.writeUInt16LE(0x9003, 28); tiff.writeUInt16LE(2, 30); tiff.writeUInt32LE(20, 32); tiff.writeUInt32LE(44, 36); tiff.writeUInt32LE(0, 40);
  tiff.write(date + '\0', 44, 'ascii');
  const data = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const head = Buffer.alloc(4); head.writeUInt16BE(0xFFE1, 0); head.writeUInt16BE(data.length + 2, 2);
  const app0End = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.slice(0, app0End), head, data, jpeg.slice(app0End)]);
}

// ---------- Téléphone simulé ----------
async function newPhone(browser, { bridge = true, systemDark = false, colorScheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', colorScheme });
  await blockExternal(context);
  if (bridge) {
    await context.addInitScript(([systemDark]) => {
      const state = window.__bridge = { opened: [], copied: [], files: {}, finished: [], saved: {}, themePref: 'auto', systemDark };
      try { const saved = sessionStorage.getItem('__bridgeTheme'); if (saved) state.themePref = saved; } catch (e) {}
      window.AndroidBridge = {
        isSystemDark: () => state.systemDark,
        getThemePreference: () => state.themePref,
        setThemePreference: p => { state.themePref = p; sessionStorage.setItem('__bridgeTheme', p); },
        getSafeAreaInsets: () => '[24,0,16,0]',
        openExternal: url => state.opened.push(url),
        copyText: t => state.copied.push(t),
        getAppVersion: () => '1.1',
        fileBegin: (name, type) => { const id = 'f' + Object.keys(state.files).length; state.files[id] = { name, type, chunks: [] }; return id; },
        fileAppend: (id, b64) => { state.files[id].chunks.push(b64); },
        fileFinish: (id, action) => {
          const f = state.files[id];
          const parts = f.chunks.map(c => Uint8Array.from(atob(c), ch => ch.charCodeAt(0)));
          const blob = new Blob(parts, { type: f.type });
          state.saved[id] = blob;
          state.finished.push({ id, action, name: f.name, type: f.type, size: blob.size, chunks: f.chunks.length });
        }
      };
    }, [systemDark]);
  }
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Image illisible|Failed to load resource/.test(m.text())) page.errors.push('console.error: ' + m.text());
  });
  page.on('dialog', d => { page.errors.push('dialogue natif inattendu: ' + d.message()); d.dismiss(); });
  return { context, page };
}

const back = page => page.evaluate(() => handleBackButton());
const title = page => page.textContent('#viewTitle');
const visible = (page, sel) => page.$eval(sel, el => !el.hidden && getComputedStyle(el).display !== 'none').catch(() => false);
const lastFile = page => page.evaluate(() => window.__bridge.finished[window.__bridge.finished.length - 1] || null);
async function topAction(page, label) { await page.click(`#topActions button[aria-label="${label}"]`); }
async function sheetItem(page, text) { await page.click(`#sheetPanel .sheet-item:has-text("${text}")`); }
async function dialogAnswer(page, value, okText) {
  await page.waitForSelector('#dialog:not([hidden])');
  if (value !== undefined) await page.fill('#dialogInput', value);
  if (okText) check(norm(await page.textContent('#dialogOkBtn')) === okText, 'bouton de la boîte de dialogue : « ' + okText + ' »');
  await page.click('#dialogOkBtn');
}
async function openSection(page, name) { await page.evaluate(() => openDrawer()); await page.click('.drawer-item[data-section="' + name + '"]'); }
async function waitIdle(page) { await page.waitForTimeout(120); }
async function toolbar(page, action) { await page.tap(`#mdToolbar [data-md="${action}"]`); }
async function select(page, sel, start, end) { await page.$eval(sel, (el, [s, e]) => { el.focus(); el.setSelectionRange(s, e); }, [start, end]); }

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + '/index.html';
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log('Chrome', browser.version());

  // ================= Migration d'une base v1 (appli 1.0) =================
  {
    const { context, page } = await newPhone(browser);
    await page.goto(base + '/seed-v1.html');
    await page.waitForFunction(() => document.title === 'seeded');
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
    check(norm(await page.textContent('#rateText')) === '1 € = 175,00 ¥', 'migration v1 → v2 : taux conservé');
    const stores = await page.evaluate(async () => { const db = await dbPromise; return { version: db.version, stores: Array.from(db.objectStoreNames).sort().join(',') }; });
    check(stores.version === 6 && stores.stores === 'addresses,cloud,documentFiles,documents,expenses,folders,notes,photos,settings,sharedAlbums,sharedComments,sharedPhotos', 'migration : base en version 6 avec les nouveaux magasins (' + stores.stores + ')');
    await page.evaluate(() => goToSection('notes'));
    await page.waitForSelector('#notesContent .list-row');
    check(await page.textContent('#notesContent .list-row-title') === 'Ancienne note', 'migration : ancienne note visible');
    check((await page.textContent('#notesContent .chips')).includes('Ancien hôtel'), 'migration : lien vers l\'ancienne adresse conservé (id en texte)');
    await page.click('#notesContent .list-row');
    await page.waitForSelector('#noteDetail .image-cell img');
    check(await page.$eval('#noteDetail .image-cell img', img => img.complete && img.naturalWidth === 1), 'migration : ancienne photo (data URL) affichée');
    check(page.errors.length === 0, 'migration : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
    await context.close();
  }

  // ================= Parcours complet, pont Android simulé =================
  const { context, page } = await newPhone(browser);
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  check(await title(page) === 'Convertisseur', 'démarrage sur le convertisseur');
  check(await page.getAttribute('html', 'data-theme') === 'light', 'thème clair (automatique, téléphone en clair)');
  check(await page.$eval('.topbar', el => getComputedStyle(el).paddingTop) === '38px', 'barre du haut sous la barre d\'état');
  await page.fill('#yenInput', '10000');
  check(norm(await page.textContent('#eurResult')) === '54,20', 'convertisseur toujours fonctionnel (10 000 ¥ = 54,20 €)');
  const scrollable = () => page.$eval('main', m => ({ x: m.scrollWidth - m.clientWidth, y: m.scrollHeight - m.clientHeight }));
  check(JSON.stringify(await scrollable()) === '{"x":0,"y":0}', 'convertisseur : tient dans l\'écran, sans défilement (ni de côté, ni vertical)');
  await page.fill('#yenInput', '99999999999999');
  check(norm(await page.inputValue('#yenInput')) === '999 999 999 999' && (await scrollable()).x === 0, 'montant énorme (12 chiffres max) : rétréci, toujours sans défilement');
  await page.fill('#yenInput', '10000');

  // ---------- Menu ----------
  await page.click('#navBtn');
  check(await visible(page, '#drawer'), 'menu ouvert');
  check((await page.$$eval('.drawer-item', l => l.filter(e => !e.hidden).map(e => e.textContent.trim()))).join(' | ') === '💴Convertisseur ¥ ⇄ € | 🧾Dépenses | 🌤️Météo & heure | 📝Notes | 📍Carnet d\'adresses | 🗣️Phrases utiles | 🖼️Images | 📂Documents | 👥Partage | ⚙️Paramètres', 'menu : 10 rubriques dont Dépenses, Phrases utiles, Météo & heure et Partage (projet Firebase configuré)');
  await page.screenshot({ path: OUT + '/01-menu.png' });
  await page.click('.drawer-item[data-section="notes"]');
  await page.waitForSelector('#notesEmpty:not([hidden])');
  check(await title(page) === 'Notes' && norm(await page.textContent('#notesEmpty')).startsWith('Aucune note'), 'Notes : état vide');

  // ---------- Dossier « Tokyo » avec icône choisie ----------
  await page.click('#notesContent .add-row');
  await page.waitForSelector('#dialog:not([hidden])');
  check(norm(await page.textContent('#dialogTitle')) === 'Nouveau dossier' && await visible(page, '#dialogIconBtn'), 'nouveau dossier : saisie du nom et bouton d\'icône');
  await page.fill('#dialogInput', 'Tokyo');
  await page.click('#dialogIconBtn');
  await page.waitForSelector('#sheet:not([hidden]) .emoji-grid');
  check(await page.$$eval('.emoji-tab', l => l.length) >= 6, 'sélecteur d\'emojis : catégories');
  await page.screenshot({ path: OUT + '/02-emojis.png' });
  await page.click('.emoji-tab[aria-label="Voyage et lieux"]');
  await page.click('.emoji-cell[data-emoji="🗼"]');
  check(await page.textContent('#dialogIconBtn') === '🗼' && !(await visible(page, '#sheet')), 'emoji choisi au-dessus de la boîte de dialogue (🗼)');
  await dialogAnswer(page, undefined, 'Créer');
  await page.waitForSelector('#notesContent .list-row');
  check(norm(await page.textContent('#notesContent .list-row')) === '🗼Tokyo0›', 'dossier créé et listé (🗼 Tokyo, 0 note)');

  // ---------- Nouvelle note dans le dossier ----------
  await page.click('#notesContent .list-row');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === '🗼 Tokyo' && !document.getElementById('notesEmpty').hidden);
  check(await title(page) === '🗼 Tokyo' && norm(await page.textContent('#notesEmpty')).startsWith('Ce dossier est vide'), 'dossier ouvert (titre et état vide)');
  check(await page.textContent('#navBtn') === '←', 'bouton ← dans une vue ouverte depuis une autre');
  await topAction(page, 'Nouvelle note');
  await page.waitForFunction(() => document.getElementById('noteFolderBtn').textContent !== '');
  check(await title(page) === 'Nouvelle note' && await page.textContent('#noteFolderBtn') === '🗼 Tokyo', 'éditeur : dossier présélectionné');
  check(await visible(page, '#mdToolbar'), 'éditeur : barre de mise en forme visible');
  await page.click('#noteIconBtn');
  await page.click('.emoji-tab[aria-label="Voyage et lieux"]');
  await page.click('.emoji-cell[data-emoji="⛩️"]');
  check(await page.textContent('#noteIconBtn') === '⛩️', 'icône de la note choisie (⛩️)');
  await page.fill('#noteTitle', 'Temple Sensō-ji');

  // ---------- Mise en forme avec la barre d'outils ----------
  const body = '#noteBody';
  await page.click(body);
  await page.keyboard.type('Programme');
  await toolbar(page, 'heading');
  check(await page.inputValue(body) === '# Programme', 'barre : titre (# Programme)');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Arriver tôt');
  let v = await page.inputValue(body);
  await select(page, body, v.length - 3, v.length);
  await toolbar(page, 'bold');
  check(await page.inputValue(body) === '# Programme\nArriver **tôt**', 'barre : gras sur la sélection (**tôt**)');
  await select(page, body, v.length + 4, v.length + 4);
  await page.keyboard.press('Enter');
  await toolbar(page, 'task');
  await page.keyboard.type('Omikuji');
  await page.keyboard.press('Enter');
  check((await page.inputValue(body)).endsWith('- [ ] Omikuji\n- [ ] '), 'Entrée dans une liste à cocher : nouvelle case préparée');
  await page.keyboard.type('Photos du portail');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  check((await page.inputValue(body)).endsWith('- [ ] Photos du portail\n\n'), 'Entrée sur une case vide : fin de la liste');
  await page.keyboard.type('Horaires ');
  await toolbar(page, 'link');
  await page.keyboard.type('www.senso-ji.jp');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await toolbar(page, 'emoji');
  await page.waitForSelector('#sheet:not([hidden]) .emoji-grid');
  await page.click('.emoji-tab[aria-label="Nourriture et boissons"]');
  await page.click('.emoji-cell[data-emoji="🍡"]');
  const expected = '# Programme\nArriver **tôt**\n- [ ] Omikuji\n- [ ] Photos du portail\n\nHoraires [lien](www.senso-ji.jp)\n🍡';
  check(await page.inputValue(body) === expected, 'barre : lien et emoji insérés au bon endroit');
  if (await page.inputValue(body) !== expected) console.log('   obtenu :', JSON.stringify(await page.inputValue(body)));
  const autoHeight = await page.$eval(body, el => el.scrollHeight <= el.clientHeight + 2);
  check(autoHeight, 'la zone de texte grandit avec son contenu');
  await page.screenshot({ path: OUT + '/03-editeur.png' });

  // ---------- Aperçu ----------
  await page.click('#notePreviewTab');
  check(!(await visible(page, '#mdToolbar')) && await visible(page, '#notePreview'), 'Aperçu : texte mis en forme, barre masquée');
  const preview = await page.$eval('#notePreview', el => ({
    h1: el.querySelector('h1') && el.querySelector('h1').textContent,
    strong: el.querySelector('strong') && el.querySelector('strong').textContent,
    boxes: el.querySelectorAll('input.task-box').length,
    disabled: Array.from(el.querySelectorAll('input.task-box')).every(b => b.disabled),
    link: el.querySelector('a') && el.querySelector('a').getAttribute('href')
  }));
  check(preview.h1 === 'Programme' && preview.strong === 'tôt' && preview.boxes === 2 && preview.disabled && preview.link === 'https://www.senso-ji.jp', 'Aperçu : titre, gras, 2 cases, lien');
  await page.click('#notePreview a');
  check((await page.evaluate(() => __bridge.opened.slice(-1)[0])) === 'https://www.senso-ji.jp', 'lien du texte ouvert dans le navigateur (via Android)');
  await page.click('#noteWriteTab');
  check(await visible(page, '#mdToolbar'), 'retour à « Écrire » : barre visible');

  // ---------- Photos et pièces jointes ----------
  const big = await makeImage(page, 4000, 3000, 'image/jpeg', 'GRANDE');
  const small = await makeImage(page, 300, 200, 'image/png', 'petite');
  await page.setInputFiles('#noteImages', [{ name: 'grande.jpg', mimeType: 'image/jpeg', buffer: big }, { name: 'petite.png', mimeType: 'image/png', buffer: small }]);
  await page.waitForFunction(() => document.querySelectorAll('#imagePreview img').length === 2 && !document.getElementById('addImagesBtn').disabled);
  const shrunk = await page.evaluate(async () => { const b = await createImageBitmap(currentImages[0]); return [b.width, b.height, currentImages[0].type]; });
  check(shrunk.join('x') === '1600x1200ximage/jpeg', 'photo de note réduite à 1600 px');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024, 7)]);
  await page.setInputFiles('#noteFiles', [
    { name: 'billet-JR.pdf', mimeType: 'application/pdf', buffer: pdf },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') }
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#noteAttachments .attachment').length === 2);
  check(norm(await page.textContent('#noteAttachments .attachment')) === '📄billet-JR.pdf3 Mo×', 'pièce jointe listée (icône, nom, taille)');
  await page.click('#noteAttachments .attachment:nth-child(2) .icon-btn');
  check(await page.$$eval('#noteAttachments .attachment', l => l.length) === 1, 'pièce jointe retirée (×)');
  await page.click('#imagePreview img >> nth=0');
  check(await visible(page, '#viewer') && await page.textContent('#viewerCounter') === '1 / 2', 'visionneuse : 1 / 2');
  await page.evaluate(() => {
    const target = document.getElementById('viewerScroll');
    const touch = x => new Touch({ identifier: 1, target, clientX: x, clientY: 400 });
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(300)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(200)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(120)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(120)], bubbles: true }));
  });
  check(await page.textContent('#viewerCounter') === '2 / 2', 'visionneuse : balayage vers la photo suivante');
  check(await back(page) === true && !(await visible(page, '#viewer')), 'retour Android ferme la visionneuse');

  // ---------- Enregistrement et lecture ----------
  await topAction(page, 'Enregistrer la note');
  await page.waitForSelector('#noteDetail .detail-title');
  check(await title(page) === '🗼 Tokyo' && await page.textContent('#noteDetail .detail-title') === 'Temple Sensō-ji', 'note enregistrée, affichée en lecture');
  check(await page.textContent('#noteDetail .detail-icon') === '⛩️', 'lecture : icône de la note');
  const view = await page.$eval('#noteDetail', el => ({
    h1: !!el.querySelector('.markdown h1'), boxes: el.querySelectorAll('.markdown input.task-box:not([disabled])').length,
    photos: el.querySelectorAll('.image-grid img').length, files: el.querySelectorAll('.attachment').length
  }));
  check(view.h1 && view.boxes === 2 && view.photos === 2 && view.files === 1, 'lecture : markdown, 2 cases cliquables, 2 photos, 1 pièce jointe');
  await page.screenshot({ path: OUT + '/04-note-lecture.png', fullPage: true });
  await page.click('#noteDetail .markdown input.task-box >> nth=0');
  await waitIdle(page);
  const stored = await page.evaluate(async () => (await dbGetAll('notes'))[0]);
  check(stored.body.includes('- [x] Omikuji') && stored.body.includes('- [ ] Photos du portail'), 'case cochée enregistrée dans le texte ([x] Omikuji)');
  check(stored.folderId > 0 && stored.icon === '⛩️' && stored.attachments[0].blob instanceof Object, 'note : dossier, icône et pièce jointe enregistrés');
  await page.click('#noteDetail .attachment');
  await page.waitForSelector('#docViewer:not([hidden]) .doc-card button.primary-btn');
  check(norm(await page.textContent('#docViewer .doc-card .hint')) === "Ce PDF n'a pas pu être affiché dans l'appli.", 'pièce jointe PDF abîmée : visionneuse avec message clair');
  await page.click('#docViewer .doc-card button.primary-btn');
  await page.waitForFunction(() => __bridge.finished.length === 1);
  check(await back(page) === true && !(await visible(page, '#docViewer')), 'retour Android ferme la visionneuse de documents');
  let f = await lastFile(page);
  check(f.action === 'open' && f.name === 'billet-JR.pdf' && f.type === 'application/pdf' && f.size === pdf.length && f.chunks === 3, 'PDF transmis à Android pour être ouvert (3 morceaux, taille exacte)');
  await page.click('#noteDetail .attachment .icon-btn');
  await page.waitForFunction(() => __bridge.finished.length === 2);
  check((await lastFile(page)).action === 'share', 'pièce jointe partagée (↗)');

  // ---------- Menu ⋮ de la note ----------
  await topAction(page, "Plus d'options");
  await page.screenshot({ path: OUT + '/05-menu-note.png' });
  await sheetItem(page, 'Épingler');
  await page.waitForSelector('#toast:not([hidden])');
  check(norm(await page.textContent('#toast')) === 'Note épinglée' && (await page.textContent('#noteDetail .detail-meta')).startsWith('📌 Épinglée'), 'note épinglée');
  await topAction(page, "Plus d'options");
  await sheetItem(page, 'Partager (fichier .md)');
  await page.waitForFunction(() => __bridge.finished.length === 3);
  f = await lastFile(page);
  const md = await page.evaluate(id => __bridge.saved[id].text(), f.id);
  check(f.action === 'share' && f.name === 'Temple Sensō-ji.md' && f.type === 'text/markdown' && md.startsWith('# ⛩️ Temple Sensō-ji\n\n# Programme'), 'export .md partagé (nom, type, contenu)');
  await topAction(page, "Plus d'options");
  await sheetItem(page, 'Enregistrer (fichier .md)');
  await page.waitForFunction(() => __bridge.finished.length === 4);
  check((await lastFile(page)).action === 'save', 'export .md : « Enregistrer sous » proposé par Android');

  // ---------- Listes, recherche ----------
  await back(page);
  await page.waitForSelector('#notesContent .list-row');
  check(norm(await page.textContent('#notesContent .list-row-title')) === '📌 Temple Sensō-ji', 'dossier : note épinglée listée');
  check((await page.$$eval('#notesContent .chip', l => l.map(e => e.textContent))).join(' | ') === '📷 2 | 📎 1', 'liste : pastilles photos et pièces jointes');
  await back(page);
  await page.waitForSelector('#notesContent .row-count');
  check(await page.textContent('#notesContent .row-count') === '1', 'racine : le dossier compte 1 note');
  await page.fill('#notesSearch', 'SENSO');
  await page.waitForFunction(() => document.querySelectorAll('#notesContent .list-row').length === 1 && document.querySelector('#notesContent .list-row-title').textContent.includes('Sensō'));
  check((await page.textContent('#notesContent .chips')).includes('🗼 Tokyo'), 'recherche sans accents ni majuscules, avec le dossier affiché');
  await page.fill('#notesSearch', 'introuvable');
  await page.waitForSelector('#notesEmpty:not([hidden])');
  check(norm(await page.textContent('#notesEmpty')) === 'Aucune note ne correspond à ta recherche.', 'recherche sans résultat');
  await page.fill('#notesSearch', '');
  await waitIdle(page);

  // ---------- Modification avec confirmation ----------
  await page.click('#notesContent .row-chevron');
  await page.click('#notesContent .list-row');
  await page.waitForSelector('#noteDetail .detail-title');
  await topAction(page, 'Modifier');
  await page.waitForFunction(() => document.getElementById('noteTitle').value === 'Temple Sensō-ji');
  check(await page.evaluate(() => isNoteDirty()) === false, 'éditeur rouvert : aucune modification détectée');
  await page.fill('#noteTitle', 'Sensō-ji (Asakusa)');
  await back(page);
  check(norm(await page.textContent('#dialogMessage')) === 'Abandonner les modifications de cette note ?', 'retour avec modifications : confirmation');
  await page.click('#dialogCancelBtn');
  check(await page.inputValue('#noteTitle') === 'Sensō-ji (Asakusa)', '« Annuler » : saisie conservée');
  await topAction(page, 'Enregistrer la note');
  await page.waitForFunction(() => document.querySelector('#noteDetail .detail-title') && document.querySelector('#noteDetail .detail-title').textContent === 'Sensō-ji (Asakusa)');
  check(true, 'modification enregistrée, retour à la lecture');
  const edited = await page.evaluate(async () => (await dbGetAll('notes'))[0]);
  check(edited.createdAt === stored.createdAt && edited.pinned === true && edited.images.length === 2, 'modification : date de création, épinglage et photos conservés');

  // ---------- Déplacer, renommer, supprimer un dossier ----------
  await topAction(page, "Plus d'options");
  await sheetItem(page, 'Déplacer vers un dossier');
  await page.waitForSelector('#sheet:not([hidden]) .sheet-item.is-selected');
  check(norm(await page.textContent('#sheetPanel .sheet-item.is-selected')) === '🗼Tokyo', 'choix du dossier : dossier actuel mis en évidence');
  await sheetItem(page, 'Aucun dossier');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === 'Notes');
  check(true, 'note sortie du dossier');
  await back(page); // → dossier Tokyo (vide)
  await page.waitForSelector('#notesEmpty:not([hidden])');
  await topAction(page, 'Options du dossier');
  await sheetItem(page, 'Renommer le dossier');
  await page.waitForSelector('#dialog:not([hidden])');
  check(await page.inputValue('#dialogInput') === 'Tokyo', 'renommer : nom actuel prérempli');
  await dialogAnswer(page, 'Tokyo 2026', 'Renommer');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === '🗼 Tokyo 2026');
  check(true, 'dossier renommé');
  await topAction(page, 'Options du dossier');
  await sheetItem(page, 'Supprimer le dossier');
  await dialogAnswer(page, undefined, 'Supprimer');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === 'Notes' && !document.querySelector('#notesContent .row-count'));
  check((await page.$$('#notesContent .list-row')).length === 1, 'dossier supprimé, la note reste dans Notes');

  // ---------- Carnet d'adresses ----------
  await openSection(page, 'addresses');
  await page.waitForSelector('#addressesEmpty:not([hidden])');
  await topAction(page, 'Nouvelle adresse');
  await page.waitForSelector('#addrCategories .filter-chip');
  check(await page.$$eval('#addrCategories .filter-chip', l => l.length) === 6 && norm(await page.textContent('#addrCategories [aria-pressed="true"]')) === '📍 Autre', 'éditeur d\'adresse : 6 catégories, « Autre » par défaut');
  await page.click('#addrCategories .filter-chip:has-text("Hébergement")');
  await page.fill('#addrTitle', 'Hôtel Gracery');
  await topAction(page, "Enregistrer l'adresse");
  await page.waitForSelector('#dialog:not([hidden])');
  check(norm(await page.textContent('#dialogMessage')) === "Le nom du lieu et l'adresse sont obligatoires.", 'adresse incomplète refusée');
  await page.click('#dialogOkBtn');
  await page.fill('#addrAddress', '1-19-1 Kabukichō, Shinjuku, Tokyo');
  await page.fill('#addrAddressJa', '東京都新宿区歌舞伎町1-19-1');
  await page.fill('#addrPhone', '+81 3-6833-2489');
  await page.fill('#addrWebsite', 'gracery.com');
  await page.click('#addrDesc');
  await page.keyboard.type('Check-in 14h');
  await select(page, '#addrDesc', 0, 8);
  await toolbar(page, 'bold');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await toolbar(page, 'task');
  await page.keyboard.type('Réserver le petit-déjeuner');
  check(await page.inputValue('#addrDesc') === '**Check-in** 14h\n- [ ] Réserver le petit-déjeuner', 'description mise en forme avec la barre');
  await page.screenshot({ path: OUT + '/06-adresse-edition.png' });
  await topAction(page, "Enregistrer l'adresse");
  await page.waitForSelector('#addressDetail .detail-title');
  check(await title(page) === '🏨 Hébergement' && await page.textContent('#addressDetail .detail-title') === 'Hôtel Gracery', 'fiche de l\'adresse (catégorie en titre)');
  check(await page.$$eval('#addressDetail .card', l => l.length) === 3 && !!(await page.$('#addressDetail .markdown strong')), 'fiche : adresse, japonais, contact, description mise en forme');
  await page.screenshot({ path: OUT + '/07-adresse-fiche.png', fullPage: true });
  await page.click('#addressDetail .action-btn:has-text("Itinéraire")');
  check((await page.evaluate(() => __bridge.opened.slice(-1)[0])) === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('1-19-1 Kabukichō, Shinjuku, Tokyo'), 'itinéraire Google Maps');
  await page.click('#addressDetail .action-btn:has-text("Copier") >> nth=0');
  await page.waitForSelector('#toast:not([hidden])');
  check((await page.evaluate(() => __bridge.copied.slice(-1)[0])) === '1-19-1 Kabukichō, Shinjuku, Tokyo' && norm(await page.textContent('#toast')) === 'Adresse copiée', 'adresse copiée (presse-papiers Android)');
  await page.click('#addressDetail .action-btn:has-text("Pour le taxi")');
  check(await visible(page, '#taxi') && await page.textContent('#taxiAddress') === '東京都新宿区歌舞伎町1-19-1', 'carte taxi : adresse en japonais en grand');
  await page.screenshot({ path: OUT + '/08-taxi.png' });
  check(await back(page) === true && !(await visible(page, '#taxi')), 'retour Android ferme la carte taxi');
  await page.click('#addressDetail .action-btn:has-text("+81")');
  await page.click('#addressDetail .action-btn:has-text("Site web")');
  const opened = await page.evaluate(() => __bridge.opened.slice(-2));
  check(opened[0] === 'tel:+81368332489' && opened[1] === 'https://gracery.com', 'appel et site web ouverts par Android');
  await page.click('#addressDetail .markdown input.task-box');
  await waitIdle(page);
  check((await page.evaluate(async () => (await dbGetAll('addresses'))[0].description)).endsWith('- [x] Réserver le petit-déjeuner'), 'case de la description cochée et enregistrée');

  // Note liée depuis la fiche
  await topAction(page, "Plus d'options");
  await sheetItem(page, 'Nouvelle note sur ce lieu');
  await page.waitForFunction(() => document.getElementById('noteAddressBtn').textContent.includes('Hôtel Gracery'));
  await page.fill('#noteTitle', 'Dîner au 1er étage');
  await topAction(page, 'Enregistrer la note');
  await page.waitForSelector('#noteDetail .link-card');
  check(norm(await page.textContent('#noteDetail .link-card .list-row-title')) === 'Hôtel Gracery', 'note liée : carte de l\'adresse affichée');
  await page.click('#noteDetail .link-card');
  await page.waitForSelector('#addressDetail .list-row');
  check((await page.$$eval('#addressDetail .list-row-title', l => l.map(e => e.textContent))).includes('Dîner au 1er étage'), 'fiche : section « Notes liées »');

  // Deuxième adresse, filtres et recherche
  await openSection(page, 'addresses');
  await topAction(page, 'Nouvelle adresse');
  await page.waitForSelector('#addrCategories .filter-chip');
  await page.click('#addrCategories .filter-chip:has-text("Restaurant")');
  await page.fill('#addrTitle', 'Ichiran Shibuya');
  await page.fill('#addrAddress', '1-22-7 Jinnan, Shibuya, Tokyo');
  await topAction(page, "Enregistrer l'adresse");
  await page.waitForSelector('#addressDetail .detail-title');
  await back(page);
  await page.waitForFunction(() => document.querySelectorAll('#addressList .list-row').length === 2);
  check((await page.$$eval('#addressFilters .filter-chip', l => l.map(e => e.textContent))).map(norm).join(' | ') === 'Tous 2 | 🏨 Hébergement 1 | 🍜 Restaurant 1', 'filtres par catégorie avec compteurs');
  await page.click('#addressFilters .filter-chip:has-text("Restaurant")');
  await page.waitForFunction(() => document.querySelectorAll('#addressList .list-row').length === 1);
  check(await page.textContent('#addressList .list-row-title') === 'Ichiran Shibuya', 'filtre « Restaurant »');
  await page.click('#addressList .route-btn');
  check((await page.evaluate(() => __bridge.opened.slice(-1)[0])).endsWith(encodeURIComponent('1-22-7 Jinnan, Shibuya, Tokyo')), 'bouton 🧭 de la liste : itinéraire direct');
  await page.click('#addressFilters .filter-chip:has-text("Tous")');
  await page.waitForFunction(() => document.querySelectorAll('#addressList .list-row').length === 2);
  await page.fill('#addressSearch', 'kabukicho');
  await page.waitForFunction(() => document.querySelectorAll('#addressList .list-row').length === 1);
  check(await page.textContent('#addressList .list-row-title') === 'Hôtel Gracery', 'recherche dans les adresses (sans accents)');
  await page.screenshot({ path: OUT + '/09-adresses.png' });
  await page.fill('#addressSearch', '');

  // ---------- Images : albums ----------
  await openSection(page, 'albums');
  await page.waitForSelector('#albumsEmpty:not([hidden])');
  await topAction(page, 'Nouvel album');
  await dialogAnswer(page, 'Shibuya', 'Créer');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === '🖼️ Shibuya');
  check(norm(await page.textContent('#albumEmpty')).startsWith('Album vide'), 'album créé et ouvert (vide)');
  const photoA = withExifDate(await makeImage(page, 3000, 2000, 'image/jpeg', 'A 5 avril'), '2026:04:05 10:30:00');
  const photoB = withExifDate(await makeImage(page, 2000, 3000, 'image/jpeg', 'B 4 avril'), '2026:04:04 18:00:00');
  const photoC = await makeImage(page, 1200, 900, 'image/jpeg', 'C sans date');
  await page.setInputFiles('#albumPhotos', [
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: photoA },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: photoB },
    { name: 'c.jpg', mimeType: 'image/jpeg', buffer: photoC },
    { name: 'd.heic', mimeType: 'image/heic', buffer: Buffer.from('pas une image') }
  ]);
  await page.waitForSelector('#dialog:not([hidden])');
  check(norm(await page.textContent('#dialogMessage')).startsWith("1 photo n'a pas pu être ajoutée"), 'photo illisible (HEIC) signalée');
  await page.click('#dialogOkBtn');
  await page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 3);
  const photos = await page.evaluate(async () => Promise.all(albumPhotos.map(async p => {
    const full = await createImageBitmap(p.blob), thumb = await createImageBitmap(p.thumb);
    return { name: p.name, takenAt: p.takenAt, full: [full.width, full.height], thumb: Math.max(thumb.width, thumb.height) };
  })));
  const expectA = await page.evaluate(() => new Date(2026, 3, 5, 10, 30, 0).getTime());
  const expectB = await page.evaluate(() => new Date(2026, 3, 4, 18, 0, 0).getTime());
  check(photos.map(p => p.name).join(',') === 'b.jpg,a.jpg,c.jpg', 'photos triées par date de prise de vue (EXIF)');
  check(photos[0].takenAt === expectB && photos[1].takenAt === expectA, 'dates EXIF lues correctement');
  check(photos[1].full.join('x') === '2048x1365' && photos[0].full.join('x') === '1365x2048' && photos.every(p => p.thumb === 400), 'photos réduites à 2048 px + miniatures 400 px');
  const days = await page.$$eval('#photoGrid .photo-day', l => l.map(e => e.textContent));
  check(days.length === 3 && days[0] === 'Samedi 4 avril 2026' && days[1] === 'Dimanche 5 avril 2026', 'photos regroupées par jour (' + days.slice(0, 2).join(', ') + ', …)');
  await page.screenshot({ path: OUT + '/10-album.png' });
  await page.click('#photoGrid .photo-cell >> nth=0');
  check(await page.textContent('#viewerCounter') === '1 / 3', 'visionneuse de l\'album : 1 / 3');
  await page.click('#viewerActions button[aria-label="Partager"]');
  await page.waitForFunction(() => __bridge.finished.length === 5);
  f = await lastFile(page);
  check(f.action === 'share' && f.name === 'SOHRI-20260404-180000.jpg' && f.type === 'image/jpeg', 'photo partagée (nom daté)');
  await page.click('#viewerActions button[aria-label="Supprimer"]');
  await dialogAnswer(page, undefined, 'Supprimer');
  await page.waitForFunction(() => document.getElementById('viewerCounter').textContent === '1 / 2');
  check(true, 'photo supprimée depuis la visionneuse (confirmation au-dessus)');
  await back(page);
  await page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 2);
  await topAction(page, "Options de l'album");
  await sheetItem(page, 'Sélectionner des photos');
  check(await visible(page, '#selectionBar') && await title(page) === 'Sélection' && norm(await page.textContent('#selectionCount')) === 'Touche les photos', 'mode sélection');
  await page.click('#photoGrid .photo-cell >> nth=0');
  check(norm(await page.textContent('#selectionCount')) === '1 sélectionnée', 'sélection : 1 photo');
  await topAction(page, 'Tout sélectionner');
  check(norm(await page.textContent('#selectionCount')) === '2 sélectionnées', 'sélection : tout');
  await page.screenshot({ path: OUT + '/11-selection.png' });
  await page.click('#selectionMoveBtn');
  await sheetItem(page, 'Nouvel album');
  await dialogAnswer(page, 'Tokyo', 'Créer');
  await page.waitForSelector('#toast:not([hidden])');
  check(norm(await page.textContent('#toast')) === '2 photos déplacées vers « Tokyo »' && !(await visible(page, '#selectionBar')), 'photos déplacées vers un nouvel album');
  await back(page);
  await page.waitForFunction(() => document.querySelectorAll('#albumGrid .album-card').length === 2);
  const albums = await page.$$eval('#albumGrid .album-card', l => l.map(e => e.querySelector('.album-name').textContent + ' : ' + e.querySelector('.album-count').textContent));
  check(albums.join(' | ') === '🖼️ Shibuya : 0 photo | 🖼️ Tokyo : 2 photos', 'albums listés avec leur nombre de photos (' + albums.join(' | ') + ')');
  check(await page.$eval('#albumGrid .album-card:nth-child(2) img', img => img.complete && img.naturalWidth > 0), 'couverture de l\'album affichée');
  await page.screenshot({ path: OUT + '/12-albums.png' });

  // ---------- Paramètres : thème ----------
  await openSection(page, 'settings');
  await page.waitForFunction(() => document.getElementById('appVersion').textContent !== '');
  check(norm(await page.textContent('#appVersion')) === 'SOHRI, version 1.1' && await page.getAttribute('[data-theme-choice="auto"]', 'aria-selected') === 'true', 'paramètres : version, thème automatique');
  await page.waitForFunction(() => document.getElementById('storageInfo').textContent !== '');
  check(/^Espace utilisé par l'appli : [\d,]+ (o|Ko|Mo)\.$/.test(norm(await page.textContent('#storageInfo'))), 'paramètres : espace utilisé (' + norm(await page.textContent('#storageInfo')) + ')');
  await page.click('[data-theme-choice="dark"]');
  check(await page.getAttribute('html', 'data-theme') === 'dark' && (await page.evaluate(() => __bridge.themePref)) === 'dark', 'thème sombre choisi (transmis à Android)');
  await page.screenshot({ path: OUT + '/13-parametres-sombre.png' });
  await page.click('[data-theme-choice="light"]');
  check(await page.getAttribute('html', 'data-theme') === 'light', 'thème clair choisi');
  await page.evaluate(() => onSystemThemeChanged(true));
  check(await page.getAttribute('html', 'data-theme') === 'light', 'thème clair imposé : ignore le mode sombre du téléphone');
  await page.click('[data-theme-choice="auto"]');
  check(await page.getAttribute('html', 'data-theme') === 'dark', 'automatique : suit le téléphone (sombre)');
  await page.evaluate(() => onSystemThemeChanged(false));
  check(await page.getAttribute('html', 'data-theme') === 'light', 'automatique : repasse en clair avec le téléphone');
  await page.click('[data-theme-choice="dark"]');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  check(await page.getAttribute('html', 'data-theme') === 'dark', 'choix du thème conservé au redémarrage');
  for (const [section, file] of [['notes', '14-sombre-notes'], ['addresses', '15-sombre-adresses'], ['albums', '16-sombre-albums']]) {
    await page.evaluate(s => goToSection(s), section);
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + '/' + file + '.png' });
  }
  await page.evaluate(() => goToSection('notes'));
  await page.waitForSelector('#notesContent .list-row');
  await page.click('#notesContent .list-row:has-text("Sensō-ji")');
  await page.waitForSelector('#noteDetail .markdown');
  await page.screenshot({ path: OUT + '/17-sombre-note.png', fullPage: true });
  await page.evaluate(() => setThemePreference('light'));

  // ---------- Sauvegarde ----------
  await page.evaluate(() => goToSection('settings'));
  const before = await page.evaluate(async () => ({ notes: (await dbGetAll('notes')).length, addresses: (await dbGetAll('addresses')).length, folders: (await dbGetAll('folders')).length, photos: (await dbGetAll('photos')).length }));
  const filesBefore = await page.evaluate(() => __bridge.finished.length);
  await page.click('#backupBtn');
  await page.waitForFunction(n => __bridge.finished.length === n + 1 && document.getElementById('progress').hidden, filesBefore);
  f = await lastFile(page);
  const today = await page.evaluate(() => { const d = new Date(); const p = n => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); });
  check(f.action === 'save' && f.name === 'SOHRI-sauvegarde-' + today + '.zip' && f.type === 'application/zip', 'sauvegarde : fichier zip proposé à l\'enregistrement (' + f.name + ', ' + (f.size / 1024 / 1024).toFixed(1) + ' Mo)');
  const zipB64 = await page.evaluate(async id => { const buf = new Uint8Array(await __bridge.saved[id].arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }, f.id);
  const zipPath = path.join(OUT, 'sauvegarde.zip');
  fs.writeFileSync(zipPath, Buffer.from(zipB64, 'base64'));

  // ---------- Restauration (dans une base vidée) ----------
  await page.evaluate(() => dbReplaceAll({}));
  await page.reload();
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  check((await page.evaluate(async () => (await dbGetAll('notes')).length)) === 0, 'base vidée avant restauration');
  await page.evaluate(() => goToSection('settings'));
  await page.setInputFiles('#restoreInput', { name: 'SOHRI-sauvegarde.zip', mimeType: 'application/zip', buffer: fs.readFileSync(zipPath) });
  await page.waitForSelector('#dialog:not([hidden])');
  const restoreMsg = norm(await page.textContent('#dialogMessage'));
  check(restoreMsg.includes('(2 notes, 2 adresses, 2 albums, 2 photos, 0 document, 0 dépense)'), 'restauration : résumé du contenu (' + restoreMsg.slice(0, 100) + '…)');
  await Promise.all([page.waitForNavigation(), page.click('#dialogOkBtn')]);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  const after = await page.evaluate(async () => ({ notes: (await dbGetAll('notes')).length, addresses: (await dbGetAll('addresses')).length, folders: (await dbGetAll('folders')).length, photos: (await dbGetAll('photos')).length }));
  check(JSON.stringify(after) === JSON.stringify(before), 'restauration : tout est revenu ' + JSON.stringify(after));
  const restored = await page.evaluate(async () => {
    const note = (await dbGetAll('notes')).find(n => n.title === 'Sensō-ji (Asakusa)');
    const photo = (await dbGetAll('photos'))[0];
    const bmp = await createImageBitmap(photo.blob);
    const pdf = new Uint8Array(await note.attachments[0].blob.arrayBuffer());
    return { images: note.images.length, pdfSize: pdf.length, pdfHead: String.fromCharCode(...pdf.slice(0, 8)), photo: bmp.width + 'x' + bmp.height, type: photo.blob.type, pinned: note.pinned };
  });
  check(restored.images === 2 && restored.pdfSize === pdf.length && restored.pdfHead === '%PDF-1.4' && restored.type === 'image/jpeg' && restored.pinned, 'restauration : photos, PDF (octets identiques) et épinglage intacts');
  // Nouvel enregistrement après restauration : les identifiants ne doivent pas entrer en collision.
  const newId = await page.evaluate(() => dbPut('notes', { title: 'après restauration', body: '', createdAt: Date.now(), updatedAt: Date.now() }));
  const ids = await page.evaluate(async () => (await dbGetAll('notes')).map(n => n.id));
  check(ids.length === 3 && new Set(ids).size === 3 && newId > Math.max(...ids.filter(i => i !== newId)), 'après restauration : nouveaux identifiants sans collision');

  // ---------- Bouton retour ----------
  await page.evaluate(() => goToSection('notes'));
  await page.waitForSelector('#notesContent .list-row');
  await topAction(page, 'Nouvelle note');
  await page.click('#noteFolderBtn');
  await page.waitForSelector('#sheet:not([hidden])');
  check(await back(page) === true && !(await visible(page, '#sheet')), 'retour : ferme le menu du bas');
  check(await back(page) === true && await title(page) === 'Notes', 'retour : quitte un éditeur vide sans confirmation');
  check(await back(page) === true && await title(page) === 'Convertisseur', 'retour depuis une rubrique : convertisseur');
  check(await back(page) === false, 'retour sur le convertisseur : Android quitte l\'appli');
  check(page.errors.length === 0, 'aucune erreur JavaScript' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
  await context.close();

  // ================= Navigateur ordinaire (sans Android) =================
  {
    const { context, page } = await newPhone(browser, { bridge: false, colorScheme: 'dark' });
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
    check(await page.getAttribute('html', 'data-theme') === 'dark', 'navigateur : thème automatique = préférence sombre du système');
    await page.evaluate(() => setThemePreference('light'));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
    check(await page.getAttribute('html', 'data-theme') === 'light', 'navigateur : choix du thème conservé (localStorage)');
    check(await page.$eval('.topbar', el => getComputedStyle(el).paddingTop) === '14px', 'navigateur : pas de marge système');
    await page.evaluate(() => goToSection('notes'));
    await page.evaluate(() => openView('note-edit', {}));
    await page.fill('#noteTitle', 'test navigateur');
    await page.evaluate(() => saveNote());
    await page.waitForSelector('#noteDetail .detail-title');
    // Téléphone sans Android : feuille de partage du système (simulée ici).
    await page.evaluate(() => {
      window.__shared = [];
      navigator.share = data => { window.__shared.push(data.files.map(f => f.name + '|' + f.type)); return Promise.resolve(); };
      navigator.canShare = () => true;
    });
    await page.evaluate(() => exportNote(viewedNote, 'save'));
    await page.waitForFunction(() => window.__shared.length === 1);
    check(await page.evaluate(() => window.__shared[0][0]) === 'test navigateur.md|text/markdown', 'navigateur (téléphone) : export .md par la feuille de partage');
    check(page.errors.length === 0, 'navigateur : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
    await context.close();
  }
  {
    // Ordinateur (souris) : téléchargement.
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'fr-FR' });
    await blockExternal(context);
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
    await page.evaluate(() => goToSection('notes'));
    await page.evaluate(() => openView('note-edit', {}));
    await page.fill('#noteTitle', 'test ordinateur');
    await page.evaluate(() => saveNote());
    await page.waitForSelector('#noteDetail .detail-title');
    const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportNote(viewedNote, 'save'))]);
    check(download.suggestedFilename() === 'test ordinateur.md', 'navigateur (ordinateur) : export .md téléchargé');
    await context.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
