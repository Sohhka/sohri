// Toutes mes rubriques, les mêmes sur mes appareils : A (iPhone, version web) et B (appli Android)
// connectés au même compte, « Synchroniser toutes mes rubriques » activé. Notes (photos, pièces
// jointes), adresses, dossiers, documents : fusion sans perte, changements dans les deux sens,
// conflits, suppressions, fichiers partagés envoyés une fois, fichier trop gros, élément redemandé,
// ménage des fichiers inutiles, déconnexion / reconnexion, arrêt. Images comprises (sans partage).
// Usage : node 13-rubriques-appareils.js <www> <sorties>
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
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}
async function adminList(pathName) {
  let all = [];
  let token = null;
  do {
    const page = await admin('GET', pathName + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    all = all.concat(page.documents || []);
    token = page.nextPageToken;
  } while (token);
  return all;
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
        openExternal: () => {}, copyText: () => {}, getAppVersion: () => '2.1', shareText: () => {},
        fileBegin: () => 'f', fileAppend: () => {}, fileFinish: () => {}
      };
    }
  }, [EMULATOR_CONFIG, android]);
  const page = context.pages()[0] || await context.newPage();
  page.errors = [];
  page.warnings = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR|Could not connect|Load failed/.test(m.text())) page.errors.push('console.error: ' + m.text());
    if (m.type() === 'warning') page.warnings.push(m.text());
  });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  return { context, page };
}

const norm = s => (s || '').replace(/\s/g, ' ').trim();
const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
// Fin de la synchronisation (réussie ou non) : son état.
const settled = (page, timeout = 180000) => page.waitForFunction(() => cloudStatus.state !== 'syncing' && !cloudSyncRunning, null, { timeout })
  .then(() => page.evaluate(() => cloudStatus.state + (cloudStatus.error ? ' : ' + cloudErrorText(cloudStatus.error) : '')));
const syncNowAndWait = page => page.evaluate(() => { clearTimeout(cloudPublishTimer); return syncNow(); }).then(() => settled(page));
async function goTo(page, section) { await page.evaluate(s => goToSection(s), section); await page.waitForTimeout(150); }
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
  await page.click('#accountForm button[type="submit"]');
  await page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await settled(page);
}
async function signIn(page, email, password) {
  await goTo(page, 'sharing');
  await page.click('#sharingContent button:has-text("J\'ai déjà un compte")');
  await page.fill('#accEmail', email);
  await page.fill('#accPassword', password);
  await page.click('#accountForm button[type="submit"]');
  await page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  return settled(page);
}
async function signOut(page) {
  await goTo(page, 'sharing');
  await page.click('#sharingContent .sign-out-btn');
  await dialogOk(page);
  await page.waitForSelector('#sharingContent button:has-text("Créer un compte")');
}

// Images de test (JPEG) et fichiers, en base64 (fabriqués dans la page).
async function makeJpegs(page, labels, size = 800) {
  return page.evaluate(async ([labels, size]) => {
    const out = [];
    for (let n = 0; n < labels.length; n++) {
      const c = document.createElement('canvas');
      c.width = size; c.height = Math.round(size * 0.75);
      const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + (n * 67 + labels[n].length * 13) + ',60%,45%)'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(size / 8) + 'px sans-serif'; g.fillText(labels[n], size / 10, size / 2.5);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push(btoa(bin));
    }
    return out;
  }, [labels, size]);
}
const b64 = text => Buffer.from(text, 'utf8').toString('base64');

