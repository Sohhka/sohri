// Images reçues et affichées sans « carré bleu » : un téléphone envoie, l'autre regarde l'album
// pendant la réception (connexion lente), dans les deux sens (iPhone ↔ Android) ; mes propres
// photos après une modification de description (Safari) ; réparation d'une image illisible.
// Usage : node 08-images.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const SPEED = 190; // octets par milliseconde (~1,5 Mbit/s)
const CHROME = require("./lib/chrome");
const PROJECT = 'demo-sohri';
const EMULATOR_CONFIG = { apiKey: 'demo-key', projectId: PROJECT, emulator: { auth: 'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8085' } };
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
let prefix = '';
function check(ok, msg) { results.push([!!ok, prefix + msg]); console.log((ok ? 'PASS ' : 'FAIL ') + prefix + msg); }

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
async function resetEmulators() {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
}

let profileCount = 0;
async function newPhone(engineName) {
  const android = engineName === 'chromium';
  const options = { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' };
  let context;
  if (engineName === 'webkit') {
    const dir = path.join(OUT, 'profiles', 'wk-' + (++profileCount));
    fs.rmSync(dir, { recursive: true, force: true });
    context = await webkit.launchPersistentContext(dir, options);
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

const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const synced = (page, timeout = 300000) => page.waitForFunction(() => cloudStatus.state === 'done' && !cloudSyncRunning, null, { timeout });
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
// Photos « d'appareil photo » (4032×3024, grain) : ~375 Ko une fois réduites, comme des vraies.
async function makePhotos(page, count) {
  return page.evaluate(async count => {
    const out = [];
    for (let n = 0; n < count; n++) {
      const c = document.createElement('canvas');
      c.width = 4032; c.height = 3024;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 4032, 3024);
      grad.addColorStop(0, 'hsl(' + (n * 47) + ',70%,55%)'); grad.addColorStop(1, 'hsl(' + (n * 47 + 120) + ',60%,35%)');
      g.fillStyle = grad; g.fillRect(0, 0, 4032, 3024);
      const img = g.getImageData(0, 0, 4032, 3024);
      let seed = n * 7919 + 1;
      for (let i = 0; i < img.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const d = (seed % 70) - 35;
        img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d;
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = '#fff'; g.font = 'bold 500px sans-serif'; g.fillText('#' + (n + 1), 300, 1700);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push(btoa(bin));
    }
    return out;
  }, count);
}
const file = (name, b64) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });

async function throttle(context) {
  await context.route(/127\.0\.0\.1:(8085|9099)/, async route => {
    const req = route.request();
    const up = (req.postDataBuffer() || Buffer.alloc(0)).length;
    let response;
    try { response = await route.fetch(); } catch (e) { return route.abort().catch(() => {}); }
    const body = await response.body();
    await sleep(120 + (up + body.length) / SPEED);
    await route.fulfill({ response, body }).catch(() => {});
  });
}

// État des vignettes d'une grille : affichées, cassées (icône visible), en réparation (masquées).
const GRID_STATE = selector => {
  const imgs = [...document.querySelectorAll(selector + ' .photo-cell img')];
  return {
    cells: imgs.length,
    ok: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
    brokenVisible: imgs.filter(i => i.complete && i.naturalWidth === 0 && !i.classList.contains('is-missing')).length,
    healing: imgs.filter(i => i.classList.contains('is-missing')).length
  };
};

// ---------- Un téléphone envoie 8 photos, l'autre les reçoit en regardant l'album ----------
async function sendAndReceive(senderEngine, receiverEngine, url) {
  prefix = `[${senderEngine} → ${receiverEngine}] `;
  await resetEmulators();
  const sender = await newPhone(senderEngine);
  const receiver = await newPhone(receiverEngine);
  await sender.page.goto(url);
  await receiver.page.goto(url);
  await ready(sender.page);
  await ready(receiver.page);
  await signUp(sender.page, { name: 'Envoyeur', email: 'envoi@exemple.fr', password: 'voyage-japon-2026' });
  const code = (await sender.page.textContent('#sharingContent .profile-code')).replace(/\s/g, ' ').trim();
  await signUp(receiver.page, { name: 'Receveur', email: 'recoit@exemple.fr', password: 'bisous-bisous', invite: code });

  const photos = await makePhotos(sender.page, 8);
  await goTo(sender.page, 'albums');
  await topAction(sender.page, 'Nouvel album');
  await dialogOk(sender.page, 'Tokyo');
  await sender.page.waitForFunction(() => document.getElementById('viewTitle').textContent.includes('Tokyo'));
  await sender.page.setInputFiles('#albumPhotos', photos.map((b, i) => file('IMG_' + i + '.jpg', b)));
  await sender.page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 8, null, { timeout: 120000 });
  await goTo(sender.page, 'sharing');
  await topAction(sender.page, 'Synchroniser');
  await synced(sender.page);
  await sender.page.click('#sharingContent .list-row:not(.sync-all-row):has-text("Images")');
  await sender.page.check('#shareCategoryContent .toggle-row:has-text("Receveur") .toggle');
  await sender.page.waitForSelector('#shareCategoryContent .source-card', { timeout: 20000 });
  await synced(sender.page);

  // Mouchard : écritures des photos reçues par la visionneuse et l'arrière-plan.
  await receiver.page.evaluate(() => {
    window.__downloadsSaved = {};
    const origPut = window.dbPut;
    window.dbPut = function (store, value) {
      if (store === 'sharedPhotos' && value.blob) window.__downloadsSaved[value.key] = (window.__downloadsSaved[value.key] || 0) + 1;
      return origPut.apply(this, arguments);
    };
  });
  await throttle(receiver.context);
  await goTo(receiver.page, 'sharing');
  const t0 = Date.now();
  receiver.page.evaluate(() => syncNow());
  await receiver.page.waitForFunction(() => cloudState.grantsToMe.length > 0, null, { timeout: 120000 });
  await receiver.page.evaluate(() => openView('shared-albums', { owner: cloudState.grantsToMe[0].owner }));
  await receiver.page.waitForSelector('#sharedAlbumGrid .album-card', { timeout: 120000 });
  await receiver.page.click('#sharedAlbumGrid .album-card');
  let opened = false;
  let brokenSeen = 0;
  let viewerBroken = 0;
  let viewerSizes = new Set();
  let infoTexts = new Set();
  while (Date.now() - t0 < 180000) {
    const s = await receiver.page.evaluate(GRID_STATE, '#sharedPhotoGrid');
    const v = await receiver.page.evaluate(() => {
      const img = document.getElementById('viewerImg');
      if (document.getElementById('viewer').hidden) return null;
      const st = document.getElementById('viewerStatus');
      return { complete: img.complete, w: img.naturalWidth, status: st && !st.hidden ? st.textContent : '' };
    });
    infoTexts.add(await receiver.page.evaluate(() => document.getElementById('sharedAlbumInfo').textContent));
    if (s.brokenVisible) {
      brokenSeen++;
      if (brokenSeen === 1) await receiver.page.screenshot({ path: path.join(OUT, `casse-${receiverEngine}.png`) });
    }
    if (v) {
      if (v.complete && v.w === 0 && !v.status) viewerBroken++;
      if (v.complete && v.w) viewerSizes.add(v.w);
    }
    if (!opened && s.cells >= 8 && (Date.now() - t0) > 4000) {
      opened = true;
      await receiver.page.click('#sharedPhotoGrid .photo-cell[data-index="7"]');
    }
    if (opened && v && (Date.now() - t0) > 20000) await receiver.page.click('#viewerCloseBtn');
    const done = await receiver.page.evaluate(() => cloudStatus.state === 'done' && !cloudSyncRunning);
    if (done && opened && !v && (Date.now() - t0) > 22000) break;
    await sleep(250);
  }
  await sleep(1500);
  const end = await receiver.page.evaluate(GRID_STATE, '#sharedPhotoGrid');
  check(end.cells === 8 && end.ok === 8, `les 8 vignettes s'affichent à la fin (${JSON.stringify(end)})`);
  check(brokenSeen === 0, `jamais d'icône d'image cassée dans la grille pendant la réception (${brokenSeen} relevés)`);
  check(viewerBroken === 0 && viewerSizes.has(1600), `visionneuse : aperçu puis photo en grand, jamais d'écran vide (${[...viewerSizes].join(', ')} px)`);
  const saved = await receiver.page.evaluate(() => window.__downloadsSaved);
  check(Object.keys(saved).length === 8 && Object.values(saved).every(n => n === 1), `chaque photo en grand n'est reçue et enregistrée qu'une fois (${Object.values(saved).join(',')})`);
  const finalInfo = await receiver.page.textContent('#sharedAlbumInfo');
  check([...infoTexts].some(t => /encore à recevoir/.test(t)) && /Tout est enregistré/.test(finalInfo), 'décompte « encore à recevoir » tenu à jour, puis « tout est enregistré » (' + [...infoTexts].join(' | ') + ')');
  const stored = await receiver.page.evaluate(async () => {
    const rows = await dbGetAll('sharedPhotos');
    const readable = async b => { try { return (await b.arrayBuffer()).byteLength === b.size; } catch (e) { return false; } };
    let ok = 0;
    for (const r of rows) if (r.blob && await readable(r.blob) && await readable(r.thumb)) ok++;
    return { rows: rows.length, ok };
  });
  check(stored.rows === 8 && stored.ok === 8, `enregistrées sur le téléphone, lisibles (${JSON.stringify(stored)})`);

  if (process.env.OLD_CODE) { await sender.context.close(); await receiver.context.close(); return; }

  // Réparation : une vignette dont l'image devient illisible est relue dans la base.
  const healed = await receiver.page.evaluate(async () => {
    const img = document.querySelector('#sharedPhotoGrid .photo-cell img');
    const bad = URL.createObjectURL(new Blob(['pas une image'], { type: 'image/jpeg' }));
    img.src = bad;
    await new Promise(r => setTimeout(r, 300));
    const during = { hidden: img.classList.contains('is-missing') };
    await new Promise(r => setTimeout(r, 2500));
    return { during, after: img.complete && img.naturalWidth > 0, hiddenAfter: img.classList.contains('is-missing') };
  });
  check(healed.during.hidden && healed.after && !healed.hiddenAfter, 'vignette illisible : masquée (pas de carré bleu), puis relue et réaffichée ' + JSON.stringify(healed));

  // Visionneuse : photo illisible → message, puis photo relue.
  await receiver.page.click('#sharedPhotoGrid .photo-cell[data-index="2"]');
  await receiver.page.waitForSelector('#viewer:not([hidden])');
  await receiver.page.waitForFunction(() => document.getElementById('viewerImg').complete && document.getElementById('viewerImg').naturalWidth > 0);
  await receiver.page.evaluate(() => {
    viewerItems[viewerIndex] = new Blob(['pas une image'], { type: 'image/jpeg' });
    viewerShow(viewerIndex);
  });
  await receiver.page.waitForSelector('#viewerStatus:not([hidden])', { timeout: 5000 });
  const message = await receiver.page.textContent('#viewerStatus');
  await receiver.page.screenshot({ path: path.join(OUT, `visionneuse-chargement-${receiverEngine}.png`) });
  await receiver.page.waitForFunction(() => document.getElementById('viewerImg').complete && document.getElementById('viewerImg').naturalWidth === 1600 && document.getElementById('viewerStatus').hidden, null, { timeout: 8000 });
  check(/Chargement/.test(message), `visionneuse : « ${message} » au lieu d'un écran noir, puis la photo revient`);
  await receiver.page.click('#viewerCloseBtn');

  check(!receiver.page.errors.length && !sender.page.errors.length, 'aucune erreur ' + JSON.stringify(receiver.page.errors.concat(sender.page.errors).slice(0, 3)));
  await sender.context.close();
  await receiver.context.close();
}

