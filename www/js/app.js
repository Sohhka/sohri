/* ---------- Menu tiroir ---------- */
var drawer = byId('drawer');

function openDrawer() {
  drawer.hidden = false;
}

function closeDrawer() {
  drawer.hidden = true;
}

/* ☰ ouvre le menu ; ← (vue ouverte depuis une autre) revient en arrière. */
byId('navBtn').addEventListener('click', function () {
  if (isSelectingPhotos()) exitPhotoSelection();
  else if (navStack.length > 1) goBack();
  else openDrawer();
});
byId('drawerBackdrop').addEventListener('click', closeDrawer);

var drawerItems = document.querySelectorAll('.drawer-item');
for (var d = 0; d < drawerItems.length; d++) {
  drawerItems[d].addEventListener('click', function (e) {
    closeDrawer();
    goToSection(e.currentTarget.dataset.section);
  });
}

/* ---------- Bouton retour d'Android ----------
   Appelé par l'appli Android à chaque appui sur « retour » : renvoie true si l'action a été
   traitée ici, false pour laisser Android fermer l'appli. Ce qui est affiché par-dessus
   (photo, menu, boîte de dialogue...) se ferme d'abord. */
window.handleBackButton = function () {
  if (!byId('progress').hidden) return true; // opération en cours : on attend
  if (!byId('taxi').hidden) { closeTaxiCard(); return true; }
  if (isPhraseCardOpen()) { closePhraseCard(); return true; }
  if (!byId('sheet').hidden) { closeSheet(); return true; }
  if (!byId('dialog').hidden) { closeDialog(false); return true; }
  if (!byId('viewer').hidden) { closeViewer(); return true; }
  if (isDocumentOpen()) { closeDocument(); return true; }
  if (!drawer.hidden) { closeDrawer(); return true; }
  if (isSelectingPhotos()) { exitPhotoSelection(); return true; }
  if (currentViewName() === 'converter' && isRateEditOpen()) { closeRateEdit(); return true; }
  if (navStack.length > 1) { goBack(); return true; }
  if (currentViewName() !== 'converter') { goToSection('converter'); return true; }
  return false;
};

/* Quand le clavier s'ouvre, la page rétrécit : on garde visible le champ en cours de saisie. */
function revealFocusedField() {
  var el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    setTimeout(function () { el.scrollIntoView({ block: 'nearest' }); }, 100);
  }
}
window.addEventListener('resize', revealFocusedField);

/* ---------- Version web (iPhone, navigateur) ---------- */
var IS_WEB = !window.AndroidBridge;
var IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
var IS_INSTALLED = navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

/* Le clavier de l'iPhone recouvre la page au lieu de la réduire : l'appli est ramenée à la partie
   visible de l'écran (voir html.is-web #app dans style.css), comme sur Android. */
function fitToVisibleArea() {
  var viewport = window.visualViewport;
  var root = document.documentElement;
  if (Math.abs(viewport.scale - 1) > 0.01) return; // zoom du navigateur : on ne touche à rien
  var previous = parseFloat(root.style.getPropertyValue('--app-height')) || 0;
  root.style.setProperty('--app-height', viewport.height + 'px');
  root.style.setProperty('--app-top', viewport.offsetTop + 'px');
  // Clavier ouvert : il cache la barre du bas de l'iPhone, inutile de laisser sa marge.
  if (root.clientHeight - viewport.height > 120) root.style.setProperty('--safe-bottom', '0px');
  else root.style.removeProperty('--safe-bottom');
  if (viewport.height < previous - 1) revealFocusedField();
}

/* Bandeau d'installation : sur l'iPhone, l'appli s'installe depuis Safari (Partager > Sur l'écran
   d'accueil), et fonctionne alors en plein écran et hors connexion. */
function canInstallOnIos() {
  return IS_WEB && IS_IOS && !IS_INSTALLED;
}

function showInstallHint() {
  try {
    if (localStorage.getItem('sohri.installHint') === 'hidden') return;
  } catch (e) { /* stockage indisponible : le bandeau s'affiche */ }
  showBanner("Installe SOHRI sur l'iPhone : dans Safari, touche Partager (ou ••• puis Partager), puis « Sur l'écran d'accueil ».",
    null, null, function () {
      try { localStorage.setItem('sohri.installHint', 'hidden'); } catch (e) { /* tant pis */ }
    });
}

/* Safari en navigation privée n'enregistre pas les fichiers (photos, documents...) : on prévient. */
function checkFileStorage() {
  dbPut('settings', { key: 'storageProbe', value: new Blob(['x'], { type: 'text/plain' }) }).then(function () {
    return dbDelete('settings', 'storageProbe');
  }, function (err) {
    console.warn('Enregistrement des fichiers impossible', err);
    showBanner("Ce navigateur n'enregistre pas les fichiers (navigation privée ?) : photos et documents ne pourront pas être ajoutés. Ouvre SOHRI dans un onglet normal.");
  });
}

/* Copie hors connexion (voir sw.js), et nouvelles versions : proposées par un bandeau, installées
   en rechargeant l'appli. Seulement pour la version web : l'appli Android a déjà tous ses fichiers. */
