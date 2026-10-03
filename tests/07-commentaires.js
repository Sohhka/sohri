// Descriptions et commentaires des photos (façon Instagram), de bout en bout sur l'émulateur Firebase.
// Chromium : toi = version web, ta mère = appli Android (faux pont). WebKit : deux iPhone.
// Usage : node 07-commentaires.js <dossier www> <dossier sorties> [chromium|webkit]
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
const CLOUD_URL = /127\.0\.0\.1:(9099|8085)/;
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
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

async function adminList(pathName) {
  const r = await fetch(FS + '/' + pathName + '?pageSize=300', { headers: { Authorization: 'Bearer owner' } });
  return (await r.json()).documents || [];
}
async function resetEmulators() {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
}

let profileCount = 0;
async function newPhone(engineName, { android = false } = {}) {
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
    window.SOHRI_CLOUD = config;
    window.__opened = [];
    if (android) {
      window.AndroidBridge = {
        isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
        openExternal: url => window.__opened.push(url), copyText: () => {}, getAppVersion: () => '1.5', shareText: () => {},
        fileBegin: () => 'f', fileAppend: () => {}, fileFinish: () => {}
      };
    } else {
      window.open = url => { window.__opened.push(url); return null; };
    }
  }, [EMULATOR_CONFIG, android]);
  const page = context.pages()[0] || await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Could not connect|Load failed/.test(m.text())) page.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  return { context, page };
}
async function goOffline(engineName, context) {
  if (engineName === 'webkit') await context.route(CLOUD_URL, route => route.abort('internetdisconnected'));
  else await context.setOffline(true);
}
async function goOnline(engineName, context) {
  if (engineName === 'webkit') await context.unroute(CLOUD_URL);
  else await context.setOffline(false);
}

const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const synced = (page, timeout = 90000) => page.waitForFunction(() => cloudStatus.state === 'done' && !cloudSyncRunning, null, { timeout });
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
async function sync(page) {
  await goTo(page, 'sharing');
  await topAction(page, 'Synchroniser');
  await synced(page);
}
async function signUp(page, form) {
  await goTo(page, 'sharing');
  await page.click('#sharingContent button:has-text("Créer un compte")');
  await page.waitForSelector('#accountForm #accEmail');
  await page.fill('#accName', form.name);
  await page.fill('#accEmail', form.email);
  await page.fill('#accPassword', form.password);
  if (form.invite) await page.fill('#accInvite', form.invite);
  await page.click('#accountForm button[type="submit"]');
  await page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await synced(page);
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
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push(btoa(bin));
    }
    return out;
  }, specs);
}
const commentTexts = page => page.$$eval('#photoComments .comment', l => l.map(e => e.querySelector('.comment-author').textContent + ':' + e.querySelector('.comment-text').textContent));