// ---------- Safari : mes photos, description modifiée puis album réaffiché ----------
async function ownPhotosAfterEdit(url) {
  prefix = '[webkit, mes photos] ';
  const me = await newPhone('webkit');
  await me.page.goto(url);
  await ready(me.page);
  const photos = await makePhotos(me.page, 6);
  await goTo(me.page, 'albums');
  await topAction(me.page, 'Nouvel album');
  await dialogOk(me.page, 'Kyoto');
  await me.page.waitForFunction(() => document.getElementById('viewTitle').textContent.includes('Kyoto'));
  await me.page.setInputFiles('#albumPhotos', photos.map((b, i) => file('IMG_' + i + '.jpg', b)));
  await me.page.waitForFunction(() => document.querySelectorAll('#photoGrid .photo-cell').length === 6, null, { timeout: 120000 });
  // Grille affichée (images lues), puis description et lieu de chaque photo modifiés et
  // album réaffiché aussitôt : c'est ce qui cassait les vignettes sur iPhone.
  const r = await me.page.evaluate(async () => {
    await new Promise(res => setTimeout(res, 800));
    // Comme la fiche d'une photo : relue dans la base (loadPhotoDetail), puis enregistrée.
    for (const photo of albumPhotos.slice()) {
      const fresh = await dbGet('photos', photo.id);
      await setPhotoInfo(fresh, 'Temple ' + photo.id, 'Kyoto, Japon');
    }
    await renderAlbum({ id: currentAlbum.id });
    await new Promise(res => setTimeout(res, 800));
    const imgs = [...document.querySelectorAll('#photoGrid .photo-cell img')];
    const now = { ok: imgs.filter(i => i.complete && i.naturalWidth > 0).length, broken: imgs.filter(i => i.complete && i.naturalWidth === 0 && !i.classList.contains('is-missing')).length };
    const readable = async b => { try { return (await b.arrayBuffer()).byteLength === b.size; } catch (e) { return false; } };
    let handles = 0;
    for (const p of albumPhotos) if (await readable(p.blob) && await readable(p.thumb)) handles++;
    return { now, handles, captions: albumPhotos.filter(p => p.location === 'Kyoto, Japon').length };
  });
  check(r.captions === 6, 'descriptions et lieux enregistrés (' + r.captions + '/6)');
  check(r.now.ok === 6 && r.now.broken === 0, `album réaffiché juste après : les 6 vignettes s'affichent (${JSON.stringify(r.now)})`);
  check(r.handles === 6, `photos et miniatures relues aussitôt : toutes lisibles (${r.handles}/6)`);
  // Viewer sur la dernière photo modifiée
  await me.page.click('#photoGrid .photo-cell[data-index="5"]');
  await me.page.waitForFunction(() => document.getElementById('viewerImg').complete && document.getElementById('viewerImg').naturalWidth > 0, null, { timeout: 8000 });
  check(true, 'visionneuse : la photo modifiée s\'affiche');
  await me.page.click('#viewerCloseBtn');
  check(!me.page.errors.length, 'aucune erreur ' + JSON.stringify(me.page.errors.slice(0, 3)));
  await me.context.close();
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    const only = process.argv[4]; // « own » : seulement mes photos
    if (only !== 'own') {
      await sendAndReceive('chromium', 'webkit', url);  // maman (Android) → moi (iPhone)
      await sendAndReceive('webkit', 'chromium', url);  // moi (iPhone) → maman (Android)
    }
    await ownPhotosAfterEdit(url);
  } catch (e) {
    console.error(e);
    check(false, 'exception : ' + e.message.split('\n')[0]);
  }
  server.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} réussis`);
  if (failed.length) { console.log('ÉCHECS :'); failed.forEach(f => console.log(' - ' + f[1])); }
  process.exit(failed.length ? 1 : 0);
})();
