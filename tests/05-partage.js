// Partage entre proches, de bout en bout, sur l'émulateur Firebase (auth 9099, firestore 8085).
// Chromium : toi = version web (iPhone), ta mère = appli Android (faux pont). WebKit : deux iPhone.
// Usage : node 05-partage.js <dossier www> <dossier sorties> [chromium|webkit]
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const ENGINES = process.argv[4] ? [process.argv[4]] : ['chromium', 'webkit'];
const CHROME = require("./lib/chrome");
const PROJECT = 'demo-sohri';
const FS = 'http://127.0.0.1:8085/v1/projects/' + PROJECT + '/databases/(default)/documents';
const EMULATOR_CONFIG = { apiKey: 'demo-key', projectId: PROJECT, emulator: { auth: 'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8085' } };
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      // Jamais le vrai projet Firebase pendant les essais : sans configuration injectée, pas de partage.
      if (p === '/js/cloud-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.SOHRI_CLOUD = window.SOHRI_CLOUD || null;'); }
      const file = path.join(WWW, p);
      if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
let prefix = '';
function check(ok, msg) { results.push([!!ok, prefix + msg]); console.log((ok ? 'PASS ' : 'FAIL ') + prefix + msg); }
const norm = s => (s || '').replace(/\s/g, ' ').trim();

// Lecture directe de la base de l'émulateur, sans les règles (« owner »).
async function adminList(pathName) {
  const r = await fetch(FS + '/' + pathName + '?pageSize=300', { headers: { Authorization: 'Bearer owner' } });
  const j = await r.json();
  return j.documents || [];
}
async function adminGet(pathName) {
  const r = await fetch(FS + '/' + pathName, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function resetEmulators() {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
}
async function authUsers() {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:query', {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{}'
  });
  const j = await r.json();
  return j.userInfo || [];
}

