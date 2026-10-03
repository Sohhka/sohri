// Tests de la rubrique Documents et de la visionneuse (SOHRI 1.2), avec de vrais fichiers.
// Usage : node 03-documents.js <dossier www> <dossier sorties>
const { chromium } = require('playwright-core');
const blockExternal = require("./lib/block-external");
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const CHROME = require("./lib/chrome");
fs.mkdirSync(OUT, { recursive: true });

// Types MIME identiques à WebViewAssetLoader (androidx/webkit/internal/MimeUtil.java).
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const requests = [];
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      requests.push(p);
      if (p === '/') p = '/index.html';
      const file = path.join(WWW, p);
      if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function check(ok, msg) { results.push([!!ok, msg]); console.log((ok ? 'PASS ' : 'FAIL ') + msg); }
const norm = s => (s || '').replace(/\s/g, ' ').trim();

// ---------- Fichiers de test ----------
function makeWav(seconds, rate) {
  const n = seconds * rate, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), 44 + i * 2);
  return buf;
}
// PDF écrit à la main : texte japonais (東京駅) avec une police NON incluse → pdf.js a besoin des CMaps.
function makeCjkPdf() {
  const content = 'BT /F1 36 Tf 20 80 Td <67714EAC99C5> Tj ET'; // 東 京 駅 en UCS-2
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R >>',
    '<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function makePdf(context) {
  const page = await context.newPage();
  const pages = Array.from({ length: 12 }, (_, i) => `<section style="page-break-after:always;height:250mm;font-family:sans-serif">
    <h1 style="color:#C8402C;font-size:48px">Page ${i + 1}</h1><p style="font-size:28px">Billet Shinkansen — 東京駅 → 京都駅 のぞみ ${i + 1}号</p>
    <div style="width:300px;height:150px;background:#1B2140"></div></section>`).join('');
  await page.setContent(`<html><body style="margin:0">${pages}</body></html>`);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await page.close();
  return pdf;
}

