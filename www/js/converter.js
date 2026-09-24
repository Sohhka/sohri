/* ---------- Convertisseur Yen -> Euro ---------- */
defineView('converter', { el: 'view-converter', section: 'converter', title: 'Convertisseur' });

var DEFAULT_RATE = 184.5;
var currentRate = DEFAULT_RATE;
var rawYen = 0;

var yenInput = document.getElementById('yenInput');
var eurResult = document.getElementById('eurResult');

function fmtRate(rate) { return rate.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function refreshRateText() { document.getElementById('rateText').textContent = '1 € = ' + fmtRate(currentRate) + ' ¥'; }
function formatYen(raw) { return Number(raw).toLocaleString('fr-FR'); }

function updateResult() {
  var eur = rawYen > 0 ? rawYen / currentRate : 0;
  eurResult.textContent = eur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

yenInput.addEventListener('input', function () {
  var raw = yenInput.value.replace(/[^\d]/g, '');
  rawYen = raw ? parseInt(raw, 10) : 0;
  yenInput.value = raw ? formatYen(rawYen) : '';
  updateResult();
});

function openRateEdit() {
  document.getElementById('rateInput').value = fmtRate(currentRate);
  document.getElementById('rateView').hidden = true;
  document.getElementById('rateEdit').hidden = false;
  document.getElementById('rateInput').focus();
}

function closeRateEdit() {
  document.getElementById('rateEdit').hidden = true;
  document.getElementById('rateView').hidden = false;
}

function isRateEditOpen() {
  return !document.getElementById('rateEdit').hidden;
}

document.getElementById('rateEditBtn').addEventListener('click', openRateEdit);

function saveRate() {
  // Accepte « 184,5 », « 184.5 » et les espaces de séparation des milliers.
  var val = parseFloat(document.getElementById('rateInput').value.replace(/\s/g, '').replace(',', '.'));
  if (val && val > 0) {
    currentRate = val;
    dbPut('settings', { key: 'yenEuroRate', value: val }).catch(function (err) { console.error(err); });
    refreshRateText();
    updateResult();
  }
  closeRateEdit();
}
document.getElementById('rateSaveBtn').addEventListener('click', saveRate);
document.getElementById('rateInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveRate(); });

function loadRate() {
  dbGet('settings', 'yenEuroRate').then(function (row) {
    if (row && row.value > 0) currentRate = row.value;
  }).catch(function (err) { console.error(err); }).then(function () {
    refreshRateText();
    updateResult();
  });
}
