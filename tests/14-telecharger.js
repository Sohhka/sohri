// Bouton « Télécharger » de la visionneuse de photos : appli Android (galerie, via le pont simulé),
// iPhone (feuille de partage → « Enregistrer l'image », explication la première fois), ordinateur
// (téléchargement). Albums, photos des proches, fiche d'une photo, photos et pièces jointes des notes.
// Usage : node 14-telecharger.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require("./lib/chrome");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(ok, msg) { results.push([!!ok, msg]); console.log((ok ? 'PASS ' : 'FAIL ') + msg); }

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      if (p === '/js/cloud-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.SOHRI_CLOUD = null;'); }
      const file = path.join(WWW, p);
      if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Android : pont simulé qui garde chaque fichier transmis (nom, type, action, contenu).
const ANDROID_BRIDGE = () => {
  // refuse : réponse d'Android simulée (« permission » : autorisation refusée sur Android 8 / 9).
  const state = window.__bridge = { files: {}, finished: [], refuse: '' };
  window.AndroidBridge = {
    isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
    openExternal: () => {}, copyText: () => {}, getAppVersion: () => '2.3', shareText: () => {},
    fileBegin: (name, type) => { const id = 'f' + Object.keys(state.files).length; state.files[id] = { name, type, chunks: [] }; return id; },
    fileAppend: (id, b64) => { state.files[id].chunks.push(b64); },
    fileFinish: (id, action) => {
      const f = state.files[id];
      const bin = f.chunks.map(c => atob(c)).join('');
      state.finished.push({ action, name: f.name, type: f.type, size: bin.length, b64: btoa(bin) });
      // Comme Android : la galerie répond un peu plus tard (MainActivity.reportGallery).
      if (action === 'gallery') setTimeout(() => window.onGallerySaved(id, !state.refuse, state.refuse), 30);
    }
  };
};
// iPhone : feuille de partage simulée (ce qu'elle reçoit).
const IOS_SHARE = () => {
  window.__shared = [];
  navigator.share = data => {
    window.__shared.push((data.files || []).map(f => f.name + '|' + f.type + '|' + f.size));
    return Promise.resolve();
  };
  navigator.canShare = () => true;
};