async function makeMedia(page) {
  return page.evaluate(async () => {
    const png = await new Promise(r => { const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const g = c.getContext('2d');
      g.fillStyle = '#1B2140'; g.fillRect(0, 0, 1200, 800); g.fillStyle = '#C8402C'; g.beginPath(); g.arc(600, 400, 250, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.fillText('QR BILLET', 330, 430); c.toBlob(r, 'image/png'); });
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d');
    const recorder = new MediaRecorder(c.captureStream(30), { mimeType: type });
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise(r => { recorder.onstop = r; });
    recorder.start();
    for (let frame = 0; frame < 45; frame++) {
      g.fillStyle = `hsl(${frame * 8}, 70%, 45%)`; g.fillRect(0, 0, 320, 240);
      g.fillStyle = '#fff'; g.font = 'bold 36px sans-serif'; g.fillText('SOHRI ' + frame, 50, 130);
      await new Promise(r => setTimeout(r, 33));
    }
    recorder.stop();
    await stopped;
    const video = new Blob(chunks, { type: type.split(';')[0] });
    const b64 = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
    return { png: await b64(png), video: await b64(video), videoType: type.split(';')[0] };
  });
}

// ---------- Téléphone simulé et faux pont Android (comme test2.js) ----------
async function newPhone(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
  await blockExternal(context);
  await context.addInitScript(() => {
    const state = window.__bridge = { opened: [], files: {}, finished: [], saved: {}, themePref: 'auto' };
    try { const saved = sessionStorage.getItem('__bridgeTheme'); if (saved) state.themePref = saved; } catch (e) {}
    window.AndroidBridge = {
      isSystemDark: () => false, getThemePreference: () => state.themePref,
      setThemePreference: p => { state.themePref = p; sessionStorage.setItem('__bridgeTheme', p); },
      getSafeAreaInsets: () => '[24,0,16,0]', openExternal: url => state.opened.push(url), copyText: () => {}, getAppVersion: () => '1.2',
      fileBegin: (name, type) => { const id = 'f' + Object.keys(state.files).length; state.files[id] = { name, type, chunks: [] }; return id; },
      fileAppend: (id, b64) => { state.files[id].chunks.push(b64); },
      fileFinish: (id, action) => {
        const f = state.files[id];
        const blob = new Blob(f.chunks.map(c => Uint8Array.from(atob(c), ch => ch.charCodeAt(0))), { type: f.type });
        state.saved[id] = blob;
        state.finished.push({ id, action, name: f.name, type: f.type, size: blob.size });
      }
    };
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('dialogue natif: ' + d.message()); d.dismiss(); });
  return { context, page };
}

const back = page => page.evaluate(() => handleBackButton());
const visible = (page, sel) => page.$eval(sel, el => !el.hidden && getComputedStyle(el).display !== 'none').catch(() => false);
const lastFile = page => page.evaluate(() => window.__bridge.finished[window.__bridge.finished.length - 1] || null);
async function topAction(page, label) { await page.click(`#topActions button[aria-label="${label}"]`); }
async function sheetItem(page, text) { await page.click(`#sheetPanel .sheet-item:has-text("${text}")`); }
async function dialogOk(page, value) { await page.waitForSelector('#dialog:not([hidden])'); if (value !== undefined) await page.fill('#dialogInput', value); await page.click('#dialogOkBtn'); }
async function openSection(page, name) { await page.evaluate(() => openDrawer()); await page.click(`.drawer-item[data-section="${name}"]`); }
const rowByName = name => `#docsContent .doc-row:has(.doc-name:text-is("${name}"))`;
async function openRow(page, name) { await page.click(rowByName(name)); await page.waitForSelector('#docViewer:not([hidden])'); }
const zoom = page => page.evaluate(() => docViewer.zoom);
const pageWidth = page => page.$eval('.pdf-page', el => el.getBoundingClientRect().width);
async function pinch(page, from, to) {
  await page.evaluate(([from, to]) => {
    const target = document.getElementById('docBody');
    const r = target.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const t = (id, x) => new Touch({ identifier: id, target, clientX: x, clientY: cy });
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [t(1, cx - from / 2), t(2, cx + from / 2)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchmove', { touches: [t(1, cx - to / 2), t(2, cx + to / 2)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(1, cx - to / 2), t(2, cx + to / 2)], bubbles: true }));
  }, [from, to]);
}
async function doubleTap(page) {
  await page.evaluate(() => {
    const target = document.getElementById('docBody');
    const r = target.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 200;
    const t = () => new Touch({ identifier: 9, target, clientX: x, clientY: y });
    for (let i = 0; i < 2; i++) {
      target.dispatchEvent(new TouchEvent('touchstart', { touches: [t()], bubbles: true }));
      target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t()], bubbles: true }));
    }
  });
}
const canvasInk = (page, sel) => page.$eval(sel, c => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
  return n;
});

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log('Chrome', browser.version());
  const { context, page } = await newPhone(browser);
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');

  const pdf = await makePdf(context);
  const cjkPdf = makeCjkPdf();
  const media = await makeMedia(page);
  const png = Buffer.from(media.png, 'base64');
  const video = Buffer.from(media.video, 'base64');
  const wav = makeWav(1, 8000);
  const sjis = Buffer.concat([Buffer.from('Message : '), Buffer.from([0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD])]);
  const latin1 = Buffer.from('Café crème à Kyōto'.replace('ō', 'o'), 'latin1');
  const videoName = 'visite-temple.' + (media.videoType === 'video/mp4' ? 'mp4' : 'webm');
  console.log(`   fichiers : PDF ${(pdf.length / 1024).toFixed(0)} Ko (12 pages), vidéo ${media.videoType} ${(video.length / 1024).toFixed(0)} Ko, PNG ${(png.length / 1024).toFixed(0)} Ko`);

  // ---------- Rubrique et dossier ----------
  await openSection(page, 'documents');
  await page.waitForSelector('#docsEmpty:not([hidden])');
  check(await page.textContent('#viewTitle') === 'Documents' && norm(await page.textContent('#docsEmpty')).startsWith('Aucun document'), 'rubrique Documents : état vide');
  await page.click('#docsContent .add-row');
  await dialogOk(page, 'Billets');
  await page.waitForSelector('#docsContent .list-row');
  check(norm(await page.textContent('#docsContent .list-row')) === '📁Billets0›', 'dossier « Billets » créé');
  await page.click('#docsContent .list-row');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === '📁 Billets');
  await topAction(page, 'Ajouter des fichiers');

  // ---------- Import ----------
  await page.setInputFiles('#docFiles', [
    { name: 'billet-shinkansen.pdf', mimeType: 'application/pdf', buffer: pdf },
    { name: 'police-japonaise.pdf', mimeType: 'application/pdf', buffer: cjkPdf },
    { name: 'qr-code.png', mimeType: 'image/png', buffer: png },
    { name: videoName, mimeType: media.videoType, buffer: video },
    { name: 'annonce-gare.wav', mimeType: 'audio/wav', buffer: wav },
    { name: 'message-sjis.txt', mimeType: 'text/plain', buffer: sjis },
    { name: 'menu-latin1.txt', mimeType: 'text/plain', buffer: latin1 },
    { name: 'itineraire.md', mimeType: '', buffer: Buffer.from('# Itinéraire\n\n- [x] Tokyo\n- [ ] Kyoto\n\n**Hôtel** réservé.') },
    { name: 'assurance.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK fausse archive') }
  ]);
  await page.waitForSelector('#toast:not([hidden])', { timeout: 60000 });
  check(norm(await page.textContent('#toast')) === '9 fichiers ajoutés', 'import : 9 fichiers ajoutés (' + norm(await page.textContent('#toast')) + ')');
  await page.waitForFunction(() => document.querySelectorAll('#docsContent .doc-row').length === 9);
  const names = await page.$$eval('#docsContent .doc-name', l => l.map(e => e.textContent));
  check(names.join(',') === ['annonce-gare.wav', 'assurance.docx', 'billet-shinkansen.pdf', 'itineraire.md', 'menu-latin1.txt', 'message-sjis.txt', 'police-japonaise.pdf', 'qr-code.png', videoName].join(','), 'fichiers triés par nom');
  const thumbs = await page.$$eval('#docsContent .doc-row', rows => rows.map(r => [r.querySelector('.doc-name').textContent, !!r.querySelector('.doc-thumb img'), r.querySelector('.doc-thumb').textContent]));
  const withThumb = thumbs.filter(t => t[1]).map(t => t[0]).sort();
  check(withThumb.join(',') === ['billet-shinkansen.pdf', 'police-japonaise.pdf', 'qr-code.png', videoName].sort().join(','), 'miniatures : PDF (1re page), image et vidéo (' + withThumb.join(', ') + ')');
  check(thumbs.find(t => t[0] === 'assurance.docx')[2] === '📎' && thumbs.find(t => t[0] === 'annonce-gare.wav')[2] === '🎵', 'icônes pour les autres types');
  const pdfThumbInk = await page.evaluate(async () => {
    const doc = (await dbGetAll('documents')).find(d => d.name === 'billet-shinkansen.pdf');
    const bmp = await createImageBitmap(doc.thumb); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
    return { w: bmp.width, h: bmp.height, ink: n };
  });
  check(pdfThumbInk.h === 160 && pdfThumbInk.ink > 500, 'miniature du PDF = vraie 1re page (' + pdfThumbInk.w + 'x' + pdfThumbInk.h + ')');
  check(norm(await page.textContent(rowByName('billet-shinkansen.pdf') + ' .list-row-sub')).startsWith('PDF · ' + Math.round(pdf.length / 1024) + ' Ko'), 'ligne : type et taille');
  const stores = await page.evaluate(async () => ({ docs: (await dbGetAll('documents')).length, files: (await dbGetAll('documentFiles')).length, blobInMeta: (await dbGetAll('documents')).some(d => d.blob) }));
  check(stores.docs === 9 && stores.files === 9 && !stores.blobInMeta, 'description et contenu enregistrés séparément');
  await page.screenshot({ path: OUT + '/01-documents.png' });

  // ---------- PDF ----------
  await openRow(page, 'billet-shinkansen.pdf');
  await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  check(await page.$$eval('.pdf-page', l => l.length) === 12, 'PDF : 12 pages');
  check(norm(await page.textContent('#docName')) === 'billet-shinkansen.pdf' && norm(await page.textContent('#docInfo')).startsWith('PDF · '), 'barre : nom et type du fichier');
  check((await canvasInk(page, '.pdf-page canvas')) > 5000, 'PDF : page 1 dessinée (contenu visible)');
  check(await page.textContent('#docPage') === '1 / 12' && await visible(page, '#docZoom'), 'indicateur de page et boutons de zoom');
  const loaded = requests.filter(r => r.includes('/vendor/pdfjs/'));
  check(loaded.some(r => r.endsWith('pdf.min.mjs')) && loaded.some(r => r.endsWith('pdf.worker.min.mjs')), 'pdf.js chargé depuis l\'appli (hors ligne)');
  await page.screenshot({ path: OUT + '/02-pdf.png' });
  const w1 = await pageWidth(page);
  await page.click('#docZoomIn');
  check(Math.abs(await pageWidth(page) / w1 - 1.5) < 0.02 && await zoom(page) === 1.5, 'bouton + : zoom x1,5');
  await page.waitForTimeout(600);
  const sharp = await page.$eval('.pdf-page', el => { const c = el.querySelector('canvas'); return c.width >= el.getBoundingClientRect().width * 1.9; });
  check(sharp, 'page redessinée nette après le zoom');
  await page.click('#docZoomOut');
  check(await zoom(page) === 1, 'bouton − : taille normale');
  await pinch(page, 100, 200);
  check(Math.abs(await zoom(page) - 2) < 0.01 && Math.abs(await pageWidth(page) / w1 - 2) < 0.02, 'zoom à deux doigts : x2');
  await doubleTap(page);
  check(await zoom(page) === 1, 'double toucher : retour à la taille normale');
  await doubleTap(page);
  check(await zoom(page) === 2.5, 'double toucher : zoom x2,5');
  await page.click('#docZoomOut'); await page.click('#docZoomOut'); await page.click('#docZoomOut');
  await page.$eval('#docBody', el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(700);
  check(await page.textContent('#docPage') === '12 / 12', 'défilement : page 12 / 12');
  await page.waitForFunction(() => docViewer.pages[11].canvas, null, { timeout: 15000 });
  const rendered = await page.evaluate(() => docViewer.pages.filter(p => p.canvas).map(p => p.number));
  check(!rendered.includes(1) && rendered.includes(12), 'pages éloignées libérées de la mémoire (dessinées : ' + rendered.join(',') + ')');
  await page.click('#docShareBtn');
  await page.waitForFunction(() => __bridge.finished.length === 1);
  let f = await lastFile(page);
  check(f.action === 'share' && f.name === 'billet-shinkansen.pdf' && f.size === pdf.length, 'partage du PDF depuis la visionneuse');
  await page.click('#docMenuBtn');
  const menu = await page.$$eval('#sheetPanel .sheet-item', l => l.map(e => e.textContent.trim()));
  check(menu.join(' | ') === '📲Ouvrir avec une autre appli | 💾Enregistrer sous… | ✏️Renommer | 📁Déplacer vers un dossier | 🗑️Supprimer', 'menu de la visionneuse');
  await sheetItem(page, 'Enregistrer sous');
  await page.waitForFunction(() => __bridge.finished.length === 2);
  check((await lastFile(page)).action === 'save', '« Enregistrer sous… » proposé par Android');
  check(await back(page) === true && !(await visible(page, '#docViewer')), 'retour Android ferme la visionneuse');

  // PDF à police japonaise non incluse : les CMaps doivent être chargées.
  await openRow(page, 'police-japonaise.pdf');
  await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await page.waitForTimeout(300);
  check(requests.some(r => r.endsWith('/cmaps/UniJIS-UCS2-H.bcmap')), 'police japonaise non incluse : CMap chargée depuis l\'appli');
  check((await canvasInk(page, '.pdf-page canvas')) > 300, 'texte japonais dessiné (東京駅)');
  await page.screenshot({ path: OUT + '/03-pdf-japonais.png' });
  await back(page);

  // ---------- Image ----------
  await openRow(page, 'qr-code.png');
  await page.waitForFunction(() => docViewer.image && docViewer.image.complete && docViewer.image.naturalWidth === 1200);
  const imgW = await page.$eval('.doc-image', el => el.getBoundingClientRect().width);
  check(imgW > 300 && imgW <= 390, 'image affichée en entier (' + Math.round(imgW) + ' px)');
  await page.click('#docZoomIn');
  check(Math.abs(await page.$eval('.doc-image', el => el.getBoundingClientRect().width) / imgW - 1.5) < 0.02, 'image : zoom x1,5');
  await page.screenshot({ path: OUT + '/04-image.png' });
  await back(page);

  // ---------- Vidéo ----------
  await openRow(page, videoName);
  await page.waitForFunction(() => { const v = document.querySelector('#docBody video'); return v && v.readyState >= 1; }, null, { timeout: 15000 });
  const vid = await page.$eval('#docBody video', v => ({ w: v.videoWidth, h: v.videoHeight, controls: v.controls }));
  check(vid.w === 320 && vid.h === 240 && vid.controls, 'vidéo lue dans l\'appli (' + media.videoType + ', ' + vid.w + 'x' + vid.h + ')');
  await page.$eval('#docBody video', v => { v.muted = true; return v.play(); });
  await page.waitForFunction(() => document.querySelector('#docBody video').currentTime > 0.2, null, { timeout: 10000 });
  check(true, 'lecture de la vidéo');
  await page.screenshot({ path: OUT + '/05-video.png' });
  await back(page);
  check(!(await page.$('#docBody video')), 'vidéo arrêtée et retirée à la fermeture');

  // ---------- Son ----------
  await openRow(page, 'annonce-gare.wav');
  await page.waitForFunction(() => { const a = document.querySelector('#docBody audio'); return a && a.readyState >= 1; });
  check(Math.abs(await page.$eval('#docBody audio', a => a.duration) - 1) < 0.05, 'son lu dans l\'appli (1 s)');
  await back(page);

  // ---------- Textes ----------
  await openRow(page, 'message-sjis.txt');
  await page.waitForSelector('.doc-text');
  check(await page.textContent('.doc-text') === 'Message : こんにちは', 'texte Shift_JIS (japonais) décodé');
  await back(page);
  await openRow(page, 'menu-latin1.txt');
  await page.waitForSelector('.doc-text');
  check(await page.textContent('.doc-text') === 'Café crème à Kyoto', 'texte Latin-1 (Windows) décodé');
  await back(page);
  await openRow(page, 'itineraire.md');
  await page.waitForSelector('#docBody .markdown h1');
  check(await page.textContent('#docBody .markdown h1') === 'Itinéraire' && await page.$$eval('#docBody .task-box', l => l.length) === 2, 'markdown mis en forme');
  await back(page);

  // ---------- Format non affichable ----------
  await openRow(page, 'assurance.docx');
  await page.waitForSelector('#docBody .doc-card');
  check(norm(await page.textContent('#docBody .doc-card .hint')) === "Ce type de fichier ne peut pas être affiché dans l'appli.", 'Word : message clair');
  await page.click('#docBody .doc-card .primary-btn');
  await page.waitForFunction(() => __bridge.finished.length === 3);
  f = await lastFile(page);
  check(f.action === 'open' && f.name === 'assurance.docx' && f.type.includes('wordprocessingml'), 'Word : « Ouvrir avec une autre appli »');
  await back(page);

  // ---------- Renommer, déplacer, supprimer ----------
  await page.click(rowByName('billet-shinkansen.pdf') + ' .icon-btn');
  await sheetItem(page, 'Renommer');
  await dialogOk(page, 'Billet Tokyo-Kyoto');
  await page.waitForSelector(rowByName('Billet Tokyo-Kyoto.pdf'));
  check(true, 'renommer : extension .pdf conservée (Billet Tokyo-Kyoto.pdf)');
  await page.click(rowByName('Billet Tokyo-Kyoto.pdf') + ' .icon-btn');
  await sheetItem(page, 'Déplacer vers un dossier');
  await sheetItem(page, 'Aucun dossier');
  await page.waitForFunction(() => document.querySelectorAll('#docsContent .doc-row').length === 8);
  check(true, 'fichier sorti du dossier');
  await openRow(page, 'assurance.docx');
  await page.click('#docMenuBtn');
  await sheetItem(page, 'Supprimer');
  await dialogOk(page);
  await page.waitForFunction(() => document.getElementById('docViewer').hidden && document.querySelectorAll('#docsContent .doc-row').length === 7);
  const left = await page.evaluate(async () => ({ docs: (await dbGetAll('documents')).length, files: (await dbGetAll('documentFiles')).length }));
  check(left.docs === 8 && left.files === 8, 'suppression depuis la visionneuse : description et contenu effacés');
  await back(page);
  await page.waitForSelector('#docsContent .row-count');
  check(await page.textContent('#docsContent .row-count') === '7' && (await page.$$eval('#docsContent .doc-name', l => l.map(e => e.textContent))).join() === 'Billet Tokyo-Kyoto.pdf', 'racine : dossier (7 fichiers) et fichier hors dossier');
  await page.fill('#docsSearch', 'japonaise');
  await page.waitForFunction(() => document.querySelectorAll('#docsContent .doc-row').length === 1 && document.querySelector('#docsContent .doc-name').textContent === 'police-japonaise.pdf');
  check((await page.textContent('#docsContent .chips')).includes('Billets'), 'recherche dans tous les dossiers');
  await page.fill('#docsSearch', '');
  await page.waitForTimeout(250);

  // ---------- Pièce jointe PDF d'une note : ouverte dans l'appli ----------
  await openSection(page, 'notes');
  await topAction(page, 'Nouvelle note');
  await page.fill('#noteTitle', 'Trajet');
  await page.setInputFiles('#noteFiles', [{ name: 'reservation.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await page.waitForSelector('#noteAttachments .attachment');
  await topAction(page, 'Enregistrer la note');
  await page.waitForSelector('#noteDetail .attachment');
  await page.click('#noteDetail .attachment');
  await page.waitForSelector('#docViewer:not([hidden]) .pdf-page canvas', { timeout: 30000 });
  check(await page.$$eval('.pdf-page', l => l.length) === 12 && await page.textContent('#docName') === 'reservation.pdf', 'pièce jointe PDF affichée dans l\'appli');
  await page.click('#docMenuBtn');
  check((await page.$$eval('#sheetPanel .sheet-item', l => l.length)) === 2, 'pièce jointe : menu sans renommer/supprimer');
  await back(page); await back(page);

  // ---------- Sauvegarde et restauration ----------
  await page.evaluate(() => goToSection('settings'));
  await page.click('#backupBtn');
  await page.waitForFunction(() => __bridge.finished.some(f => f.name.startsWith('SOHRI-sauvegarde')) && document.getElementById('progress').hidden, null, { timeout: 60000 });
  const zipB64 = await page.evaluate(async () => { const f = __bridge.finished.find(f => f.name.startsWith('SOHRI-sauvegarde')); const buf = new Uint8Array(await __bridge.saved[f.id].arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); });
  fs.writeFileSync(path.join(OUT, 'sauvegarde.zip'), Buffer.from(zipB64, 'base64'));
  await page.evaluate(() => dbReplaceAll({}));
  await page.reload();
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  await page.evaluate(() => goToSection('settings'));
  await page.setInputFiles('#restoreInput', { name: 'sauvegarde.zip', mimeType: 'application/zip', buffer: fs.readFileSync(path.join(OUT, 'sauvegarde.zip')) });
  await page.waitForSelector('#dialog:not([hidden])');
  check(norm(await page.textContent('#dialogMessage')).includes('8 documents'), 'restauration : 8 documents annoncés');
  await Promise.all([page.waitForNavigation(), page.click('#dialogOkBtn')]);
  await page.waitForFunction(() => document.getElementById('rateText').textContent !== '');
  const restored = await page.evaluate(async () => {
    const doc = (await dbGetAll('documents')).find(d => d.name === 'Billet Tokyo-Kyoto.pdf');
    const file = await dbGet('documentFiles', doc.fileId);
    const video = (await dbGetAll('documents')).find(d => d.type.startsWith('video/'));
    const vfile = await dbGet('documentFiles', video.fileId);
    return { pdfSize: file.blob.size, pdfHead: await file.blob.slice(0, 5).text(), thumb: !!doc.thumb, video: vfile.blob.size };
  });
  check(restored.pdfSize === pdf.length && restored.pdfHead === '%PDF-' && restored.thumb && restored.video === video.length, 'restauration : documents, miniatures et vidéo intacts');
  await page.evaluate(() => goToSection('documents'));
  await page.waitForSelector('#docsContent .doc-row');
  await openRow(page, 'Billet Tokyo-Kyoto.pdf');
  await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  check(true, 'document restauré : s\'ouvre dans la visionneuse');
  await back(page);

  // ---------- Thème sombre ----------
  await page.evaluate(() => setThemePreference('dark'));
  await page.screenshot({ path: OUT + '/06-documents-sombre.png' });
  await page.click('#docsContent .list-row');
  await page.waitForSelector('#docsContent .doc-row');
  await openRow(page, 'police-japonaise.pdf');
  await page.waitForSelector('.pdf-page canvas');
  await page.screenshot({ path: OUT + '/07-pdf-sombre.png' });
  await back(page);

  // ---------- Suppression du dossier : fichiers conservés ----------
  await topAction(page, 'Options du dossier');
  await sheetItem(page, 'Supprimer le dossier');
  await page.waitForSelector('#dialog:not([hidden])');
  check(norm(await page.textContent('#dialogMessage')).includes('Ses fichiers ne sont pas supprimés'), 'supprimer le dossier : fichiers conservés (message)');
  await page.click('#dialogOkBtn');
  await page.waitForFunction(() => document.getElementById('viewTitle').textContent === 'Documents' && document.querySelectorAll('#docsContent .doc-row').length === 8);
  check(true, 'dossier supprimé, les 8 fichiers sont à la racine');
  check(page.errors.length === 0, 'aucune erreur JavaScript' + (page.errors.length ? ' : ' + page.errors.join(' | ') : ''));

  await browser.close();
  server.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
