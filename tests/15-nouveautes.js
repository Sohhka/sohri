// Nouveautés de la version 2.3 : convertisseur dans les deux sens (et addition de prix), Dépenses
// (totaux, modification, export, sauvegarde), météo heure par heure, Phrases utiles, rappel de
// sauvegarde, rapport de diagnostic, témoin de synchronisation dans le menu.
// Usage : node 15-nouveautes.js <www> <sorties>
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

// Appli Android simulée : fichiers transmis gardés (action, nom, contenu), textes partagés.
// « Enregistrer sous » : emplacement choisi, sauf si cancelSave (fenêtre fermée sans choisir).
const ANDROID_BRIDGE = () => {
  const state = window.__bridge = { files: {}, finished: [], texts: [], cancelSave: false };
  window.AndroidBridge = {
    isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
    openExternal: u => { state.opened = u; }, copyText: () => {}, getAppVersion: () => '2.3', shareText: t => state.texts.push(t),
    fileBegin: (name, type) => { const id = 'f' + Object.keys(state.files).length; state.files[id] = { name, type, chunks: [] }; return id; },
    fileAppend: (id, b64) => { state.files[id].chunks.push(b64); },
    fileFinish: (id, action) => {
      const f = state.files[id];
      state.finished.push({ action, name: f.name, type: f.type, b64: f.chunks.join('|') });
      if (action === 'save') setTimeout(() => window.onFileSaved(id, !state.cancelSave), 300);
    }
  };
};

// Météo simulée (Open-Meteo), heure par heure comprise, pour Tokyo (UTC+9).
function forecast(nowMs) {
  const local = new Date(nowMs + 9 * 3600000);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] };
  for (let d = -6; d < 7; d++) {
    daily.time.push(iso(midnight + d * 86400000)); daily.weather_code.push(2); daily.temperature_2m_max.push(24); daily.temperature_2m_min.push(16); daily.precipitation_probability_max.push(30);
  }
  const hourly = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], is_day: [] };
  for (let i = -6 * 24; i < 7 * 24; i++) {
    const t = midnight + i * 3600000;
    const hr = new Date(t).getUTCHours();
    hourly.time.push(new Date(t).toISOString().slice(0, 13) + ':00');
    hourly.temperature_2m.push(10 + hr); hourly.precipitation_probability.push(hr * 4); hourly.weather_code.push(hr < 12 ? 0 : 61); hourly.is_day.push(hr >= 6 && hr < 18 ? 1 : 0);
  }
  return { utc_offset_seconds: 32400, timezone: 'Asia/Tokyo', current: { temperature_2m: 21, apparent_temperature: 21, weather_code: 2, is_day: 1 }, daily, hourly };
}

