// Sauvegarde faite sur iPhone (WebKit, feuille de partage), restaurée sur Android (Chromium) :
// telle quelle, puis après les transformations d'un transfert (zip recompressé par l'iPhone...).
// Usage : node 12-sauvegardes.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require("./lib/chrome");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let prefix = '';
function check(ok, msg) { results.push([!!ok, prefix + msg]); console.log((ok ? 'PASS ' : 'FAIL ') + prefix + msg); }

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

// ---------- Zip « à la façon » d'autres outils, pour les transferts ----------
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// Lit un zip « stocké » (celui de SOHRI) : [{ name, data }].
function unzipStored(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    const size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, data: buf.slice(start, start + size) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
// Écrit un zip : options.deflate (compression), options.descriptor (tailles après les données,
// comme macOS / iOS), options.zip64 (fin de fichier ZIP64), options.folder (tout dans un dossier),
// options.macosx (fichiers « __MACOSX/._ » en plus).
function zipFiles(files, options = {}) {
  const parts = [], central = [];
  let offset = 0;
  const list = files.map(f => ({ name: (options.folder ? options.folder + '/' : '') + f.name, data: f.data }));
  if (options.folder) list.unshift({ name: options.folder + '/', data: Buffer.alloc(0) });
  if (options.macosx) list.push({ name: '__MACOSX/' + (options.folder ? options.folder + '/' : '') + '._sohri.json', data: Buffer.from('Mac OS X        ATTR') });
  for (const f of list) {
    const name = Buffer.from(f.name, 'utf8');
    const method = options.deflate && f.data.length ? 8 : 0;
    const body = method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const crc = crc32(f.data);
    const flags = 0x0800 | (options.descriptor ? 0x0008 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(options.descriptor ? 0 : crc, 14);
    local.writeUInt32LE(options.descriptor ? 0 : body.length, 18);
    local.writeUInt32LE(options.descriptor ? 0 : f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    let written = 30 + name.length + body.length;
    if (options.descriptor) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(body.length, 8); dd.writeUInt32LE(f.data.length, 12);
      parts.push(dd);
      written += 16;
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(0x031E, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(flags, 8); header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(body.length, 20); header.writeUInt32LE(f.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    let extra = Buffer.alloc(0);
    if (options.zip64) {
      // Tailles et position dans un champ ZIP64 (comme les gros zips) : 0xFFFFFFFF dans l'en-tête.
      header.writeUInt32LE(0xFFFFFFFF, 20); header.writeUInt32LE(0xFFFFFFFF, 24); header.writeUInt32LE(0xFFFFFFFF, 42);
      extra = Buffer.alloc(28);
      extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(f.data.length), 4); extra.writeBigUInt64LE(BigInt(body.length), 12); extra.writeBigUInt64LE(BigInt(offset), 20);
      header.writeUInt16LE(extra.length, 30);
    } else {
      header.writeUInt32LE(offset, 42);
    }
    central.push(header, name, extra);
    offset += written;
  }
  const cd = Buffer.concat(central);
  const tail = [];
  if (options.zip64) {
    const e64 = Buffer.alloc(56);
    e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeUInt16LE(45, 12); e64.writeUInt16LE(45, 14);
    e64.writeBigUInt64LE(BigInt(list.length), 24); e64.writeBigUInt64LE(BigInt(list.length), 32);
    e64.writeBigUInt64LE(BigInt(cd.length), 40); e64.writeBigUInt64LE(BigInt(offset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(offset + cd.length), 8); loc.writeUInt32LE(1, 16);
    tail.push(e64, loc);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64 ? 0xFFFF : list.length, 8); end.writeUInt16LE(options.zip64 ? 0xFFFF : list.length, 10);
  end.writeUInt32LE(options.zip64 ? 0xFFFFFFFF : cd.length, 12); end.writeUInt32LE(options.zip64 ? 0xFFFFFFFF : offset, 16);
  return Buffer.concat(parts.concat([cd], tail, [end]));
}

async function makeIphoneBackup(url) {
  const context = await webkit.launchPersistentContext(path.join(OUT, 'wk-profile-' + Date.now()), { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
  await blockExternal(context);
  // Feuille de partage de l'iPhone : on récupère le fichier qu'elle recevrait.
  await context.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = data => { window.__shared = data.files[0]; return Promise.resolve(); };
  });
  const page = context.pages()[0] || await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  // Contenu : un album de 3 photos (avec description et lieu), une note avec photo et pièce jointe, un document.
  await page.evaluate(async () => {
    const jpeg = (w, hgt, hue) => new Promise(r => {
      const c = document.createElement('canvas'); c.width = w; c.height = hgt;
      const g = c.getContext('2d'); g.fillStyle = 'hsl(' + hue + ',60%,50%)'; g.fillRect(0, 0, w, hgt);
      for (let i = 0; i < 300; i++) { g.fillStyle = 'hsl(' + (i * 13) + ',70%,50%)'; g.fillRect((i * 37) % w, (i * 53) % hgt, 30, 30); }
      c.toBlob(r, 'image/jpeg', 0.85);
    });
    const albumId = await dbPut('folders', { kind: 'photos', name: 'Tokyo', icon: '🗼', createdAt: Date.now() });
    for (let i = 0; i < 3; i++) {
      await dbPut('photos', { albumId, blob: await jpeg(2048, 1536, i * 90), thumb: await jpeg(400, 300, i * 90), width: 2048, height: 1536, name: 'IMG_' + i + '.jpg',
        takenAt: Date.now() - i * 3600000, createdAt: Date.now() + i, caption: i === 0 ? 'Shibuya la nuit 🌃' : '', location: i === 0 ? 'Tokyo, Japon' : '' });
    }
    await dbPut('notes', { title: 'Réservations', body: '- [x] Hôtel\n- [ ] Ryokan', images: [await jpeg(800, 600, 200)],
      attachments: [{ id: 'a1', name: 'billet.pdf', type: 'application/pdf', size: 12, blob: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }) }], createdAt: Date.now(), updatedAt: Date.now() });
    const fileId = await dbPut('documentFiles', { blob: new Blob(['Bonjour depuis l\'iPhone'], { type: 'text/plain' }) });
    await dbPut('documents', { name: 'mot.txt', type: 'text/plain', size: 23, fileId, folderId: null, createdAt: Date.now() });
  });
  await page.evaluate(() => goToSection('settings'));
  await page.click('#backupBtn');
  await page.waitForFunction(() => window.__shared, null, { timeout: 60000 });
  const shared = await page.evaluate(async () => {
    const f = window.__shared;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { name: f.name, type: f.type, b64: btoa(bin) };
  });
  await context.close();
  return { name: shared.name, type: shared.type, data: Buffer.from(shared.b64, 'base64'), errors };
}

// Contenu de test (même que sur l'iPhone), ajouté dans la page.
const FILL = async () => {
  const jpeg = (w, hgt, hue) => new Promise(r => {
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const g = c.getContext('2d'); g.fillStyle = 'hsl(' + hue + ',60%,50%)'; g.fillRect(0, 0, w, hgt);
    for (let i = 0; i < 300; i++) { g.fillStyle = 'hsl(' + (i * 13) + ',70%,50%)'; g.fillRect((i * 37) % w, (i * 53) % hgt, 30, 30); }
    c.toBlob(r, 'image/jpeg', 0.85);
  });
  const albumId = await dbPut('folders', { kind: 'photos', name: 'Tokyo', icon: '🗼', createdAt: Date.now() });
  for (let i = 0; i < 3; i++) {
    await dbPut('photos', { albumId, blob: await jpeg(2048, 1536, i * 90), thumb: await jpeg(400, 300, i * 90), width: 2048, height: 1536, name: 'IMG_' + i + '.jpg',
      takenAt: Date.now() - i * 3600000, createdAt: Date.now() + i, caption: i === 0 ? 'Shibuya la nuit 🌃' : '', location: i === 0 ? 'Tokyo, Japon' : '' });
  }
  await dbPut('notes', { title: 'Réservations', body: '- [x] Hôtel\n- [ ] Ryokan', images: [await jpeg(800, 600, 200)],
    attachments: [{ id: 'a1', name: 'billet.pdf', type: 'application/pdf', size: 12, blob: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }) }], createdAt: Date.now(), updatedAt: Date.now() });
  const fileId = await dbPut('documentFiles', { blob: new Blob(['Bonjour depuis l\'iPhone'], { type: 'text/plain' }) });
  await dbPut('documents', { name: 'mot.txt', type: 'text/plain', size: 23, fileId, folderId: null, createdAt: Date.now() });
};
// Pont Android simulé ; __saved : fichier que l'appli Android enregistrerait (morceaux en base64).
const FAKE_BRIDGE = () => {
  window.__saved = null;
  const pending = {};
  window.AndroidBridge = {
    isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
    openExternal: () => {}, copyText: () => {}, getAppVersion: () => '1.9', shareText: () => {},
    fileBegin: name => { pending.f = { name, chunks: [] }; return 'f'; },
    fileAppend: (id, chunk) => { pending.f.chunks.push(chunk); },
    fileFinish: () => { window.__saved = pending.f; }
  };
};

async function makeAndroidBackup(browser, url) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
  await blockExternal(context);
  await context.addInitScript(FAKE_BRIDGE);
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  await page.evaluate(FILL);
  await page.evaluate(() => goToSection('settings'));
  await page.click('#backupBtn');
  await page.waitForFunction(() => window.__saved, null, { timeout: 60000 });
  const saved = await page.evaluate(() => window.__saved);
  await context.close();
  return { name: saved.name, data: Buffer.concat(saved.chunks.map(c => Buffer.from(c, 'base64'))) };
}

