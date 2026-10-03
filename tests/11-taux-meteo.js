// Taux du jour (repris dès qu'il y a Internet, taux à la main gardé jusqu'au suivant) et catégorie
// Météo & heure (semaine en cours, Internet un instant suffit, hors connexion, lundi, villes).
// Services simulés : Frankfurter / jsDelivr (taux), Open-Meteo (météo, recherche de ville).
// Usage : node 11-taux-meteo.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require("./lib/chrome");
const FRANKFURTER = /api\.frankfurter\.dev\/v1\/latest/;
const JSDELIVR = /cdn\.jsdelivr\.net\/npm\/@fawazahmed0/;
const FORECAST = /api\.open-meteo\.com\/v1\/forecast/;
const GEOCODING = /geocoding-api\.open-meteo\.com\/v1\/search/;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let prefix = '';
function check(ok, msg) { results.push([!!ok, prefix + msg]); console.log((ok ? 'PASS ' : 'FAIL ') + prefix + msg); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

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

// Prévisions simulées : 13 jours (6 passés, aujourd'hui, 6 à venir) à partir de « first ».
function forecast(first, tz, offset, seed) {
  const time = [], code = [], max = [], min = [], rain = [];
  const codes = [0, 2, 61, 3, 95, 1, 71, 45, 80, 0, 2, 63, 3];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.parse(first + 'T00:00:00Z') + i * 86400000);
    time.push(d.toISOString().slice(0, 10));
    code.push(codes[(i + seed) % codes.length]);
    max.push(20 + ((i + seed) % 7) + 0.4);
    min.push(12 + ((i + seed) % 5) - 0.4);
    rain.push(((i + seed) * 17) % 100);
  }
  return {
    utc_offset_seconds: offset, timezone: tz,
    current: { temperature_2m: 23.6, apparent_temperature: 25.2, weather_code: 2, is_day: 1 },
    daily: { time, weather_code: code, temperature_2m_max: max, temperature_2m_min: min, precipitation_probability_max: rain }
  };
}

async function newPhone(browser, engine, options = {}) {
  const base = engine === 'webkit' ? { ...devices['iPhone 14 Plus'] } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const context = await browser.newContext({ ...base, locale: 'fr-FR', serviceWorkers: 'block', colorScheme: options.scheme || 'light' });
  await blockExternal(context);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.errors.push('dialogue natif : ' + d.message()); d.dismiss(); });
  return { context, page };
}
const rateText = page => page.evaluate(() => ({ rate: document.getElementById('rateText').textContent, note: document.getElementById('rateNote').textContent, eur: document.getElementById('eurResult').textContent }));

