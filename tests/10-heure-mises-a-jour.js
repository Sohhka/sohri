// Heure au Japon et en France sous le convertisseur (heure d'été, minuit, sans Intl, mise en page
// sans défilement) ; appli Android : nouvelle version sur GitHub proposée, « Mettre à jour » ouvre
// la page de la release.
// Usage : node 10-heure-mises-a-jour.js <www> <sorties>
const { chromium, webkit, devices } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require("./lib/chrome");
const API = 'https://api.github.com/repos/Sohhka/sohri/releases/latest';
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

async function launch(engine) {
  return engine === 'webkit' ? webkit.launch() : chromium.launch({ executablePath: CHROME });
}
const clockText = page => page.evaluate(() => ({
  japan: document.getElementById('clockJapan').textContent, japanDay: document.getElementById('clockJapanDay').textContent,
  france: document.getElementById('clockFrance').textContent, franceDay: document.getElementById('clockFranceDay').textContent,
  gap: document.getElementById('clockGap').textContent
}));

async function clockTests(engine, url) {
  prefix = `[${engine}] `;
  const browser = await launch(engine);
  const context = await browser.newContext({ ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
  await blockExternal(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('clockJapan').textContent !== '--:--');
  let t = await clockText(page);
  check(t.japan === '21:00' && t.france === '14:00' && t.japanDay === 'mer. 30 sept.' && t.franceDay === 'mer. 30 sept.' && t.gap === "7 h d'écart",
    'été : Japon 21:00, France 14:00 (24 h), mêmes jours, « 7 h d\'écart » ' + JSON.stringify(t));
  await page.screenshot({ path: path.join(OUT, `heures-${engine}.png`) });
  // En direct : une minute plus tard, sans rien toucher.
  await page.clock.runFor(60000);
  t = await clockText(page);
  check(t.japan === '21:01' && t.france === '14:01', 'mise à jour toute seule chaque minute (' + t.japan + ' / ' + t.france + ')');
  // Hiver, et Japon déjà au lendemain.
  await page.clock.setSystemTime(new Date('2026-12-15T22:30:00Z'));
  await page.clock.runFor(1000);
  t = await clockText(page);
  check(t.france === '23:30' && t.franceDay === 'mar. 15 déc.' && t.japan === '07:30' && t.japanDay === 'mer. 16 déc.' && t.gap === "8 h d'écart",
    'hiver : France 23:30 le 15, Japon 07:30 le 16, « 8 h d\'écart » ' + JSON.stringify(t));
  // Passage à l'heure d'été en France (dernier dimanche de mars 2027 : le 28, à 1 h UTC).
  await page.clock.setSystemTime(new Date('2027-03-28T00:59:00Z'));
  await page.clock.runFor(1000);
  const before = (await clockText(page)).france;
  await page.clock.runFor(60000);
  const after = (await clockText(page)).france;
  check(before === '01:59' && after === '03:00', 'heure d\'été : 01:59 puis 03:00 (' + before + ' → ' + after + ')');
  // Sans les fuseaux du téléphone : même résultat, heure par heure sur trois ans.
  const fallback = await page.evaluate(() => {
    let diff = 0;
    const start = Date.UTC(2026, 0, 1);
    for (let t = start; t < Date.UTC(2029, 0, 1); t += 1800000) {
      const d = new Date(t);
      if (zoneOffset(d, 'Europe/Paris', franceOffsetRule) !== franceOffsetRule(d)) diff++;
      if (zoneOffset(d, 'Asia/Tokyo', () => 540) !== 540) diff++;
    }
    const Orig = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function (locale, options) {
      if (options && options.timeZone) throw new RangeError('fuseau inconnu');
      return new Orig(locale, options);
    };
    clockFormats = {};
    clockMinute = null;
    tickClock();
    const shown = document.getElementById('clockFrance').textContent + ' ' + document.getElementById('clockJapan').textContent;
    Intl.DateTimeFormat = Orig;
    clockFormats = {};
    return { diff, shown };
  });
  check(fallback.diff === 0 && fallback.shown === '03:00 10:00', 'sans les fuseaux du téléphone : règle de secours identique sur 3 ans (' + JSON.stringify(fallback) + ')');
  // Rien ne tourne quand on quitte le convertisseur ; tout repart en y revenant.
  await page.evaluate(() => goToSection('notes'));
  await page.waitForTimeout(100);
  const stopped = await page.evaluate(() => clockTimer === null);
  await page.evaluate(() => goToSection('converter'));
  await page.waitForTimeout(100);
  check(stopped && await page.evaluate(() => clockTimer !== null), 'arrêtée hors du convertisseur, relancée au retour');
  check(errors.length === 0, 'aucune erreur ' + JSON.stringify(errors));
  await browser.close();
}

// La page du convertisseur tient sans défilement, heures comprises (carte, puis ligne, puis masquées).
async function layoutTests(engine, url) {
  prefix = `[${engine}, mise en page] `;
  const browser = await launch(engine);
  for (const [w, hgt, label] of [[430, 932, 'grand téléphone'], [390, 844, 'iPhone 14'], [375, 667, 'iPhone SE'], [360, 640, 'petit Android'], [320, 568, 'très petit'], [390, 430, 'clavier ouvert']]) {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', colorScheme: scheme, serviceWorkers: 'block' });
      await blockExternal(context);
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => document.getElementById('clockJapan').textContent !== '--:--');
      await page.evaluate(() => { const b = document.getElementById('banner'); if (b && !b.hidden) closeBanner(); fitClock(); });
      await page.waitForTimeout(150);
      const s = await page.evaluate(() => {
        const main = document.getElementById('content');
        const clock = document.getElementById('worldClock');
        return {
          fits: main.scrollHeight <= main.clientHeight + 1, wide: main.scrollWidth <= main.clientWidth + 1,
          state: clock.hidden ? 'masquées' : clock.classList.contains('is-compact') ? 'sur une ligne' : 'carte'
        };
      });
      // Clavier ouvert : le convertisseur seul déborde déjà (on défile pendant la saisie) ; les
      // heures, elles, s'effacent pour ne rien ajouter.
      const keyboard = label === 'clavier ouvert';
      if (scheme === 'light') check((keyboard ? s.state === 'masquées' : s.fits) && s.wide, `${label} (${w}×${hgt}) : ${keyboard ? 'heures effacées pendant la saisie' : 'sans défilement, heures en ' + s.state}`);
      if (label === 'petit Android' || label === 'très petit' || label === 'iPhone 14') await page.screenshot({ path: path.join(OUT, `convertisseur-${engine}-${w}x${hgt}-${scheme}.png`) });
      await context.close();
    }
  }
  await browser.close();
}