async function restoreOnIphone(url, file, label) {
  const context = await webkit.launchPersistentContext(path.join(OUT, 'wk-restore-' + Date.now()), { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
  await blockExternal(context);
  const page = context.pages()[0] || await context.newPage();
  const result = await restoreIn(page, url, file, label);
  await context.close();
  return result;
}

async function restoreOnAndroid(browser, url, file, label) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
  await blockExternal(context);
  await context.addInitScript(FAKE_BRIDGE);
  const page = await context.newPage();
  const result = await restoreIn(page, url, file, label);
  await context.close();
  return result;
}

async function restoreIn(page, url, file, label) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  await page.evaluate(() => goToSection('settings'));
  const filePath = path.join(OUT, label.replace(/[^a-z0-9]+/gi, '-') + '.zip');
  fs.writeFileSync(filePath, file);
  await page.setInputFiles('#restoreInput', filePath);
  await page.waitForSelector('#dialog:not([hidden])', { timeout: 30000 });
  const message = (await page.textContent('#dialogMessage').catch(() => '')) || (await page.textContent('#dialog'));
  let restored = null;
  if (/Restaurer la sauvegarde/.test(message)) {
    await Promise.all([page.waitForEvent('load', { timeout: 60000 }), page.click('#dialogOkBtn')]);
    await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
    restored = await page.evaluate(async () => {
      const photos = await dbGetAll('photos');
      const notes = await dbGetAll('notes');
      const docs = await dbGetAll('documents');
      const readable = async b => { try { return (await b.arrayBuffer()).byteLength === b.size && b.size > 0; } catch (e) { return false; } };
      const decodes = b => new Promise(res => { const i = new Image(); const u = URL.createObjectURL(b); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = u; });
      let ok = 0;
      for (const p of photos) if (await readable(p.blob) && await readable(p.thumb) && await decodes(p.blob) === 2048) ok++;
      const file = docs[0] && await dbGet('documentFiles', docs[0].fileId);
      return {
        photos: photos.length, photosOk: ok, caption: (photos.find(p => p.caption) || {}).caption,
        note: notes[0] && notes[0].title, noteImage: notes[0] && await readable(notes[0].images[0]), attachment: notes[0] && await notes[0].attachments[0].blob.text(),
        doc: file && await file.blob.text()
      };
    });
  } else {
    await page.click('#dialogOkBtn').catch(() => {});
  }
  return { message: message.replace(/\s+/g, ' ').trim(), restored, errors };
}

