// Programme du voyage : étapes (date, heure, lieu du carnet, notes, billets), vue d'ensemble avec le
// compte à rebours, écran du jour (« Aujourd'hui » : étape en cours, suivante, météo), modification,
// suppression, liens avec le carnet d'adresses, sauvegarde. Téléphone à l'heure de Tokyo, à une date
// et une heure fixées par le test.
// Usage : node 16-programme.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require('./lib/block-external');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require('./lib/chrome');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(ok, msg) { results.push([!!ok, msg]); console.log((ok ? 'PASS ' : 'FAIL ') + msg); }
const norm = s => (s || '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();

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

const ANDROID_BRIDGE = () => {
  const state = window.__bridge = { files: {}, finished: [], opened: [] };
  window.AndroidBridge = {
    isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
    openExternal: u => { state.opened.push(u); }, copyText: () => {}, getAppVersion: () => '2.3', shareText: () => {},
    fileBegin: (name, type) => { const id = 'f' + Object.keys(state.files).length; state.files[id] = { name, type, chunks: [] }; return id; },
    fileAppend: (id, b64) => { state.files[id].chunks.push(b64); },
    fileFinish: (id, action) => {
      const f = state.files[id];
      state.finished.push({ action, name: f.name, b64: f.chunks.join('|') });
      if (action === 'save') setTimeout(() => window.onFileSaved(id, true), 50);
    }
  };
};

// Heure de Tokyo (UTC+9) → instant.
const tokyo = (date, time) => new Date(date + 'T' + time + ':00+09:00');
// Météo simulée : la semaine autour du voyage, à Tokyo.
function forecast(today) {
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] };
  const base = Date.parse(today + 'T00:00:00Z');
  for (let d = -6; d < 7; d++) {
    daily.time.push(new Date(base + d * 86400000).toISOString().slice(0, 10));
    daily.weather_code.push(0); daily.temperature_2m_max.push(24); daily.temperature_2m_min.push(16); daily.precipitation_probability_max.push(10);
  }
  return { utc_offset_seconds: 32400, timezone: 'Asia/Tokyo', current: { temperature_2m: 21, apparent_temperature: 21, weather_code: 0, is_day: 1 }, daily, hourly: { time: [] } };
}

const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const text = (page, sel) => page.textContent(sel).then(norm);
// Texte de chaque élément : ses morceaux séparés par une espace.
const texts = (page, sel) => page.$$eval(sel, l => l.map(e => Array.from(e.querySelectorAll('*')).filter(n => !n.children.length)
  .map(n => n.textContent.replace(/\s/g, ' ').replace(/ +/g, ' ').trim()).filter(Boolean).join(' ')));
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent.replace(/\s/g, ' ')); }, [sel, re.source], { timeout: timeout || 10000 }).then(() => true, () => false);
async function dialogOk(page) { await page.waitForSelector('#dialog:not([hidden])'); await page.click('#dialogOkBtn'); }
const goTo = (page, section) => page.evaluate(s => goToSection(s), section).then(() => page.waitForTimeout(150));
const save = page => page.click('#topActions button:has-text("Enregistrer")');