// ---------- Appli Android : nouvelle version ----------
async function updateTests(url) {
  prefix = '[android, mise à jour] ';
  const browser = await chromium.launch({ executablePath: CHROME });
  async function phone({ version = '1.8', release, offline = false, storage } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
    const calls = { api: 0 };
    await blockExternal(context);
    await context.route(API, route => {
      calls.api++;
      if (offline) return route.abort('internetdisconnected');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(release) });
    });
    await context.addInitScript(([version, storage]) => {
      window.__opened = [];
      window.AndroidBridge = {
        isSystemDark: () => false, getThemePreference: () => 'auto', setThemePreference: () => {}, getSafeAreaInsets: () => '[24,0,16,0]',
        openExternal: u => window.__opened.push(u), copyText: () => {}, getAppVersion: () => version, shareText: () => {},
        fileBegin: () => 'f', fileAppend: () => {}, fileFinish: () => {}
      };
      if (storage && !sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        Object.keys(storage).forEach(k => localStorage.setItem(k, storage[k]));
      }
    }, [version, storage || null]);
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    await page.goto(url);
    await page.waitForTimeout(800);
    return { context, page, calls };
  }
  const release19 = { tag_name: '1.9', html_url: 'https://github.com/Sohhka/sohri/releases/tag/1.9', draft: false, prerelease: false, assets: [{ name: 'Sohri-1.9.apk' }] };

  let p = await phone({ release: release19 });
  const text = await p.page.textContent('#bannerText').catch(() => '');
  check(await p.page.isVisible('#banner') && text === 'SOHRI 1.9 est disponible (tu as la 1.8).' && (await p.page.textContent('#bannerActionBtn')) === 'Mettre à jour',
    'version 1.9 publiée : bandeau « SOHRI 1.9 est disponible (tu as la 1.8). » + « Mettre à jour »');
  await p.page.screenshot({ path: path.join(OUT, 'android-mise-a-jour.png') });
  await p.page.click('#bannerActionBtn');
  const opened = await p.page.evaluate(() => window.__opened);
  check(opened.length === 1 && opened[0] === 'https://github.com/Sohhka/sohri/releases/tag/1.9' && !(await p.page.isVisible('#banner')),
    '« Mettre à jour » ouvre directement la page de la release (' + opened.join() + ')');
  await p.page.reload();
  await p.page.waitForTimeout(600);
  check(!(await p.page.isVisible('#banner')) && p.calls.api === 1, 'au retour depuis le navigateur : pas de nouveau bandeau tout de suite, pas de nouvelle demande à GitHub');
  check(p.page.errors.length === 0, 'aucune erreur ' + JSON.stringify(p.page.errors));
  await p.context.close();

  p = await phone({ release: release19 });
  await p.page.click('#bannerCloseBtn');
  await p.page.reload();
  await p.page.waitForTimeout(600);
  check(!(await p.page.isVisible('#banner')), '« × » : le bandeau ne revient pas (3 jours)');
  await p.context.close();

  p = await phone({ version: '1.9', release: release19 });
  check(!(await p.page.isVisible('#banner')), 'déjà à jour (1.9) : pas de bandeau');
  await p.context.close();

  p = await phone({ release: { ...release19, assets: [] } });
  check(!(await p.page.isVisible('#banner')), 'release sans APK (encore en préparation) : pas de bandeau');
  await p.context.close();

  p = await phone({ release: release19, offline: true });
  check(!(await p.page.isVisible('#banner')) && p.page.errors.length === 0, 'sans Internet : rien, sans erreur');
  await p.context.close();

  // Vérifiée il y a moins de 6 h : pas de nouvelle demande, mais la version connue est proposée.
  p = await phone({ release: release19, storage: { 'sohri.updateCheck': JSON.stringify(Date.now() - 3600000), 'sohri.update': JSON.stringify({ version: '1.9', url: 'https://github.com/Sohhka/sohri/releases/tag/1.9' }) } });
  check(p.calls.api === 0 && await p.page.isVisible('#banner'), 'vérifiée il y a 1 h : pas de nouvelle demande à GitHub, la version connue reste proposée');
  const order = await p.page.evaluate(() => [isNewerVersion('1.10', '1.9'), isNewerVersion('v1.9', '1.9'), isNewerVersion('1.9', '1.8.5'), isNewerVersion('1.8', '1.8')]);
  check(order.join() === 'true,false,true,false', 'comparaison des versions (1.10 > 1.9, v1.9 = 1.9...) : ' + order.join());
  await p.context.close();

  // Version web (iPhone) : aucune demande à GitHub.
  const context = await browser.newContext({ ...devices['iPhone 14 Plus'], locale: 'fr-FR', serviceWorkers: 'block' });
  let webCalls = 0;
  await blockExternal(context);
  await context.route(API, route => { webCalls++; route.abort(); });
  const web = await context.newPage();
  await web.goto(url);
  await web.waitForTimeout(800);
  check(webCalls === 0, 'version web : ne demande rien à GitHub (elle se met à jour toute seule)');
  await context.close();
  await browser.close();
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    for (const engine of ['chromium', 'webkit']) {
      await clockTests(engine, url);
      await layoutTests(engine, url);
    }
    await updateTests(url);
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