function restoredOk(r) {
  return r.restored && r.restored.photos === 3 && r.restored.photosOk === 3 && r.restored.caption === 'Shibuya la nuit 🌃' && r.restored.note === 'Réservations'
    && r.restored.noteImage && r.restored.attachment === '%PDF-1.4 test' && r.restored.doc === 'Bonjour depuis l\'iPhone';
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    prefix = '[iPhone → Android] ';
    const backup = await makeIphoneBackup(url);
    check(/^SOHRI-sauvegarde-\d{4}-\d\d-\d\d\.zip$/.test(backup.name) && backup.data.length > 100000 && !backup.errors.length,
      `sauvegarde créée sur iPhone : ${backup.name}, ${Math.round(backup.data.length / 1024)} Ko, type « ${backup.type} »`);
    const browser = await chromium.launch({ executablePath: CHROME });
    const direct = await restoreOnAndroid(browser, url, backup.data, 'telle quelle');
    check(restoredOk(direct), 'fichier tel quel : restauré sur Android (' + (direct.restored ? JSON.stringify(direct.restored) : direct.message) + ')');

    // Transferts qui transforment le zip : l'iPhone qui le décompresse puis le recompresse (dossier,
    // compression, tailles après les données), un zip64, des fichiers « __MACOSX ».
    const files = unzipStored(backup.data);
    const variants = {
      'dossier recompressé par l\'iPhone': zipFiles(files, { deflate: true, descriptor: true, folder: backup.name.replace(/\.zip$/, '') }),
      'recompressé, avec __MACOSX': zipFiles(files, { deflate: true, descriptor: true, folder: backup.name.replace(/\.zip$/, ''), macosx: true }),
      'compressé sans dossier': zipFiles(files, { deflate: true }),
      'zip64': zipFiles(files, { zip64: true })
    };
    for (const [label, data] of Object.entries(variants)) {
      const r = await restoreOnAndroid(browser, url, data, label);
      check(restoredOk(r), label + ' : restauré (' + (r.restored ? 'ok' : r.message) + ')');
    }
    // Un fichier qui n'est vraiment pas une sauvegarde : message clair.
    const notBackup = await restoreOnAndroid(browser, url, zipFiles([{ name: 'photo.jpg', data: Buffer.from('xx') }]), 'autre zip');
    check(!notBackup.restored && /pas une sauvegarde SOHRI/.test(notBackup.message), 'autre zip : refusé avec un message (' + notBackup.message + ')');
    // Seulement sohri.json (sorti d'un zip décompressé) : on explique qu'il faut le .zip complet.
    const manifestOnly = await restoreOnAndroid(browser, url, files.find(f => f.name === 'sohri.json').data, 'sohri json seul');
    check(!manifestOnly.restored && /que la liste de la sauvegarde \(sohri\.json\)/.test(manifestOnly.message), 'sohri.json seul : « il faut le .zip complet » (' + manifestOnly.message + ')');

    // ---------- Sens inverse : sauvegarde faite sur Android, restaurée sur iPhone ----------
    prefix = '[Android → iPhone] ';
    const androidBackup = await makeAndroidBackup(browser, url);
    check(androidBackup.name && androidBackup.data.length > 100000, `sauvegarde créée sur Android : ${androidBackup.name}, ${Math.round(androidBackup.data.length / 1024)} Ko`);
    const onIphone = await restoreOnIphone(url, androidBackup.data, 'android tel quel');
    check(restoredOk(onIphone), 'restaurée sur iPhone (' + (onIphone.restored ? JSON.stringify(onIphone.restored).slice(0, 300) : onIphone.message) + ')');
    const recompressed = await restoreOnIphone(url, zipFiles(unzipStored(androidBackup.data), { deflate: true, descriptor: true, folder: 'SOHRI-sauvegarde' }), 'android recompresse');
    check(restoredOk(recompressed), 'recompressée en route, restaurée sur iPhone (' + (recompressed.restored ? 'ok' : recompressed.message) + ')');
    await browser.close();
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
