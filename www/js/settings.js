/* ---------- Paramètres : thème, sauvegarde, stockage ---------- */
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