// Dans la page : création directe d'éléments (comme le feraient les écrans).
const PAGE_HELPERS = () => {
  window.t13 = {
    blob: (b64, type) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    },
    folder: async (kind, name) => {
      const now = Date.now();
      await new Promise(r => setTimeout(r, 3));
      return dbPut('folders', { kind, name, icon: kind === 'notes' ? '🗼' : '🎫', createdAt: now });
    },
    address: async (title, extra) => {
      const now = Date.now();
      await new Promise(r => setTimeout(r, 3));
      return dbPut('addresses', Object.assign({ category: 'hebergement', title, address: '1-2-3 Shinjuku, Tokyo', addressJa: '東京都新宿区1-2-3', phone: '+81 3 1234 5678', website: '', description: 'Check-in à 15 h', attachments: [], createdAt: now, updatedAt: now }, extra || {}));
    },
    note: async (f) => {
      const now = f.createdAt || Date.now();
      await new Promise(r => setTimeout(r, 3));
      return dbPut('notes', {
        title: f.title, body: f.body || '', icon: f.icon || '📝', folderId: f.folderId || null, addressId: f.addressId || null, pinned: !!f.pinned,
        images: (f.images || []).map(b => t13.blob(b, 'image/jpeg')),
        attachments: (f.attachments || []).map((a, i) => { const blob = t13.blob(a.b64, a.type); return { id: 'att' + now.toString(36) + i, name: a.name, type: a.type, size: blob.size, blob }; }),
        createdAt: now, updatedAt: f.updatedAt || now
      });
    },
    document: async (name, type, content, folderId, thumbB64) => {
      const now = Date.now();
      await new Promise(r => setTimeout(r, 3));
      const blob = typeof content === 'string' ? t13.blob(content, type) : content;
      await saveNewDocument({ folderId: folderId || null, name, type, size: blob.size, thumb: thumbB64 ? t13.blob(thumbB64, 'image/jpeg') : null, createdAt: now, updatedAt: now }, blob);
    },
    edit: async (store, find, change) => {
      const all = await dbGetAll(store);
      const record = all.find(find);
      if (!record) throw new Error('introuvable dans ' + store);
      change(record);
      await dbPut(store, record);
      return record.id;
    },
    hex: async blob => {
      const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
    },
    // Tout ce qu'a l'appareil (hors Images), lisible : « * » = venu d'un autre appareil.
    summary: async () => {
      const short = async blob => (await t13.hex(blob)).slice(0, 10);
      const folders = (await dbGetAll('folders')).filter(f => f.kind !== 'photos');
      const fname = id => (folders.find(f => f.id === id) || {}).name || '-';
      const addresses = await dbGetAll('addresses');
      const aname = id => (addresses.find(a => a.id === id) || {}).title || '-';
      const out = [];
      for (const f of folders) out.push('F ' + f.kind + ' ' + f.name + (f.fromAccount ? ' *' : ''));
      for (const a of addresses) out.push('A ' + a.title + ' | ' + a.description + ' | ' + a.addressJa + (a.fromAccount ? ' *' : ''));
      for (const n of await dbGetAll('notes')) {
        const imgs = [];
        for (const i of n.images || []) imgs.push(await short(i));
        const atts = [];
        for (const a of n.attachments || []) atts.push(a.name + '=' + await short(a.blob));
        out.push('N ' + n.title + ' | ' + n.body + ' | ' + fname(n.folderId) + ' | ' + aname(n.addressId) + ' | ' + imgs.join(',') + ' | ' + atts.join(',') + (n.pinned ? ' | 📌' : '') + (n.fromAccount ? ' *' : ''));
      }
      for (const e of await dbGetAll('expenses')) {
        out.push('E ' + (e.label || '-') + ' | ' + e.amount + ' ' + e.currency + ' | ' + e.category + ' | ' + e.rate + ' | ' + new Date(e.spentAt).toISOString() + (e.fromAccount ? ' *' : ''));
      }
      for (const d of await dbGetAll('documents')) {
        const file = d.fileId != null ? await dbGet('documentFiles', d.fileId) : null;
        out.push('D ' + d.name + ' | ' + fname(d.folderId) + ' | ' + (file ? await short(file.blob) : 'sans contenu') + ' | ' + (d.thumb ? 'miniature ' + await short(d.thumb) : 'sans miniature') + (d.fromAccount ? ' *' : ''));
      }
      return out.sort();
    }
  };
};
const summary = page => page.evaluate(() => t13.summary());
const plain = list => list.map(x => x.replace(/ \*$/, '')).sort();
const same = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
const show = list => '\n    ' + list.join('\n    ');
const liveItems = async uid => (await adminList('users/' + uid + '/items')).filter(d => !(d.fields.deleted && d.fields.deleted.booleanValue));
const countOf = async (uid, collection) => (await adminList('users/' + uid + '/' + collection)).length;
const itemData = doc => JSON.parse(doc.fields.data.stringValue);

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    await resetEmulators();
    const A = await newPhone('webkit');   // mon iPhone (version web)
    const B = await newPhone('chromium'); // mon autre téléphone (appli Android)
    for (const p of [A, B]) { await p.page.goto(url); await ready(p.page); await p.page.evaluate(PAGE_HELPERS); }

    // ---------- A, avant le compte : dossiers, adresse, note complète, documents, album ----------
    const [imgRamen, imgTemple, imgThumb, imgKyoto] = await makeJpegs(A.page, ['Ramen', 'Temple', 'PDF', 'Kyoto']);
    const pdf = b64('%PDF-1.4\n% faux PDF de test\n' + 'x'.repeat(200000));
    const A_ids = await A.page.evaluate(async ([imgRamen, imgTemple, pdf, imgThumb]) => {
      const tokyo = await t13.folder('notes', 'Tokyo');
      const billets = await t13.folder('documents', 'Billets');
      const hotel = await t13.address('Hôtel Shinjuku');
      const ramen = await t13.note({
        title: 'Ramen', body: '# Ichiran\n- [ ] goûter le tonkotsu', folderId: tokyo, addressId: hotel,
        images: [imgRamen, imgTemple], attachments: [{ name: 'menu.txt', type: 'text/plain', b64: btoa('Menu : tonkotsu 980 ¥') }]
      });
      await t13.note({ title: 'Liste de courses', body: 'Thé matcha' });
      await t13.document('billet-avion.pdf', 'application/pdf', pdf, billets, imgThumb);
      await t13.document('assurance.txt', 'text/plain', btoa('Assurance voyage n° 42'), null, null);
      const spent = Date.parse('2026-10-01T12:30:00Z');
      await dbPut('expenses', { amount: 980, currency: 'JPY', rate: 184.5, category: 'repas', label: 'Ichiran', spentAt: spent, createdAt: spent, updatedAt: spent });
      return { tokyo, billets, hotel, ramen };
    }, [imgRamen, imgTemple, pdf, imgThumb]);
    // Un album (Images), qui suivra aussi, sans être partagé avec personne.
    await A.page.evaluate(async img => {
      const album = await dbPut('folders', { kind: 'photos', name: 'Kyoto', createdAt: Date.now() });
      const blob = t13.blob(img, 'image/jpeg');
      await dbPut('photos', { albumId: album, blob, thumb: blob, width: 800, height: 600, name: 'Kyoto.jpg', takenAt: Date.now() - 86400000, createdAt: Date.now() });
    }, imgKyoto);
    const sumA0 = await summary(A.page);

    // ---------- A : compte, puis « Synchroniser toutes mes rubriques » (écran Partage) ----------
    await signUp(A.page, { name: 'Sohhka', email: 'sohhka@exemple.fr', password: 'voyage-japon-2026' });
    const uid = await A.page.evaluate(() => cloudSession.uid);
    check(await countOf(uid, 'items') === 0, 'compte créé : rien ne part tant que la synchronisation n\'est pas activée');
    await A.page.waitForSelector('#sharingContent .sync-all-row');
    check(norm(await A.page.textContent('#sharingContent')).includes('Mes appareils'), 'Partage : section « Mes appareils »');
    await A.page.screenshot({ path: path.join(OUT, '01-partage-avant.png') });
    await A.page.click('#sharingContent .sync-all-row .toggle');
    await A.page.waitForSelector('#dialog:not([hidden])');
    const question = norm(await A.page.textContent('#dialog'));
    check(/visibles de toi seul/.test(question) && /1 Go/.test(question), 'question avant d\'activer : ce qui part, pour qui, place disponible');
    const t0 = await A.page.evaluate(() => Date.now());
    await A.page.click('#dialogOkBtn');
    await A.page.waitForFunction(t0 => syncAllEnabled() && !cloudSyncRunning && (cloudStatus.lastSync > t0 || cloudStatus.state === 'error'), t0, { timeout: 180000 });
    const stateA1 = await settled(A.page);
    check(stateA1 === 'done', 'A : première synchronisation terminée (' + stateA1 + ')');
    check(await A.page.isChecked('#sharingContent .sync-all-row .toggle'), 'interrupteur activé');
    await A.page.screenshot({ path: path.join(OUT, '02-partage-active.png') });
    const profileDoc = await admin('GET', 'users/' + uid);
    check(profileDoc.fields.syncAll && profileDoc.fields.syncAll.booleanValue === true, 'réglage enregistré sur le compte (vaut pour tous mes appareils)');
    const online1 = await liveItems(uid);
    const kinds1 = online1.map(d => d.fields.kind.stringValue).sort().join(',');
    check(kinds1 === 'address,document,document,expense,folder,folder,note,note', 'en ligne : 2 dossiers, 1 adresse, 2 notes, 2 documents, 1 dépense (' + kinds1 + ')');
    const blobs1 = await countOf(uid, 'blobs');
    check(blobs1 === 6, 'fichiers en ligne : 2 photos, 1 pièce jointe, 1 miniature, 2 contenus de documents (' + blobs1 + ')');
    const ramenDoc = online1.find(d => d.fields.kind.stringValue === 'note' && itemData(d).title === 'Ramen');
    const ramenData = ramenDoc && itemData(ramenDoc);
    check(ramenData && ramenData.folder && ramenData.address && ramenData.images.length === 2 && ramenData.attachments[0].blob.$blob.length === 64,
      'note en ligne : dossier et adresse par identifiant commun, photos et pièce jointe par empreinte');
    check(ramenData && !('id' in ramenData) && !('folderId' in ramenData) && !('fromAccount' in ramenData), 'rien de propre au téléphone n\'est envoyé (id, folderId…)');
    check((await countOf(uid, 'photos')) === 1, 'Images : la photo de l\'album part aussi (sans partage)');

    // ---------- B, avant connexion : ses propres éléments, dont deux déjà connus du compte ----------
    // (même sauvegarde restaurée sur les deux : même date de création). « Ramen » : plus ancienne ici ;
    // « Liste de courses » : plus récente ici.
    const createdOf = await A.page.evaluate(async () => {
      const notes = await dbGetAll('notes');
      return { ramen: notes.find(n => n.title === 'Ramen').createdAt, courses: notes.find(n => n.title === 'Liste de courses').createdAt };
    });
    const [imgChat] = await makeJpegs(B.page, ['Chat']);
    await B.page.evaluate(async ([created, imgChat]) => {
      const perso = await t13.folder('notes', 'Perso');
      await t13.note({ title: 'Mon chat', body: 'Croquettes', folderId: perso, images: [imgChat] });
      await t13.address('Chez Tanaka', { category: 'restaurant', description: 'Réserver' });
      await t13.note({ title: 'Ramen', body: 'ancienne version', createdAt: created.ramen, updatedAt: created.ramen - 1000 });
      await t13.note({ title: 'Liste de courses', body: 'Thé matcha, mochi', createdAt: created.courses, updatedAt: Date.now() + 1000 });
    }, [createdOf, imgChat]);
    const stateB1 = await signIn(B.page, 'sohhka@exemple.fr', 'voyage-japon-2026');
    check(stateB1 === 'done', 'B se connecte : synchronisation terminée (' + stateB1 + ')');
    check(await B.page.evaluate(() => syncAllEnabled()), 'B : synchronisation activée d\'office (réglage du compte)');
    const stateA2 = await syncNowAndWait(A.page);
    check(stateA2 === 'done', 'A : synchronisation terminée (' + stateA2 + ')');
    const sumA = await summary(A.page);
    const sumB = await summary(B.page);
    check(same(sumA, sumB), 'A et B ont exactement les mêmes rubriques :' + show(sumA) + (same(sumA, sumB) ? '' : '\n  B :' + show(sumB)));
    check(sumB.some(l => /^N Ramen \| # Ichiran/.test(l)) && !sumB.some(l => /ancienne version/.test(l)), 'même note des deux côtés : la version la plus récente (A) gagne');
    check(sumA.some(l => /^N Liste de courses \| Thé matcha, mochi/.test(l)), '… et l\'inverse (B plus récent) : B gagne partout');
    check(sumB.some(l => /^N Ramen [\s\S]* \| Tokyo \| Hôtel Shinjuku \| \w+,\w+ \| menu.txt=\w+$/.test(l)), 'B : la note de A garde dossier, adresse, 2 photos et pièce jointe');
    check(sumB.some(l => /^D billet-avion.pdf \| Billets \| \w+ \| miniature \w+ \*$/.test(l)), 'B : document de A avec son dossier, son contenu et sa miniature');
    check(sumA.some(l => /^N Mon chat \| Croquettes \| Perso \| - \| \w+ \|  \*$/.test(l)), 'A : la note de B, avec sa photo et son dossier');
    const sameBytes = await Promise.all([A.page, B.page].map(p => p.evaluate(async () => {
      const doc = (await dbGetAll('documents')).find(d => d.name === 'billet-avion.pdf');
      const file = await dbGet('documentFiles', doc.fileId);
      return { hash: await t13.hex(file.blob), size: file.blob.size, type: file.blob.type, recorded: doc.size };
    })));
    check(sameBytes[0].hash === sameBytes[1].hash && sameBytes[1].size === sameBytes[1].recorded && sameBytes[1].type === 'application/pdf', 'contenu du document identique à l\'octet près (' + JSON.stringify(sameBytes[1]) + ')');
    const kyotoOnB = await B.page.evaluate(async () => (await dbGetAll('folders')).some(f => f.kind === 'photos' && f.name === 'Kyoto' && f.fromAccount) && (await dbGetAll('photos')).length === 1);
    check(kyotoOnB, 'Images : l\'album de A arrive sur B (sans partage)');
    const online2 = await liveItems(uid);
    check(online2.length === 11, 'en ligne : 11 éléments, sans doublon (' + online2.length + ')');
    check(sumB.some(l => l === 'E Ichiran | 980 JPY | repas | 184.5 | 2026-10-01T12:30:00.000Z *'), 'B : la dépense de A, avec son taux et sa date');

    // ---------- Affichage sur l'iPhone (A) : note venue de B, photo lisible ----------
    await A.page.evaluate(async () => { const n = (await dbGetAll('notes')).find(x => x.title === 'Mon chat'); openView('note', { id: n.id }); });
    await A.page.waitForFunction(() => { const i = document.querySelector('#noteDetail .image-grid img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
    check(true, 'A (Safari) : la photo de la note venue de B s\'affiche');
    await A.page.screenshot({ path: path.join(OUT, '03-A-note-de-B.png') });
    const texts = await Promise.all([A.page, B.page].map(p => p.evaluate(async () => {
      const d = (await dbGetAll('documents')).find(x => x.name === 'assurance.txt');
      return loadDocument(d).then(full => full.blob.text());
    })));
    check(texts[1] === texts[0] && /^Assurance voyage/.test(texts[1]), 'B : le texte du document venu de A est intact (' + texts[1] + ')');

    // ---------- Changements des deux côtés ; B regarde la liste des notes ----------
    await goTo(B.page, 'notes');
    await A.page.evaluate(async () => {
      await t13.edit('notes', n => n.title === 'Ramen', n => { n.body = '# Ichiran\n- [x] goûter le tonkotsu'; n.updatedAt = Date.now(); });
      await t13.note({ title: 'Nouvelle de A', body: 'Écrite sur l\'iPhone' });
    });
    await B.page.evaluate(async () => {
      await t13.edit('folders', f => f.name === 'Tokyo', f => { f.name = 'Tokyo 2026'; f.updatedAt = Date.now(); });
      const billets = (await dbGetAll('folders')).find(f => f.name === 'Billets');
      await t13.edit('documents', d => d.name === 'assurance.txt', d => { d.folderId = billets.id; d.name = 'assurance-voyage.txt'; d.updatedAt = Date.now(); });
      await t13.edit('addresses', a => a.title === 'Chez Tanaka', a => { a.description = 'Réserver la veille'; a.updatedAt = Date.now(); });
      await t13.edit('expenses', e => e.label === 'Ichiran', e => { e.amount = 1180; e.category = 'shopping'; e.updatedAt = Date.now(); });
    });
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await syncNowAndWait(A.page);
    const sumA3 = await summary(A.page);
    const sumB3 = await summary(B.page);
    check(same(sumA3, sumB3), 'après les changements des deux côtés : identiques' + (same(sumA3, sumB3) ? '' : show(sumA3) + '\n  B :' + show(sumB3)));
    check(sumA3.some(l => /^N Ramen \| # Ichiran\n- \[x\]/.test(l)) && sumA3.some(l => /^N Ramen [\s\S]* \| Tokyo 2026 \| Hôtel Shinjuku/.test(l)),
      'note modifiée sur A, son dossier renommé sur B : les deux changements partout');
    check(sumA3.some(l => /^D assurance-voyage.txt \| Billets/.test(l)), 'document renommé et déplacé sur B : suivi sur A');
    check(sumA3.some(l => /^A Chez Tanaka \| Réserver la veille/.test(l)), 'adresse modifiée sur B : suivie sur A');
    check(sumA3.some(l => /^E Ichiran \| 1180 JPY \| shopping \| 184.5 \|/.test(l)) && (await A.page.evaluate(async () => (await dbGetAll('expenses')).length)) === 1,
      'dépense modifiée sur B : suivie sur A (sans doublon)');
    const listed = await B.page.waitForFunction(() => /Nouvelle de A/.test(document.getElementById('notesContent').textContent), null, { timeout: 5000 }).then(() => true, () => false);
    check(listed && await B.page.evaluate(() => currentViewName() === 'notes'), 'B : la liste des notes affichée se met à jour toute seule (« Nouvelle de A »)');
    const renamedDocs = await B.page.evaluate(async () => (await dbGetAll('documents')).length);
    check(renamedDocs === 2, 'renommer un document ne le duplique pas (' + renamedDocs + ' documents)');
    check((await liveItems(uid)).length === 12, 'en ligne : 12 éléments (renommage et déplacement sans doublon)');

    // B était resté en 2.2 : il passait les dépenses reçues (type inconnu) sans les retenir, tout en
    // avançant son repère. Mis à jour en 2.3, il les relit une fois en entier.
    await B.page.evaluate(async () => {
      const e = (await dbGetAll('expenses')).find(x => x.label === 'Ichiran');
      const rid = itemRemoteId('expense', e);
      await dbWrite(['expenses', 'cloud'], tx => {
        tx.objectStore('expenses').delete(e.id);
        tx.objectStore('cloud').delete('ipub:' + rid);
        tx.objectStore('cloud').delete('ikinds');
      }, { remote: true });
    });
    const upgraded = await syncNowAndWait(B.page);
    const expensesOnB = await B.page.evaluate(async () => (await dbGetAll('expenses')).map(e => e.label + ' ' + e.amount + (e.fromAccount ? ' *' : '')).join());
    check(upgraded === 'done' && expensesOnB === 'Ichiran 1180 *', 'appareil mis à jour depuis la 2.2 : les dépenses déjà en ligne arrivent (' + expensesOnB + ')');
    check(await B.page.evaluate(() => cloudGet('ikinds')).then(k => k.join()) === 'address,document,expense,folder,note' && (await liveItems(uid)).length === 12,
      '… une seule fois (types connus notés), sans rien renvoyer');

    // ---------- Conflit : la même note modifiée des deux côtés : la plus récente gagne ----------
    await A.page.evaluate(() => t13.edit('notes', n => n.title === 'Nouvelle de A', n => { n.body = 'Version A'; n.updatedAt = Date.now(); }));
    await B.page.waitForTimeout(30);
    await B.page.evaluate(() => t13.edit('notes', n => n.title === 'Nouvelle de A', n => { n.body = 'Version B (plus récente)'; n.updatedAt = Date.now() + 5; }));
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await syncNowAndWait(A.page);
    const conflict = [await A.page.evaluate(async () => (await dbGetAll('notes')).find(n => n.title === 'Nouvelle de A').body),
      await B.page.evaluate(async () => (await dbGetAll('notes')).find(n => n.title === 'Nouvelle de A').body)];
    check(conflict[0] === 'Version B (plus récente)' && conflict[1] === conflict[0], 'conflit : la modification la plus récente gagne sur les deux appareils (' + conflict.join(' / ') + ')');

    // ---------- Envois simultanés : personne n'écrase ce qu'il n'a pas encore vu ----------
    const bodyOn = (page, title) => page.evaluate(async t => { const n = (await dbGetAll('notes')).find(x => x.title === t); return n ? n.body : null; }, title);
    const onlineBody = async title => { const d = (await liveItems(uid)).find(x => itemData(x).title === title); return d ? itemData(d).body : null; };
    // 1. A modifie (plus tôt), B modifie (plus tard) et envoie ; A envoie sans avoir relu : refusé.
    await A.page.evaluate(() => t13.edit('notes', n => n.title === 'Nouvelle de A', n => { n.body = 'Ancienne modif de A'; n.updatedAt = Date.now() - 60000; }));
    await B.page.evaluate(() => t13.edit('notes', n => n.title === 'Nouvelle de A', n => { n.body = 'Modif récente de B'; n.updatedAt = Date.now(); }));
    await syncNowAndWait(B.page);
    const race1 = await A.page.evaluate(() => { clearTimeout(cloudPublishTimer); return publishOwnItems(); });
    check(race1.conflicts === 1 && await onlineBody('Nouvelle de A') === 'Modif récente de B', 'A envoie sans avoir vu la modif de B : envoi refusé, rien d\'écrasé (' + JSON.stringify(race1.conflicts) + ')');
    await syncNowAndWait(A.page);
    check(await bodyOn(A.page, 'Nouvelle de A') === 'Modif récente de B' && await onlineBody('Nouvelle de A') === 'Modif récente de B', '… A relit, et la plus récente (B) l\'emporte');
    // 2. B modifie et envoie ; A supprime sans avoir relu : la suppression est refusée, la note revient sur A.
    await A.page.evaluate(() => t13.note({ title: 'Pense-bête', body: 'Adaptateur secteur' }));
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    await B.page.evaluate(() => t13.edit('notes', n => n.title === 'Pense-bête', n => { n.body = 'Adaptateur secteur, JR Pass'; n.updatedAt = Date.now(); }));
    await syncNowAndWait(B.page);
    await A.page.evaluate(async () => { const n = (await dbGetAll('notes')).find(x => x.title === 'Pense-bête'); await dbDelete('notes', n.id); clearTimeout(cloudPublishTimer); });
    const race2 = await A.page.evaluate(() => publishOwnItems());
    check(race2.conflicts === 1 && await onlineBody('Pense-bête') === 'Adaptateur secteur, JR Pass', 'A supprime une note que B vient de modifier (sans l\'avoir vu) : suppression refusée');
    await syncNowAndWait(A.page);
    check(await bodyOn(A.page, 'Pense-bête') === 'Adaptateur secteur, JR Pass', '… la note revient sur A, avec la modification de B');
    // 3. Même note créée des deux côtés (même date de création) : la plus récente l'emporte partout.
    const twin = await B.page.evaluate(async () => {
      const created = Date.now() - 5000;
      await t13.note({ title: 'Jumelle', body: 'Version B', createdAt: created, updatedAt: created });
      return created;
    });
    await syncNowAndWait(B.page);
    await A.page.evaluate(async created => { await t13.note({ title: 'Jumelle', body: 'Version A (plus récente)', createdAt: created, updatedAt: Date.now() }); clearTimeout(cloudPublishTimer); }, twin);
    const race3 = await A.page.evaluate(() => publishOwnItems());
    check(race3.conflicts === 1 && await onlineBody('Jumelle') === 'Version B', 'même note créée sur A sans avoir vu celle de B : envoi refusé');
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    check(await bodyOn(A.page, 'Jumelle') === 'Version A (plus récente)' && await bodyOn(B.page, 'Jumelle') === 'Version A (plus récente)' &&
      (await A.page.evaluate(async () => (await dbGetAll('notes')).filter(n => n.title === 'Jumelle').length)) === 1,
      '… relue, la plus récente (A) l\'emporte sur les deux appareils, sans doublon');
    // 4. Pendant une synchronisation normale : l'envoi refusé est relu et refait aussitôt.
    await A.page.evaluate(async () => {
      await t13.edit('notes', n => n.title === 'Jumelle', n => { n.body = 'Réécrite sur A'; n.updatedAt = Date.now(); });
      const rid = itemRemoteId('note', (await dbGetAll('notes')).find(n => n.title === 'Jumelle'));
      const entry = await cloudGet('ipub:' + rid);
      entry.time = '2020-01-01T00:00:00.000000Z'; // version en ligne mal connue
      await cloudPut('ipub:' + rid, entry);
    });
    const race4 = await syncNowAndWait(A.page);
    const pendingA = await A.page.evaluate(async () => (await dbGetAll('cloud')).filter(r => r.key.indexOf('ipend:') === 0).length);
    check(race4 === 'done' && pendingA === 0 && await onlineBody('Jumelle') === 'Réécrite sur A', 'envoi refusé en cours de synchronisation : relu et renvoyé aussitôt, sans message d\'erreur (' + race4 + ')');
    await syncNowAndWait(B.page);
    check(same(await summary(A.page), await summary(B.page)), 'après ces envois simultanés : A et B identiques');

    // ---------- Suppressions ----------
    await B.page.evaluate(async () => {
      const n = (await dbGetAll('notes')).find(x => x.title === 'Liste de courses');
      await dbDelete('notes', n.id);
      const e = (await dbGetAll('expenses')).find(x => x.label === 'Ichiran');
      await dbDelete('expenses', e.id);
    });
    // Supprimée sur A pendant que B la modifiait : la modification l'emporte (rien n'est perdu).
    await A.page.evaluate(async () => { const n = (await dbGetAll('notes')).find(x => x.title === 'Mon chat'); await dbDelete('notes', n.id); });
    await B.page.evaluate(() => t13.edit('notes', n => n.title === 'Mon chat', n => { n.body = 'Croquettes et pâtée'; n.updatedAt = Date.now(); }));
    await syncNowAndWait(B.page);
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    const sumA4 = await summary(A.page);
    const sumB4 = await summary(B.page);
    check(!sumA4.some(l => /Liste de courses/.test(l)), 'note supprimée sur B : supprimée sur A');
    check(!sumA4.some(l => /^E /.test(l)), 'dépense supprimée sur B : supprimée sur A');
    check(sumA4.some(l => /^N Mon chat \| Croquettes et pâtée/.test(l)) && sumB4.some(l => /^N Mon chat \| Croquettes et pâtée/.test(l)),
      'supprimée sur A mais modifiée sur B entre-temps : gardée partout, avec la modification');
    check(same(sumA4, sumB4), 'toujours identiques après les suppressions');
    // Adresse supprimée sur A : retirée de la note sur B aussi.
    await A.page.evaluate(async () => {
      const hotel = (await dbGetAll('addresses')).find(a => a.title === 'Hôtel Shinjuku');
      const notes = await dbChangedRecords('notes', n => { if (n.addressId !== hotel.id) return false; n.addressId = null; return true; });
      await dbWrite(['addresses', 'notes'], tx => { tx.objectStore('addresses').delete(hotel.id); notes.forEach(n => tx.objectStore('notes').put(n)); });
    });
    await syncNowAndWait(A.page);
    await syncNowAndWait(B.page);
    const sumB5 = await summary(B.page);
    check(!sumB5.some(l => /^A Hôtel Shinjuku/.test(l)) && sumB5.some(l => /^N Ramen [\s\S]* \| Tokyo 2026 \| - \|/.test(l)), 'adresse supprimée sur A : partie de B, et retirée de sa note');
    check(same(await summary(A.page), sumB5), 'identiques');

    // ---------- Même photo dans une autre note : envoyée une seule fois ; ancienne, sa date est rafraîchie ----------
    const ramenImageHash = await A.page.evaluate(async () => t13.hex((await dbGetAll('notes')).find(n => n.title === 'Ramen').images[0]));
    await admin('PATCH', 'users/' + uid + '/blobs/' + ramenImageHash + '?updateMask.fieldPaths=createdAt', { fields: { createdAt: { timestampValue: '2020-01-01T00:00:00Z' } } });
    const blobsBefore = await countOf(uid, 'blobs');
    await B.page.evaluate(async () => {
      const ramen = (await dbGetAll('notes')).find(n => n.title === 'Ramen');
      const copy = new Blob([await ramen.images[0].arrayBuffer()], { type: 'image/jpeg' });
      await dbPut('notes', { title: 'Souvenir', body: 'Même photo', icon: '📷', folderId: null, addressId: null, pinned: false, images: [copy], attachments: [], createdAt: Date.now(), updatedAt: Date.now() });
    });
    await syncNowAndWait(B.page);
    check(await countOf(uid, 'blobs') === blobsBefore, 'photo déjà en ligne réutilisée : pas renvoyée (' + blobsBefore + ' fichiers)');
    const touched = await admin('GET', 'users/' + uid + '/blobs/' + ramenImageHash);
    check(touched.fields && touched.fields.createdAt.timestampValue > '2025', 'fichier réutilisé : sa date est rafraîchie (protégé du ménage) : ' + (touched.fields && touched.fields.createdAt.timestampValue));

    // ---------- Élément qui ne vient pas (fichier manquant) : les autres arrivent, lui est redemandé ----------
    const [imgRare] = await makeJpegs(A.page, ['Rare']);
    await A.page.evaluate(async img => {
      await t13.note({ title: 'Photo rare', body: '', images: [img] });
      await t13.note({ title: 'Simple', body: 'Sans fichier' });
    }, imgRare);
    await syncNowAndWait(A.page);
    const rareHash = await A.page.evaluate(async () => t13.hex((await dbGetAll('notes')).find(n => n.title === 'Photo rare').images[0]));
    const rareMeta = await admin('GET', 'users/' + uid + '/blobs/' + rareHash);
    await admin('DELETE', 'users/' + uid + '/blobs/' + rareHash);
    const stateB6 = await syncNowAndWait(B.page);
    const b6 = await B.page.evaluate(async () => ({
      titles: (await dbGetAll('notes')).map(n => n.title),
      pending: (await dbGetAll('cloud')).filter(r => r.key.indexOf('ipend:') === 0).length
    }));
    check(stateB6 === 'done' && b6.titles.includes('Simple') && !b6.titles.includes('Photo rare') && b6.pending === 1,
      'fichier manquant en ligne : la note « Simple » arrive quand même, « Photo rare » est mise de côté (' + stateB6 + ', ' + b6.pending + ' en attente)');
    await admin('PATCH', 'users/' + uid + '/blobs/' + rareHash, { fields: rareMeta.fields });
    await syncNowAndWait(B.page);
    const b7 = await B.page.evaluate(async () => ({
      rare: (await dbGetAll('notes')).some(n => n.title === 'Photo rare' && n.images.length === 1),
      pending: (await dbGetAll('cloud')).filter(r => r.key.indexOf('ipend:') === 0).length
    }));
    check(b7.rare && b7.pending === 0, 'fichier de nouveau en ligne : la note mise de côté arrive à la synchronisation suivante');

    // ---------- Fichier trop gros (plus de 60 Mo) : reste sur cet appareil, signalé ----------
    await B.page.evaluate(async () => {
      const big = new Blob([new Uint8Array(61 * 1024 * 1024)], { type: 'video/mp4' });
      await t13.document('film-du-voyage.mp4', 'video/mp4', big, null, null);
    });
    const stateB8 = await syncNowAndWait(B.page);
    check(stateB8 === 'done', 'fichier trop gros : la synchronisation se termine normalement (' + stateB8 + ')');
    check(!(await liveItems(uid)).some(d => /film-du-voyage/.test(d.fields.data.stringValue)), 'il n\'est pas envoyé');
    await goTo(B.page, 'sharing');
    const hintB = norm(await B.page.textContent('#sharingContent'));
    check(/Trop gros.*film-du-voyage\.mp4/.test(hintB), 'Partage le signale : « Trop gros… film-du-voyage.mp4 »');
    await B.page.screenshot({ path: path.join(OUT, '04-B-trop-gros.png') });
    await B.page.evaluate(async () => {
      const d = (await dbGetAll('documents')).find(x => x.name === 'film-du-voyage.mp4');
      await dbWrite(['documents', 'documentFiles'], tx => { tx.objectStore('documents').delete(d.id); tx.objectStore('documentFiles').delete(d.fileId); });
    });
    await syncNowAndWait(B.page);
    check(!/Trop gros/.test(norm(await B.page.textContent('#sharingContent'))), 'supprimé : l\'avertissement disparaît');

    // ---------- Ménage des fichiers inutiles (une fois par jour) ----------
    await A.page.evaluate(async () => { const n = (await dbGetAll('notes')).find(x => x.title === 'Photo rare'); await dbDelete('notes', n.id); });
    await syncNowAndWait(A.page);
    check(!!(await admin('GET', 'users/' + uid + '/blobs/' + rareHash)).fields, 'note supprimée : son fichier reste d\'abord en ligne (moins d\'un jour)');
    await admin('PATCH', 'users/' + uid + '/blobs/' + rareHash + '?updateMask.fieldPaths=createdAt', { fields: { createdAt: { timestampValue: '2020-01-01T00:00:00Z' } } });
    const usedOld = await A.page.evaluate(async () => t13.hex((await dbGetAll('notes')).find(n => n.title === 'Ramen').images[1]));
    await admin('PATCH', 'users/' + uid + '/blobs/' + usedOld + '?updateMask.fieldPaths=createdAt', { fields: { createdAt: { timestampValue: '2020-01-01T00:00:00Z' } } });
    await A.page.evaluate(() => cloudPut('igc', 0));
    await syncNowAndWait(A.page);
    const gcGone = !(await admin('GET', 'users/' + uid + '/blobs/' + rareHash)).fields;
    const partsLeft = (await adminList('users/' + uid + '/blobParts')).filter(d => d.name.includes(rareHash)).length;
    check(gcGone && partsLeft === 0, 'ménage : le fichier devenu inutile et ses morceaux sont effacés');
    check(!!(await admin('GET', 'users/' + uid + '/blobs/' + usedOld)).fields, 'ménage : un fichier ancien mais encore utilisé est gardé');
    await syncNowAndWait(B.page);
    const stillOk = await B.page.evaluate(async () => (await dbGetAll('notes')).find(n => n.title === 'Ramen').images.length === 2);
    check(stillOk, 'B n\'a rien perdu après le ménage');

    // ---------- B se déconnecte : ce qui vient de A part, sauf une note modifiée pas encore envoyée ----------
    await B.page.evaluate(async () => {
      await t13.edit('notes', n => n.title === 'Simple', n => { n.body = 'Modifiée hors connexion'; n.updatedAt = Date.now(); });
      clearTimeout(cloudPublishTimer);
    });
    await signOut(B.page);
    const sumB9 = await summary(B.page);
    check(!sumB9.some(l => /Nouvelle de A|billet-avion|assurance-voyage|F documents Billets/.test(l)), 'déconnexion : les éléments venus de A quittent B' + show(sumB9));
    check(sumB9.some(l => /^N Mon chat/.test(l)) && sumB9.some(l => /^A Chez Tanaka/.test(l)) && sumB9.some(l => /^N Ramen/.test(l)), 'les éléments de B restent (dont sa note « Ramen », mise à jour par A)');
    check(sumB9.includes('F notes Tokyo 2026'), 'le dossier venu de A où B range une de ses notes reste aussi');
    check(sumB9.some(l => /^N Simple \| Modifiée hors connexion/.test(l)), 'la note venue de A, modifiée sur B et pas encore envoyée, reste (rien n\'est perdu)');
    check(await B.page.evaluate(async () => (await dbGetAll('photos')).length === 0), 'Images : la photo de A quitte B aussi');
    await syncNowAndWait(A.page);
    check((await summary(A.page)).some(l => /^N Ramen/.test(l)), 'A n\'a rien perdu');
    // Reconnexion : tout revient, sans doublon ; la modification faite hors connexion part.
    const stateB10 = await signIn(B.page, 'sohhka@exemple.fr', 'voyage-japon-2026');
    await syncNowAndWait(A.page);
    const sumA10 = await summary(A.page);
    const sumB10 = await summary(B.page);
    check(stateB10 === 'done' && same(sumA10, sumB10), 'reconnexion de B : tout revient, identique à A' + (same(sumA10, sumB10) ? '' : show(sumA10) + '\n  B :' + show(sumB10)));
    check(sumA10.some(l => /^N Simple \| Modifiée hors connexion/.test(l)), 'la modification faite sur B hors connexion arrive sur A');
    const titles = sumB10.filter(l => l.startsWith('N ')).map(l => l.split(' | ')[0]);
    check(titles.length === new Set(titles).size, 'aucun doublon sur B : ' + titles.join(', '));

    // ---------- Arrêt de la synchronisation (sur A) ----------
    await goTo(A.page, 'sharing');
    await A.page.click('#sharingContent .sync-all-row .toggle');
    await A.page.waitForSelector('#dialog:not([hidden])');
    check(/copie en ligne sera effacée/.test(norm(await A.page.textContent('#dialog'))), 'question avant d\'arrêter');
    await A.page.click('#dialogOkBtn');
    await A.page.waitForFunction(() => !cloudState.profile.syncAll && !syncAllStopping, null, { timeout: 60000 });
    await settled(A.page);
    const left = { items: await countOf(uid, 'items'), blobs: await countOf(uid, 'blobs'), parts: await countOf(uid, 'blobParts'), photos: await countOf(uid, 'photos') };
    check(left.items === 0 && left.blobs === 0 && left.parts === 0 && left.photos === 0, 'arrêt : plus rien en ligne (rubriques et Images non partagées) : ' + JSON.stringify(left));
    check(!(await A.page.isChecked('#sharingContent .sync-all-row .toggle')), 'interrupteur désactivé');
    const stateB11 = await syncNowAndWait(B.page);
    const b11 = await B.page.evaluate(async () => ({
      marked: (await dbGetAll('notes')).concat(await dbGetAll('documents'), await dbGetAll('addresses'), await dbGetAll('photos')).filter(x => x.fromAccount).length,
      state: (await dbGetAll('cloud')).filter(r => /^(ipub:|ipend:|iown|iready|pub:|pubReady)/.test(r.key)).length,
      enabled: syncAllEnabled()
    }));
    check(stateB11 === 'done' && !b11.enabled && b11.marked === 0 && b11.state === 0, 'B l\'apprend à sa synchronisation suivante : tout ce qui venait de A est à lui (' + JSON.stringify(b11) + ')');
    const sumA12 = await summary(A.page);
    const sumB12 = await summary(B.page);
    check(same(sumA12, sumB12) && sumA12.length === sumA10.length, 'chaque appareil garde tout (' + sumA12.length + ' éléments)');
    await signOut(B.page);
    check((await summary(B.page)).length === sumB12.length, 'synchronisation arrêtée : se déconnecter ne retire plus rien de B');
    check(sumA0.length > 0, 'départ : ' + sumA0.length + ' éléments sur A');

    for (const [who, p] of [['A', A.page], ['B', B.page]]) {
      check(p.errors.length === 0, who + ' : aucune erreur' + (p.errors.length ? ' : ' + p.errors.slice(0, 3).join(' | ') : ''));
    }
    for (const p of [A, B]) await p.context.close();
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