async function run(engineName) {
  prefix = '[' + engineName + '] ';
  await resetEmulators();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const shots = path.join(OUT, 'shots-' + engineName);
  fs.mkdirSync(shots, { recursive: true });
  console.log('\n== ' + engineName + ' ==');

  // ---------- Sohhka : une photo avec description, sans compte d'abord ----------
  const me = await newPhone(engineName);
  await me.page.goto(url);
  await ready(me.page);
  const jpegs = await makeJpegs(me.page, [[2000, 1500, '#1B2140', 'Shibuya'], [1600, 1200, '#C8402C', 'Ramen'], [1600, 1200, '#2F7D4F', 'Temple']]);
  const file = (name, b64) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await goTo(me.page, 'albums');
  await topAction(me.page, 'Nouvel album');
  await dialogOk(me.page, 'Tokyo');
  await me.page.waitForFunction(() => document.getElementById('viewTitle').textContent.includes('Tokyo'));
  await me.page.setInputFiles('#albumPhotos', [file('shibuya.jpg', jpegs[0])]);
  await me.page.waitForSelector('#captionInput', { timeout: 30000 });
  check(await me.page.isVisible('#locationInput') && norm(await me.page.textContent('#photoDetail')).includes('facultatifs'),
    'une seule photo ajoutée : sa fiche s\'ouvre (description et lieu, facultatifs)');
  await me.page.screenshot({ path: shots + '/01-description-et-lieu.png' });
  await me.page.fill('#captionInput', 'Premier soir à Shibuya 🌃');
  await me.page.fill('#locationInput', '  Tokyo,   Japon ');
  await me.page.click('#photoDetail button:has-text("Enregistrer")');
  await me.page.waitForFunction(() => currentViewName() === 'album' && document.querySelectorAll('#photoGrid .photo-cell').length === 1);
  const saved = await me.page.evaluate(() => ({ caption: albumPhotos[0].caption, location: albumPhotos[0].location }));
  check(saved.caption === 'Premier soir à Shibuya 🌃' && saved.location === 'Tokyo, Japon', 'enregistrées : retour à l\'album (' + JSON.stringify(saved) + ')');
  await me.page.setInputFiles('#albumPhotos', [file('ramen.jpg', jpegs[1]), file('temple.jpg', jpegs[2])]);
  await me.page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 3, null, { timeout: 30000 });
  check(await me.page.evaluate(() => currentViewName()) === 'album', 'plusieurs photos : pas de fiche ouverte');
  const captionIndex = await me.page.evaluate(() => albumPhotos.findIndex(p => p.caption));
  await me.page.click(`#photoGrid .photo-cell[data-index="${captionIndex}"]`);
  await me.page.waitForSelector('#viewer:not([hidden])');
  check(norm(await me.page.textContent('#viewerLocation')) === '📍 Tokyo, Japon' && norm(await me.page.textContent('#viewerCaption')) === 'Premier soir à Shibuya 🌃'
    && norm(await me.page.textContent('#viewerInfoBtn')) === '✏️ Modifier la description',
    'visionneuse : lieu et description sous la photo (sans compte)');
  await me.page.screenshot({ path: shots + '/02-visionneuse-description.png' });
  await me.page.click('#viewerInfoBtn');
  await me.page.waitForSelector('#photoDetail .caption-card');
  check(!(await me.page.isVisible('#commentBar')) && norm(await me.page.textContent('#photoComments')).includes('Partage tes Images'), 'fiche photo sans partage : pas de commentaires, invitation à partager');
  await me.page.evaluate(() => goBack());

  // ---------- Comptes, partage ----------
  await signUp(me.page, { name: 'Sohhka', email: 'sohhka@exemple.fr', password: 'voyage-japon-2026' });
  const myCode = norm(await me.page.textContent('#sharingContent .profile-code'));
  const mom = await newPhone(engineName, { android: engineName === 'chromium' });
  await mom.page.goto(url);
  await ready(mom.page);
  await signUp(mom.page, { name: 'Maman', email: 'maman@exemple.fr', password: 'bisous-bisous', invite: myCode });
  await sync(me.page);
  await me.page.click('#sharingContent .list-row:not(.sync-all-row):has-text("Images")');
  await me.page.check('#shareCategoryContent .toggle-row:has-text("Maman") .toggle');
  await me.page.waitForSelector('#shareCategoryContent .source-card', { timeout: 20000 });
  await synced(me.page, 120000);
  const myUid = await me.page.evaluate(() => cloudSession.uid);
  const online = (await adminList('users/' + myUid + '/photos')).filter(p => p.fields.caption);
  check(online.length === 1 && online[0].fields.caption.stringValue === 'Premier soir à Shibuya 🌃' && online[0].fields.location.stringValue === 'Tokyo, Japon',
    'la description et le lieu partent avec la photo');

  // ---------- Maman voit la description et commente ----------
  await sync(mom.page);
  await openFromStrip(mom.page, 'Sohhka');
  await mom.page.click('#sharedAlbumGrid .album-card:has-text("Tokyo")');
  await mom.page.waitForFunction(() => document.querySelectorAll('#sharedPhotoGrid .photo-cell').length === 3);
  const momIndex = await mom.page.evaluate(() => sharedAlbumPhotos.findIndex(p => p.caption));
  await mom.page.click(`#sharedPhotoGrid .photo-cell[data-index="${momIndex}"]`);
  await mom.page.waitForSelector('#viewer:not([hidden])');
  check(norm(await mom.page.textContent('#viewerCaption')) === 'Premier soir à Shibuya 🌃' && norm(await mom.page.textContent('#viewerLocation')) === '📍 Tokyo, Japon'
    && norm(await mom.page.textContent('#viewerInfoBtn')) === '💬 Commenter', 'Maman : lieu et description sous la photo, bouton « Commenter »');
  await mom.page.click('#viewerInfoBtn');
  await mom.page.waitForSelector('#photoDetail .caption-card');
  check(await mom.page.isVisible('#commentBar') && norm(await mom.page.textContent('#photoDetail')).includes('Sohhka'), 'fiche de la photo : auteur, barre de commentaire');
  await mom.page.click('#photoDetail .location-link');
  const mapLink = await mom.page.evaluate(() => window.__opened.slice(-1)[0] || '');
  check(mapLink === 'https://www.google.com/maps/search/?api=1&query=Tokyo%2C%20Japon', 'lieu : ouvre la carte (' + mapLink + ')');
  await mom.page.fill('#commentInput', 'Magnifique ! 😍');
  await mom.page.click('#commentSendBtn');
  await mom.page.waitForFunction(() => document.querySelectorAll('#photoComments .comment:not(.is-pending)').length === 1, null, { timeout: 20000 });
  check((await commentTexts(mom.page)).join() === 'Toi:Magnifique ! 😍' && (await adminList('users/' + myUid + '/comments')).length === 1, 'Maman commente (envoyé)');
  await mom.page.screenshot({ path: shots + '/03-maman-commente.png' });

  // ---------- Sohhka : nouveau commentaire, réponse ----------
  await sync(me.page);
  await goTo(me.page, 'albums');
  await me.page.waitForSelector('#albumNews .list-row', { timeout: 10000 });
  check(norm(await me.page.textContent('#albumNews')).includes('Maman') && norm(await me.page.textContent('#albumNews')).includes('Magnifique'), 'Images : « Nouveaux commentaires » en haut (Maman)');
  await goTo(me.page, 'sharing');
  const meSharing = norm(await me.page.textContent('#sharingContent'));
  check(meSharing.includes('Mes contacts') && !meSharing.includes('Nouveaux commentaires'), 'Partage : plus de « Nouveaux commentaires »');
  await goTo(me.page, 'albums');
  await me.page.waitForSelector('#albumNews .list-row', { timeout: 10000 });
  await me.page.screenshot({ path: shots + '/04-nouveaux-commentaires.png' });
  check(await me.page.evaluate(() => byId('navBtn').classList.contains('has-dot')) && norm(await me.page.textContent('.drawer-item[data-section="albums"] .drawer-badge')) === '💬 1',
    'menu : point sur ☰ et « 💬 1 » à côté d\'Images');
  await goTo(me.page, 'albums');
  await me.page.waitForSelector('#albumGrid .album-card:has-text("Tokyo") .album-badge');
  check(norm(await me.page.textContent('#albumGrid .album-badge')) === '💬 1' && /1 nouveau/.test(await me.page.textContent('#albumGrid')),
    'Images : pastille « 💬 1 » sur la couverture de l\'album');
  await me.page.screenshot({ path: shots + '/04b-pastille-album.png' });
  await me.page.click('#albumGrid .album-card:has-text("Tokyo")');
  await me.page.waitForSelector('#photoGrid .photo-badge.is-unread');
  check(norm(await me.page.textContent('#photoGrid .photo-badge')) === '💬 1', 'pastille « 💬 1 » (nouveau) sur la photo');
  await goTo(me.page, 'albums');
  await me.page.click('#albumNews .list-row');
  await me.page.waitForSelector('#photoComments .comment');
  check(await me.page.isVisible('#photoComments .comment.is-new'), 'fiche : le nouveau commentaire est mis en évidence');
  await me.page.click('#photoComments .comment button:has-text("Répondre")');
  check(await me.page.inputValue('#commentInput') === '@Maman ', '« Répondre » prépare « @Maman »');
  await me.page.type('#commentInput', 'merci ! 🍜');
  await me.page.click('#commentSendBtn');
  await me.page.waitForFunction(() => document.querySelectorAll('#photoComments .comment:not(.is-pending)').length === 2, null, { timeout: 20000 });
  check((await commentTexts(me.page)).join(' | ') === 'Maman:Magnifique ! 😍 | Toi:@Maman merci ! 🍜', 'réponse de Sohhka : ' + (await commentTexts(me.page)).join(' | '));
  await me.page.screenshot({ path: shots + '/05-reponse.png' });
  await me.page.evaluate(() => goBack(true));
  await goTo(me.page, 'albums');
  await me.page.waitForTimeout(800);
  check(!(await me.page.isVisible('#albumNews .list-row')) && !(await me.page.evaluate(() => byId('navBtn').classList.contains('has-dot')))
    && await me.page.isHidden('.drawer-item[data-section="albums"] .drawer-badge'), 'lu : plus de « Nouveaux commentaires », ni de pastille');

  // ---------- Sohhka change la description ----------
  await goTo(me.page, 'albums');
  await me.page.click('#albumGrid .album-card:has-text("Tokyo")');
  await me.page.waitForSelector('#photoGrid .photo-cell');
  await me.page.click(`#photoGrid .photo-cell[data-index="${await me.page.evaluate(() => albumPhotos.findIndex(p => p.caption))}"]`);
  await me.page.click('#viewerInfoBtn');
  await me.page.click('#photoDetail button:has-text("Modifier la description")');
  await me.page.fill('#photoDetail .caption-input', 'Premier soir à Shibuya 🌃\nEt des ramen au retour 🍜');
  await me.page.fill('#locationInput', 'Shibuya, Tokyo');
  await me.page.click('#photoDetail button:has-text("Enregistrer")');
  await me.page.waitForFunction(() => /ramen au retour/.test((document.querySelector('#photoDetail .caption-text') || {}).textContent || ''));
  check(await me.page.evaluate(() => currentViewName()) === 'photo' && norm(await me.page.textContent('#photoDetail .location-link')) === '📍Shibuya, Tokyo',
    'modification : la fiche reste affichée, nouveau lieu');
  await me.page.waitForTimeout(3500);
  await synced(me.page);

  // ---------- Maman : réponse et nouvelle description ----------
  await sync(mom.page);
  await goTo(mom.page, 'albums');
  const momBadges = await mom.page.waitForFunction(() => {
    const menu = document.querySelector('.drawer-item[data-section="albums"] .drawer-badge');
    const person = document.querySelector('#sharedStrip [data-owner-unread]');
    return menu && person && menu.textContent === '💬 1' && person.textContent === '💬 1' && !menu.hidden && !person.hidden;
  }, null, { timeout: 5000 }).then(() => true, () => false);
  check(momBadges && !(await mom.page.$('.drawer-item[data-section="sharing"] .drawer-badge')),
    'Maman : « 💬 1 » sur Images dans le menu et sur Sohhka dans le bandeau (rien sur Partage)');
  check(norm(await mom.page.textContent('#albumNews')).includes('@Maman merci'), 'Maman : la réponse en haut des Images (« Nouveaux commentaires »)');
  await mom.page.screenshot({ path: shots + '/05b-maman-images.png' });
  await mom.page.click('#sharedStrip .person-tile:has-text("Sohhka")');
  await mom.page.waitForSelector('#sharedAlbumGrid .album-badge');
  check(norm(await mom.page.textContent('#sharedAlbumGrid .album-badge')) === '💬 1', 'Maman : pastille sur la couverture de l\'album');
  await mom.page.click('#sharedAlbumGrid .album-card:has-text("Tokyo")');
  await mom.page.waitForSelector('#sharedPhotoGrid .photo-badge.is-unread');
  check(norm(await mom.page.textContent('#sharedPhotoGrid .photo-badge')) === '💬 2', 'Maman : pastille « 💬 2 » (réponse non lue)');
  await mom.page.click(`#sharedPhotoGrid .photo-cell[data-index="${await mom.page.evaluate(() => sharedAlbumPhotos.findIndex(p => p.caption))}"]`);
  await mom.page.click('#viewerInfoBtn');
  await mom.page.waitForFunction(() => document.querySelectorAll('#photoComments .comment').length === 2);
  check((await commentTexts(mom.page)).join(' | ') === 'Toi:Magnifique ! 😍 | Sohhka:@Maman merci ! 🍜', 'Maman voit la réponse');
  check(norm(await mom.page.textContent('#photoDetail .caption-text')).includes('Et des ramen au retour') && norm(await mom.page.textContent('#photoDetail .location-link')) === '📍Shibuya, Tokyo',
    'Maman voit la nouvelle description (sur deux lignes) et le nouveau lieu');

  // ---------- Même compte sur un second appareil : les mêmes Images, et il peut en ajouter ----------
  const syncedNow = page => page.evaluate(() => syncNow()).then(() => synced(page, 120000));
  const other = await newPhone(engineName);
  await other.page.goto(url);
  await ready(other.page);
  await goTo(other.page, 'sharing');
  await other.page.click('#sharingContent button:has-text("J\'ai déjà un compte")');
  await other.page.fill('#accEmail', 'sohhka@exemple.fr');
  await other.page.fill('#accPassword', 'voyage-japon-2026');
  await other.page.click('#accountForm button[type="submit"]');
  await other.page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await synced(other.page, 120000);
  const copies = await other.page.evaluate(async () => (await dbGetAll('photos')).map(p => ({ location: p.location, rid: p.rid, from: !!p.fromAccount })));
  check(copies.length === 3 && copies.every(p => p.rid && p.from) && copies.some(p => p.location === 'Shibuya, Tokyo'),
    'second appareil : les 3 photos du compte arrivent, avec description et lieu (' + copies.length + ')');
  await goTo(other.page, 'albums');
  await other.page.click('#albumGrid .album-card:has-text("Tokyo")');
  await other.page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell img').length === 3);
  await other.page.click(`#photoGrid .photo-cell[data-index="${await other.page.evaluate(() => albumPhotos.findIndex(p => p.caption))}"]`);
  await other.page.waitForSelector('#viewer:not([hidden])');
  check(/💬/.test(norm(await other.page.textContent('#viewerInfoBtn'))), 'second appareil : « 💬 » sous la photo (' + norm(await other.page.textContent('#viewerInfoBtn')) + ')');
  await other.page.click('#viewerInfoBtn');
  await other.page.waitForFunction(() => document.querySelectorAll('#photoComments .comment').length === 2);
  check(await other.page.isVisible('#commentBar'), 'second appareil : les commentaires de la photo, et la barre pour répondre');
  await other.page.screenshot({ path: shots + '/07-second-appareil.png' });
  // Un album ajouté sur le second appareil arrive sur le premier et chez Maman.
  await goTo(other.page, 'albums');
  await topAction(other.page, 'Nouvel album');
  await dialogOk(other.page, 'Test PC');
  await other.page.waitForFunction(() => document.getElementById('viewTitle').textContent.includes('Test PC'));
  await other.page.setInputFiles('#albumPhotos', [file('pc.jpg', jpegs[1])]);
  await other.page.waitForSelector('#captionInput', { timeout: 30000 });
  await other.page.fill('#captionInput', 'Test description ⭐');
  await other.page.click('#photoDetail button:has-text("Enregistrer")');
  await other.page.waitForFunction(() => currentViewName() === 'album');
  await syncedNow(other.page);
  await syncedNow(me.page);
  const meGot = await me.page.evaluate(async () => {
    const album = (await dbGetAll('folders')).find(f => f.name === 'Test PC');
    const photos = album ? await dbGetAllByIndex('photos', 'albumId', album.id) : [];
    return { album: !!album, photos: photos.map(p => p.caption) };
  });
  check(meGot.album && meGot.photos.join() === 'Test description ⭐', 'premier appareil : l\'album ajouté sur le second arrive, avec sa photo et sa description');
  await syncedNow(mom.page);
  check(await mom.page.evaluate(async () => (await dbGetAll('sharedPhotos')).some(p => p.caption === 'Test description ⭐')), 'Maman voit la photo ajoutée depuis le second appareil');
  // Supprimé sur le second appareil : supprimé partout.
  await other.page.evaluate(() => deleteAlbum(currentAlbum));
  await dialogOk(other.page);
  await other.page.waitForFunction(() => currentViewName() === 'albums');
  await syncedNow(other.page);
  await syncedNow(me.page);
  check(!(await me.page.evaluate(async () => (await dbGetAll('folders')).some(f => f.name === 'Test PC'))), 'album supprimé sur le second appareil : supprimé sur le premier aussi');
  await syncedNow(mom.page);
  check(!(await mom.page.evaluate(async () => (await dbGetAll('sharedPhotos')).some(p => p.caption === 'Test description ⭐'))), '… et chez Maman');
  check(other.page.errors.length === 0, 'second appareil : aucune erreur' + (other.page.errors.length ? ' : ' + other.page.errors.join(' | ') : ''));
  await other.context.close();

  // ---------- Hors connexion ----------
  await goOffline(engineName, mom.context);
  await mom.page.fill('#commentInput', 'Écrit dans le métro 📴');
  await mom.page.click('#commentSendBtn');
  await mom.page.waitForSelector('#photoComments .comment.is-pending', { timeout: 20000 });
  // (« ⏳ envoi… » d'abord, puis la raison, une fois l'envoi tenté)
  const waitingLabel = await mom.page.waitForFunction(() => /envoi au retour d'Internet/.test((document.querySelector('#photoComments .comment.is-pending') || {}).textContent || ''), null, { timeout: 20000 }).then(() => true, () => false);
  check(waitingLabel, 'hors connexion : commentaire gardé, « envoi au retour d\'Internet »');
  await mom.page.screenshot({ path: shots + '/06-hors-connexion.png' });
  await goOnline(engineName, mom.context);
  await mom.page.evaluate(() => syncNow());
  await mom.page.waitForFunction(() => !document.querySelector('#photoComments .comment.is-pending') && document.querySelectorAll('#photoComments .comment').length === 3, null, { timeout: 30000 });
  check((await adminList('users/' + myUid + '/comments')).length === 3, 'retour du réseau : commentaire envoyé');

  // ---------- Suppressions ----------
  await mom.page.click('#photoComments .comment:has-text("métro") button:has-text("Supprimer")');
  await dialogOk(mom.page);
  await mom.page.waitForFunction(() => document.querySelectorAll('#photoComments .comment').length === 2);
  await sync(me.page);
  const afterDelete = await me.page.evaluate(async () => (await dbGetAll('sharedComments')).map(c => c.text).sort().join(' | '));
  check(afterDelete === '@Maman merci ! 🍜 | Magnifique ! 😍', 'Maman supprime son commentaire : retiré chez Sohhka aussi');
  await goTo(me.page, 'albums');
  await me.page.click('#albumGrid .album-card:has-text("Tokyo")');
  await me.page.waitForSelector('#photoGrid .photo-cell');
  await me.page.click(`#photoGrid .photo-cell[data-index="${await me.page.evaluate(() => albumPhotos.findIndex(p => p.caption))}"]`);
  await me.page.click('#viewerInfoBtn');
  await me.page.waitForFunction(() => document.querySelectorAll('#photoComments .comment').length === 2);
  await me.page.click('#photoComments .comment:has-text("Magnifique") button:has-text("Supprimer")');
  await dialogOk(me.page);
  await me.page.waitForFunction(() => document.querySelectorAll('#photoComments .comment').length === 1);
  await sync(mom.page);
  const momLeft = await mom.page.evaluate(async () => (await dbGetAll('sharedComments')).map(c => c.text).join(' | '));
  check(momLeft === '@Maman merci ! 🍜', 'Sohhka retire un commentaire de sa photo : retiré chez Maman aussi');

  // ---------- Photo supprimée : ses commentaires aussi ----------
  await goTo(me.page, 'albums');
  await me.page.click('#albumGrid .album-card:has-text("Tokyo")');
  await me.page.waitForSelector('#photoGrid .photo-cell');
  await me.page.click(`#photoGrid .photo-cell[data-index="${await me.page.evaluate(() => albumPhotos.findIndex(p => p.caption))}"]`);
  await me.page.click('#viewerActions button[aria-label="Supprimer"]');
  await dialogOk(me.page);
  await me.page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 2);
  await me.page.evaluate(() => closeViewer());
  await me.page.waitForTimeout(3500);
  await synced(me.page, 60000);
  check((await adminList('users/' + myUid + '/comments')).length === 0, 'photo supprimée : ses commentaires effacés du serveur');
  await sync(mom.page);
  const momAfter = await mom.page.evaluate(async () => ({ comments: (await dbGetAll('sharedComments')).length, photos: (await dbGetAll('sharedPhotos')).length }));
  check(momAfter.comments === 0 && momAfter.photos === 2, 'Maman : photo et commentaires retirés (' + JSON.stringify(momAfter) + ')');

  // ---------- Fin du partage ----------
  await mom.page.evaluate(async () => {
    const photo = (await dbGetAll('sharedPhotos'))[0];
    return cloudPostComment(photo.owner, photo.rid, 'Dernier commentaire');
  });
  await goTo(me.page, 'sharing');
  await me.page.click('#sharingContent .list-row:not(.sync-all-row):has-text("Images")');
  await me.page.uncheck('#shareCategoryContent .toggle-row:has-text("Maman") .toggle');
  await me.page.waitForFunction(() => !document.querySelector('#shareCategoryContent .source-card'), null, { timeout: 30000 });
  await synced(me.page);
  check((await adminList('users/' + myUid + '/comments')).length === 0, 'partage arrêté : commentaires effacés du serveur');
  await sync(mom.page);
  check(await mom.page.evaluate(async () => (await dbGetAll('sharedComments')).length) === 0, 'Maman : plus aucun commentaire de ces photos');

  for (const [who, p] of [['Sohhka', me.page], ['Maman', mom.page]]) {
    check(p.errors.length === 0, who + ' : aucune erreur' + (p.errors.length ? ' : ' + p.errors.join(' | ') : ''));
  }
  await me.context.close();
  await mom.context.close();
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