function registerServiceWorker() {
  var updateRequested = false;
  // Rechargée seulement à la demande (bouton « Mettre à jour ») : jamais au milieu d'une saisie.
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (updateRequested) {
      updateRequested = false;
      location.reload();
    }
  });
  navigator.serviceWorker.register('sw.js').then(function (registration) {
    function offerUpdate(worker) {
      showBanner('Une nouvelle version de SOHRI est disponible.', 'Mettre à jour', function () {
        updateRequested = true;
        worker.postMessage('skipWaiting');
      });
    }
    // Nouvelle version déjà téléchargée (lors d'une visite précédente), en attente.
    if (registration.waiting && registration.active) offerUpdate(registration.waiting);
    registration.addEventListener('updatefound', function () {
      var worker = registration.installing;
      // Une mise à jour remplace une version active ; la toute première installation, non.
      // (WebKit annonce l'installation alors que l'appli semble déjà prise en charge : on ne se
      // fie pas à navigator.serviceWorker.controller.)
      if (!worker || !registration.active) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed') offerUpdate(worker);
      });
    });
    // L'appli installée reste souvent ouverte en arrière-plan : on vérifie à chaque retour.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') registration.update()['catch'](function () { /* hors connexion */ });
    });
  })['catch'](function (err) {
    console.warn('Mode hors connexion indisponible', err);
  });
}

/* ---------- Appli Android : nouvelle version publiée sur GitHub ----------
   Vérifiée avec Internet (au lancement, au retour dans l'appli, au plus toutes les 6 heures) ;
   proposée par le même bandeau que la version web, et « Mettre à jour » ouvre directement la page
   de la release, où l'on télécharge l'APK. « × » la fait oublier 3 jours. */
var RELEASES_API = 'https://api.github.com/repos/Sohhka/sohri/releases/latest';
var UPDATE_CHECK_EVERY = 6 * 3600000;
var UPDATE_LATER = { closed: 3 * 86400000, opened: 3600000 };

function readPref(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
}

/* « 1.10 » est plus récent que « 1.9 » (et « v1.9 » vaut « 1.9 »). */
function isNewerVersion(candidate, current) {
  var a = String(candidate || '').replace(/^v/i, '').split('.');
  var b = String(current || '').replace(/^v/i, '').split('.');
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    var x = parseInt(a[i], 10) || 0;
    var y = parseInt(b[i], 10) || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function checkAndroidUpdate() {
  var last = readPref('sohri.updateCheck') || 0;
  if (Date.now() - last < UPDATE_CHECK_EVERY || navigator.onLine === false) return offerAndroidUpdate();
  fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } }).then(function (response) {
    return response.ok ? response.json() : null;
  }).then(function (release) {
    writePref('sohri.updateCheck', Date.now());
    // Seulement une vraie version publiée, avec son APK (pas un brouillon en cours de préparation).
    var apk = release && !release.draft && !release.prerelease && (release.assets || []).some(function (a) { return /\.apk$/i.test(a.name || ''); });
    if (apk) writePref('sohri.update', { version: release.tag_name, url: release.html_url });
    offerAndroidUpdate();
  }, function () { /* hors connexion : on réessaiera */ });
}

function offerAndroidUpdate() {
  var update = readPref('sohri.update');
  var current = window.AndroidBridge.getAppVersion();
  if (!update || !isNewerVersion(update.version, current)) return;
  var later = readPref('sohri.updateLater');
  if (later && later.version === update.version && Date.now() < later.until) return;
  if (!byId('banner').hidden) return; // un autre message est déjà affiché
  var version = String(update.version).replace(/^v/i, '');
  var postpone = function (delay) { writePref('sohri.updateLater', { version: update.version, until: Date.now() + delay }); };
  showBanner('SOHRI ' + version + ' est disponible (tu as la ' + current + ').', 'Mettre à jour', function () {
    postpone(UPDATE_LATER.opened); // le temps de télécharger et d'installer, sans le bandeau à chaque retour
    openExternal(update.url || 'https://github.com/Sohhka/sohri/releases/latest');
  }, function () { postpone(UPDATE_LATER.closed); });
}

if (window.AndroidBridge && window.AndroidBridge.getAppVersion) {
  checkAndroidUpdate();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkAndroidUpdate();
  });
  window.addEventListener('online', checkAndroidUpdate);
}

if (IS_WEB) {
  if (window.visualViewport) {
    var fitPending = false;
    var scheduleFit = function () {
      if (fitPending) return;
      fitPending = true;
      requestAnimationFrame(function () {
        fitPending = false;
        fitToVisibleArea();
      });
    };
    window.visualViewport.addEventListener('resize', scheduleFit);
    window.visualViewport.addEventListener('scroll', scheduleFit);
    fitToVisibleArea();
  }
  // iPhone : pas de zoom de toute la page à deux doigts (documents et photos ont leur propre zoom).
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  if ('serviceWorker' in navigator && window.isSecureContext) registerServiceWorker();
  // Appli installée : ses données ne doivent pas être effacées pour faire de la place.
  if (IS_INSTALLED && navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (persisted) {
      if (!persisted) return navigator.storage.persist();
    })['catch'](function () { /* non pris en charge */ });
  }
  if (canInstallOnIos()) showInstallHint();
  checkFileStorage();
}

/* ---------- Démarrage ---------- */
goToSection('converter');
loadRate();
cloudStart(); // partage : seulement si un compte est connecté sur ce téléphone
// Rappel de sauvegarde (voir settings.js), une fois l'appli lancée et le compte chargé.
setTimeout(function () {
  checkBackupReminder()['catch'](function (err) { console.error(err); });
}, 4000);