// ---------- Taux du jour ----------
async function rateTests(engine, url) {
  prefix = `[${engine}, taux] `;
  const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: CHROME });
  const { context, page } = await newPhone(browser, engine);
  let frank = { date: '2026-09-29', rate: 178.41, status: 200 };
  let jsdDate = '2026-09-30';
  let calls = 0;
  await context.route(FRANKFURTER, route => {
    calls++;
    if (frank.status !== 200) return route.fulfill({ status: frank.status, body: 'erreur' });
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ amount: 1, base: 'EUR', date: frank.date, rates: { JPY: frank.rate } }) });
  });
  await context.route(JSDELIVR, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ date: jsdDate, eur: { jpy: 178.9, usd: 1.17 } }) }));
  await page.clock.install({ time: new Date('2026-09-30T08:00:00Z') });
  await page.goto(url);
  await page.waitForFunction(() => /178,41/.test(document.getElementById('rateText').textContent), null, { timeout: 10000 });
  await page.fill('#yenInput', '10000');
  let t = await rateText(page);
  check(t.rate === '1 € = 178,41 ¥' && t.eur === '56,05' && /Taux de la BCE du 29 sept\., mis à jour tout seul avec Internet/.test(t.note),
    'au lancement avec Internet : taux du jour (178,41), 10 000 ¥ = 56,05 €, « Taux de la BCE du 29 sept. » ' + JSON.stringify(t));
  await page.screenshot({ path: path.join(OUT, `taux-${engine}.png`) });
  // Taux de sa carte, à la main : gardé tant qu'aucun taux plus récent n'est publié.
  await page.click('#rateEditBtn');
  await page.fill('#rateInput', '180');
  await page.click('#rateSaveBtn');
  t = await rateText(page);
  check(t.rate === '1 € = 180,00 ¥' && /modifié à la main/.test(t.note), 'taux modifié à la main : 180,00, « modifié à la main » ' + JSON.stringify(t));
  frank.date = '2026-09-30'; frank.rate = 178.6;
  await page.evaluate(() => { rateInfo.checkedAt = 0; return refreshRate(); });
  t = await rateText(page);
  check(t.rate === '1 € = 180,00 ¥', 'taux du même jour : le taux à la main reste (' + t.rate + ')');
  frank.date = '2026-10-01'; frank.rate = 177.95;
  await page.evaluate(() => { rateInfo.checkedAt = 0; return refreshRate(); });
  t = await rateText(page);
  check(t.rate === '1 € = 177,95 ¥' && /du 1 oct\./.test(t.note) && t.eur === '56,20', 'nouveau taux publié le lendemain : il remplace celui à la main (177,95 ; 56,20 €) ' + JSON.stringify(t));
  // Pas plus d'une demande par heure (retour dans l'appli...), sauf retour du réseau après 10 min.
  const before = calls;
  await page.evaluate(() => refreshRate());
  check(calls === before, 'vérifié il y a moins d\'une heure : pas de nouvelle demande');
  // Frankfurter en panne : taux du marché (jsDelivr) ; plus ancien que celui affiché, il est ignoré.
  frank.status = 500;
  await page.evaluate(() => { rateInfo.checkedAt = 0; return refreshRate(); });
  t = await rateText(page);
  check(t.rate === '1 € = 177,95 ¥', 'service de secours en retard (30 sept.) : le taux du 1er oct. reste (' + t.rate + ')');
  jsdDate = '2026-10-02';
  await page.evaluate(() => { rateInfo.checkedAt = 0; return refreshRate(); });
  t = await rateText(page);
  check(t.rate === '1 € = 178,90 ¥' && /du marché du 2 oct\./.test(t.note), 'service BCE indisponible : taux du marché en secours ' + JSON.stringify(t));
  // Réponse absurde : ignorée.
  frank.status = 200; frank.date = '2026-10-03'; frank.rate = 0.5;
  await context.unroute(JSDELIVR);
  await context.route(JSDELIVR, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"date":"2026-10-03","eur":{}}' }));
  await page.evaluate(() => { rateInfo.checkedAt = 0; return refreshRate(); });
  t = await rateText(page);
  check(t.rate === '1 € = 178,90 ¥', 'taux absurde reçu : ignoré, le précédent reste');
  // Gardé sur le téléphone : même hors connexion après rechargement.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  t = await rateText(page);
  check(t.rate === '1 € = 178,90 ¥' && /du marché/.test(t.note), 'après rechargement : le dernier taux reçu est gardé');
  check(page.errors.length === 0, 'aucune erreur ' + JSON.stringify(page.errors));
  await context.close();

  if (engine === 'chromium') {
    // Démarrage sans Internet, puis Internet une minute : le taux arrive aussitôt.
    const p = await newPhone(browser, engine);
    let n = 0;
    let internet = false; // l'appli se charge (serveur local), mais pas d'Internet
    await p.context.route(FRANKFURTER, route => {
      if (!internet) return route.abort('internetdisconnected');
      n++;
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ amount: 1, base: 'EUR', date: '2026-09-29', rates: { JPY: 178.41 } }) });
    });
    await p.page.goto(url);
    await p.page.waitForTimeout(800);
    const offline = await rateText(p.page);
    await p.context.setOffline(true);
    internet = true;
    await p.context.setOffline(false); // le téléphone retrouve le réseau : événement « online »
    await p.page.waitForFunction(() => /178,41/.test(document.getElementById('rateText').textContent), null, { timeout: 5000 }).catch(() => {});
    const online = await rateText(p.page);
    check(offline.rate === '1 € = 184,50 ¥' && /Taux indicatif/.test(offline.note) && online.rate === '1 € = 178,41 ¥' && n === 1,
      'sans Internet : taux indicatif ; Internet revient : taux du jour aussitôt (' + offline.rate + ' → ' + online.rate + ')');
    await p.context.close();
  }
  await browser.close();
}

