/* ---------- Paramètres : thème, sauvegarde, stockage, aide ---------- */
defineView('settings', {
  el: 'view-settings',
  section: 'settings',
  title: 'Paramètres',
  enter: renderSettings
});

function renderSettings() {
  var preference = getThemePreference();
  var choices = document.querySelectorAll('[data-theme-choice]');
  for (var i = 0; i < choices.length; i++) {
    choices[i].setAttribute('aria-selected', String(choices[i].dataset.themeChoice === preference));
  }
  renderBackupInfo();
  var storage = byId('storageInfo');
  storage.textContent = '';
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(function (estimate) {
      storage.textContent = "Espace utilisé par l'appli : " + formatSize(estimate.usage || 0) + '.';
    });
  }
  byId('appVersion').textContent = window.AndroidBridge
    ? 'SOHRI, version ' + window.AndroidBridge.getAppVersion()
    : 'SOHRI, version web' + (navigator.serviceWorker && navigator.serviceWorker.controller
      ? ', disponible hors connexion.'
      : ' (hors connexion : pas encore prête, rouvre l\'appli avec Internet).');
  byId('installInfo').hidden = !canInstallOnIos();
  prepareDiagnosticReport();
}

byId('themeChoice').addEventListener('click', function (e) {
  var button = e.target.closest('[data-theme-choice]');
  if (!button) return;
  setThemePreference(button.dataset.themeChoice);
  renderSettings();
});

byId('backupBtn').addEventListener('click', function () {
  createBackup().catch(function (err) {
    console.error(err);
    uiAlert("La sauvegarde n'a pas pu être créée : " + err.message);
  });
});

byId('restoreBtn').addEventListener('click', function () {
  byId('restoreInput').click();
});

byId('restoreInput').addEventListener('change', function (e) {
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) restoreBackup(file);
});

/* ---------- Rappel de sauvegarde ----------
   Date de la dernière sauvegarde faite sur ce téléphone (gardée par le téléphone, pas dans les
   sauvegardes). Au-delà d'une semaine, un bandeau le rappelle au lancement, sauf si toutes les
   rubriques sont synchronisées avec le compte (elles y sont déjà à l'abri) ; « × » le fait taire
   trois jours. Sans aucune sauvegarde : une semaine après la première utilisation. */
var LAST_BACKUP_PREF = 'sohri.lastBackup';
var FIRST_SEEN_PREF = 'sohri.firstSeen';
var BACKUP_LATER_PREF = 'sohri.backupLater';
var BACKUP_REMIND_AFTER = 7 * 86400000;
var BACKUP_REMIND_LATER = 3 * 86400000;