/* Une étape, par le formulaire. */
async function addEvent(page, e) {
  await page.waitForSelector('#view-schedule-edit:not([hidden])');
  await page.waitForFunction(() => document.getElementById('eventDate').value !== '');
  await page.fill('#eventTitle', e.title);
  if (e.type) await page.click('#eventTypes .filter-chip:has-text("' + e.type + '")');
  if (e.date) await page.fill('#eventDate', e.date);
  if (e.time) await page.fill('#eventTime', e.time);
  if (e.end) await page.fill('#eventEnd', e.end);
  if (e.place) {
    await page.click('#eventAddressBtn');
    await page.click('#sheetPanel .sheet-item:has-text("' + e.place + '")');
    await waitText(page, '#eventAddressBtn', new RegExp(e.place));
  }
  if (e.notes) await page.fill('#eventNotes', e.notes);
  if (e.file) {
    await page.setInputFiles('#eventFiles', e.file);
    await page.waitForSelector('#eventAttachments .attachment');
  }
  await save(page);
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
    await context.clock.setFixedTime(tokyo('2026-10-10', '10:00'));
    await blockExternal(context);
    await context.route(/api\.open-meteo\.com\/v1\/forecast/, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(forecast('2026-10-15')) }));
    await context.addInitScript(ANDROID_BRIDGE);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console.error: ' + m.text()); });
    page.on('dialog', d => { errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
    await page.goto(url);
    await ready(page);

    // ---------- Menu, programme vide ----------
    check(norm(await page.textContent('.drawer-item[data-section="schedule"]')) === '📅Programme', 'menu : « 📅 Programme »');
    await goTo(page, 'schedule');
    check(/Aucune étape pour l'instant/.test(await text(page, '#scheduleEmpty')), 'programme vide : « Aucune étape pour l\'instant… »');

    // Le carnet : l'hôtel (adresse en japonais pour le taxi).
    await page.evaluate(() => dbPut('addresses', { category: 'hebergement', title: 'Hôtel Gracery', address: '1-19-1 Kabukicho, Shinjuku, Tokyo', addressJa: '東京都新宿区歌舞伎町1-19-1', phone: '+81 3-6833-2489', website: '', description: '', attachments: [], createdAt: Date.now(), updatedAt: Date.now() }));

    // ---------- Étapes ajoutées par le formulaire ----------
    await page.click('#topActions button[aria-label="Nouvelle étape"]');
    await page.waitForFunction(() => document.getElementById('eventDate').value !== '');
    check(await page.inputValue('#eventDate') === '2026-10-10' && await page.getAttribute('#eventTypes .filter-chip:has-text("Autre")', 'aria-pressed') === 'true',
      'nouvelle étape : date du jour proposée, type « Autre »');
    await addEvent(page, { title: 'Vol Paris → Tokyo', type: 'Vol', date: '2026-10-14', time: '11:30', end: '07:15', notes: 'Vol AF 276, **terminal 2E**' });
    check(await waitText(page, '#toast', /Étape ajoutée au programme/), 'enregistrée : « Étape ajoutée au programme »');
    await page.click('#topActions button[aria-label="Nouvelle étape"]');
    check(await page.waitForFunction(() => document.getElementById('eventDate').value === '2026-10-14', null, { timeout: 5000 }).then(() => true, () => false), 'étape suivante : date de la dernière ajoutée proposée (préparation dans l\'ordre)');
    await addEvent(page, {
      title: 'Check-in', type: 'Hébergement', date: '2026-10-15', time: '15:00', place: 'Hôtel Gracery', notes: 'Réservation n° 12345\n- [ ] passeports',
      file: { name: 'reservation-hotel.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% réservation\n') }
    });
    await page.waitForSelector('#view-schedule:not([hidden])');
    for (const e of [
      { title: 'Petit-déjeuner au marché', type: 'Repas', date: '2026-10-15', time: '09:00', end: '11:00' },
      { title: 'Shibuya et Harajuku', type: 'Visite', date: '2026-10-15', time: '12:00', end: '14:00' },
      { title: 'Bus pour l\'hôtel', type: 'Transport', date: '2026-10-15', time: '14:30' },
      { title: 'Journée à Nikko', type: 'Activité', date: '2026-10-16' }
    ]) {
      await page.click('#topActions button[aria-label="Nouvelle étape"]');
      await addEvent(page, e);
      await page.waitForSelector('#view-schedule:not([hidden])');
    }
    await page.waitForFunction(() => document.querySelectorAll('#scheduleContent .schedule-row').length === 6);

    // ---------- Vue d'ensemble : compte à rebours, jours, étapes ----------
    check(/Départ dans 4 jours/.test(await text(page, '.trip-card')) && /Mercredi 14 octobre → Vendredi 16 octobre · 3 jours/.test(await text(page, '.trip-card')),
      'avant le départ : « Départ dans 4 jours », du mercredi 14 au vendredi 16 octobre (' + await text(page, '.trip-card') + ')');
    const heads = await texts(page, '.schedule-day-head');
    check(heads.join(' | ') === 'Jour 1 · Mercredi 14 octobre › | Jour 2 · Jeudi 15 octobre › | Jour 3 · Vendredi 16 octobre ›', 'jours numérotés (' + heads.join(' | ') + ')');
    const rows = await texts(page, '#scheduleContent .schedule-row');
    check(rows[1] === '09:00 🍜 Petit-déjeuner au marché' && rows[4] === '15:00 🏨 Check-in Hôtel Gracery 📎 1 pièce jointe' && rows[5] === '🎫 Journée à Nikko',
      'étapes dans l\'ordre des heures, avec le lieu et les billets (' + rows[4] + ')');
    await page.screenshot({ path: path.join(OUT, '01-programme-avant-depart.png'), fullPage: true });

    // ---------- Une journée : navigation, lieu, notes, billets ----------
    await page.waitForFunction(() => weatherData && weatherData.days.length > 0);
    await page.click('.schedule-day-head:has-text("Jour 2")');
    await page.waitForSelector('#scheduleDay .event-card');
    check(await text(page, '#viewTitle') === 'Jour 2' && await text(page, '.day-nav-date') === 'Jeudi 15 octobre' && await text(page, '.day-nav-sub') === 'Jour 2 sur 3',
      'journée : « Jeudi 15 octobre », Jour 2 sur 3');
    check(/☀️ Tokyo : 24° \/ 16° · 💧 10 %/.test(await text(page, '.day-weather')), 'météo du jour (rubrique Météo) : ' + await text(page, '.day-weather'));
    const checkin = '.event-card:has-text("Check-in")';
    check(/15:00/.test(await text(page, checkin + ' .event-time')) && /🏨 Hôtel Gracery/.test(await text(page, checkin + ' .event-place')) && /Réservation n° 12345/.test(await text(page, checkin + ' .event-notes')),
      'étape : heure, lieu du carnet, notes');
    await page.click(checkin + ' .action-btn:has-text("Itinéraire")');
    check((await page.evaluate(() => window.__bridge.opened.pop())) === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('1-19-1 Kabukicho, Shinjuku, Tokyo'), '🧭 Itinéraire : Google Maps');
    await page.click(checkin + ' .action-btn:has-text("Pour le taxi")');
    check(await page.isVisible('#taxi') && await text(page, '#taxiAddress') === '東京都新宿区歌舞伎町1-19-1', '🚕 Pour le taxi : l\'adresse en japonais, en grand');
    await page.evaluate(() => handleBackButton());
    await page.click(checkin + ' .attachment');
    check(await page.waitForSelector('#docViewer:not([hidden]), .doc-viewer:not([hidden])', { timeout: 5000 }).then(() => true, () => false) || (await page.evaluate(() => window.__bridge.finished.some(f => f.name === 'reservation-hotel.pdf'))),
      'billet : s\'ouvre d\'un toucher');
    await page.evaluate(() => handleBackButton());
    await page.click(checkin + ' .task-box');
    check(await page.waitForFunction(async () => /- \[x\] passeports/.test((await dbGetAll('schedule')).find(e => e.title === 'Check-in').notes)).then(() => true, () => false), 'case cochée dans les notes : enregistrée');
    await page.screenshot({ path: path.join(OUT, '02-journee.png'), fullPage: true });
    await page.click('.day-nav-btn[aria-label="Jour suivant"]');
    check(await waitText(page, '.day-nav-date', /Vendredi 16 octobre/) && await page.isDisabled('.day-nav-btn[aria-label="Jour suivant"]') && /Dans la journée/.test(await text(page, '.event-card .event-time')),
      '› jour suivant (le dernier : › désactivé) ; étape sans heure : « Dans la journée »');
    await page.evaluate(() => handleBackButton());
    check(await page.evaluate(() => currentViewName()) === 'schedule', 'retour : la vue d\'ensemble (les jours parcourus ne s\'empilent pas)');

    // ---------- Aujourd'hui (pendant le voyage) ----------
    await context.clock.setFixedTime(tokyo('2026-10-15', '13:00'));
    await page.evaluate(() => refreshView());
    await page.waitForSelector('.trip-card.is-now');
    const card = await text(page, '.trip-card');
    check(/Aujourd'hui · Jour 2 sur 3/.test(card) && /En cours : ⛩️ Shibuya et Harajuku/.test(card) && /À suivre dans 1 h 30 : 14:30 🚇 Bus pour l'hôtel/.test(card),
      'pendant le voyage : « Aujourd\'hui · Jour 2 sur 3 », étape en cours et suivante (' + card + ')');
    check(await page.$eval('.schedule-day-head.is-today', e => e.textContent.includes('Jour 2')) && await page.$eval('.schedule-day-head:has-text("Jour 1")', e => e.classList.contains('is-past')),
      'jour en cours mis en avant, jours passés estompés');
    await page.screenshot({ path: path.join(OUT, '03-programme-pendant.png') });
    await page.click('.trip-card .action-btn:has-text("Voir la journée")');
    await waitText(page, '.day-nav-date', /Jeudi 15 octobre/);
    const states = await page.$$eval('.event-card', l => l.map(e => e.querySelector('.event-title').textContent + ':' + (['is-past', 'is-now', 'is-next'].find(c => e.classList.contains(c)) || '-') + ':' + ((e.querySelector('.event-badge') || {}).textContent || '')));
    check(await text(page, '#viewTitle') === 'Aujourd\'hui' && states.join(' | ') === 'Petit-déjeuner au marché:is-past: | Shibuya et Harajuku:is-now:En cours | Bus pour l\'hôtel:is-next:À suivre · dans 1 h 30 | Check-in:-:',
      '« Aujourd\'hui » : passée estompée, « En cours », « À suivre · dans 1 h 30 » (' + states.join(' | ') + ')');
    await page.screenshot({ path: path.join(OUT, '04-aujourdhui.png'), fullPage: true });
    await context.clock.setFixedTime(tokyo('2026-10-15', '14:50'));
    await page.evaluate(() => refreshView());
    await waitText(page, '#scheduleDay', /Bus pour l'hôtel/);
    const later = await page.$$eval('.event-card', l => l.map(e => (['is-past', 'is-now', 'is-next'].find(c => e.classList.contains(c)) || '-') + ':' + ((e.querySelector('.event-badge') || {}).textContent || '')));
    check(later.join(' | ') === 'is-past: | is-past: | is-now: | is-next:À suivre · dans 10 min', 'plus tard : le bus (sans heure de fin) est l\'étape en cours, le check-in « dans 10 min » (' + later.join(' | ') + ')');

    // ---------- Modifier, supprimer ----------
    await page.click('.event-card:has-text("Bus pour l\'hôtel") .event-edit');
    await page.waitForFunction(() => document.getElementById('eventTitle').value === 'Bus pour l\'hôtel');
    check(await page.isVisible('#eventDeleteBtn') && await text(page, '#viewTitle') === 'Modifier l\'étape', 'modifier : formulaire rempli, bouton Supprimer');
    await page.fill('#eventTime', '14:45');
    await save(page);
    check(await waitText(page, '#toast', /Étape modifiée/) && await page.evaluate(() => currentViewName()) === 'schedule-day' && /14:45/.test(await text(page, '.event-card:has-text("Bus") .event-time')),
      'modifiée : retour à la journée, nouvelle heure');
    await page.click('.event-card:has-text("Petit-déjeuner") .event-edit');
    await page.waitForSelector('#eventDeleteBtn:not([hidden])');
    await page.click('#eventDeleteBtn');
    await dialogOk(page);
    check(await waitText(page, '#toast', /Étape supprimée/) && !(await page.isVisible('.event-card:has-text("Petit-déjeuner")')), 'supprimée (après confirmation)');
    // Quitter un formulaire modifié : confirmation.
    await page.click('#topActions button[aria-label="Nouvelle étape ce jour-là"]');
    await page.waitForFunction(() => document.getElementById('eventDate').value === '2026-10-15');
    await page.fill('#eventTitle', 'Brouillon');
    await page.evaluate(() => handleBackButton());
    check(await page.waitForSelector('#dialog:not([hidden])', { timeout: 3000 }).then(() => true, () => false) && /Abandonner cette étape/.test(await text(page, '#dialogMessage')), 'formulaire modifié : « Abandonner cette étape ? »');
    await page.click('#dialogOkBtn');
    await page.waitForSelector('#view-schedule-day:not([hidden])');

    // ---------- Le carnet d'adresses ----------
    const hotelId = await page.evaluate(async () => (await dbGetAll('addresses')).find(a => a.title === 'Hôtel Gracery').id);
    await page.evaluate(id => openView('address', { id }), hotelId);
    await page.waitForSelector('#addressDetail .detail-title');
    check(/Au programme/.test(await text(page, '#addressDetail')) && (await texts(page, '#addressDetail .schedule-row')).join() === '🏨 Check-in Jeudi 15 octobre · 15:00', 'fiche du lieu : « Au programme » (Check-in, jeudi 15 octobre · 15:00)');
    await page.click('#topActions button[aria-label="Plus d\'options"]');
    await page.click('#sheetPanel .sheet-item:has-text("Ajouter au programme")');
    await page.waitForFunction(() => document.getElementById('eventTitle').value === 'Hôtel Gracery');
    check(await page.getAttribute('#eventTypes .filter-chip:has-text("Hébergement")', 'aria-pressed') === 'true' && /Hôtel Gracery/.test(await text(page, '#eventAddressBtn')),
      '« Ajouter au programme » depuis la fiche : lieu, nom et type (hébergement) déjà remplis');
    await page.fill('#eventTitle', 'Départ de l\'hôtel');
    await page.fill('#eventDate', '2026-10-16');
    await page.fill('#eventTime', '10:00');
    await save(page);
    await page.waitForSelector('#view-address:not([hidden])');
    // Lieu supprimé du carnet : retiré des étapes.
    await page.click('#topActions button[aria-label="Plus d\'options"]');
    await page.click('#sheetPanel .sheet-item:has-text("Supprimer l\'adresse")');
    await dialogOk(page);
    await page.waitForFunction(() => currentViewName() !== 'address');
    check(await page.evaluate(async () => (await dbGetAll('schedule')).every(e => e.addressId === null)), 'lieu supprimé du carnet : retiré des étapes (qui restent)');

    // ---------- Après le voyage ; sauvegarde ----------
    await context.clock.setFixedTime(tokyo('2026-10-20', '09:00'));
    await goTo(page, 'schedule');
    check(await waitText(page, '#scheduleContent', /Voyage terminé · Mercredi 14 octobre → Vendredi 16 octobre · 3 jours/), 'après le voyage : « Voyage terminé · … »');
    await goTo(page, 'settings');
    const before = await page.evaluate(() => window.__bridge.finished.length);
    await page.click('#backupBtn');
    await page.waitForFunction(n => window.__bridge.finished.length > n && document.getElementById('progress').hidden, before);
    const zip = await page.evaluate(() => window.__bridge.finished[window.__bridge.finished.length - 1].b64.split('|').map(atob).join(''));
    await page.evaluate(() => dbReplaceAll({}));
    await page.reload();
    await ready(page);
    await goTo(page, 'settings');
    await page.setInputFiles('#restoreInput', { name: 'SOHRI-sauvegarde.zip', mimeType: 'application/zip', buffer: Buffer.from(zip, 'latin1') });
    await page.waitForSelector('#dialog:not([hidden])');
    check(/6 étapes au programme/.test(await text(page, '#dialogMessage')), 'sauvegarde : « 6 étapes au programme » dans le résumé de la restauration');
    await Promise.all([page.waitForNavigation(), page.click('#dialogOkBtn')]);
    await ready(page);
    const restored = await page.evaluate(async () => {
      const all = await dbGetAll('schedule');
      const checkin = all.find(e => e.title === 'Check-in');
      return all.length + ' étapes, billet ' + (checkin.attachments[0].blob instanceof Blob ? checkin.attachments[0].name : 'perdu');
    });
    check(restored === '6 étapes, billet reservation-hotel.pdf', 'restaurées, billets compris (' + restored + ')');
    await goTo(page, 'schedule');
    await page.evaluate(() => handleBackButton());
    check(await page.evaluate(() => currentViewName()) === 'converter', 'bouton retour d\'Android depuis le Programme : convertisseur');
    check(errors.length === 0, 'Android : aucune erreur' + (errors.length ? ' : ' + errors.join(' | ') : ''));
    await context.close();

    // ---------- iPhone (WebKit) : formulaire et journée ----------
    const dir = path.join(OUT, 'profil-iphone');
    fs.rmSync(dir, { recursive: true, force: true });
    const ios = await webkit.launchPersistentContext(dir, { ...devices['iPhone 14 Plus'], locale: 'fr-FR', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
    await ios.clock.setFixedTime(tokyo('2026-10-15', '13:00'));
    await blockExternal(ios);
    const ipage = ios.pages()[0] || await ios.newPage();
    const iosErrors = [];
    ipage.on('pageerror', e => iosErrors.push(e.message));
    await ipage.goto(url);
    await ready(ipage);
    await goTo(ipage, 'schedule');
    await ipage.click('#topActions button[aria-label="Nouvelle étape"]');
    await addEvent(ipage, { title: 'Temple Senso-ji', type: 'Visite', date: '2026-10-15', time: '16:00', end: '17:30' });
    await ipage.waitForSelector('#view-schedule:not([hidden])');
    check(/À suivre dans 3 h : 16:00 ⛩️ Temple Senso-ji/.test(await text(ipage, '.trip-card')), 'iPhone : étape ajoutée, « À suivre dans 3 h »');
    await ipage.click('.trip-card .action-btn:has-text("Voir la journée")');
    await ipage.waitForSelector('#scheduleDay .event-card');
    await ipage.screenshot({ path: path.join(OUT, '05-iphone-aujourdhui.png') });
    await ipage.click('.event-card .event-edit');
    await ipage.waitForFunction(() => document.getElementById('eventTime').value === '16:00');
    const fits = await ipage.evaluate(() => { const r = document.getElementById('eventEnd').getBoundingClientRect(); return r.right <= window.innerWidth && r.height >= 40; });
    await ipage.screenshot({ path: path.join(OUT, '06-iphone-formulaire.png') });
    check(fits, 'iPhone : heure et fin côte à côte, dans l\'écran');
    check(iosErrors.length === 0, 'iPhone : aucune erreur' + (iosErrors.length ? ' : ' + iosErrors.join(' | ') : ''));
    await ios.close();
  } catch (e) {
    console.error(e);
    check(false, 'exception : ' + e.message.split('\n')[0]);
  }
  await browser.close();
  server.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  if (failed.length) { console.log('ÉCHECS :'); failed.forEach(f => console.log(' - ' + f[1])); }
  process.exit(failed.length ? 1 : 0);
})();