async function newPhone(browser, { android = true, weather = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
  await blockExternal(context);
  if (weather) { // (après le blocage : la dernière règle déclarée l'emporte)
    await context.route(/api\.open-meteo\.com\/v1\/forecast/, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(forecast(Date.now())) }));
  }
  if (android) await context.addInitScript(ANDROID_BRIDGE);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) page.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  return { context, page };
}
const ready = page => page.waitForFunction(() => document.getElementById('rateText').textContent !== '', null, { timeout: 30000 });
const text = (page, sel) => page.textContent(sel).then(norm);
async function dialogOk(page) { await page.waitForSelector('#dialog:not([hidden])'); await page.click('#dialogOkBtn'); }
const toastHas = (page, re) => waitText(page, '#toast', re, 5000);
// Texte d'un élément (espaces insécables des nombres « 1 200 » ramenés à de simples espaces).
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent.replace(/\s/g, ' ')); }, [sel, re.source], { timeout: timeout || 10000 }).then(() => true, () => false);
const value = (page, sel) => page.inputValue(sel).then(norm);

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // ---------- Convertisseur : dans les deux sens, addition de prix, dépense ----------
    {
      const { context, page } = await newPhone(browser);
      await page.goto(url);
      await ready(page);
      const fits = () => page.evaluate(() => { const m = document.getElementById('content'); return m.scrollHeight <= m.clientHeight + 1; });
      check(await fits(), 'convertisseur vide : toujours sans défilement (heures comprises)');
      check(await page.isHidden('#noteExpenseBtn') && await page.isHidden('#sumList'), 'au départ : ni « 🧾 », ni liste de prix');
      await page.fill('#yenInput', '1200');
      check(await text(page, '#eurResult') === '6,50' && await page.isVisible('#noteExpenseBtn'), '1 200 ¥ = 6,50 € ; bouton 🧾 (noter comme dépense)');
      await page.click('#sumAddBtn');
      await page.fill('#yenInput', '850');
      const chips = await page.$$eval('#sumList button', l => l.map(b => b.textContent.replace(/\s/g, ' ')));
      check(chips.join('|') === '1 200 ¥ ×|Effacer' && await text(page, '#resultLabel') === 'Total en euros' && await text(page, '#eurResult') === '11,11',
        '＋ : 1 200 ¥ + 850 ¥ = 11,11 € (« Total en euros »)');
      await page.click('#sumAddBtn');
      await page.fill('#yenInput', '500');
      check(await text(page, '#eurResult') === '13,82', 'trois prix : 2 550 ¥ = 13,82 €');
      await page.click('#sumList .sum-chip >> nth=0'); // retire 1 200 ¥
      check(await text(page, '#eurResult') === '7,32', 'un prix retiré (×) : 1 350 ¥ = 7,32 €');
      await page.screenshot({ path: path.join(OUT, '01-convertisseur-addition.png') });
      await page.click('#swapBtn');
      check(await text(page, '#amountLabel') === 'Euro' && await value(page, '#yenInput') === '7,32' && await text(page, '#eurResult') === '1 351' && await page.isHidden('#sumList'),
        '⇅ : le total (7,32 €) devient le montant saisi, en euros → 1 351 ¥');
      check(await page.getAttribute('#yenInput', 'inputmode') === 'decimal', 'en euros : clavier avec virgule');
      await page.fill('#yenInput', '12,5');
      check(await value(page, '#yenInput') === '12,5' && await text(page, '#eurResult') === '2 306', '12,5 € = 2 306 ¥');
      await page.fill('#yenInput', '1234.567');
      check(await value(page, '#yenInput') === '1 234,56', 'saisie au point, plus de deux décimales : « 1 234,56 »');
      await page.reload();
      await ready(page);
      check(await text(page, '#amountLabel') === 'Euro' && await text(page, '#resultLabel') === 'Yen', 'le sens choisi est gardé (appli relancée)');
      await page.fill('#yenInput', '15');
      await page.click('#noteExpenseBtn');
      await page.waitForSelector('#view-expense-edit:not([hidden])');
      check(await value(page, '#expenseAmount') === '15' && await page.getAttribute('[data-currency="EUR"]', 'aria-selected') === 'true', '🧾 : dépense pré-remplie (15 €)');
      await page.click('#expenseCategories .filter-chip:has-text("Visites")');
      await page.fill('#expenseLabel', 'Temple Kinkaku-ji');
      await page.click('#topActions button:has-text("Enregistrer")');
      check(await toastHas(page, /Dépense notée : 15,00 €/) && await page.evaluate(() => currentViewName()) === 'converter', 'enregistrée : message, retour au convertisseur');
      await page.click('#swapBtn'); // remis en yens pour la suite
      check(page.errors.length === 0, 'convertisseur : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));

      // ---------- Dépenses : liste, totaux, modification, suppression, export, sauvegarde ----------
      await page.evaluate(() => goToSection('expenses'));
      await page.waitForSelector('#expensesList .expense-row');
      await page.click('#topActions button[aria-label="Nouvelle dépense"]');
      await page.fill('#expenseAmount', '980');
      await page.fill('#expenseLabel', 'Ramen Ichiran');
      await page.click('#topActions button:has-text("Enregistrer")');
      await page.waitForSelector('#view-expenses:not([hidden])');
      // Hier : un billet de train, en yens.
      await page.click('#topActions button[aria-label="Nouvelle dépense"]');
      await page.fill('#expenseAmount', '13900');
      await page.click('#expenseCategories .filter-chip:has-text("Transport")');
      await page.evaluate(() => {
        const d = new Date(Date.now() - 86400000);
        const p = n => (n < 10 ? '0' : '') + n;
        document.getElementById('expenseDate').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T09:30';
      });
      await page.click('#topActions button:has-text("Enregistrer")');
      await page.waitForSelector('#view-expenses:not([hidden])');
      await page.waitForFunction(() => document.querySelectorAll('#expensesList .expense-row').length === 3);
      const total = await text(page, '.expense-total');
      check(/17 648 ¥/.test(total) && /≈ 95,65 €/.test(total), 'total du voyage : 980 ¥ + 13 900 ¥ + 15 € (2 768 ¥) = 17 648 ¥ ≈ 95,65 € (' + total + ')');
      check(/Aujourd'hui : 3 748 ¥ · 20,31 €/.test(total), 'aujourd\'hui : 3 748 ¥ · 20,31 €');
      const days = await page.$$eval('.expense-day', l => l.map(e => e.textContent.replace(/\s+/g, ' ')));
      check(days.length === 2 && /13 900 ¥ · 75,34 €/.test(days[1]), 'deux jours, chacun avec son total (' + days.join(' / ') + ')');
      const cats = await page.$$eval('.expense-category-name', l => l.map(e => e.textContent));
      check(cats.join(',') === '🚆 Transport,⛩️ Visites,🍜 Repas', 'par catégorie, de la plus grosse à la plus petite (' + cats.join(', ') + ')');
      await page.screenshot({ path: path.join(OUT, '02-depenses.png'), fullPage: true });
      // Modifier : 980 → 1 180 ¥.
      await page.click('#expensesList .expense-row:has-text("Ramen Ichiran")');
      await page.waitForSelector('#view-expense-edit:not([hidden])');
      await waitText(page, '#expenseRate', /du jour de la dépense/);
      check(await value(page, '#expenseAmount') === '980' && /du jour de la dépense/.test(await text(page, '#expenseRate')) && await page.isVisible('#expenseDeleteBtn'), 'modifier : montant, taux du jour de la dépense, bouton Supprimer');
      await page.fill('#expenseAmount', '1180');
      await page.click('#topActions button:has-text("Enregistrer")');
      await page.waitForSelector('#view-expenses:not([hidden])');
      check(await waitText(page, '.expense-total', /17 848 ¥/) && await toastHas(page, /Dépense modifiée/), 'modifiée : total recalculé (17 848 ¥)');
      // Taux du jour changé : les dépenses gardent le leur.
      await page.evaluate(() => { currentRate = 200; });
      await page.click('#topActions button[aria-label="Nouvelle dépense"]');
      await page.fill('#expenseAmount', '2000');
      check(/1 € = 200,00 ¥/.test(await text(page, '#expenseRate')) && await text(page, '#expenseConverted') === '≈ 10,00 €', 'nouvelle dépense : au taux du jour (1 € = 200 ¥)');
      await page.click('#topActions button:has-text("Enregistrer")');
      await page.waitForSelector('#view-expenses:not([hidden])');
      check(await waitText(page, '.expense-total', /19 848 ¥/) && /≈ 106,73 €/.test(await text(page, '.expense-total')), 'chaque dépense convertie à son propre taux (≈ 106,73 €, pas 99,24 €)');
      // Supprimer.
      await page.locator('#expensesList .expense-row').filter({ hasText: /2\s000\s¥/ }).click();
      await page.waitForSelector('#expenseDeleteBtn:not([hidden])');
      await page.click('#expenseDeleteBtn');
      await dialogOk(page);
      await page.waitForFunction(() => document.querySelectorAll('#expensesList .expense-row').length === 3);
      check(await toastHas(page, /Dépense supprimée/), 'supprimée (après confirmation)');
      // Export CSV (feuille de partage d'Android).
      await page.click('#topActions button[aria-label="Options des dépenses"]');
      await page.click('#sheetPanel .sheet-item:has-text("Exporter")');
      await page.waitForFunction(() => window.__bridge.finished.some(f => /\.csv$/.test(f.name)));
      const csv = await page.evaluate(() => {
        const f = window.__bridge.finished.filter(x => /\.csv$/.test(x.name)).pop();
        const bytes = Uint8Array.from(f.b64.split('|').map(atob).join(''), c => c.charCodeAt(0));
        return { action: f.action, name: f.name, text: new TextDecoder().decode(bytes) };
      });
      const lines = csv.text.replace(/^﻿/, '').trim().split(/\r\n/);
      check(csv.action === 'share' && /^SOHRI-depenses-\d{4}-\d\d-\d\d\.csv$/.test(csv.name) && lines.length === 4, 'export : fichier CSV partagé (' + csv.name + ', ' + (lines.length - 1) + ' dépenses)');
      check(lines[0] === 'Date;Heure;Catégorie;Libellé;Montant;Devise;Taux (¥ pour 1 €);En yens;En euros' && lines.some(l => /;"Visites";"Temple Kinkaku-ji";15,00;EUR;184,50;2768;15,00$/.test(l)),
        'export : colonnes lisibles par un tableur (« ; », virgule décimale)');
      // Sauvegarde : les dépenses en font partie, et reviennent à la restauration.
      await page.evaluate(() => goToSection('settings'));
      const before = await page.evaluate(() => window.__bridge.finished.length);
      await page.click('#backupBtn');
      await page.waitForFunction(n => window.__bridge.finished.length > n && document.getElementById('progress').hidden, before);
      const zip = await page.evaluate(() => {
        const f = window.__bridge.finished[window.__bridge.finished.length - 1];
        return f.b64.split('|').map(atob).join('');
      });
      check(await waitText(page, '#backupInfo', /^Dernière sauvegarde sur ce téléphone : aujourd'hui\.$/), 'après la sauvegarde : « Dernière sauvegarde sur ce téléphone : aujourd\'hui »');
      await page.evaluate(() => dbReplaceAll({}));
      await page.reload();
      await ready(page);
      await page.evaluate(() => goToSection('settings'));
      await page.setInputFiles('#restoreInput', { name: 'SOHRI-sauvegarde.zip', mimeType: 'application/zip', buffer: Buffer.from(zip, 'latin1') });
      await page.waitForSelector('#dialog:not([hidden])');
      check(/3 dépenses/.test(await text(page, '#dialogMessage')), 'restauration : « 3 dépenses » dans le résumé');
      await Promise.all([page.waitForNavigation(), page.click('#dialogOkBtn')]);
      await ready(page);
      const restored = await page.evaluate(async () => (await dbGetAll('expenses')).map(e => (e.label || e.category) + ' ' + e.amount + ' ' + e.currency).sort().join(', '));
      check(restored === 'Ramen Ichiran 1180 JPY, Temple Kinkaku-ji 15 EUR, transport 13900 JPY', 'restaurées : les 3 dépenses reviennent (' + restored + ')');
      check(page.errors.length === 0, 'dépenses : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await context.close();
    }

    // ---------- Météo : heure par heure ----------
    {
      const { context, page } = await newPhone(browser, { weather: true });
      await page.goto(url);
      await ready(page);
      await page.evaluate(() => goToSection('weather'));
      await page.waitForSelector('.weather-hours .weather-hour');
      const hours = await page.$$eval('.weather-hour', l => l.map(e => e.querySelector('.weather-hour-time').textContent));
      const tokyoHour = await page.evaluate(() => new Date(Date.now() + 9 * 3600000).getUTCHours());
      check(hours.length === 24 && hours[0] === tokyoHour + ' h', 'heure par heure : 24 heures, à partir de l\'heure en cours à Tokyo (' + hours.slice(0, 3).join(', ') + '…)');
      check(hours.includes('Demain'), 'minuit marqué « Demain »');
      const first = await page.$eval('.weather-hour', e => ({ now: e.classList.contains('is-now'), temp: e.querySelector('.weather-hour-temp').textContent, rain: e.querySelector('.weather-hour-rain').textContent }));
      check(first.now && first.temp === (10 + tokyoHour) + '°' && first.rain === '💧' + tokyoHour * 4 + '%', 'heure en cours mise en avant, température et pluie (' + JSON.stringify(first) + ')');
      await page.screenshot({ path: path.join(OUT, '03-meteo-heures.png') });
      // Hors connexion : gardée sur le téléphone.
      await context.route(/api\.open-meteo\.com/, route => route.abort('internetdisconnected'));
      await page.reload();
      await ready(page);
      await page.evaluate(() => goToSection('weather'));
      check(await page.waitForSelector('.weather-hours .weather-hour', { timeout: 5000 }).then(() => true, () => false), 'hors connexion : l\'heure par heure reste affichée');
      check(page.errors.length === 0, 'météo : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await context.close();
    }

    // ---------- Phrases utiles ----------
    {
      const { context, page } = await newPhone(browser);
      await page.goto(url);
      await ready(page);
      await page.evaluate(() => goToSection('phrases'));
      await page.waitForSelector('.phrase-row');
      const groups = await page.$$eval('#phrasesContent .section-title', l => l.map(e => e.textContent));
      check(groups.length === 6 && groups[0] === '🙏 Politesse' && groups[5] === '🚑 Urgences', 'phrases rangées par thème (' + groups.join(', ') + ')');
      check(await page.$$eval('.phrase-row', l => l.length) >= 35, 'une quarantaine de phrases');
      await page.fill('#phrasesSearch', 'toilettes');
      await page.waitForFunction(() => document.querySelectorAll('.phrase-row').length === 1);
      check(/トイレはどこですか/.test(await text(page, '.phrase-row')), 'recherche « toilettes » : トイレはどこですか？');
      await page.click('.phrase-row');
      check(await page.isVisible('#phraseCard') && await text(page, '#phraseJa') === 'トイレはどこですか？' && await text(page, '#phraseRomaji') === 'Toire wa doko desu ka ?', 'en grand, à montrer : japonais, prononciation, français');
      await page.screenshot({ path: path.join(OUT, '04-phrase-en-grand.png') });
      check(await page.evaluate(() => handleBackButton()) === true && await page.isHidden('#phraseCard'), 'bouton retour d\'Android : ferme la phrase');
      await page.fill('#phrasesSearch', 'ambulance');
      await page.waitForFunction(() => document.querySelectorAll('.phrase-row').length === 1);
      await page.click('.emergency-card .action-btn:has-text("119")');
      check(await page.evaluate(() => window.__bridge.opened) === 'tel:119', 'numéros d\'urgence : 119 appelé d\'un toucher');
      check(page.errors.length === 0, 'phrases : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await context.close();
    }

    // ---------- Rappel de sauvegarde ----------
    {
      const { context, page } = await newPhone(browser);
      await page.goto(url);
      await ready(page);
      await page.waitForTimeout(4500);
      check(await page.isHidden('#banner'), 'première ouverture : pas de rappel');
      await page.evaluate(() => {
        localStorage.setItem('sohri.firstSeen', JSON.stringify(Date.now() - 10 * 86400000));
        return dbPut('notes', { title: 'Itinéraire', body: 'Tokyo, Kyoto', icon: '📝', folderId: null, addressId: null, pinned: false, images: [], attachments: [], createdAt: Date.now(), updatedAt: Date.now() });
      });
      await page.reload();
      await ready(page);
      await page.waitForSelector('#banner:not([hidden])', { timeout: 8000 });
      check(/Pas de sauvegarde récente/.test(await text(page, '#bannerText')) && await text(page, '#bannerActionBtn') === 'Sauvegarder', 'utilisée depuis 10 jours sans sauvegarde : rappel « Sauvegarder »');
      await page.screenshot({ path: path.join(OUT, '05-rappel-sauvegarde.png') });
      await page.click('#bannerCloseBtn');
      await page.reload();
      await ready(page);
      await page.waitForTimeout(4500);
      check(await page.isHidden('#banner'), '× : plus de rappel pendant 3 jours');
      await page.evaluate(() => {
        localStorage.setItem('sohri.backupLater', JSON.stringify(Date.now() - 1000));
        localStorage.setItem('sohri.lastBackup', JSON.stringify(Date.now() - 8 * 86400000));
      });
      await page.reload();
      await ready(page);
      await page.waitForSelector('#banner:not([hidden])', { timeout: 8000 });
      check(/date de 8 jours/.test(await text(page, '#bannerText')), 'dernière sauvegarde il y a 8 jours : rappel');
      const lastBackupAge = () => page.evaluate(() => Date.now() - JSON.parse(localStorage.getItem('sohri.lastBackup')));
      // Fenêtre « Enregistrer sous » fermée sans choisir d'emplacement : rien n'est noté.
      await page.evaluate(() => { window.__bridge.cancelSave = true; });
      let n = await page.evaluate(() => window.__bridge.finished.length);
      await page.click('#bannerActionBtn');
      await page.waitForFunction(k => window.__bridge.finished.length > k && document.getElementById('progress').hidden, n);
      await page.waitForTimeout(700);
      check((await page.evaluate(() => window.__bridge.finished[window.__bridge.finished.length - 1].action)) === 'save' && await lastBackupAge() > 7 * 86400000,
        '« Sauvegarder », mais emplacement pas choisi (fenêtre fermée) : pas de sauvegarde notée');
      // Emplacement choisi : la date est notée.
      await page.evaluate(() => { window.__bridge.cancelSave = false; goToSection('settings'); });
      n = await page.evaluate(() => window.__bridge.finished.length);
      await page.click('#backupBtn');
      await page.waitForFunction(k => window.__bridge.finished.length > k && document.getElementById('progress').hidden, n);
      check(await waitText(page, '#backupInfo', /^Dernière sauvegarde sur ce téléphone : aujourd'hui\.$/) && await lastBackupAge() < 60000,
        'emplacement choisi : sauvegarde notée, Paramètres « Dernière sauvegarde sur ce téléphone : aujourd\'hui »');

      // ---------- Rapport de diagnostic ----------
      await page.evaluate(() => console.warn('Météo pas encore reçue', new Error('Failed to fetch')));
      await page.evaluate(() => renderSettings());
      await page.waitForFunction(() => !!diagnosticReport);
      await page.click('#diagnosticBtn');
      await page.waitForFunction(() => window.__bridge.texts.length === 1);
      const report = await page.evaluate(() => window.__bridge.texts[0]);
      check(/^Rapport SOHRI du /.test(report) && /Appli : appli Android 2\.3/.test(report) && /Contenu : 1 note, 0 adresse, 0 dossier ou album, 0 photo, 0 document, 0 dépense, 0 étape\n/.test(report) && /Dernière sauvegarde : aujourd'hui/.test(report),
        'rapport : version, contenu (nombres), dernière sauvegarde');
      check(/Compte : aucun/.test(report) && /Météo pas encore reçue Failed to fetch/.test(report), 'rapport : compte, et dernières erreurs');
      check(!/Itinéraire|Tokyo, Kyoto/.test(report), 'rapport : rien de personnel (ni titre ni texte de note)');
      const errorLines = report.split('\n').filter(l => /^- /.test(l)).map(l => l.replace(/^- \S+ \S+ \S+ /, '').replace(/ \(\d+ fois.*\)$/, ''));
      check(errorLines.length >= 2 && new Set(errorLines).size === errorLines.length && /Météo pas encore reçue Failed to fetch \(\d+ fois/.test(report),
        'rapport : un message répété n\'apparaît qu\'une fois, avec son nombre (' + errorLines.length + ' messages différents)');
      fs.writeFileSync(path.join(OUT, 'rapport.txt'), report);
      check(page.errors.length === 0, 'rappel et rapport : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await context.close();
    }

    // ---------- Témoin de synchronisation dans le menu ----------
    {
      const { context, page } = await newPhone(browser);
      await page.goto(url);
      await ready(page);
      const look = () => page.evaluate(() => {
        const s = document.querySelector('#drawerSharing .drawer-sync');
        return { hidden: s.hidden, icon: s.textContent, cls: s.className, alert: document.getElementById('navBtn').classList.contains('has-alert') };
      });
      check((await look()).hidden, 'sans compte : rien à côté de « Partage »');
      await page.evaluate(() => { cloudSession = { uid: 'moi' }; setCloudStatus('syncing'); });
      let s = await look();
      check(!s.hidden && s.icon === '⟳' && /is-busy/.test(s.cls) && !s.alert, 'synchronisation en cours : ⟳ qui tourne');
      await page.evaluate(() => setCloudStatus('done'));
      s = await look();
      check(s.icon === '✓' && /is-ok/.test(s.cls), 'à jour : ✓');
      await page.evaluate(() => setCloudStatus('offline'));
      s = await look();
      check(s.icon === '📴' && !s.alert, 'hors connexion : 📴, sans alerte');
      await page.evaluate(() => setCloudStatus('error', { error: new Error('x') }));
      s = await look();
      check(s.icon === '⚠️' && s.alert, 'problème : ⚠️, et point orange sur ☰');
      await page.screenshot({ path: path.join(OUT, '06-alerte-synchro.png') });
      await page.evaluate(() => { cloudSession = null; notifyCloud('data'); });
      s = await look();
      check(s.hidden && !s.alert, 'déconnecté : plus rien');
      check(page.errors.length === 0, 'témoin : aucune erreur' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));
      await context.close();
    }

    // ---------- iPhone : rapport et convertisseur (WebKit) ----------
    {
      const dir = path.join(OUT, 'profil-iphone');
      fs.rmSync(dir, { recursive: true, force: true });
      const context = await webkit.launchPersistentContext(dir, { ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
      await blockExternal(context);
      // Feuille de partage simulée : textes gardés ; fichiers « enregistrés », ou feuille fermée (abort).
      await context.addInitScript(() => {
        window.__texts = []; window.__files = []; window.__abort = false;
        navigator.canShare = d => !!(d && d.files && d.files.length);
        navigator.share = d => {
          if (!d.files) { window.__texts.push(d.text); return Promise.resolve(); }
          window.__files.push(d.files[0].name);
          return window.__abort ? Promise.reject(new DOMException('Partage annulé', 'AbortError')) : Promise.resolve();
        };
      });
      const page = context.pages()[0] || await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await ready(page);
      await page.fill('#yenInput', '3000');
      await page.click('#sumAddBtn');
      await page.fill('#yenInput', '1500');
      check(await text(page, '#eurResult') === '24,39', 'iPhone : addition 3 000 ¥ + 1 500 ¥ = 24,39 €');
      await page.evaluate(() => goToSection('settings'));
      await page.waitForFunction(() => !!diagnosticReport);
      await page.click('#diagnosticBtn');
      await page.waitForFunction(() => window.__texts.length === 1);
      check(/Appli : version web.*navigateur/.test(await page.evaluate(() => window.__texts[0])), 'iPhone : rapport envoyé par la feuille de partage (version web)');
      // Sauvegarde : notée seulement si un choix est fait dans la feuille de partage.
      await page.evaluate(() => { window.__abort = true; });
      await page.click('#backupBtn');
      await page.waitForFunction(() => window.__files.length === 1 && document.getElementById('progress').hidden);
      await page.waitForTimeout(300);
      check(await page.evaluate(() => localStorage.getItem('sohri.lastBackup')) === null && /Aucune sauvegarde récente/.test(await text(page, '#backupInfo')),
        'iPhone : feuille de partage fermée sans rien choisir : pas de sauvegarde notée');
      await page.evaluate(() => { window.__abort = false; });
      await page.click('#backupBtn');
      await page.waitForFunction(() => window.__files.length === 2);
      check(/^SOHRI-sauvegarde-\d{4}-\d\d-\d\d\.zip$/.test(await page.evaluate(() => window.__files[1])) && await waitText(page, '#backupInfo', /aujourd'hui/),
        'iPhone : « Enregistrer dans Fichiers » : sauvegarde notée (aujourd\'hui)');
      check(errors.length === 0, 'iPhone : aucune erreur' + (errors.length ? ' : ' + errors.join(' | ') : ''));
      await context.close();
    }
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
