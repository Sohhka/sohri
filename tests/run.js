// Lance les tests de SOHRI : tous (node run.js), ou seulement certains (node run.js 13 14, ou
// node run.js partage). Démarre l'émulateur Firebase s'il en faut un (et l'arrête à la fin),
// range les journaux et les captures d'écran dans tests/out/, et affiche un résumé.
// Voir tests/README.md.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const OUT = path.join(__dirname, 'out');

const wanted = process.argv.slice(2).map(a => a.toLowerCase());
const suites = fs.readdirSync(__dirname).filter(f => /^\d\d-.*\.js$/.test(f)).sort()
  .filter(f => !wanted.length || wanted.some(w => f.startsWith(w.padStart(2, '0') + '-') || f.includes(w)));
if (!suites.length) {
  console.error('Aucun test ne correspond à : ' + wanted.join(' '));
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

// Arguments de chaque test : le dossier www (ou la racine du projet pour la version web) et son
// dossier de sorties ; les règles du serveur n'en ont pas besoin.
function argsFor(file) {
  const out = path.join(OUT, file.replace(/\.js$/, ''));
  if (file.startsWith('01-')) return [];
  if (file.startsWith('04-')) return [ROOT, out];
  return [WWW, out];
}
const needsEmulator = file => /127\.0\.0\.1:8085|demo-sohri/.test(fs.readFileSync(path.join(__dirname, file), 'utf8'));

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

/* Java 21 (pour l'émulateur Firestore) : JAVA_HOME, sinon les emplacements habituels. */
function findJava() {
  const home = process.env.JAVA_HOME;
  if (home && fs.existsSync(path.join(home, 'bin'))) return home;
  const roots = ['C:/Program Files/Android/openjdk', 'C:/Program Files/Microsoft', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const jdk = fs.readdirSync(root).filter(d => /^jdk-?(2[1-9]|[3-9]\d)/.test(d)).sort().pop();
    if (jdk) return path.join(root, jdk);
  }
  const studio = 'C:/Program Files/Android/Android Studio/jbr';
  return fs.existsSync(studio) ? studio : null;
}

async function startEmulator() {
  if (await portOpen(8085)) {
    console.log('Émulateur Firebase déjà lancé : il est réutilisé.');
    return null;
  }
  const java = findJava();
  const env = Object.assign({}, process.env);
  if (java) {
    env.JAVA_HOME = java;
    env.PATH = path.join(java, 'bin') + path.delimiter + env.PATH;
  }
  const firebase = require.resolve('firebase-tools/lib/bin/firebase.js');
  const log = fs.createWriteStream(path.join(OUT, 'emulateurs.log'));
  // (lancé depuis tests/out/ : ses propres journaux, firebase-debug.log..., y restent)
  const child = spawn(process.execPath, [firebase, 'emulators:start', '--only', 'auth,firestore', '--project', 'demo-sohri',
    '--config', path.join(ROOT, 'firebase', 'firebase.json')], { env, cwd: OUT, detached: process.platform !== 'win32' });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  process.stdout.write('Démarrage de l\'émulateur Firebase… ');
  await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Émulateur pas prêt après 2 minutes : voir tests/out/emulateurs.log')), 120000);
    child.stdout.on('data', chunk => {
      text += chunk;
      if (text.includes('All emulators ready')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Émulateur arrêté (code ' + code + ') : voir tests/out/emulateurs.log')); });
  });
  console.log('prêt.');
  return child;
}

function stopEmulator(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch (e) { /* déjà arrêté */ }
}

function runSuite(file) {
  return new Promise(resolve => {
    const started = Date.now();
    const log = path.join(OUT, file.replace(/\.js$/, '.log'));
    const out = fs.createWriteStream(log);
    const child = spawn(process.execPath, [path.join(__dirname, file)].concat(argsFor(file)), { cwd: __dirname });
    let text = '';
    const keep = chunk => { text += chunk; out.write(chunk); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('exit', code => {
      out.end();
      const summary = (text.match(/(\d+)\/(\d+) (?:vérifications réussies|réussis)/g) || []).pop() || 'pas de résumé';
      const failures = text.split('\n').filter(line => /^FAIL /.test(line));
      resolve({ file, ok: code === 0, summary, failures, seconds: Math.round((Date.now() - started) / 1000), log });
    });
  });
}

(async () => {
  let emulator = null;
  const results = [];
  try {
    if (suites.some(needsEmulator)) emulator = await startEmulator();
    for (const file of suites) {
      process.stdout.write(file.padEnd(28) + ' … ');
      const r = await runSuite(file);
      results.push(r);
      console.log((r.ok ? '✓ ' : '✗ ') + r.summary + ' (' + r.seconds + ' s)');
      r.failures.slice(0, 5).forEach(line => console.log('    ' + line));
    }
  } catch (e) {
    console.error('\n' + e.message);
    results.push({ ok: false });
  } finally {
    stopEmulator(emulator);
  }
  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? '\n' + failed.length + ' test(s) en échec : détails dans tests/out/*.log' : '\nTout est bon.');
  process.exit(failed.length ? 1 : 0);
})();
