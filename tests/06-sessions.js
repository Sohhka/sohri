// Session : renouvellement du jeton d'accès (toutes les heures) et session refusée (mot de passe changé).
const { chromium } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http'); const fs = require('fs'); const path = require('path');
const WWW = path.resolve(process.argv[2]);
const PROJECT = 'demo-sohri';
const CONFIG = { apiKey: 'demo-key', projectId: PROJECT, emulator: { auth: 'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8085' } };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const results = [];
function check(ok, msg) { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + msg); }
(async () => {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
    if (p === '/js/cloud-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.SOHRI_CLOUD = window.SOHRI_CLOUD || null;'); }
    const f = path.join(WWW, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const browser = await chromium.launch({ executablePath: require("./lib/chrome") });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await blockExternal(context);
  await context.addInitScript(c => { window.SOHRI_CLOUD = c; }, CONFIG);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  await page.evaluate(() => cloudSignUp({ name: 'Sohhka', email: 's@exemple.fr', password: 'voyage-japon-2026', invite: '' }));
  await page.waitForFunction(() => cloudStatus.state === 'done' && !cloudSyncRunning, null, { timeout: 30000 });
  // Jeton expiré (comme une heure plus tard) : renouvelé tout seul.
  await page.waitForTimeout(1100); // l'émulateur date ses jetons à la seconde
  const before = await page.evaluate(() => cloudSession.idToken);
  await page.evaluate(() => { cloudSession.expiresAt = 0; return syncNow(); });
  const after = await page.evaluate(() => ({ state: cloudStatus.state, token: cloudSession.idToken, valid: cloudSession.expiresAt > Date.now() + 30 * 60000 }));
  const stored = await page.evaluate(async () => (await dbGet('cloud', 'session')).value.idToken);
  check(after.state === 'done' && after.valid && after.token !== before && stored === after.token, 'jeton expiré : renouvelé et enregistré');
  // Après rechargement : session reprise, sans se reconnecter.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  await page.waitForFunction(() => cloudStatus.state === 'done' && !cloudSyncRunning, null, { timeout: 30000 });
  check(await page.evaluate(() => isSignedIn() && cloudState.profile.name === 'Sohhka'), 'rechargement : toujours connecté');
  // Jeton de longue durée refusé (compte supprimé ou mot de passe changé ailleurs).
  await page.evaluate(() => { cloudSession.expiresAt = 0; cloudSession.refreshToken = 'invalide'; return syncNow(); });
  check(await page.evaluate(() => cloudStatus.state) === 'signed-out', 'session refusée : « reconnecte-toi »');
  await page.evaluate(() => goToSection('sharing'));
  await page.waitForTimeout(200);
  check((await page.textContent('#sharingContent')).includes('Ta session a expiré'), 'écran Partage : bouton « Se reconnecter »');
  await page.click('#sharingContent .link-btn:has-text("Se reconnecter")');
  await page.fill('#accPassword', 'voyage-japon-2026');
  await page.click('#accountForm button[type="submit"]');
  await page.waitForSelector('#sharingContent .profile-code', { timeout: 30000 });
  await page.waitForFunction(() => cloudStatus.state === 'done' && !cloudSyncRunning, null, { timeout: 30000 });
  check(await page.evaluate(() => cloudStatus.state === 'done'), 'reconnexion (e-mail déjà rempli) : tout refonctionne');
  check(errors.length === 0, 'aucune erreur' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} vérifications réussies`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