async function newPhone(kind) {
  let browser, context;
  if (kind === 'iphone') {
    const dir = path.join(OUT, 'profile-iphone');
    fs.rmSync(dir, { recursive: true, force: true });
    context = await webkit.launchPersistentContext(dir, { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
    browser = context; // fermé avec le contexte
    await context.addInitScript(IOS_SHARE);
  } else {
    browser = await chromium.launch({ executablePath: CHROME });
    context = kind === 'android'
      ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' })
      : await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block', acceptDownloads: true });
    if (kind === 'android') await context.addInitScript(ANDROID_BRIDGE);
  }
  await blockExternal(context);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) page.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  return { browser, context, page };
}

// Données de test : un album (2 photos), une note (2 photos dont une très ancienne en data URL, une
// pièce jointe image), un album d'un proche (une photo reçue en grand, une pas encore).
const SETUP = async () => {
  const jpeg = async (label, hue) => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = 'hsl(' + hue + ',60%,45%)'; g.fillRect(0, 0, 900, 600);
    g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText(label, 60, 330);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  };
  const png = async () => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#2a6'; g.fillRect(0, 0, 300, 200);
    return new Promise(r => c.toBlob(r, 'image/png'));
  };
  const asDataUrl = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const shibuya = await jpeg('Shibuya', 10);
  const ramen = await jpeg('Ramen', 200);
  const album = await dbPut('folders', { kind: 'photos', name: 'Tokyo', createdAt: Date.now() });
  const t1 = new Date(2026, 3, 4, 18, 0, 0).getTime();
  const t2 = new Date(2026, 3, 5, 10, 30, 0).getTime();
  const p1 = await dbPut('photos', { albumId: album, blob: shibuya, thumb: shibuya, width: 900, height: 600, name: 'shibuya.jpg', takenAt: t1, createdAt: Date.now() });
  await dbPut('photos', { albumId: album, blob: ramen, thumb: ramen, width: 900, height: 600, name: 'ramen.jpg', takenAt: t2, createdAt: Date.now() });
  const plan = await png();
  const old = await asDataUrl(await png());
  const temple = await jpeg('Temple', 120);
  const note = await dbPut('notes', {
    title: 'Kyoto : temples', body: 'Visites', icon: '📝', folderId: null, addressId: null, pinned: false,
    images: [temple, old], attachments: [{ id: 'a1', name: 'plan-metro.png', type: 'image/png', size: plan.size, blob: plan }],
    createdAt: Date.now(), updatedAt: Date.now()
  });
  const mom = await jpeg('Maman', 300);
  await dbPut('sharedAlbums', { key: 'mom/a1', owner: 'mom', rid: 'a1', name: 'Osaka', icon: '' });
  await dbPut('sharedPhotos', { key: 'mom/p1', owner: 'mom', rid: 'p1', albumKey: 'mom/a1', takenAt: t1, width: 900, height: 600, parts: 1, size: mom.size, caption: '', location: '', thumb: mom, blob: mom, receivedAt: 1 });
  await dbPut('sharedPhotos', { key: 'mom/p2', owner: 'mom', rid: 'p2', albumKey: 'mom/a1', takenAt: t2, width: 900, height: 600, parts: 1, size: 123, caption: '', location: '', thumb: mom, blob: null, receivedAt: 1 });
  const hex = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
  return { album, p1, note, hashes: { shibuya: await hex(shibuya), temple: await hex(temple), plan: await hex(plan), mom: await hex(mom) }, sizes: { shibuya: shibuya.size } };
};

const sha = b64 => crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const viewerOpen = page => page.waitForFunction(() => !document.getElementById('viewer').hidden && document.getElementById('viewerImg').complete);
const buttons = page => page.$$eval('#viewerActions button', l => l.map(b => b.getAttribute('aria-label')));
const closeViewer = page => page.click('#viewerCloseBtn');
const lastFile = page => page.evaluate(() => window.__bridge.finished[window.__bridge.finished.length - 1] || null);
const fileCount = page => page.evaluate(() => window.__bridge.finished.length);
async function waitFiles(page, n) { await page.waitForFunction(n => window.__bridge.finished.length >= n, n, { timeout: 10000 }); }

