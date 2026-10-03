// Mes Images, les mêmes sur tous mes appareils : A (iPhone, version web) et B (second téléphone,
// appli Android) connectés au même compte, Maman qui regarde. Fusion sans perte, changements dans
// les deux sens, conflit, déplacement, renommage, suppression, déconnexion / reconnexion.
// Usage : node 09-images-appareils.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require("./lib/chrome");
const PROJECT = 'demo-sohri';
const FS = 'http://127.0.0.1:8085/v1/projects/' + PROJECT + '/databases/(default)/documents';
const EMULATOR_CONFIG = { apiKey: 'demo-key', projectId: PROJECT, emulator: { auth: 'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8085' } };
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(ok, msg) { results.push([!!ok, msg]); console.log((ok ? 'PASS ' : 'FAIL ') + msg); }

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
async function admin(method, pathName, body) {
  const r = await fetch(FS + '/' + pathName, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function adminList(pathName) {
  return (await admin('GET', pathName + '?pageSize=300')).documents || [];
}
async function resetEmulators() {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
}

let profileCount = 0;
async function newPhone(engineName) {
  const android = engineName === 'chromium';
  let context;
  if (engineName === 'webkit') {
    const dir = path.join(OUT, 'profiles', 'wk-' + (++profileCount));
    fs.rmSync(dir, { recursive: true, force: true });
    context = await webkit.launchPersistentContext(dir, { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
    await blockExternal(context);
  } else {
    const browser = await chromium.launch({ executablePath: CHROME });
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
    await blockExternal(context);
    context.on('close', () => browser.close());
  }
  await context.addInitScript(([config, android]) => {
    window.SOHRI_CLOUD = config;
    if (android) {
      window.AndroidBridge = {
        isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
        openExternal: () => {}, copyText: () => {}, getAppVersion: () => '1.7', shareText: () => {},
        fileBegin: () => 'f', fileAppend: () => {}, fileFinish: () => {}
      };
    }
  }, [EMULATOR_CONFIG, android]);
  const page = context.pages()[0] || await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Could not connect|Load failed/.test(m.text())) page.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  return { context, page };
}

const norm = s => (s || '').replace(/\s/g, ' ').trim();
const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const synced = (page, timeout = 180000) => page.waitForFunction(() => cloudStatus.state === 'done' && !cloudSyncRunning, null, { timeout });
const syncNowAndWait = page => page.evaluate(() => syncNow()).then(() => synced(page));
async function goTo(page, section) { await page.evaluate(s => goToSection(s), section); await page.waitForTimeout(150); }
async function topAction(page, label) { await page.click(`#topActions button[aria-label="${label}"]`); }
async function dialogOk(page, value) {
  await page.waitForSelector('#dialog:not([hidden])');
  if (value !== undefined) await page.fill('#dialogInput', value);
  await page.click('#dialogOkBtn');
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
async function signIn(page, email, password) {
  await goTo(page, 'sharing');
  await page.click('#sharingContent button:has-text("J\'ai déjà un compte")');
  await page.fill('#accEmail', email);
  await page.fill('#accPassword', password);
  await page.click('#accountForm button[type="submit"]');
  await page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await synced(page);
}
async function makeJpegs(page, labels) {
  return page.evaluate(async labels => {
    const out = [];
    for (let n = 0; n < labels.length; n++) {
      const c = document.createElement('canvas');
      c.width = 1600; c.height = 1200;
      const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + (n * 53) + ',60%,45%)'; g.fillRect(0, 0, 1600, 1200);
      g.fillStyle = '#fff'; g.font = 'bold 200px sans-serif'; g.fillText(labels[n], 120, 650);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push(btoa(bin));
    }
    return out;
  }, labels);
}
const file = (name, b64) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
async function addAlbum(page, name, jpegs, names) {
  await goTo(page, 'albums');
  await topAction(page, 'Nouvel album');
  await dialogOk(page, name);
  await page.waitForFunction(n => document.getElementById('viewTitle').textContent.includes(n), name);
  await page.setInputFiles('#albumPhotos', jpegs.map((b, i) => file(names[i] + '.jpg', b)));
  if (jpegs.length === 1) {
    await page.waitForSelector('#captionInput', { timeout: 30000 });
    await page.click('#photoDetail button:has-text("Plus tard")');
  }
  await page.waitForFunction(n => currentViewName() === 'album' && document.querySelectorAll('#photoGrid .photo-cell').length === n, jpegs.length, { timeout: 60000 });
}
// Ce qu'un appareil a dans Images : { album : [photos] } ; « * » : venu d'un autre appareil. Les
// photos sont reconnues par leur identifiant commun (les copies n'ont pas de nom de fichier).
const labels = {};
async function learnLabels(page) {
  const pairs = await page.evaluate(async () => (await dbGetAll('photos')).filter(p => !p.fromAccount).map(p => [photoRemoteId(p), (p.name || '').replace(/\.jpg$/, '')]));
  pairs.forEach(([rid, name]) => { labels[rid] = name; });
}
const LIBRARY = async () => {
  const folders = (await dbGetAll('folders')).filter(f => f.kind === 'photos');
  const photos = await dbGetAll('photos');
  const out = {};
  folders.forEach(f => { out[f.name + (f.fromAccount ? '*' : '')] = []; });
  photos.forEach(p => {
    const f = folders.find(x => x.id === p.albumId);
    const key = f ? f.name + (f.fromAccount ? '*' : '') : '?';
    (out[key] = out[key] || []).push({ rid: photoRemoteId(p), from: !!p.fromAccount });
  });
  return out;
};
async function library(page) {
  const raw = await page.evaluate(LIBRARY);
  const out = {};
  Object.keys(raw).forEach(k => { out[k] = raw[k].map(x => (labels[x.rid] || x.rid) + (x.from ? '*' : '')).sort(); });
  return out;
}
const sameContent = (a, b) => {
  const flat = lib => Object.keys(lib).map(k => k.replace('*', '') + ':' + lib[k].map(x => x.replace('*', '')).sort().join(',')).sort().join(' | ');
  return flat(a) === flat(b);
};
const flat = lib => Object.keys(lib).sort().map(k => k + '[' + lib[k].join(',') + ']').join(' ');
const findPhoto = (page, name) => page.evaluate(async name => {
  const photos = await dbGetAll('photos');
  return photos.find(p => (p.name || '').replace(/\.jpg$/, '') === name || p.caption === name) || null;
}, name);

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    await resetEmulators();
    const A = await newPhone('webkit');   // mon iPhone (version web)
    const B = await newPhone('chromium'); // mon autre téléphone (appli Android)
    const mom = await newPhone('chromium');
    for (const p of [A, B, mom]) { await p.page.goto(url); await ready(p.page); }

    // ---------- A : compte, album Tokyo (3 photos), partagé avec Maman ----------
    const jA = await makeJpegs(A.page, ['Shibuya', 'Ramen', 'Temple']);
    await addAlbum(A.page, 'Tokyo', jA, ['Shibuya', 'Ramen', 'Temple']);
    await learnLabels(A.page);
    await signUp(A.page, { name: 'Sohhka', email: 'sohhka@exemple.fr', password: 'voyage-japon-2026' });
    const code = norm(await A.page.textContent('#sharingContent .profile-code'));
    await signUp(mom.page, { name: 'Maman', email: 'maman@exemple.fr', password: 'bisous-bisous', invite: code });
    await syncNowAndWait(A.page);
    await A.page.click('#sharingContent .list-row:not(.sync-all-row):has-text("Images")');
    await A.page.check('#shareCategoryContent .toggle-row:has-text("Maman") .toggle');
    await A.page.waitForSelector('#shareCategoryContent .source-card', { timeout: 20000 });
    await synced(A.page);
    check(norm(await A.page.textContent('#shareCategoryContent .source-card')).includes('les mêmes sur tous les appareils'), 'écran Partage → Images : « les mêmes sur tous les appareils connectés à ton compte »');
    await A.page.screenshot({ path: path.join(OUT, '01-partage-images.png') });
    const uid = await A.page.evaluate(() => cloudSession.uid);

    // Ancienne version : un seul appareil d'envoi (« sources.albums ») : le repère est effacé.
    await admin('PATCH', 'users/' + uid + '?updateMask.fieldPaths=sources', { fields: { sources: { mapValue: { fields: { albums: { stringValue: 'vieil-appareil' } } } } } });
    await syncNowAndWait(A.page);
    const profileDoc = await admin('GET', 'users/' + uid);
    const sourcesLeft = profileDoc.fields.sources && profileDoc.fields.sources.mapValue.fields && profileDoc.fields.sources.mapValue.fields.albums;
    check(!sourcesLeft, 'repère des anciennes versions (un seul appareil d\'envoi) effacé : elles n\'envoient plus rien');

    // ---------- B, avant connexion : ses propres photos (dont un autre album « Tokyo ») ----------
    const jB = await makeJpegs(B.page, ['Chat', 'Plage', 'Metro']);
    await addAlbum(B.page, 'Perso', jB.slice(0, 2), ['Chat', 'Plage']);
    await addAlbum(B.page, 'Tokyo', jB.slice(2), ['Metro']);
    await learnLabels(B.page);
    await signIn(B.page, 'sohhka@exemple.fr', 'voyage-japon-2026');
    const libB = await library(B.page);
    check(flat(libB) === 'Perso[Chat,Plage] Tokyo[Metro] Tokyo*[Ramen*,Shibuya*,Temple*]',
      'B se connecte : fusion sans rien perdre (ses albums + ceux du compte) : ' + flat(libB));
    const online1 = await adminList('users/' + uid + '/photos');
    check(online1.filter(d => !d.fields.deleted).length === 6, 'les photos de B partent en ligne (6 en tout, sans doublon) : ' + online1.length);
    await syncNowAndWait(A.page);
    const libA = await library(A.page);
    check(flat(libA) === 'Perso*[Chat*,Plage*] Tokyo[Ramen,Shibuya,Temple] Tokyo*[Metro*]', 'A reçoit les photos de B : ' + flat(libA));
    await goTo(A.page, 'albums');
    await A.page.waitForFunction(() => document.querySelectorAll('#albumGrid .album-card').length === 3);
    await A.page.screenshot({ path: path.join(OUT, '02-A-albums.png') });
    await syncNowAndWait(mom.page);
    const momCount = await mom.page.evaluate(async () => ({ albums: (await dbGetAll('sharedAlbums')).length, photos: (await dbGetAll('sharedPhotos')).length }));
    check(momCount.albums === 3 && momCount.photos === 6, 'Maman voit les photos des deux appareils (' + JSON.stringify(momCount) + ')');

    // ---------- Espace en ligne (écran Partage) : le mien et celui de mes proches ----------
    await A.page.evaluate(() => measureOnlineUsage(true));
    const usageA = Number(((await admin('GET', 'users/' + uid)).fields.usageBytes || {}).integerValue);
    check(usageA > 100000, 'espace occupé par le compte : mesuré et noté sur le serveur (' + usageA + ' octets)');
    await mom.page.evaluate(() => measureOnlineUsage(true));
    await goTo(mom.page, 'sharing');
    await mom.page.waitForSelector('#sharingContent .usage-card .usage-people');
    const momUsage = norm(await mom.page.textContent('#sharingContent .usage-card'));
    check(/Toi et tes proches : environ [\d,]+ (Ko|Mo) sur 1 Go \(moins de 1 %\)/.test(momUsage) && /Toi : 0 o · Sohhka : [\d,]+ (Ko|Mo)/.test(momUsage),
      'Maman : « Espace en ligne », avec la part de chacun (' + momUsage.slice(0, 110) + '…)');
    await mom.page.screenshot({ path: path.join(OUT, '05-maman-espace-en-ligne.png'), fullPage: true });

    // ---------- Changements des deux côtés ----------
    await A.page.evaluate(async () => { const p = (await dbGetAll('photos')).find(x => x.name === 'Ramen.jpg'); await setPhotoInfo(p, 'Les meilleurs ramen', ''); });
    await B.page.evaluate(async () => {
      const photos = await dbGetAll('photos');
      await setPhotoInfo(photos.find(x => x.name === 'Chat.jpg'), 'Mon chat', 'Lyon, France');
    });
    // B : lieu d'une photo venue de A (Temple), déplacée dans Perso ; album Tokyo (de B) renommé.
    const templeRid = (await findPhoto(A.page, 'Temple')) && await A.page.evaluate(async () => photoRemoteId((await dbGetAll('photos')).find(x => x.name === 'Temple.jpg')));
    await B.page.evaluate(async rid => {
      const photos = await dbGetAll('photos');
      const temple = photos.find(x => x.rid === rid);
      const perso = (await dbGetAll('folders')).find(f => f.name === 'Perso');
      await setPhotoInfo(temple, '', 'Asakusa, Tokyo');
      const again = await dbGet('photos', temple.id);
      again.albumId = perso.id;
      await dbPut('photos', again);
      const mine = (await dbGetAll('folders')).find(f => f.name === 'Tokyo' && !f.fromAccount);
      mine.name = 'Tokyo (métro)';
      await dbPut('folders', mine);
    }, templeRid);
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await syncNowAndWait(A.page);
    const a2 = await A.page.evaluate(async rid => {
      const photos = await dbGetAll('photos');
      const folders = await dbGetAll('folders');
      const t = photos.find(x => photoRemoteId(x) === rid);
      return {
        ramen: photos.find(x => x.name === 'Ramen.jpg').caption,
        chat: photos.find(x => x.caption === 'Mon chat') ? photos.find(x => x.caption === 'Mon chat').location : null,
        temple: t ? { location: t.location, album: (folders.find(f => f.id === t.albumId) || {}).name } : null,
        renamed: folders.some(f => f.name === 'Tokyo (métro)')
      };
    }, templeRid);
    check(a2.chat === 'Lyon, France', 'description et lieu écrits sur B : arrivés sur A');
    check(a2.temple && a2.temple.location === 'Asakusa, Tokyo' && a2.temple.album === 'Perso', 'photo de A modifiée et déplacée sur B : suivie sur A (' + JSON.stringify(a2.temple) + ')');
    check(a2.renamed, 'album renommé sur B : renommé sur A');
    const b2 = await B.page.evaluate(async () => (await dbGetAll('photos')).find(x => x.caption === 'Les meilleurs ramen') !== undefined);
    check(b2 && a2.ramen === 'Les meilleurs ramen', 'description écrite sur A : arrivée sur B (et gardée sur A)');

    // Conflit : la même description changée des deux côtés : la dernière envoyée gagne partout.
    await A.page.evaluate(async () => { const p = (await dbGetAll('photos')).find(x => x.name === 'Shibuya.jpg'); await setPhotoInfo(p, 'Version A', ''); });
    await B.page.evaluate(async rid => { const p = (await dbGetAll('photos')).find(x => x.rid === rid); await setPhotoInfo(p, 'Version B', ''); },
      await A.page.evaluate(async () => photoRemoteId((await dbGetAll('photos')).find(x => x.name === 'Shibuya.jpg'))));
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await syncNowAndWait(A.page);
    const conflict = [await A.page.evaluate(async () => (await dbGetAll('photos')).find(x => x.name === 'Shibuya.jpg').caption),
      await B.page.evaluate(async () => (await dbGetAll('photos')).filter(x => /Version/.test(x.caption)).map(x => x.caption).join())];
    check(conflict[0] === 'Version B' && conflict[1] === 'Version B', 'conflit : la dernière modification envoyée (B) gagne sur les deux appareils (' + conflict.join(' / ') + ')');

    // Envois croisés : A change la description de Shibuya sans avoir vu le lieu que B vient d'y
    // ajouter ; son envoi est refusé (le lieu n'est pas effacé), puis la synchronisation réunit tout.
    const shibuyaRid = await A.page.evaluate(async () => photoRemoteId((await dbGetAll('photos')).find(x => x.name === 'Shibuya.jpg')));
    const onlinePhoto = async rid => {
      const f = (await admin('GET', 'users/' + uid + '/photos/' + rid)).fields || {};
      return { caption: f.caption ? f.caption.stringValue : '', location: f.location ? f.location.stringValue : '' };
    };
    await A.page.evaluate(async () => { const p = (await dbGetAll('photos')).find(x => x.name === 'Shibuya.jpg'); await setPhotoInfo(p, 'Course A', p.location); clearTimeout(cloudPublishTimer); });
    await B.page.evaluate(async rid => { const p = (await dbGetAll('photos')).find(x => photoRemoteId(x) === rid); await setPhotoInfo(p, p.caption, 'Shibuya, Tokyo'); clearTimeout(cloudPublishTimer); }, shibuyaRid);
    await syncNowAndWait(B.page);
    const retry = await A.page.evaluate(async () => {
      cloudSyncAgain = false;
      const r = await Promise.all([dbGetAll('folders'), dbGetAll('photos'), loadPublished()]);
      await publishChanges(r[0].filter(isAlbum), r[1], r[2]); // sans relire d'abord
      const again = cloudSyncAgain;
      cloudSyncAgain = false;
      return again;
    });
    const raced = await onlinePhoto(shibuyaRid);
    check(retry && raced.caption === 'Version B' && raced.location === 'Shibuya, Tokyo', 'A envoie sans avoir vu le lieu ajouté par B : envoi refusé, rien d\'écrasé (' + JSON.stringify(raced) + ')');
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    const reunited = await onlinePhoto(shibuyaRid);
    const shibuyaOn = page => page.evaluate(async rid => { const p = (await dbGetAll('photos')).find(x => photoRemoteId(x) === rid); return p ? p.caption + ' | ' + p.location : null; }, shibuyaRid);
    check(reunited.caption === 'Course A' && reunited.location === 'Shibuya, Tokyo' && await shibuyaOn(A.page) === 'Course A | Shibuya, Tokyo' && await shibuyaOn(B.page) === 'Course A | Shibuya, Tokyo',
      '… puis les deux changements réunis partout : description de A, lieu de B (' + JSON.stringify(reunited) + ')');

    // ---------- Suppression sur B d'une photo venue de A ----------
    await B.page.evaluate(async () => { const p = (await dbGetAll('photos')).find(x => x.caption === 'Les meilleurs ramen'); await dbDelete('photos', p.id); });
    await syncNowAndWait(B.page);
    await syncNowAndWait(A.page);
    check(!(await findPhoto(A.page, 'Ramen')), 'photo supprimée sur B : supprimée sur A');
    await syncNowAndWait(mom.page);
    const momAfter = await mom.page.evaluate(async () => (await dbGetAll('sharedPhotos')).map(p => p.caption).filter(Boolean).sort().join(' | '));
    check(!/ramen/.test(momAfter) && /Mon chat/.test(momAfter) && /Course A/.test(momAfter), 'Maman : suppression et modifications suivies (' + momAfter + ')');
    const libA3 = await library(A.page);
    const libB3 = await library(B.page);
    check(sameContent(libA3, libB3), 'A et B ont exactement les mêmes Images : ' + flat(libA3));
    const onlineNow = (await adminList('users/' + uid + '/photos')).filter(d => !d.fields.deleted).length;
    check(onlineNow === 5, 'en ligne : 5 photos, aucun doublon (' + onlineNow + ')');
    await A.page.screenshot({ path: path.join(OUT, '03-A-apres.png') });

    // ---------- B se déconnecte : les photos de A quittent B, les siennes restent ----------
    await goTo(B.page, 'sharing');
    await B.page.click('#sharingContent .sign-out-btn');
    await dialogOk(B.page);
    await B.page.waitForSelector('#sharingContent button:has-text("Créer un compte")');
    const libB4 = await library(B.page);
    check(flat(libB4) === 'Perso[Chat,Plage] Tokyo (métro)[Metro]', 'déconnexion de B : ses photos restent, celles de A partent : ' + flat(libB4));
    await syncNowAndWait(A.page);
    check(Object.values(await library(A.page)).flat().length === 5, 'A n\'a rien perdu (déconnexion de B) ');
    // Reconnexion : tout revient, sans doublon.
    await signIn(B.page, 'sohhka@exemple.fr', 'voyage-japon-2026');
    const libB5 = await library(B.page);
    check(sameContent(libB5, await library(A.page)), 'reconnexion de B : tout revient, identique à A : ' + flat(libB5));
    check((await adminList('users/' + uid + '/photos')).filter(d => !d.fields.deleted).length === 5, 'reconnexion : aucun doublon en ligne');

    // ---------- Photo ajoutée sur B : A et Maman la reçoivent ; B s'affiche bien ----------
    const jB2 = await makeJpegs(B.page, ['Neige']);
    await addAlbum(B.page, 'Hokkaido', jB2, ['Neige']);
    await learnLabels(B.page);
    await syncNowAndWait(B.page);
    await syncNowAndWait(A.page);
    check((await library(A.page))['Hokkaido*'] && (await library(A.page))['Hokkaido*'].join() === 'Neige*', 'album ajouté sur B après reconnexion : reçu sur A');
    await goTo(A.page, 'albums');
    await A.page.click('#albumGrid .album-card:has-text("Hokkaido")');
    await A.page.waitForFunction(() => { const i = document.querySelector('#photoGrid .photo-cell img'); return i && i.complete && i.naturalWidth > 0; });
    await A.page.click('#photoGrid .photo-cell');
    await A.page.waitForFunction(() => document.getElementById('viewerImg').complete && document.getElementById('viewerImg').naturalWidth > 0);
    check(true, 'A : vignette et photo venues de B s\'affichent');
    await A.page.screenshot({ path: path.join(OUT, '04-A-photo-de-B.png') });
    await A.page.click('#viewerCloseBtn');

    // ---------- Suppressions croisées : rien ne se perd ----------
    // Aides : album et photos ajoutés directement (sans écran), état d'une photo ici et en ligne.
    const [jNara, jKyoto, jGeisha, jOsaka, jTako] = await makeJpegs(A.page, ['Daim', 'Torii', 'Geisha', 'Chateau', 'Tako']);
    const putAlbum = (page, name, photos) => page.evaluate(async ([name, photos]) => {
      const albumId = await dbPut('folders', { kind: 'photos', name, createdAt: Date.now() });
      for (const [label, b64] of photos) {
        const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jpeg' });
        await dbPut('photos', { albumId, blob, thumb: blob, width: 1600, height: 1200, name: label + '.jpg', takenAt: Date.now(), createdAt: Date.now() });
        await new Promise(r => setTimeout(r, 3));
      }
      clearTimeout(cloudPublishTimer);
      return albumId;
    }, [name, photos]);
    const addPhoto = (page, album, label, b64) => page.evaluate(async ([album, label, b64]) => {
      const a = (await dbGetAll('folders')).find(f => f.kind === 'photos' && f.name === album);
      const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      await dbPut('photos', { albumId: a.id, blob, thumb: blob, width: 1600, height: 1200, name: label + '.jpg', takenAt: Date.now(), createdAt: Date.now() });
      clearTimeout(cloudPublishTimer);
    }, [album, label, b64]);
    // Supprime ici un album (avec ses photos) ou une photo, sans synchroniser tout de suite.
    const dropAlbum = (page, album) => page.evaluate(async album => {
      const a = (await dbGetAll('folders')).find(f => f.kind === 'photos' && f.name === album);
      const photos = (await dbGetAll('photos')).filter(p => p.albumId === a.id);
      await dbWrite(['folders', 'photos'], tx => { tx.objectStore('folders').delete(a.id); photos.forEach(p => tx.objectStore('photos').delete(p.id)); });
      clearTimeout(cloudPublishTimer);
    }, album);
    const ridOf = (page, find) => page.evaluate(async src => { const p = (await dbGetAll('photos')).find(eval(src)); return p ? photoRemoteId(p) : null; }, find.toString());
    const photoOn = (page, rid) => page.evaluate(async rid => {
      const p = (await dbGetAll('photos')).find(x => photoRemoteId(x) === rid);
      if (!p) return null;
      const a = (await dbGetAll('folders')).find(f => f.id === p.albumId);
      return (a ? a.name : '?') + ' | ' + (p.caption || '') + ' | ' + (p.location || '');
    }, rid);
    const photoOnline = async rid => {
      const f = (await admin('GET', 'users/' + uid + '/photos/' + rid)).fields || {};
      return f.deleted ? 'supprimée' : (f.caption ? f.caption.stringValue : '') + ' | ' + (f.location ? f.location.stringValue : '');
    };
    const albumsOn = page => page.evaluate(async () => {
      const photos = await dbGetAll('photos');
      return (await dbGetAll('folders')).filter(f => f.kind === 'photos').map(f => f.name + '(' + photos.filter(p => p.albumId === f.id).length + ')').sort().join(' ');
    });
    const publishOnly = page => page.evaluate(async () => {
      cloudSyncAgain = false;
      const r = await Promise.all([dbGetAll('folders'), dbGetAll('photos'), loadPublished()]);
      await publishChanges(r[0].filter(isAlbum), r[1], r[2]);
      const again = cloudSyncAgain;
      cloudSyncAgain = false;
      return again;
    });

    // 1. Photo supprimée sur A pendant que B la modifie : la suppression est refusée, elle revient.
    const chatRid = await ridOf(B.page, x => x.caption === 'Mon chat');
    await B.page.evaluate(async rid => { const p = (await dbGetAll('photos')).find(x => photoRemoteId(x) === rid); await setPhotoInfo(p, 'Mon chat adoré', p.location); clearTimeout(cloudPublishTimer); }, chatRid);
    await syncNowAndWait(B.page);
    await A.page.evaluate(async rid => { const p = (await dbGetAll('photos')).find(x => photoRemoteId(x) === rid); await dbDelete('photos', p.id); clearTimeout(cloudPublishTimer); }, chatRid);
    const refusedDelete = await publishOnly(A.page);
    check(refusedDelete && await photoOnline(chatRid) === 'Mon chat adoré | Lyon, France', 'photo supprimée sur A sans avoir vu la modification de B : suppression refusée, rien de perdu en ligne');
    await syncNowAndWait(A.page);
    check(await photoOn(A.page, chatRid) === 'Perso | Mon chat adoré | Lyon, France' && await photoOn(B.page, chatRid) === 'Perso | Mon chat adoré | Lyon, France',
      '… elle revient sur A, avec la modification de B (' + await photoOn(A.page, chatRid) + ')');

    // 2. Dans l'autre ordre : supprimée sur A (envoyé), puis modifiée sur B qui ne l'a pas encore vu.
    const plageRid = await ridOf(B.page, x => x.name === 'Plage.jpg');
    await A.page.evaluate(async rid => { const p = (await dbGetAll('photos')).find(x => photoRemoteId(x) === rid); await dbDelete('photos', p.id); clearTimeout(cloudPublishTimer); }, plageRid);
    await syncNowAndWait(A.page);
    check(await photoOnline(plageRid) === 'supprimée', 'photo supprimée sur A : supprimée en ligne');
    await B.page.evaluate(async rid => { const p = (await dbGetAll('photos')).find(x => photoRemoteId(x) === rid); await setPhotoInfo(p, 'Plage de Kamakura', ''); clearTimeout(cloudPublishTimer); }, plageRid);
    const plageState = await syncNowAndWait(B.page).then(() => B.page.evaluate(() => cloudStatus.state));
    check(plageState === 'done' && await photoOnline(plageRid) === 'Plage de Kamakura | ' && await photoOn(B.page, plageRid) === 'Perso | Plage de Kamakura | ',
      'B la modifie sans avoir vu la suppression : elle est gardée, et renvoyée en ligne (' + await photoOnline(plageRid) + ')');
    await syncNowAndWait(A.page);
    check(await photoOn(A.page, plageRid) === 'Perso | Plage de Kamakura | ', '… et revient sur A');

    // 3. Album renommé sur B pendant que A le supprime : il revient (renommé) ; sa photo, inchangée, part.
    await putAlbum(A.page, 'Nara', [['Daim', jNara]]);
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await B.page.evaluate(async () => { const a = (await dbGetAll('folders')).find(f => f.name === 'Nara'); a.name = 'Nara (cerfs)'; await dbPut('folders', a); clearTimeout(cloudPublishTimer); });
    await syncNowAndWait(B.page);
    await dropAlbum(A.page, 'Nara');
    const refusedAlbum = await publishOnly(A.page);
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    check(refusedAlbum && /Nara \(cerfs\)\(0\)/.test(await albumsOn(A.page)) && /Nara \(cerfs\)\(0\)/.test(await albumsOn(B.page)),
      'album supprimé sur A pendant que B le renommait : il revient, renommé (sa photo, inchangée, est bien supprimée)');

    // 4. Album supprimé sur A pendant que B y ajoute une photo : il revient, avec elle.
    await putAlbum(A.page, 'Kyoto', [['Torii', jKyoto]]);
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await addPhoto(B.page, 'Kyoto', 'Geisha', jGeisha);
    await syncNowAndWait(B.page);
    await dropAlbum(A.page, 'Kyoto');
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    const kyoto = [await albumsOn(A.page), await albumsOn(B.page)].map(s => (s.match(/Kyoto\(\d+\)/) || ['absent'])[0]);
    const geishaRid = await ridOf(B.page, x => x.name === 'Geisha.jpg');
    check(kyoto.join() === 'Kyoto(1),Kyoto(1)' && /^Kyoto \| /.test(await photoOn(A.page, geishaRid) || ''),
      'album supprimé sur A pendant que B y ajoutait une photo : il revient avec elle seule (' + kyoto.join(' / ') + ')');

    // 5. Album supprimé sur A (envoyé), puis photo ajoutée dedans sur B qui ne l'a pas encore vu :
    //    l'album est gardé sur B et renvoyé en ligne (avant la 2.4 : refusé à chaque fois).
    await putAlbum(A.page, 'Osaka', [['Chateau', jOsaka]]);
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await dropAlbum(A.page, 'Osaka');
    await syncNowAndWait(A.page);
    await addPhoto(B.page, 'Osaka', 'Tako', jTako);
    const osakaState = await syncNowAndWait(B.page).then(() => B.page.evaluate(() => cloudStatus.state));
    await syncNowAndWait(A.page);
    const osaka = [await albumsOn(A.page), await albumsOn(B.page)].map(s => (s.match(/Osaka\(\d+\)/) || ['absent'])[0]);
    const osakaOnline = await adminList('users/' + uid + '/albums').then(list => list.filter(d => d.fields.name && d.fields.name.stringValue === 'Osaka').length);
    check(osakaState === 'done' && osaka.join() === 'Osaka(1),Osaka(1)' && osakaOnline === 1,
      'photo ajoutée sur B dans un album déjà supprimé sur A : album gardé, renvoyé en ligne, revenu sur A (' + osaka.join(' / ') + ')');
    check(sameContent(await library(A.page), await library(B.page)), 'après toutes ces suppressions croisées : A et B identiques');
    await syncNowAndWait(mom.page);
    const momAlbums = await mom.page.evaluate(async () => (await dbGetAll('sharedAlbums')).map(a => a.name).sort().join(', '));
    check(/Kyoto/.test(momAlbums) && /Nara \(cerfs\)/.test(momAlbums) && /Osaka/.test(momAlbums), 'Maman voit les albums revenus (' + momAlbums + ')');

    for (const [who, p] of [['A', A.page], ['B', B.page], ['Maman', mom.page]]) {
      check(p.errors.length === 0, who + ' : aucune erreur' + (p.errors.length ? ' : ' + p.errors.slice(0, 3).join(' | ') : ''));
    }
    for (const p of [A, B, mom]) await p.context.close();
  } catch (e) {
    console.error(e);
    check(false, 'exception : ' + e.message.split('\n')[0]);
  }
  server.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  if (failed.length) { console.log('ÉCHECS :'); failed.forEach(f => console.log(' - ' + f[1])); }
  process.exit(failed.length ? 1 : 0);
})();
