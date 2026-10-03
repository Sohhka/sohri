// Partager programme, carnet d'adresses, notes et documents avec un proche, en lecture seule :
// Sohhka (iPhone, version web) les partage avec Maman (appli Android). Synchronisation proposée au
// premier partage, réception chez Maman (copie gardée hors connexion), lieux du programme sans le
// carnet, modifications et suppressions suivies, partage retiré, dépenses jamais montrées.
// Usage : node 17-partage-rubriques.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require('./lib/block-external');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require('./lib/chrome');
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
async function adminList(pathName) {
  const r = await fetch(FS + '/' + pathName + '?pageSize=300', { headers: { Authorization: 'Bearer owner' } });
  return (await r.json()).documents || [];
}
async function resetEmulators() {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
}

async function newPhone(engineName) {
  const android = engineName === 'chromium';
  let context;
  if (engineName === 'webkit') {
    const dir = path.join(OUT, 'profil-iphone');
    fs.rmSync(dir, { recursive: true, force: true });
    context = await webkit.launchPersistentContext(dir, { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
  } else {
    const browser = await chromium.launch({ executablePath: CHROME });
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
    context.on('close', () => browser.close());
  }
  await blockExternal(context);
  await context.addInitScript(([config, android]) => {
    window.SOHRI_CLOUD = config;
    if (android) {
      const state = window.__bridge = { files: {}, finished: [], opened: [] };
      window.AndroidBridge = {
        isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
        openExternal: u => { state.opened.push(u); }, copyText: () => {}, getAppVersion: () => '2.3', shareText: () => {},
        fileBegin: (name, type) => { const id = 'f' + Object.keys(state.files).length; state.files[id] = { name, type }; return id; },
        fileAppend: () => {}, fileFinish: (id, action) => { state.finished.push({ action, name: state.files[id].name }); }
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

const norm = s => (s || '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();
const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const settled = (page, timeout = 180000) => page.waitForFunction(() => cloudStatus.state !== 'syncing' && !cloudSyncRunning, null, { timeout })
  .then(() => page.evaluate(() => cloudStatus.state + (cloudStatus.error ? ' : ' + cloudErrorText(cloudStatus.error) : '')));
const syncNowAndWait = page => page.evaluate(() => { clearTimeout(cloudPublishTimer); return syncNow(); }).then(() => settled(page));
const goTo = (page, section) => page.evaluate(s => goToSection(s), section).then(() => page.waitForTimeout(200));
const text = (page, sel) => page.textContent(sel).then(norm);
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent.replace(/\s/g, ' ')); }, [sel, re.source], { timeout: timeout || 10000 }).then(() => true, () => false);
async function dialogOk(page) { await page.waitForSelector('#dialog:not([hidden])'); await page.click('#dialogOkBtn'); }
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
  await settled(page);
}
/* Partage → Ce que je partage → rubrique → interrupteur du proche. */
async function setShare(page, label, who, on) {
  await goTo(page, 'sharing');
  await page.click('#sharingContent .list-row:has-text("' + label + '"):not(.sync-all-row)');
  await page.waitForSelector('#shareCategoryContent .toggle-row');
  const toggle = '#shareCategoryContent .toggle-row:has-text("' + who + '") .toggle';
  if (await page.isChecked(toggle) !== on) await page.click(toggle);
}
const sharedKinds = page => page.evaluate(async () => (await dbGetAll('sharedItems')).map(i => i.kind).sort().join(','));

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    await resetEmulators();
    const me = await newPhone('webkit');     // Sohhka (iPhone)
    const mom = await newPhone('chromium');  // Maman (appli Android)
    for (const p of [me, mom]) { await p.page.goto(url); await ready(p.page); }
    const A = me.page;
    const M = mom.page;

    // ---------- Sohhka : son voyage (sans compte pour l'instant) ----------
    await A.evaluate(async () => {
      const blob = (text, type) => new Blob([text], { type });
      const now = Date.now();
      const hotel = await dbPut('addresses', { category: 'hebergement', title: 'Hôtel Gracery', address: '1-19-1 Kabukicho, Shinjuku, Tokyo', addressJa: '東京都新宿区歌舞伎町1-19-1', phone: '+81 3-6833-2489', website: '', description: 'Check-in à **15 h**', attachments: [], createdAt: now, updatedAt: now });
      const voucher = blob('Bon de réservation Gracery n° 4242', 'text/plain');
      await dbPut('schedule', { date: '2026-10-15', time: '15:00', endTime: '', title: 'Check-in', type: 'hebergement', addressId: hotel, notes: 'Chambre au 12e', attachments: [{ id: 'a1', name: 'reservation.txt', type: 'text/plain', size: voucher.size, blob: voucher }], createdAt: now + 1, updatedAt: now + 1 });
      await dbPut('schedule', { date: '2026-10-16', time: '', endTime: '', title: 'Journée à Nikko', type: 'activite', addressId: null, notes: '', attachments: [], createdAt: now + 2, updatedAt: now + 2 });
      const tokyo = await dbPut('folders', { kind: 'notes', name: 'Tokyo', createdAt: now + 3 });
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const g = c.getContext('2d'); g.fillStyle = '#c84'; g.fillRect(0, 0, 400, 300);
      const jpeg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
      await dbPut('notes', { title: 'Conseils pour Maman', body: '- Toujours garder le **passeport**\n- Le Suica pour le métro', icon: '💡', folderId: tokyo, addressId: hotel, pinned: false, images: [jpeg], attachments: [], createdAt: now + 4, updatedAt: now + 4 });
      const billets = await dbPut('folders', { kind: 'documents', name: 'Billets', createdAt: now + 5 });
      const ticket = blob('Billet Shinkansen Tokyo → Kyoto, voiture 7, place 12A', 'text/plain');
      await saveNewDocument({ folderId: billets, name: 'shinkansen.txt', type: 'text/plain', size: ticket.size, thumb: null, createdAt: now + 6, updatedAt: now + 6 }, ticket);
      await dbPut('expenses', { amount: 980, currency: 'JPY', rate: 184.5, category: 'repas', label: 'Ichiran', spentAt: now, createdAt: now + 7, updatedAt: now + 7 });
    });

    // ---------- Comptes : Sohhka, puis Maman avec son code ----------
    await signUp(A, { name: 'Sohhka', email: 'sohhka@exemple.fr', password: 'voyage-japon-2026' });
    const code = norm(await A.textContent('#sharingContent .profile-code'));
    await signUp(M, { name: 'Maman', email: 'maman@exemple.fr', password: 'bisous-bisous', invite: code });
    await syncNowAndWait(A);
    const uid = await A.evaluate(() => cloudSession.uid);
    check(await A.evaluate(() => !syncAllEnabled()), 'au départ : rubriques de Sohhka pas en ligne');

    // ---------- Partager le programme : la synchronisation est proposée ----------
    await setShare(A, 'Programme', 'Maman', true);
    await A.waitForSelector('#dialog:not([hidden])');
    check(/Pour partager ton programme, tes rubriques doivent être en ligne/.test(await text(A, '#dialogMessage')) && /jamais tes dépenses/.test(await text(A, '#dialogMessage')),
      'premier partage : « Pour partager ton programme, tes rubriques doivent être en ligne… »');
    await A.screenshot({ path: path.join(OUT, '01-sohhka-partage-programme.png') });
    await A.click('#dialogOkBtn');
    check(await waitText(A, '#toast', /Partagé avec Maman/, 30000) && await A.evaluate(() => syncAllEnabled() && sharedWith('schedule').join() !== ''), 'Sohhka : synchronisation activée, programme partagé avec Maman');
    await setShare(A, 'Carnet d\'adresses', 'Maman', true);
    check(await waitText(A, '#toast', /Partagé avec Maman/), 'carnet d\'adresses partagé aussi (sans nouvelle question)');
    await syncNowAndWait(A);

    // ---------- Chez Maman ----------
    const state = await syncNowAndWait(M);
    check(state === 'done' && await sharedKinds(M) === 'address,event,event', 'Maman reçoit le programme (2 étapes) et l\'adresse ; ni notes, ni documents, ni dépenses (' + await sharedKinds(M) + ')');
    await goTo(M, 'sharing');
    check(/Sohhka te partage aussi : 📅 Programme, 📍 Carnet d'adresses \(en lecture seule\)/.test(await text(M, '#sharingContent')), 'écran Partage de Maman : ce que Sohhka lui partage');
    await goTo(M, 'schedule');
    await M.waitForSelector('#scheduleShared .shared-entry');
    check(/Programme de Sohhka ?2 étapes/.test(await text(M, '#scheduleShared')), 'Programme de Maman : « Programme de Sohhka · 2 étapes · … »');
    await M.screenshot({ path: path.join(OUT, '02-maman-programme.png') });
    await M.click('#scheduleShared .shared-entry');
    await M.waitForSelector('#scheduleContent .schedule-row');
    check(await text(M, '#viewTitle') === 'Programme de Sohhka' && await M.isHidden('#topActions button[aria-label="Nouvelle étape"]'), 'programme de Sohhka : en lecture seule (pas de +)');
    await M.click('.schedule-day-head:has-text("Jour 1")');
    await M.waitForSelector('#scheduleDay .event-card');
    const card = '.event-card:has-text("Check-in")';
    check(/Programme de Sohhka · Jour 1 sur 2/.test(await text(M, '.day-nav-sub')) && await M.$(card + ' .event-edit') === null, 'journée : « Programme de Sohhka · Jour 1 sur 2 », sans ✎');
    check(/🏨 Hôtel Gracery ?1-19-1 Kabukicho, Shinjuku, Tokyo/.test(await text(M, card + ' .event-place')), 'le lieu de l\'étape (carnet de Sohhka), avec son adresse');
    await M.click(card + ' .action-btn:has-text("Itinéraire")');
    check((await M.evaluate(() => window.__bridge.opened.pop())) === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('1-19-1 Kabukicho, Shinjuku, Tokyo'), '🧭 Itinéraire jusqu\'à l\'hôtel, chez Maman');
    await M.click(card + ' .action-btn:has-text("Pour le taxi")');
    check(await M.isVisible('#taxi') && await text(M, '#taxiAddress') === '東京都新宿区歌舞伎町1-19-1', '🚕 Pour le taxi : l\'adresse en japonais, chez Maman');
    await M.evaluate(() => handleBackButton());
    await M.click(card + ' .attachment');
    check(await waitText(M, '#docName', /reservation\.txt/) && await waitText(M, '#docBody', /Bon de réservation Gracery n° 4242/), 'le billet de l\'étape s\'ouvre chez Maman (intact)');
    await M.evaluate(() => handleBackButton());
    await M.screenshot({ path: path.join(OUT, '03-maman-journee.png') });
    await M.click(card + ' .action-btn:has-text("Fiche")');
    await M.waitForSelector('#sharedItemDetail .detail-title');
    check(await text(M, '#sharedItemDetail .detail-title') === 'Hôtel Gracery' && /carnet de Sohhka/.test(await text(M, '#sharedItemDetail')) && /Partagé par Sohhka, en lecture seule/.test(await text(M, '#sharedItemDetail')),
      '📇 Fiche : l\'adresse de Sohhka, en lecture seule');
    await goTo(M, 'addresses');
    check(await waitText(M, '#addressShared', /Carnet d'adresses de Sohhka ?1 adresse · en lecture seule/), 'Carnet d\'adresses de Maman : « Carnet d\'adresses de Sohhka »');
    await goTo(M, 'notes');
    await M.waitForTimeout(300);
    check(await M.$('#notesShared .shared-entry') === null, 'Notes : rien de Sohhka (pas partagées)');

    // ---------- Notes et documents ----------
    await setShare(A, 'Notes', 'Maman', true);
    await waitText(A, '#toast', /Partagé avec Maman/);
    await setShare(A, 'Documents', 'Maman', true);
    await waitText(A, '#toast', /Partagé avec Maman/);
    await syncNowAndWait(A);
    await syncNowAndWait(M);
    check(await sharedKinds(M) === 'address,document,event,event,folder,folder,note', 'Maman reçoit aussi les notes, les documents et leurs dossiers ; toujours pas les dépenses (' + await sharedKinds(M) + ')');
    await goTo(M, 'notes');
    await M.waitForSelector('#notesShared .shared-entry');
    await M.click('#notesShared .shared-entry');
    await M.waitForSelector('#sharedItemsContent .list-row');
    check(/📁 Tokyo/.test(await text(M, '#sharedItemsContent')) && /Conseils pour Maman/.test(await text(M, '#sharedItemsContent')), 'notes de Sohhka : rangées dans leur dossier (Tokyo)');
    await M.click('#sharedItemsContent .list-row:has-text("Conseils pour Maman")');
    await M.waitForSelector('#sharedItemDetail .detail-title');
    const photoOk = await M.waitForFunction(() => { const i = document.querySelector('#sharedItemDetail .image-grid img'); return i && i.complete && i.naturalWidth === 400; }, null, { timeout: 10000 }).then(() => true, () => false);
    check(photoOk && /Toujours garder le passeport/.test(await text(M, '#sharedItemDetail .markdown')) && /Hôtel Gracery/.test(await text(M, '#sharedItemDetail .link-card')),
      'la note : texte mis en forme, photo, et son lieu (carnet partagé)');
    await M.screenshot({ path: path.join(OUT, '04-maman-note.png') });
    await goTo(M, 'documents');
    await M.waitForSelector('#docsShared .shared-entry');
    await M.click('#docsShared .shared-entry');
    await M.waitForSelector('#sharedItemsContent .doc-row');
    check(/📁 Billets/.test(await text(M, '#sharedItemsContent')), 'documents de Sohhka : dans leur dossier (Billets)');
    // Hors connexion : tout reste consultable.
    await mom.context.setOffline(true);
    await M.click('#sharedItemsContent .doc-row:has-text("shinkansen.txt")');
    check(await waitText(M, '#docBody', /voiture 7, place 12A/), 'hors connexion : le billet s\'ouvre (copie gardée sur le téléphone)');
    await M.evaluate(() => handleBackButton());
    await mom.context.setOffline(false);

    // ---------- Changements de Sohhka ----------
    await A.evaluate(async () => {
      const e = (await dbGetAll('schedule')).find(x => x.title === 'Check-in');
      e.time = '15:30';
      e.updatedAt = Date.now();
      await dbPut('schedule', e);
      clearTimeout(cloudPublishTimer);
    });
    await syncNowAndWait(A);
    await syncNowAndWait(M);
    await M.evaluate(owner => openView('schedule-day', { date: '2026-10-15', owner }), uid);
    check(await M.waitForFunction(() => Array.from(document.querySelectorAll('.event-card')).some(c => /Check-in/.test(c.textContent) && /15:30/.test(c.querySelector('.event-time').textContent))).then(() => true, () => false), 'étape modifiée par Sohhka : à jour chez Maman (15:30)');
    // Carnet plus partagé : le lieu de l'étape reste (recopié dans le programme).
    await setShare(A, 'Carnet d\'adresses', 'Maman', false);
    await waitText(A, '#toast', /Plus partagé avec Maman/);
    await syncNowAndWait(M);
    await M.evaluate(owner => openView('schedule-day', { date: '2026-10-15', owner }), uid);
    await M.waitForSelector('.event-card:has-text("Check-in")');
    check(!/address/.test(await sharedKinds(M)) && /🏨 Hôtel Gracery/.test(await text(M, '.event-card:has-text("Check-in") .event-place')) && await M.$('.event-card .action-btn:has-text("Fiche")') === null,
      'carnet plus partagé : il quitte le téléphone de Maman, mais le lieu de l\'étape reste (adresse, taxi), sans fiche');
    await M.click('.event-card:has-text("Check-in") .action-btn:has-text("Pour le taxi")');
    check(await text(M, '#taxiAddress') === '東京都新宿区歌舞伎町1-19-1', '… et l\'adresse pour le taxi aussi');
    await M.evaluate(() => handleBackButton());
    // Étape supprimée.
    await A.evaluate(async () => {
      const e = (await dbGetAll('schedule')).find(x => x.title === 'Journée à Nikko');
      await dbDelete('schedule', e.id);
      clearTimeout(cloudPublishTimer);
    });
    await syncNowAndWait(A);
    await syncNowAndWait(M);
    check(await M.evaluate(async () => (await dbGetAll('sharedItems')).filter(i => i.kind === 'event').map(i => i.data.title).join()) === 'Check-in', 'étape supprimée par Sohhka : supprimée chez Maman');

    // ---------- Synchronisation arrêtée : plus rien de partagé, sauf les Images ----------
    await setShare(A, 'Images', 'Maman', true);
    await waitText(A, '#toast', /Partagé avec Maman/);
    await goTo(A, 'sharing');
    await A.click('#sharingContent .sync-all-row .toggle');
    await A.waitForSelector('#dialog:not([hidden])');
    check(/Tes proches ne verront plus ce que tu leur partages \(programme, adresses, notes, documents\)/.test(await text(A, '#dialogMessage')) && /Tes Images restent en ligne pour tes proches/.test(await text(A, '#dialogMessage')),
      'arrêter la synchronisation : prévient que les proches ne verront plus les rubriques partagées (sauf les Images)');
    await A.click('#dialogOkBtn');
    await waitText(A, '#toast', /Synchronisation arrêtée/, 60000);
    await settled(A);
    const grant = (await adminList('grants')).find(d => d.name.endsWith('/' + uid + '_' + (d.fields.to || {}).stringValue));
    const left = grant ? grant.fields.categories.arrayValue.values.map(v => v.stringValue).join() : '-';
    check(left === 'albums' && (await adminList('users/' + uid + '/items')).length === 0, 'Sohhka : rubriques effacées du serveur, partage réduit aux Images (' + left + ')');
    await syncNowAndWait(M);
    check(await sharedKinds(M) === '' && await M.evaluate(async () => (await dbGetAll('sharedFiles')).length) === 0, 'chez Maman : notes, documents et programme partis du téléphone (fichiers compris)');
    await goTo(M, 'notes');
    await M.waitForTimeout(300);
    check(await M.$('#notesShared .shared-entry') === null, 'Notes de Maman : plus rien de Sohhka');

    for (const [who, p] of [['Sohhka', A], ['Maman', M]]) {
      check(p.errors.length === 0, who + ' : aucune erreur' + (p.errors.length ? ' : ' + p.errors.slice(0, 3).join(' | ') : ''));
    }
    await me.context.close();
    await mom.context.close();
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