async function openAlbum(page, data) {
  await page.evaluate(id => openView('album', { id }), data.album);
  await page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 2);
  await page.click('#photoGrid .photo-cell >> nth=0');
  await viewerOpen(page);
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    // ---------- Appli Android : la photo va dans la galerie ----------
    {
      const { browser, page } = await newPhone('android');
      await page.goto(url);
      await ready(page);
      const data = await page.evaluate(SETUP);
      await openAlbum(page, data);
      check(JSON.stringify(await buttons(page)) === JSON.stringify(['Télécharger', 'Partager', 'Supprimer']), 'Android, album : boutons Télécharger, Partager, Supprimer (' + (await buttons(page)).join(', ') + ')');
      const svg = await page.$eval('#viewerActions button[aria-label="Télécharger"]', b => { const s = b.querySelector('svg'); const r = s && s.getBoundingClientRect(); return s ? { w: Math.round(r.width), h: Math.round(r.height), color: getComputedStyle(s).color } : null; });
      check(svg && svg.w === 22 && svg.h === 22 && svg.color === 'rgb(255, 255, 255)', 'icône de téléchargement dessinée, blanche comme les autres (' + JSON.stringify(svg) + ')');
      await page.screenshot({ path: path.join(OUT, '01-android-visionneuse.png') });
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await waitFiles(page, 1);
      let f = await lastFile(page);
      check(f.action === 'gallery' && f.name === 'SOHRI-20260404-180000.jpg' && f.type === 'image/jpeg', 'Télécharger → galerie, nom daté (' + f.action + ', ' + f.name + ')');
      check(sha(f.b64) === data.hashes.shibuya && f.size === data.sizes.shibuya, 'la photo transmise est exactement celle de l\'album');
      await page.waitForFunction(() => !document.getElementById('toast').hidden && /galerie/.test(document.getElementById('toast').textContent));
      check((await page.textContent('#toast')) === 'Photo enregistrée dans la galerie (album SOHRI)', 'réponse d\'Android : « Photo enregistrée dans la galerie (album SOHRI) »');
      // Android 8 ou 9, autorisation refusée : expliqué, avec où la changer.
      await page.evaluate(() => { window.__bridge.refuse = 'permission'; });
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await page.waitForSelector('#dialog:not([hidden])');
      check(/n'a pas autorisé SOHRI/.test(await page.textContent('#dialogMessage')) && /Autorisations/.test(await page.textContent('#dialogMessage')), 'autorisation refusée : message clair (où la changer)');
      await page.click('#dialogOkBtn');
      await page.evaluate(() => { window.__bridge.refuse = ''; window.__bridge.finished.pop(); });
      await page.click('#viewerActions button[aria-label="Partager"]');
      await waitFiles(page, 2);
      f = await lastFile(page);
      check(f.action === 'share' && f.name === 'SOHRI-20260404-180000.jpg', 'Partager : inchangé');
      // Photo suivante (balayage) : c'est elle qui part.
      await page.evaluate(() => viewerShow(1, 1));
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await waitFiles(page, 3);
      check((await lastFile(page)).name === 'SOHRI-20260405-103000.jpg', 'après avoir changé de photo : la photo affichée part');
      await closeViewer(page);

      // Fiche d'une photo : la photo en grand a aussi les boutons.
      await page.evaluate(id => openView('photo', { local: id }), data.p1);
      await page.waitForSelector('#photoDetail .photo-detail-img');
      await page.click('#photoDetail .photo-detail-img');
      await viewerOpen(page);
      check(JSON.stringify(await buttons(page)) === JSON.stringify(['Télécharger', 'Partager']), 'fiche d\'une photo, en grand : Télécharger et Partager');
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await waitFiles(page, 4);
      f = await lastFile(page);
      check(f.action === 'gallery' && sha(f.b64) === data.hashes.shibuya, 'fiche : la photo part dans la galerie');
      await closeViewer(page);

      // Note : ses photos (dont une très ancienne, en texte data:) et une pièce jointe image.
      await page.evaluate(id => openView('note', { id }), data.note);
      await page.waitForSelector('#noteDetail .image-grid .image-cell');
      await page.click('#noteDetail .image-grid .image-cell >> nth=0');
      await viewerOpen(page);
      check(JSON.stringify(await buttons(page)) === JSON.stringify(['Télécharger', 'Partager']), 'photos d\'une note : Télécharger et Partager');
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await waitFiles(page, 5);
      f = await lastFile(page);
      check(f.action === 'gallery' && f.name === 'Kyoto _ temples-1.jpg' && sha(f.b64) === data.hashes.temple, 'photo de note → galerie, nommée d\'après la note (' + f.name + ')');
      await page.evaluate(() => viewerShow(1, 1));
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await waitFiles(page, 6);
      f = await lastFile(page);
      check(f.action === 'gallery' && f.name === 'Kyoto _ temples-2.png' && f.type === 'image/png' && f.size > 100, 'ancienne photo (data URL) : convertie en vraie image PNG (' + f.name + ', ' + f.size + ' o)');
      await closeViewer(page);
      await page.click('#noteDetail .attachment');
      await viewerOpen(page);
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await waitFiles(page, 7);
      f = await lastFile(page);
      check(f.action === 'gallery' && f.name === 'plan-metro.png' && sha(f.b64) === data.hashes.plan, 'pièce jointe image → galerie, avec son nom (' + f.name + ')');
      await closeViewer(page);

      // Photos d'un proche : reçue en grand → galerie ; pas encore reçue (hors compte) → message, rien n'est envoyé.
      await page.evaluate(() => openView('shared-album', { owner: 'mom', album: 'mom/a1' }));
      await page.waitForFunction(() => document.querySelectorAll('#sharedPhotoGrid .photo-cell').length === 2);
      await page.click('#sharedPhotoGrid .photo-cell >> nth=0');
      await viewerOpen(page);
      check(JSON.stringify(await buttons(page)) === JSON.stringify(['Télécharger', 'Partager']), 'photos d\'un proche : Télécharger et Partager');
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await waitFiles(page, 8);
      f = await lastFile(page);
      check(f.action === 'gallery' && f.name === 'SOHRI-20260404-180000.jpg' && sha(f.b64) === data.hashes.mom, 'photo d\'un proche → galerie');
      await page.evaluate(() => viewerShow(1, 1));
      const before = await fileCount(page);
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      const notYet = await page.waitForFunction(() => /pas encore reçue/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).then(() => true, () => false);
      check(notYet && await fileCount(page) === before, 'photo d\'un proche pas encore reçue : message « pas encore reçue », rien n\'est envoyé');
      await closeViewer(page);
      // Tout l'album du proche (bouton en haut) : celles reçues en grand (l'autre attend la connexion).
      check(await page.$eval('#topActions button[aria-label="Télécharger tout l\'album dans la galerie"]', b => !!b.querySelector('svg')), 'album d\'un proche : bouton « Télécharger tout l\'album »');
      let count = await fileCount(page);
      await page.click('#topActions button[aria-label="Télécharger tout l\'album dans la galerie"]');
      await waitFiles(page, count + 1);
      await page.waitForFunction(() => /galerie/.test(document.getElementById('toast').textContent));
      check(await fileCount(page) === count + 1 && (await lastFile(page)).action === 'gallery', 'tout l\'album du proche : la photo reçue part dans la galerie');

      // Plusieurs photos d'un coup : mode sélection d'un album, « Tout », puis ⬇.
      await page.evaluate(id => openView('album', { id }), data.album);
      await page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 2);
      await page.evaluate(() => startPhotoSelection());
      check(await page.$eval('#topActions button[aria-label="Télécharger dans la galerie"]', b => !!b.querySelector('svg')), 'mode sélection : bouton ⬇ en haut, à côté de « Tout »');
      await page.click('#topActions button[aria-label="Tout sélectionner"]');
      await page.screenshot({ path: path.join(OUT, '03-android-selection.png') });
      count = await fileCount(page);
      await page.click('#topActions button[aria-label="Télécharger dans la galerie"]');
      await waitFiles(page, count + 2);
      await page.waitForFunction(() => /2 photos enregistrées/.test(document.getElementById('toast').textContent));
      const pair = await page.evaluate(() => window.__bridge.finished.slice(-2).map(f => f.action + ':' + f.name).join(' '));
      check(pair === 'gallery:SOHRI-20260404-180000.jpg gallery:SOHRI-20260405-103000.jpg', 'sélection : les 2 photos partent dans la galerie, une à une (' + pair + ')');
      check((await page.textContent('#toast')) === '2 photos enregistrées dans la galerie (album SOHRI)' && await page.evaluate(() => !isSelectingPhotos()), '« 2 photos enregistrées dans la galerie », et fin de la sélection');
      check(page.errors.length === 0, 'Android : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await browser.close();
    }

    // ---------- iPhone : feuille de partage, explication la première fois ----------
    {
      const { browser, page } = await newPhone('iphone');
      await page.goto(url);
      await ready(page);
      check(await page.evaluate(() => IS_IOS), 'iPhone reconnu');
      const data = await page.evaluate(SETUP);
      await openAlbum(page, data);
      check(JSON.stringify(await buttons(page)) === JSON.stringify(['Télécharger', 'Partager', 'Supprimer']), 'iPhone, album : Télécharger, Partager, Supprimer');
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await page.waitForSelector('#dialog:not([hidden])');
      const hint = (await page.textContent('#dialog')).replace(/\s+/g, ' ');
      check(/Télécharger la photo/.test(hint) && /Enregistrer l.image/.test(hint) && /Photos/.test(hint) && (await page.textContent('#dialogOkBtn')).trim() === 'Continuer',
        'première fois : explication (« Enregistrer l\'image » → Photos), bouton Continuer');
      await page.screenshot({ path: path.join(OUT, '02-iphone-explication.png') });
      check(await page.evaluate(() => window.__shared.length) === 0, '… la feuille de partage attend le toucher sur Continuer');
      await page.click('#dialogOkBtn');
      await page.waitForFunction(() => window.__shared.length === 1);
      check(await page.evaluate(() => window.__shared[0].join()) === 'SOHRI-20260404-180000.jpg|image/jpeg|' + data.sizes.shibuya, 'Continuer : feuille de partage avec la photo (nom daté, JPEG)');
      await page.click('#viewerActions button[aria-label="Télécharger"]');
      await page.waitForFunction(() => window.__shared.length === 2);
      check(await page.evaluate(() => document.getElementById('dialog').hidden), 'les fois suivantes : directement la feuille de partage, sans explication');
      await page.click('#viewerActions button[aria-label="Partager"]');
      await page.waitForFunction(() => window.__shared.length === 3);
      check(true, 'Partager : feuille de partage');
      await closeViewer(page);
      // Plusieurs photos : une seule feuille de partage (« Enregistrer 2 images »).
      await page.evaluate(() => startPhotoSelection());
      await page.click('#topActions button[aria-label="Tout sélectionner"]');
      await page.click('#topActions button[aria-label="Télécharger dans la galerie"]');
      await page.waitForFunction(() => window.__shared.length === 4);
      check(await page.evaluate(() => window.__shared[3].length) === 2, 'iPhone, sélection : les 2 photos dans une même feuille de partage');
      check(page.errors.length === 0, 'iPhone : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await browser.close();
    }

    // ---------- Ordinateur (ou navigateur Android) : téléchargement du fichier ----------
    {
      const { browser, page } = await newPhone('desktop');
      await page.goto(url);
      await ready(page);
      const data = await page.evaluate(SETUP);
      await openAlbum(page, data);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#viewerActions button[aria-label="Télécharger"]')]);
      const saved = path.join(OUT, 'telechargement.jpg');
      await download.saveAs(saved);
      const bytes = fs.readFileSync(saved);
      check(download.suggestedFilename() === 'SOHRI-20260404-180000.jpg' && crypto.createHash('sha256').update(bytes).digest('hex') === data.hashes.shibuya,
        'ordinateur : fichier téléchargé, identique (' + download.suggestedFilename() + ', ' + bytes.length + ' o)');
      await page.waitForFunction(() => !document.getElementById('toast').hidden);
      check(/Photo téléchargée/.test(await page.textContent('#toast')), 'message « Photo téléchargée »');
      await closeViewer(page);
      await page.evaluate(() => startPhotoSelection());
      await page.click('#topActions button[aria-label="Tout sélectionner"]');
      const names = [];
      page.on('download', d => names.push(d.suggestedFilename()));
      await page.click('#topActions button[aria-label="Télécharger dans la galerie"]');
      await page.waitForFunction(() => /2 photos téléchargées/.test(document.getElementById('toast').textContent));
      for (let i = 0; i < 20 && names.length < 2; i++) await page.waitForTimeout(100);
      check(names.sort().join(' ') === 'SOHRI-20260404-180000.jpg SOHRI-20260405-103000.jpg', 'ordinateur, sélection : les 2 fichiers téléchargés (' + names.join(', ') + ')');
      check(page.errors.length === 0, 'ordinateur : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await browser.close();
    }
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
