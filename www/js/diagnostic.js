/* ---------- Rapport de diagnostic (Paramètres → Aide) ----------
   Chargé en premier : garde les derniers messages d'erreur et avertissements de l'appli (sur ce
   téléphone, d'une ouverture à l'autre), pour le rapport qu'on peut envoyer à la personne qui aide
   quand quelque chose ne marche pas. Le rapport décrit l'état de l'appli (version, synchronisation,
   nombre d'éléments, erreurs), jamais leur contenu : ni texte, ni photo, ni adresse e-mail. */
var DIAG_KEY = 'sohri.diagnostic';
var DIAG_MAX = 40;
var diagLog = (function () {
  try { return JSON.parse(localStorage.getItem(DIAG_KEY)) || []; } catch (e) { return []; }
})();
var diagSaveTimer = null;

function diagText(value) {
  if (value instanceof Error) return value.message + (value.cloud ? ' [' + value.cloud + ']' : '');
  if (value && typeof value === 'object') {
    if (value.message) return String(value.message);
    try { return JSON.stringify(value).slice(0, 120); } catch (e) { return String(value); }
  }
  return String(value);
}

/* Un message déjà noté (hors connexion, le même revient souvent) : compté, et remonté en dernier. */
function diagRecord(level, args) {
  var text = Array.prototype.map.call(args, diagText).join(' ').replace(/\s+/g, ' ').slice(0, 300);
  var count = 1;
  for (var i = diagLog.length - 1; i >= 0; i--) {
    if (diagLog[i].level === level && diagLog[i].text === text) {
      count += diagLog[i].n || 1;
      diagLog.splice(i, 1);
      break;
    }
  }
  diagLog.push({ t: Date.now(), level: level, text: text, n: count });
  if (diagLog.length > DIAG_MAX) diagLog.splice(0, diagLog.length - DIAG_MAX);
  clearTimeout(diagSaveTimer);
  diagSaveTimer = setTimeout(function () {
    try { localStorage.setItem(DIAG_KEY, JSON.stringify(diagLog)); } catch (e) { /* stockage indisponible */ }
  }, 1000);
}

['error', 'warn'].forEach(function (level) {
  var original = console[level];
  console[level] = function () {
    try { diagRecord(level, arguments); } catch (e) { /* jamais bloquant */ }
    return original.apply(console, arguments);
  };
});
window.addEventListener('error', function (e) {
  diagRecord('error', [(e.message || 'Erreur') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')]);
});
window.addEventListener('unhandledrejection', function (e) {
  diagRecord('error', ['Promesse rejetée :', e.reason]);
});