// ---------- Météo & heure ----------
async function weatherTests(engine, url) {
  prefix = `[${engine}, météo] `;
  const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: CHROME });
  const { context, page } = await newPhone(browser, engine);
  const requests = [];
  let online = true;
  let weekFirst = '2026-09-25';
  await context.route(FORECAST, route => {
    const u = new URL(route.request().url());
    requests.push(u.searchParams.get('latitude') + ',' + u.searchParams.get('longitude'));
    if (!online) return route.abort('internetdisconnected');
    const paris = u.searchParams.get('latitude').startsWith('48.8');
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(paris ? forecast(weekFirst, 'Europe/Paris', 7200, 3) : forecast(weekFirst, 'Asia/Tokyo', 32400, 0)) });
  });
  await context.route(GEOCODING, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ results: [{ name: 'Paris', latitude: 48.85341, longitude: 2.3488, country: 'France', admin1: 'Île-de-France', timezone: 'Europe/Paris' }] }) }));
  // Jeudi 1er octobre, midi à Tokyo.
  await page.clock.install({ time: new Date('2026-10-01T03:00:00Z') });
  await page.goto(url);
  await page.evaluate(() => goToSection('weather'));
  await page.waitForFunction(() => document.querySelectorAll('#weatherContent .weather-day').length === 7 && !/Mise à jour de la météo/.test(document.getElementById('weatherContent').textContent), null, { timeout: 10000 });
  await page.waitForFunction(() => /°/.test(document.querySelector('#weatherContent .weather-day.is-today .weather-day-temps').textContent), null, { timeout: 10000 });
  const w = await page.evaluate(() => ({
    title: document.getElementById('viewTitle').textContent,
    city: document.querySelector('.weather-city').textContent,
    clocks: [...document.querySelectorAll('#view-weather [data-clock]')].map(e => e.textContent).join(' '),
    days: [...document.querySelectorAll('.weather-day')].map(e => e.querySelector('.weather-day-name').textContent),
    today: document.querySelector('.weather-day.is-today .weather-day-name').textContent,
    past: document.querySelectorAll('.weather-day.is-past').length,
    temps: [...document.querySelectorAll('.weather-day-temps')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    now: document.querySelector('.weather-now-temp').textContent,
    status: document.querySelector('.weather-status').textContent,
    menu: document.querySelector('.drawer-item[data-section="weather"]').textContent.trim()
  }));
  check(w.title === 'Météo & heure' && w.menu.includes('Météo & heure'), 'catégorie « Météo & heure » dans le menu');
  check(w.clocks === '12:00 05:00', 'en haut : heure du Japon et de la France (' + w.clocks + ')');
  check(w.days.join(',') === "lun. 28,mar. 29,mer. 30,Aujourd'hui,ven. 2,sam. 3,dim. 4" && w.past === 3,
    'semaine en cours du lundi au dimanche, aujourd\'hui en évidence, jours passés estompés : ' + w.days.join(', '));
  check(w.temps.every(t => /^-?\d+° -?\d+°$/.test(t)) && w.now === '24°' && w.city === 'Météo · Tokyo', 'températures max / min chaque jour, maintenant 24° à Tokyo : ' + w.temps.join(' | '));
  check(/Mise à jour aujourd'hui à \d\d:\d\d\./.test(w.status), 'mise à jour indiquée : ' + w.status);
  await page.screenshot({ path: path.join(OUT, `meteo-${engine}.png`), fullPage: true });
  const noHorizontal = await page.evaluate(() => { const m = document.getElementById('content'); return m.scrollWidth <= m.clientWidth + 1; });
  check(noHorizontal, 'pas de défilement de côté');

  // Pas de nouvelle demande avant 30 minutes, même en revenant sur la page.
  const count = requests.length;
  await page.evaluate(() => { goToSection('converter'); goToSection('weather'); });
  await page.waitForTimeout(300);
  check(requests.length === count, 'revenue sur la page : pas de nouvelle demande (météo récente)');

  // Lundi suivant : la nouvelle semaine s'affiche ; sans Internet, elle attend ; un instant d'Internet suffit.
  online = false;
  await page.clock.setSystemTime(new Date('2026-10-05T00:30:00Z')); // lundi 5, 9 h 30 à Tokyo
  await page.clock.runFor(61000);
  await page.waitForFunction(() => document.querySelector('.weather-day.is-today') && document.querySelector('.weather-day').textContent.startsWith('Aujourd'));
  let monday = await page.evaluate(() => ({
    days: [...document.querySelectorAll('.weather-day')].map(e => e.querySelector('.weather-day-name').textContent).join(','),
    empty: [...document.querySelectorAll('.weather-day-temps')].filter(e => e.textContent.trim() === '—').length,
    status: document.querySelector('.weather-status').textContent
  }));
  check(monday.days === "Aujourd'hui,mar. 6,mer. 7,jeu. 8,ven. 9,sam. 10,dim. 11", 'le lundi, la nouvelle semaine s\'affiche : ' + monday.days);
  check(monday.empty >= 4 && /Prévisions de cette semaine à recevoir/.test(monday.status), 'jours pas encore reçus : « — », et c\'est dit (' + monday.status + ')');
  online = true;
  weekFirst = '2026-09-29';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => [...document.querySelectorAll('.weather-day-temps')].every(e => /°/.test(e.textContent)), null, { timeout: 5000 }).then(() => {}, () => {});
  monday = await page.evaluate(() => [...document.querySelectorAll('.weather-day-temps')].filter(e => /°/.test(e.textContent)).length);
  check(monday === 7, 'Internet revient : la semaine est reçue aussitôt (' + monday + '/7 jours)');

  // Autre ville, dans la liste (sans Internet), puis par la recherche.
  await page.click('#topActions button[aria-label="Changer de ville"]');
  await page.click('#sheetPanel .sheet-item:has-text("Kyoto")');
  await page.waitForFunction(() => document.querySelector('.weather-city').textContent === 'Météo · Kyoto');
  await page.waitForTimeout(300);
  check(requests[requests.length - 1] === '35.0116,135.7681', 'Kyoto choisie : sa météo est demandée (' + requests[requests.length - 1] + ')');
  await page.click('.weather-head .link-btn');
  await page.click('#sheetPanel .sheet-create');
  await page.waitForSelector('#dialog:not([hidden])');
  await page.fill('#dialogInput', 'Paris');
  await page.click('#dialogOkBtn');
  await page.click('#sheetPanel .sheet-item:has-text("Paris")');
  await page.waitForFunction(() => document.querySelector('.weather-city').textContent === 'Météo · Paris');
  await page.waitForFunction(() => [...document.querySelectorAll('.weather-day-temps')].every(e => /°/.test(e.textContent)), null, { timeout: 5000 }).then(() => {}, () => {});
  const paris = await page.evaluate(() => ({ today: document.querySelector('.weather-day.is-today .weather-day-name').textContent, first: document.querySelector('.weather-day .weather-day-name').textContent, saved: weatherCity.timezone }));
  // Lundi 5 à 2 h 30 à Paris (0 h 30 UTC + 2 h) : toujours le lundi.
  check(paris.saved === 'Europe/Paris' && paris.first === "Aujourd'hui", 'recherche « Paris » : ville trouvée, semaine à l\'heure de Paris (' + JSON.stringify(paris) + ')');

  // Rechargée sans Internet : la dernière météo reste affichée.
  online = false;
  await page.reload();
  await page.evaluate(() => goToSection('weather'));
  await page.waitForTimeout(600);
  const kept = await page.evaluate(() => ({ city: document.querySelector('.weather-city').textContent, temps: [...document.querySelectorAll('.weather-day-temps')].filter(e => /°/.test(e.textContent)).length }));
  check(kept.city === 'Météo · Paris' && kept.temps === 7, 'rouverte sans Internet : la dernière météo reçue reste consultable (' + JSON.stringify(kept) + ')');
  check(page.errors.length === 0, 'aucune erreur ' + JSON.stringify(page.errors));
  await context.close();

  // Thème sombre, petit écran : capture.
  const dark = await newPhone(browser, engine, { scheme: 'dark' });
  await dark.context.route(FORECAST, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(forecast('2026-09-25', 'Asia/Tokyo', 32400, 0)) }));
  await dark.page.clock.install({ time: new Date('2026-10-01T03:00:00Z') });
  await dark.page.goto(url);
  await dark.page.evaluate(() => goToSection('weather'));
  await dark.page.waitForFunction(() => /°/.test((document.querySelector('.weather-day.is-today .weather-day-temps') || {}).textContent || ''), null, { timeout: 10000 });
  await dark.page.screenshot({ path: path.join(OUT, `meteo-${engine}-sombre.png`), fullPage: true });
  await dark.context.close();
  await browser.close();
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    for (const engine of ['chromium', 'webkit']) {
      await rateTests(engine, url);
      await weatherTests(engine, url);
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