let profileCount = 0;
async function newPhone(engineName, { android = false, cloud = true } = {}) {
  // Service worker (copie hors connexion de l'appli) désactivé : testé à part (test4.js), il
  // empêcherait ici de couper les requêtes vers le serveur dans WebKit.
  const options = { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' };
  let context;
  if (engineName === 'webkit') {
    const dir = path.join(OUT, 'profiles', 'wk-' + (++profileCount));
    fs.rmSync(dir, { recursive: true, force: true });
    context = await webkit.launchPersistentContext(dir, options);
    await blockExternal(context);
  } else {
    const browser = await chromium.launch({ executablePath: CHROME });
    context = await browser.newContext(android ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' } : options);
    await blockExternal(context);
    context.on('close', () => browser.close());
  }
  await context.addInitScript(([config, android]) => {
    if (config) window.SOHRI_CLOUD = config;
    window.__shared = [];
    window.__sharedText = [];
    if (android) {
      window.AndroidBridge = {
        isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
        openExternal: () => {}, copyText: () => {}, getAppVersion: () => '1.4', shareText: t => window.__sharedText.push(t),
        fileBegin: () => 'f', fileAppend: () => {}, fileFinish: () => {}
      };
    } else {
      navigator.share = data => { if (data.text) window.__sharedText.push(data.text); return Promise.resolve(); };
      navigator.canShare = () => true;
    }
  }, [cloud ? EMULATOR_CONFIG : null, android]);
  const page = context.pages()[0] || await context.newPage();
  page.errors = [];
  page.cloudRequests = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Could not connect|Load failed/.test(m.text())) page.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  page.on('request', r => { if (/127\.0\.0\.1:(9099|8085)|googleapis\.com/.test(r.url())) page.cloudRequests.push(r.url()); });
  return { context, page };
}

// Coupure du réseau. WebKit : la simulation « hors ligne » de Playwright bloque aussi la lecture des
// fichiers enregistrés dans IndexedDB (ce que ne fait pas un vrai iPhone en mode avion) ; on y
// coupe donc seulement les requêtes vers le serveur.
const CLOUD_URL = /127\.0\.0\.1:(9099|8085)/;
async function goOffline(engineName, context) {
  if (engineName === 'webkit') await context.route(CLOUD_URL, route => route.abort('internetdisconnected'));
  else await context.setOffline(true);
}
async function goOnline(engineName, context) {
  if (engineName === 'webkit') await context.unroute(CLOUD_URL);
  else await context.setOffline(false);
}

const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const synced = (page, timeout = 60000) => page.waitForFunction(() => cloudStatus.state === 'done' && !cloudSyncRunning, null, { timeout });
async function goTo(page, section) { await page.evaluate(s => goToSection(s), section); await page.waitForTimeout(150); }
async function topAction(page, label) { await page.click(`#topActions button[aria-label="${label}"]`); }
// Albums d'un proche : par le bandeau « Mes proches » de la rubrique Images.
async function openFromStrip(page, name) {
  await goTo(page, 'albums');
  await page.click(`#sharedStrip .person-tile:has-text("${name}")`);
  await page.waitForFunction(() => currentViewName() === 'shared-albums');
}
async function dialogOk(page, value) {
  await page.waitForSelector('#dialog:not([hidden])');
  if (value !== undefined) await page.fill('#dialogInput', value);
  await page.click('#dialogOkBtn');
}

async function signUp(page, form) {
  await goTo(page, 'sharing');
  await page.click('#sharingContent button:has-text("Créer un compte")');
  await page.waitForSelector('#accountForm #accEmail');
  if (form.name !== undefined) await page.fill('#accName', form.name);
  await page.fill('#accEmail', form.email);
  await page.fill('#accPassword', form.password);
  if (form.invite !== undefined) await page.fill('#accInvite', form.invite);
  await page.click('#accountForm button[type="submit"]');
}
async function signUpError(page) {
  await page.waitForSelector('#accountForm .form-error:not([hidden])', { timeout: 20000 });
  return norm(await page.textContent('#accountForm .form-error'));
}

async function makeJpegs(page, specs) {
  return page.evaluate(async specs => {
    const out = [];
    for (const [w, hgt, color, label] of specs) {
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const g = c.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, w, hgt);
      g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(w / 8) + 'px sans-serif'; g.fillText(label, w / 10, hgt / 2);
      for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7}, 60%, 50%)`; g.fillRect((i * 97) % w, (i * 53) % hgt, 20, 20); }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push(btoa(bin));
    }
    return out;
  }, specs);
}

async function createAlbum(page, name, files) {
  await goTo(page, 'albums');
  await topAction(page, 'Nouvel album');
  await dialogOk(page, name);
  await page.waitForFunction(n => document.getElementById('viewTitle').textContent.includes(n), name);
  if (files.length) {
    await page.setInputFiles('#albumPhotos', files);
    if (files.length === 1) { // une seule photo : sa fiche s'ouvre pour la description, « Plus tard » ici
      await page.waitForSelector('#captionInput', { timeout: 30000 });
      await page.click('#photoDetail button:has-text("Plus tard")');
      await page.waitForFunction(() => currentViewName() === 'album');
    }
    await page.waitForFunction(n => document.querySelectorAll('#photoGrid .photo-cell').length === n, files.length, { timeout: 30000 });
  }
}

async function run(engineName) {
  prefix = '[' + engineName + '] ';
  await resetEmulators();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const shots = path.join(OUT, 'shots-' + engineName);
  fs.mkdirSync(shots, { recursive: true });
  console.log('\n== ' + engineName + ' ==');

  // ---------- Sans compte : aucune connexion ----------
  const solo = await newPhone(engineName);
  await solo.page.goto(url);
  await ready(solo.page);
  check(await solo.page.isVisible('.drawer-item[data-section="sharing"]') === false && await solo.page.$eval('#drawerSharing', el => !el.hidden), 'rubrique « Partage » dans le menu');
  await goTo(solo.page, 'sharing');
  check(norm(await solo.page.textContent('#sharingContent')).includes("C'est facultatif"), 'sans compte : explication, partage facultatif');
  await solo.page.screenshot({ path: shots + '/01-sans-compte.png' });
  await goTo(solo.page, 'albums');
  await goTo(solo.page, 'notes');
  check(solo.page.cloudRequests.length === 0, 'sans compte : aucune requête vers le serveur');
  await solo.context.close();

  // ---------- Inscription de Sohhka (premier compte) ----------
  const me = await newPhone(engineName);
  await me.page.goto(url);
  await ready(me.page);
  await signUp(me.page, { name: 'Sohhka', email: 'sohhka@exemple.fr', password: 'court', invite: '' });
  check((await signUpError(me.page)).includes('trop court'), 'mot de passe trop court : refusé');
  await me.page.fill('#accPassword', 'voyage-japon-2026');
  await me.page.click('#accountForm button[type="submit"]');
  await me.page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await synced(me.page);
  const myCode = norm(await me.page.textContent('#sharingContent .profile-code'));
  check(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(myCode), 'premier compte créé, code personnel ' + myCode);
  check(!!(await adminGet('meta/bootstrap')), 'le premier compte a ouvert le projet');
  await me.page.screenshot({ path: shots + '/02-mon-compte.png' });

  // Albums (photos plus grandes que 1600 px : réduites à l'envoi).
  const jpegs = await makeJpegs(me.page, [[2400, 1800, '#1B2140', 'Tokyo 1'], [1800, 2400, '#C8402C', 'Tokyo 2'], [2000, 1500, '#2F7D4F', 'Tokyo 3'], [1600, 1200, '#6B3FA0', 'Kyoto']]);
  const file = (name, b64) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await createAlbum(me.page, 'Tokyo', [file('t1.jpg', jpegs[0]), file('t2.jpg', jpegs[1]), file('t3.jpg', jpegs[2])]);
  await createAlbum(me.page, 'Kyoto', [file('k1.jpg', jpegs[3])]);
  check((await adminList('users')).length === 1 && (await adminList('users/' + (await me.page.evaluate(() => cloudSession.uid)) + '/photos')).length === 0,
    'albums créés, rien d\'envoyé tant que rien n\'est partagé');

  // ---------- Inscription de Maman (appli Android en Chromium) ----------
  const mom = await newPhone(engineName, { android: engineName === 'chromium' });
  await mom.page.goto(url);
  await ready(mom.page);
  await signUp(mom.page, { name: 'Maman', email: 'maman@exemple.fr', password: 'bisous-bisous' });
  check((await signUpError(mom.page)).includes("Il faut le code d'invitation"), 'sans code d\'invitation : refusé');
  await mom.page.fill('#accInvite', 'ZZZZ-9999');
  await mom.page.click('#accountForm button[type="submit"]');
  await mom.page.waitForFunction(() => /inconnu/.test(document.querySelector('#accountForm .form-error').textContent), null, { timeout: 20000 });
  check(true, 'code d\'invitation inconnu : refusé');
  check((await authUsers()).length === 1, 'refus : aucun compte créé pour rien');
  await mom.page.fill('#accInvite', myCode.toLowerCase().replace('-', ' '));
  await mom.page.click('#accountForm button[type="submit"]');
  await mom.page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await synced(mom.page);
  check(norm(await mom.page.textContent('#sharingContent')).includes('Sohhka'), 'Maman inscrite avec le code de Sohhka (tapé en minuscules), Sohhka dans ses contacts');
  if (engineName === 'chromium') {
    await mom.page.click('#sharingContent button:has-text("Inviter")');
    const text = await mom.page.evaluate(() => window.__sharedText[0] || '');
    check(text.includes(await mom.page.evaluate(() => cloudState.profile.code)) && text.includes('https://sohhka.github.io/sohri/'), 'Android : invitation envoyée (SMS, WhatsApp…) avec son code');
  }

  // ---------- Sohhka partage ses Images avec Maman ----------
  await goTo(me.page, 'sharing');
  await topAction(me.page, 'Synchroniser');
  await synced(me.page);
  check(norm(await me.page.textContent('#sharingContent')).includes('Maman'), 'Maman apparaît dans les contacts de Sohhka (inscrite avec son code)');
  await me.page.click('#sharingContent .list-row:not(.sync-all-row):has-text("Images")');
  await me.page.waitForSelector('#shareCategoryContent .toggle');
  await me.page.check('#shareCategoryContent .toggle-row:has-text("Maman") .toggle');
  await me.page.waitForSelector('#shareCategoryContent .source-card', { timeout: 20000 });
  await synced(me.page, 120000);
  const myUid = await me.page.evaluate(() => cloudSession.uid);
  const momUid = await mom.page.evaluate(() => cloudSession.uid);
  const photos = await adminList('users/' + myUid + '/photos');
  const parts = await adminList('users/' + myUid + '/photoParts');
  const albums = await adminList('users/' + myUid + '/albums');
  const sizes = photos.map(p => [Number(p.fields.width.integerValue), Number(p.fields.height.integerValue)]);
  check(albums.length === 2 && photos.length === 4 && parts.length === 4, 'envoyés : 2 albums, 4 photos (' + parts.length + ' morceaux)');
  check(sizes.every(([w, hh]) => Math.max(w, hh) <= 1600) && sizes.some(([w, hh]) => Math.max(w, hh) === 1600), 'photos réduites à 1600 px au plus (' + sizes.map(s => s.join('×')).join(', ') + ')');
  check(norm(await me.page.textContent('#shareCategoryContent')).includes('les mêmes sur tous les appareils connectés à ton compte'), 'Images partagées : les mêmes sur tous mes appareils');
  await me.page.screenshot({ path: shots + '/03-partage-images.png' });

  // ---------- Maman reçoit ----------
  await goTo(mom.page, 'sharing');
  await topAction(mom.page, 'Synchroniser');
  await synced(mom.page, 120000);
  const momSharing = norm(await mom.page.textContent('#sharingContent'));
  check(momSharing.includes('Les Images de Sohhka sont en haut de la rubrique Images') && !momSharing.includes('Partagés avec moi'),
    'Partage de Maman : plus de « Partagés avec moi », juste un renvoi vers Images');
  check(!(await mom.page.$('.drawer-item[data-section="sharing"] .drawer-badge')), 'plus de pastille sur Partage dans le menu');
  await mom.page.screenshot({ path: shots + '/03b-maman-partage.png' });
  // Bandeau de la rubrique Images : Sohhka, ses nouvelles photos, accès direct à ses albums.
  await goTo(mom.page, 'albums');
  await mom.page.waitForSelector('#sharedStrip .person-tile');
  const tile = norm(await mom.page.textContent('#sharedStrip .person-tile'));
  check(tile.includes('Sohhka') && tile.includes('4 nouvelles') && await mom.page.isVisible('#sharedStrip .person-avatar.has-new') && await mom.page.isVisible('#myAlbumsTitle'),
    'Images de Maman : bandeau « Mes proches » avec Sohhka, anneau de couleur et « 4 nouvelles » (' + tile + ')');
  await mom.page.waitForFunction(() => { const i = document.querySelector('#sharedStrip .person-avatar img'); return i && i.complete && i.naturalWidth > 0; });
  await mom.page.screenshot({ path: shots + '/04a-maman-bandeau.png' });
  await mom.page.click('#sharedStrip .person-tile');
  await mom.page.waitForFunction(() => currentViewName() === 'shared-albums' && document.querySelectorAll('#sharedAlbumGrid .album-card').length === 2);
  check(await mom.page.evaluate(() => document.querySelector('.drawer-item[aria-current="page"]').dataset.section) === 'albums',
    'un appui ouvre directement les albums de Sohhka (la rubrique Images reste en évidence dans le menu)');
  await mom.page.evaluate(() => goBack());
  await mom.page.waitForFunction(() => currentViewName() === 'albums' && document.querySelector('#sharedStrip .person-sub') && !document.querySelector('#sharedStrip .person-avatar.has-new'));
  check(norm(await mom.page.textContent('#sharedStrip .person-sub')) === '4 photos', 'au retour : plus de « nouvelles » (' + norm(await mom.page.textContent('#sharedStrip .person-sub')) + ')');
  check(!(await me.page.evaluate(() => { goToSection('albums'); return new Promise(r => setTimeout(() => r(!document.getElementById('sharedStrip').hidden), 800)); })),
    'Sohhka (personne ne lui partage d\'Images) : pas de bandeau');
  await openFromStrip(mom.page, 'Sohhka');
  await mom.page.waitForFunction(() => document.querySelectorAll('#sharedAlbumGrid .album-card').length === 2);
  const cards = await mom.page.$$eval('#sharedAlbumGrid .album-card', l => l.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(cards.join(' | ').includes('Kyoto1 photo') && cards.join(' | ').includes('Tokyo3 photos'), 'Maman voit les albums de Sohhka : ' + cards.join(' | '));
  check(norm(await mom.page.textContent('#view-shared-albums')).includes('consultable hors connexion'), 'toutes les photos reçues en taille réelle');
  await mom.page.screenshot({ path: shots + '/04-maman-albums.png' });
  await mom.page.click('#sharedAlbumGrid .album-card:has-text("Tokyo")');
  await mom.page.waitForFunction(() => document.querySelectorAll('#sharedPhotoGrid .photo-cell').length === 3);
  await mom.page.click('#sharedPhotoGrid .photo-cell');
  await mom.page.waitForSelector('#viewer:not([hidden])');
  await mom.page.waitForFunction(() => document.getElementById('viewerImg').naturalWidth > 0);
  const shown = await mom.page.$eval('#viewerImg', img => [img.naturalWidth, img.naturalHeight]);
  check(Math.max(shown[0], shown[1]) === 1600, 'photo affichée en taille réelle (' + shown.join('×') + ')');
  await mom.page.screenshot({ path: shots + '/05-maman-photo.png' });
  await mom.page.evaluate(() => closeViewer());

  // Hors connexion (après rechargement) : tout reste consultable.
  await mom.page.reload();
  await ready(mom.page);
  await goOffline(engineName, mom.context);
  await goTo(mom.page, 'sharing');
  await topAction(mom.page, 'Synchroniser');
  await mom.page.waitForFunction(() => cloudStatus.state === 'offline' && !cloudSyncRunning, null, { timeout: 30000 });
  check(norm(await mom.page.textContent('#sharingContent')).includes('Hors connexion'), 'hors connexion : signalé');
  await openFromStrip(mom.page, 'Sohhka');
  await mom.page.click('#sharedAlbumGrid .album-card:has-text("Tokyo")');
  await mom.page.waitForFunction(() => document.querySelectorAll('#sharedPhotoGrid .photo-cell').length === 3);
  await mom.page.click('#sharedPhotoGrid .photo-cell');
  await mom.page.waitForFunction(() => document.getElementById('viewerImg').naturalWidth === 1600 || document.getElementById('viewerImg').naturalHeight === 1600, null, { timeout: 10000 });
  check(true, 'hors connexion : albums et photos de Sohhka consultables');
  await mom.page.evaluate(() => closeViewer());
  await goOnline(engineName, mom.context);

  // ---------- Sohhka modifie : suppression, nouveau nom, nouvel album ----------
  await goTo(me.page, 'albums');
  await me.page.click('#albumGrid .album-card:has-text("Tokyo")');
  await me.page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 3);
  await me.page.click('#photoGrid .photo-cell');
  await me.page.click('#viewerActions button[aria-label="Supprimer"]');
  await dialogOk(me.page);
  await me.page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 2);
  await me.page.evaluate(() => closeViewer());
  await goTo(me.page, 'albums');
  await me.page.click('#albumGrid .album-card:has-text("Kyoto")');
  await me.page.waitForFunction(() => document.getElementById('viewTitle').textContent.includes('Kyoto'));
  await topAction(me.page, "Options de l'album");
  await me.page.click('#sheetPanel .sheet-item:has-text("Renommer")');
  await dialogOk(me.page, 'Kyoto et Nara');
  await createAlbum(me.page, 'Osaka', [file('o1.jpg', jpegs[3])]);
  await me.page.waitForTimeout(3500); // envoi automatique quelques secondes après les modifications
  await synced(me.page, 120000);
  await goTo(mom.page, 'sharing');
  await topAction(mom.page, 'Synchroniser');
  await synced(mom.page, 120000);
  await openFromStrip(mom.page, 'Sohhka');
  await mom.page.waitForFunction(() => document.querySelectorAll('#sharedAlbumGrid .album-card').length === 3);
  const cards2 = await mom.page.$$eval('#sharedAlbumGrid .album-card', l => l.map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  check(cards2.includes('Kyoto et Nara1 photo') && cards2.includes('Osaka1 photo') && cards2.includes('Tokyo2 photos'), 'modifications reçues : ' + cards2);

  // ---------- Un autre membre ne voit rien ----------
  const other = await newPhone(engineName);
  await other.page.goto(url);
  await ready(other.page);
  const momCode = await mom.page.evaluate(() => cloudState.profile.code);
  await signUp(other.page, { name: 'Cousin', email: 'cousin@exemple.fr', password: 'cousin-cousin', invite: momCode });
  await other.page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await synced(other.page);
  await goTo(other.page, 'albums');
  await other.page.waitForTimeout(500);
  check(!(await other.page.isVisible('#sharedStrip')) && await other.page.evaluate(async () => (await dbGetAll('sharedPhotos')).length === 0),
    'un autre membre (invité par Maman) ne voit pas les Images de Sohhka (pas de bandeau)');
  const sneak = await other.page.evaluate(uid => fsQuery('users/' + uid, { from: [{ collectionId: 'photos' }] }).then(() => 'lu', e => e.cloud), myUid);
  check(sneak === 'denied', 'lecture directe des photos de Sohhka : refusée par le serveur');

  // ---------- Déconnexion et reconnexion de Maman ----------
  await goTo(mom.page, 'sharing');
  check(await mom.page.isVisible('#sharingContent .sign-out-btn'), 'bouton « Se déconnecter » bien visible sur l\'écran Partage');
  await mom.page.screenshot({ path: shots + '/08-bouton-deconnexion.png', fullPage: true });
  await mom.page.click('#sharingContent .sign-out-btn');
  await dialogOk(mom.page);
  await mom.page.waitForSelector('#sharingContent button:has-text("Créer un compte")');
  check(!(await mom.page.isVisible('#sharingContent .sign-out-btn')), 'déconnectée : plus de bouton « Se déconnecter »');
  const leftovers = await mom.page.evaluate(async () => ({ albums: (await dbGetAll('sharedAlbums')).length, photos: (await dbGetAll('sharedPhotos')).length, cloud: (await dbGetAll('cloud')).map(r => r.key) }));
  check(leftovers.albums === 0 && leftovers.photos === 0 && leftovers.cloud.join() === 'device', 'déconnexion : rien ne reste sur le téléphone (' + JSON.stringify(leftovers) + ')');
  await mom.page.click('#sharingContent button:has-text("J\'ai déjà un compte")');
  await mom.page.fill('#accEmail', 'maman@exemple.fr');
  await mom.page.fill('#accPassword', 'mauvais-mot-de-passe');
  await mom.page.click('#accountForm button[type="submit"]');
  check((await signUpError(mom.page)).includes('E-mail ou mot de passe incorrect'), 'mauvais mot de passe : refusé');
  await mom.page.fill('#accPassword', 'bisous-bisous');
  await mom.page.click('#accountForm button[type="submit"]');
  await mom.page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await synced(mom.page, 120000);
  const back = await mom.page.evaluate(async () => (await dbGetAll('sharedPhotos')).filter(p => p.blob).length);
  check(back === 4, 'reconnexion : partages retrouvés (' + back + ' photos)');

  // ---------- Sohhka arrête de partager ----------
  await goTo(me.page, 'sharing');
  await me.page.click('#sharingContent .list-row:not(.sync-all-row):has-text("Images")');
  await me.page.uncheck('#shareCategoryContent .toggle-row:has-text("Maman") .toggle');
  await me.page.waitForFunction(() => !document.querySelector('#shareCategoryContent .source-card'), null, { timeout: 30000 });
  await synced(me.page, 60000);
  const remaining = (await adminList('users/' + myUid + '/photos')).length + (await adminList('users/' + myUid + '/photoParts')).length + (await adminList('users/' + myUid + '/albums')).length;
  check(remaining === 0, 'plus aucun partage : photos effacées du serveur');
  await goTo(mom.page, 'sharing');
  await topAction(mom.page, 'Synchroniser');
  await synced(mom.page);
  const gone = await mom.page.evaluate(async () => (await dbGetAll('sharedAlbums')).length + (await dbGetAll('sharedPhotos')).length);
  await goTo(mom.page, 'albums');
  await mom.page.waitForTimeout(500);
  check(gone === 0 && !(await mom.page.isVisible('#sharedStrip')), 'Maman : albums de Sohhka retirés de son téléphone (plus de bandeau)');

  // ---------- Suppression d'un compte ----------
  await goTo(other.page, 'sharing');
  await topAction(other.page, 'Mon compte');
  await other.page.click('#sheetPanel .sheet-item:has-text("Supprimer mon compte")');
  await dialogOk(other.page);
  await dialogOk(other.page, 'cousin-cousin');
  await other.page.waitForSelector('#sharingContent button:has-text("Créer un compte")', { timeout: 30000 });
  const otherUid = (await authUsers()).find(u => u.email === 'cousin@exemple.fr');
  check(!otherUid && (await adminList('users')).length === 2 && (await adminList('codes')).length === 2, 'compte supprimé : identifiants, profil et code effacés');

  for (const [who, p] of [['Sohhka', me.page], ['Maman', mom.page], ['Cousin', other.page]]) {
    check(p.errors.length === 0, who + ' : aucune erreur' + (p.errors.length ? ' : ' + p.errors.join(' | ') : ''));
  }
  await me.context.close();
  await mom.context.close();
  await other.context.close();
  server.close();
}

(async () => {
  for (const engine of ENGINES) {
    try {
      await run(engine);
    } catch (e) {
      check(false, 'exception : ' + (e && e.stack || e));
    }
  }
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  process.exit(failed.length ? 1 : 0);
})();