/* Jours entre deux dates du calendrier (aujourd'hui : 0, hier : 1...). */
function daysAgo(time) {
  var day = function (t) { var d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  return Math.round((day(Date.now()) - day(time)) / 86400000);
}

function backupAgeText(time) {
  var days = daysAgo(time);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return 'il y a ' + days + ' jours (le ' + formatShortDate(time) + ')';
}

function renderBackupInfo() {
  var last = readPref(LAST_BACKUP_PREF);
  var info = byId('backupInfo');
  // (date notée depuis la version 2.3 : une sauvegarde plus ancienne n'est pas connue)
  info.textContent = last ? 'Dernière sauvegarde sur ce téléphone : ' + backupAgeText(last) + '.' : 'Aucune sauvegarde récente sur ce téléphone.';
  info.classList.toggle('is-late', !last || Date.now() - last > BACKUP_REMIND_AFTER);
  if (syncAllEnabled()) info.textContent += ' Tes rubriques sont aussi synchronisées avec ton compte.';
}

/* Quelque chose à sauvegarder ? */
function hasUserData() {
  return Promise.all(['notes', 'addresses', 'photos', 'documents', 'expenses'].map(dbCount)).then(function (counts) {
    return counts.some(function (n) { return n > 0; });
  }, function () { return false; });
}

function checkBackupReminder() {
  var first = readPref(FIRST_SEEN_PREF);
  if (!first) {
    writePref(FIRST_SEEN_PREF, Date.now());
    return Promise.resolve(false);
  }
  var last = readPref(LAST_BACKUP_PREF);
  var later = readPref(BACKUP_LATER_PREF);
  if (Date.now() - (last || first) < BACKUP_REMIND_AFTER || (later && Date.now() < later) || syncAllEnabled()) return Promise.resolve(false);
  return hasUserData().then(function (has) {
    if (!has || !byId('banner').hidden) return false;
    showBanner(last ? 'Ta dernière sauvegarde date de ' + daysAgo(last) + ' jours : pense à en refaire une.' : 'Pas de sauvegarde récente de tes données sur ce téléphone : pense à en faire une.',
      'Sauvegarder', function () {
        createBackup().catch(function (err) {
          console.error(err);
          uiAlert("La sauvegarde n'a pas pu être créée : " + err.message);
        });
      }, function () {
        writePref(BACKUP_LATER_PREF, Date.now() + BACKUP_REMIND_LATER);
      });
    return true;
  });
}

/* ---------- Rapport de diagnostic (voir diagnostic.js) ----------
   Préparé à l'ouverture des Paramètres : sur l'iPhone, la feuille de partage ne s'ouvre qu'en
   réponse directe à un toucher, sans attente. */
var diagnosticReport = null;

function deviceText() {
  var ua = navigator.userAgent;
  var ios = /OS (\d+)[_.](\d+)/.exec(ua);
  if (IS_IOS && ios) return (/iPad/.test(ua) ? 'iPad' : 'iPhone') + ', iOS ' + ios[1] + '.' + ios[2];
  var android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  if (android) return 'Android ' + android[1];
  return ua.slice(0, 120);
}

function appVersionText() {
  if (window.AndroidBridge) return Promise.resolve('appli Android ' + window.AndroidBridge.getAppVersion());
  var where = IS_INSTALLED ? 'installée sur l\'écran d\'accueil' : 'dans le navigateur';
  if (!window.caches) return Promise.resolve('version web, ' + where);
  return caches.keys().then(function (keys) {
    var cache = keys.filter(function (k) { return k.indexOf('sohri-') === 0; })[0];
    return 'version web' + (cache ? ' ' + cache.slice(6, 14) : '') + ', ' + where;
  }, function () { return 'version web, ' + where; });
}

var SYNC_STATE_TEXT = { idle: 'pas encore lancée', syncing: 'en cours', done: 'à jour', offline: 'hors connexion', error: 'erreur', 'signed-out': 'session expirée' };

function buildDiagnosticReport() {
  var stores = ['notes', 'addresses', 'folders', 'photos', 'documents', 'expenses'];
  var signedIn = isSignedIn();
  return Promise.all([
    Promise.all(stores.map(function (s) { return dbCount(s).then(null, function () { return '?'; }); })),
    navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().then(null, function () { return null; }) : null,
    appVersionText(),
    signedIn ? Promise.all([loadSyncRecords('pend:'), loadSyncRecords('ipend:'), dbGetAll('sharedComments'), dbGetAll('sharedPhotos')]) : null
  ]).then(function (r) {
    var n = r[0];
    var count = function (i, one, many) { return typeof n[i] === 'number' ? plural(n[i], one, many) : '? ' + many; };
    var lines = [
      'Rapport SOHRI du ' + formatDateTime(Date.now()),
      'Appli : ' + r[2],
      'Appareil : ' + deviceText() + (navigator.onLine === false ? ' (hors connexion)' : ''),
      'Contenu : ' + [count(0, 'note', 'notes'), count(1, 'adresse', 'adresses'), count(2, 'dossier ou album', 'dossiers et albums'),
        count(3, 'photo', 'photos'), count(4, 'document', 'documents'), count(5, 'dépense', 'dépenses')].join(', ')
    ];
    if (r[1]) lines.push('Stockage du téléphone : ' + formatSize(r[1].usage || 0) + ' utilisés' + (r[1].quota ? ' (place disponible : ' + formatSize(r[1].quota) + ')' : ''));
    var last = readPref(LAST_BACKUP_PREF);
    lines.push('Dernière sauvegarde : ' + (last ? backupAgeText(last) : 'aucune récente'));
    if (!signedIn) {
      lines.push('Compte : aucun (partage non utilisé)');
    } else {
      var s = cloudStatus;
      lines.push('Compte : connecté ; toutes les rubriques synchronisées : ' + (syncAllEnabled() ? 'oui' : 'non') +
        ' ; Images partagées avec ' + plural(sharedWith('albums').length, 'proche', 'proches') +
        ' ; Images reçues de ' + plural(cloudState.grantsToMe.length, 'proche', 'proches'));
      lines.push('Synchronisation : ' + (SYNC_STATE_TEXT[s.state] || s.state) +
        (s.lastSync ? ' (dernière réussie : ' + formatDateTime(s.lastSync) + ')' : '') +
        (s.error ? ' ; erreur : ' + cloudErrorText(s.error) : ''));
      var waiting = r[3];
      lines.push('En attente : ' + Object.keys(waiting[0]).length + ' photos de mes appareils, ' + Object.keys(waiting[1]).length + ' éléments à relire, ' +
        waiting[2].filter(function (c) { return c.pending; }).length + ' commentaires à envoyer, ' +
        waiting[3].filter(function (p) { return !p.blob; }).length + ' photos de proches à recevoir en grand');
      if (itemsLeftHere.length) lines.push('Trop gros pour être synchronisés : ' + itemsLeftHere.length);
    }
    var recent = diagLog.slice(-15);
    lines.push(recent.length ? 'Dernières erreurs :' : 'Dernières erreurs : aucune');
    recent.forEach(function (entry) {
      lines.push('- ' + formatShortDate(entry.t) + ' ' + new Date(entry.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) +
        (entry.level === 'error' ? ' ⛔ ' : ' ⚠️ ') + entry.text + (entry.n > 1 ? ' (' + entry.n + ' fois, la dernière à cette heure-là)' : ''));
    });
    return lines.join('\n');
  });
}

function prepareDiagnosticReport() {
  return buildDiagnosticReport().then(function (report) {
    diagnosticReport = report;
    return report;
  }, function (err) {
    console.error(err);
    return null;
  });
}

byId('diagnosticBtn').addEventListener('click', function () {
  var send = function (report) { return shareText(report, 'Rapport SOHRI'); };
  var ready = diagnosticReport;
  if (ready) send(ready).then(null, function (err) { console.error(err); uiAlert("Le rapport n'a pas pu être envoyé."); });
  else prepareDiagnosticReport().then(function (report) {
    if (report) return showDialog('Le rapport est prêt.', { cancelable: true, okLabel: 'Envoyer', onConfirm: function () { return send(report); } });
  });
  prepareDiagnosticReport(); // à jour pour le prochain envoi
});
