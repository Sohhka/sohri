/* ---------- Convertisseur ¥ ⇄ € ----------
   Dans un sens ou dans l'autre (⇅, choix gardé sur le téléphone) : yens → euros, ou euros → yens.
   « ＋ » additionne plusieurs prix (le résultat est alors leur total), et 🧾 note le montant comme
   dépense (voir expenses.js). */
defineView('converter', { el: 'view-converter', section: 'converter', title: 'Convertisseur', enter: showConverter, exit: stopClock });

function showConverter() {
  fitAmounts();
  startClock();
}

var DEFAULT_RATE = 184.5;
var MAX_YEN_DIGITS = 12;
var MAX_EURO_DIGITS = 9;
var currentRate = DEFAULT_RATE;
var convertFrom = 'JPY'; // devise saisie : 'JPY' (vers les euros) ou 'EUR' (vers les yens)
var rawAmount = 0;       // montant saisi, dans cette devise
var sumAmounts = [];     // prix déjà additionnés (« ＋ »), dans cette devise
try { if (localStorage.getItem('sohri.convertFrom') === 'EUR') convertFrom = 'EUR'; } catch (e) { /* stockage indisponible */ }

var yenInput = document.getElementById('yenInput');   // montant saisi (en yens, ou en euros dans l'autre sens)
var eurResult = document.getElementById('eurResult'); // résultat (en euros, ou en yens)

function fmtRate(rate) { return rate.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function refreshRateText() { document.getElementById('rateText').textContent = '1 € = ' + fmtRate(currentRate) + ' ¥'; }
function formatYen(raw) { return Number(raw).toLocaleString('fr-FR'); }
function formatEuro(value) { return value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
/* Un montant dans sa devise : « 1 200 ¥ », « 12,50 € » (espace insécable : jamais de ¥ seul à la ligne). */
function formatMoney(value, currency) {
  return currency === 'EUR' ? formatEuro(value) + ' €' : formatYen(Math.round(value)) + ' ¥';
}
/* Conversion au taux affiché. */
function toEuros(yen) { return yen / currentRate; }
function toYens(euros) { return euros * currentRate; }

/* Montant très long : les chiffres rétrécissent pour tenir dans la largeur de l'écran. */
function fitToWidth(el, box) {
  el.style.fontSize = '';
  if (!box.clientWidth) return; // vue cachée : ajusté à son affichage
  var size = parseFloat(getComputedStyle(el).fontSize);
  for (var i = 0; i < 20 && box.scrollWidth > box.clientWidth && size > 16; i++) {
    size = Math.max(16, Math.floor(size * Math.min(0.95, box.clientWidth / box.scrollWidth)));
    el.style.fontSize = size + 'px';
  }
}

function fitAmounts() {
  fitToWidth(yenInput, yenInput);
  fitToWidth(eurResult, eurResult.parentNode);
}

function totalAmount() {
  return sumAmounts.reduce(function (sum, value) { return sum + value; }, rawAmount);
}

function updateResult() {
  var total = totalAmount();
  eurResult.textContent = convertFrom === 'JPY'
    ? formatEuro(total > 0 ? toEuros(total) : 0)
    : formatYen(total > 0 ? Math.round(toYens(total)) : 0);
  byId('resultLabel').textContent = (sumAmounts.length ? 'Total en ' : '') + (convertFrom === 'JPY' ? (sumAmounts.length ? 'euros' : 'Euro') : (sumAmounts.length ? 'yens' : 'Yen'));
  byId('noteExpenseBtn').hidden = !(total > 0);
  fitAmounts();
}

/* Saisie : en yens, des chiffres seulement ; en euros, deux décimales au plus (virgule ou point). */
function readAmountInput(text) {
  if (convertFrom === 'JPY') {
    var digits = text.replace(/[^\d]/g, '').slice(0, MAX_YEN_DIGITS);
    var yen = digits ? parseInt(digits, 10) : 0;
    return { value: yen, text: digits ? formatYen(yen) : '' };
  }
  var cleaned = text.replace(/[^\d,.]/g, '').replace('.', ',');
  var parts = cleaned.split(',');
  var whole = parts[0].replace(/^0+(?=\d)/, '').slice(0, MAX_EURO_DIGITS);
  var cents = parts.length > 1 ? parts.slice(1).join('').slice(0, 2) : null;
  var value = (whole ? parseInt(whole, 10) : 0) + (cents ? parseInt((cents + '0').slice(0, 2), 10) / 100 : 0);
  var shown = whole ? formatYen(parseInt(whole, 10)) : cents !== null ? '0' : '';
  return { value: value, text: shown + (cents !== null ? ',' + cents : '') };
}

function showAmount(value) {
  rawAmount = value > 0 ? value : 0;
  if (!rawAmount) yenInput.value = '';
  else if (convertFrom === 'JPY') yenInput.value = formatYen(Math.round(rawAmount));
  else yenInput.value = Number.isInteger(rawAmount) ? formatYen(rawAmount) : formatEuro(rawAmount);
}

yenInput.addEventListener('input', function () {
  var read = readAmountInput(yenInput.value);
  rawAmount = read.value;
  yenInput.value = read.text;
  updateResult();
});
window.addEventListener('resize', fitAmounts);

/* Sens de conversion : libellés, clavier (avec ou sans virgule) et résultat. */
function applyDirection() {
  var yen = convertFrom === 'JPY';
  byId('amountLabel').textContent = yen ? 'Yen' : 'Euro';
  byId('amountSign').textContent = yen ? '¥' : '€';
  byId('resultSign').textContent = yen ? '€' : '¥';
  yenInput.setAttribute('inputmode', yen ? 'numeric' : 'decimal');
  yenInput.setAttribute('aria-label', yen ? 'Montant en yens' : 'Montant en euros');
  byId('swapBtn').setAttribute('aria-label', yen ? 'Inverser : convertir des euros en yens' : 'Inverser : convertir des yens en euros');
  renderSumList();
  updateResult();
}

/* ⇅ : le résultat devient le montant saisi, dans l'autre sens. */
byId('swapBtn').addEventListener('click', function () {
  var total = totalAmount();
  var converted = convertFrom === 'JPY' ? Math.round(toEuros(total) * 100) / 100 : Math.round(toYens(total));
  convertFrom = convertFrom === 'JPY' ? 'EUR' : 'JPY';
  try { localStorage.setItem('sohri.convertFrom', convertFrom); } catch (e) { /* stockage indisponible */ }
  sumAmounts = [];
  showAmount(total > 0 ? converted : 0);
  applyDirection();
});

/* ＋ : ce prix rejoint le total, et on peut taper le suivant. */
function renderSumList() {
  var list = byId('sumList');
  list.innerHTML = '';
  list.hidden = !sumAmounts.length;
  sumAmounts.forEach(function (value, index) {
    list.appendChild(h('button', {
      type: 'button', className: 'sum-chip', 'aria-label': 'Retirer ' + formatMoney(value, convertFrom),
      onclick: function () {
        sumAmounts.splice(index, 1);
        renderSumList();
        updateResult();
      }
    }, formatMoney(value, convertFrom) + ' ×'));
  });
  if (sumAmounts.length) {
    list.appendChild(h('button', {
      type: 'button', className: 'link-btn sum-clear', text: 'Effacer',
      onclick: function () {
        sumAmounts = [];
        renderSumList();
        updateResult();
      }
    }));
  }
  if (window.fitClock) fitClock();
}

byId('sumAddBtn').addEventListener('click', function () {
  if (!(rawAmount > 0)) {
    showToast(sumAmounts.length ? 'Tape le prix suivant, puis ＋.' : 'Tape un prix, puis ＋ pour l\'ajouter au total.');
    yenInput.focus();
    return;
  }
  sumAmounts.push(rawAmount);
  showAmount(0);
  renderSumList();
  updateResult();
  yenInput.focus();
});

/* 🧾 : le montant (ou le total) devient une dépense. */
byId('noteExpenseBtn').addEventListener('click', function () {
  var total = totalAmount();
  if (total > 0) openView('expense-edit', { amount: Math.round(total * 100) / 100, currency: convertFrom });
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
    // Taux de sa carte, par exemple : gardé jusqu'au prochain taux du jour publié.
    rateInfo.manual = true;
    rateInfo.manualAt = Date.now();
    saveRateInfo();
    refreshRateText();
    refreshRateNote();
    updateResult();
  }
  closeRateEdit();
}
document.getElementById('rateSaveBtn').addEventListener('click', saveRate);
document.getElementById('rateInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveRate(); });

function loadRate() {
  Promise.all([dbGet('settings', 'yenEuroRate'), dbGet('settings', 'yenEuroRateInfo')]).then(function (r) {
    if (r[0] && r[0].value > 0) currentRate = r[0].value;
    if (r[1] && r[1].value) rateInfo = r[1].value;
  }).catch(function (err) { console.error(err); }).then(function () {
    refreshRateText();
    refreshRateNote();
    applyDirection();
    refreshRate();
  });
}

/* ---------- Taux du jour ----------
   Taux de la Banque centrale européenne (service Frankfurter, gratuit, sans compte ; en secours,
   taux du marché publié sur jsDelivr), repris dès qu'il y a Internet : au lancement, au retour dans
   l'appli, au retour du réseau (même une minute), puis au plus toutes les heures. Un taux modifié à
   la main reste en place jusqu'au prochain taux publié. */
var RATE_SOURCES = [
  { url: 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY', source: 'bce', read: function (j) { return j.rates && j.rates.JPY; } },
  { url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.min.json', source: 'marche', read: function (j) { return j.eur && j.eur.jpy; } }
];
var RATE_CHECK_EVERY = 3600000;
var RATE_CHECK_ONLINE = 10 * 60000;
var rateInfo = { manual: false, manualAt: 0, date: null, source: null, checkedAt: 0 };
var rateLoading = null;
var rateFailures = 0;
var rateRetryTimer = null;

function saveRateInfo() {
  return dbPut('settings', { key: 'yenEuroRateInfo', value: rateInfo }).catch(function (err) { console.error(err); });
}

/* Taux publié (premier service qui répond) : { rate, date 'AAAA-MM-JJ', source }. */
function fetchRate(index) {
  var service = RATE_SOURCES[index];
  return fetchJson(service.url).then(function (json) {
    var rate = service.read(json);
    if (!(rate > 50 && rate < 500) || !/^\d{4}-\d{2}-\d{2}$/.test(json.date || '')) throw new Error('Taux illisible');
    return { rate: Math.round(rate * 100) / 100, date: json.date, source: service.source };
  })['catch'](function (err) {
    if (index + 1 < RATE_SOURCES.length) return fetchRate(index + 1);
    throw err;
  });
}

function localDay(time) {
  var d = new Date(time);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* maxAge : pas de nouvelle demande si le taux a été vérifié plus récemment. */
function refreshRate(maxAge) {
  if (rateLoading) return rateLoading;
  if (navigator.onLine === false || isRateEditOpen()) return Promise.resolve(); // (saisie en cours : plus tard)
  if (Date.now() - (rateInfo.checkedAt || 0) < (maxAge === undefined ? RATE_CHECK_EVERY : maxAge)) return Promise.resolve();
  clearTimeout(rateRetryTimer);
  rateLoading = fetchRate(0).then(function (found) {
    rateInfo.checkedAt = Date.now();
    rateFailures = 0;
    // Taux modifié à la main : remplacé seulement par un taux publié après ce jour-là ; sinon,
    // jamais par un taux plus ancien que celui affiché (service de secours en retard...).
    var newer = rateInfo.manual ? found.date > localDay(rateInfo.manualAt) : !rateInfo.date || found.date >= rateInfo.date;
    if (newer) {
      rateInfo.manual = false;
      rateInfo.date = found.date;
      rateInfo.source = found.source;
      currentRate = found.rate;
      dbPut('settings', { key: 'yenEuroRate', value: currentRate }).catch(function (err) { console.error(err); });
      refreshRateText();
      refreshRateNote();
      updateResult();
    }
    return saveRateInfo();
  }, function (err) {
    // Réseau sans Internet (Wi-Fi d'hôtel pas encore ouvert...) : nouvel essai dans une minute.
    console.warn('Taux du jour pas encore reçu', err);
    if (++rateFailures <= 5) rateRetryTimer = setTimeout(function () { refreshRate(0); }, 60000);
  }).then(function () {
    rateLoading = null;
    refreshRateNote();
  });
  return rateLoading;
}

/* Sous le convertisseur : d'où vient le taux, et de quand. */
function refreshRateNote() {
  var note = byId('rateNote');
  if (rateInfo.manual) {
    note.textContent = 'Taux modifié à la main : remplacé par le prochain taux du jour (avec Internet).';
  } else if (rateInfo.date) {
    var parts = rateInfo.date.split('-');
    var day = parseInt(parts[2], 10) + ' ' + CLOCK_MONTHS[parseInt(parts[1], 10) - 1];
    note.textContent = 'Taux ' + (rateInfo.source === 'bce' ? 'de la BCE' : 'du marché') + ' du ' + day + ', mis à jour tout seul avec Internet. Fonctionne sans connexion.';
  } else {
    note.textContent = 'Taux indicatif : il se met à jour tout seul dès que tu as Internet. Fonctionne sans connexion.';
  }
}

// Internet revient (même une minute) : le taux en profite aussitôt.
window.addEventListener('online', function () {
  rateFailures = 0;
  refreshRate(RATE_CHECK_ONLINE);
});
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') refreshRate();
});
setInterval(function () {
  if (document.visibilityState === 'visible') refreshRate();
}, 20 * 60000);

/* ---------- Heure au Japon et en France (sous le convertisseur) ----------
   Calculée par le téléphone avec les fuseaux Asia/Tokyo et Europe/Paris (heure d'été comprise),
   donc sans Internet ; mise à jour chaque seconde tant que l'écran est affiché. Sans ces fuseaux
   (très vieux téléphone) : le Japon est à UTC+9 toute l'année, la France suit la règle européenne. */
var CLOCK_DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
var CLOCK_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
var clockFormats = {};
var clockTimer = null;
var clockMinute = null;

/* Décalage (en minutes) de l'heure d'un fuseau sur l'heure universelle, à cet instant. */
function zoneOffset(date, zone, fallback) {
  try {
    if (!clockFormats[zone]) {
      clockFormats[zone] = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
      });
    }
    var f = {};
    clockFormats[zone].formatToParts(date).forEach(function (part) { f[part.type] = part.value; });
    var wall = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour % 24, +f.minute); // « 24:05 » sur certains moteurs
    if (isNaN(wall)) throw new Error('Heure illisible');
    return Math.round((wall - Math.floor(date.getTime() / 60000) * 60000) / 60000);
  } catch (e) {
    return fallback(date);
  }
}

/* Heure d'été en Europe : du dernier dimanche de mars au dernier dimanche d'octobre, à 1 h UTC. */
function lastSundayUtc(year, month) {
  var d = new Date(Date.UTC(year, month + 1, 0, 1));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}
function franceOffsetRule(date) {
  var year = date.getUTCFullYear();
  var t = date.getTime();
  return t >= lastSundayUtc(year, 2) && t < lastSundayUtc(year, 9) ? 120 : 60;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/* « mer. 1 oct. » ; date lue en « UTC » : l'heure du fuseau (voir zoneWall). */
function clockDayText(wall) {
  return CLOCK_DAYS[wall.getUTCDay()] + ' ' + wall.getUTCDate() + ' ' + CLOCK_MONTHS[wall.getUTCMonth()];
}
function zoneWall(now, offset) {
  return new Date(now.getTime() + offset * 60000);
}

/* Les heures s'affichent partout où la page en a la place : data-clock="japan" (ou "france"),
   data-clock-day, data-clock-gap (écart). clockListeners : appelés à chaque nouvelle minute. */
var clockListeners = [];

function tickClock() {
  var now = new Date();
  var minute = Math.floor(now.getTime() / 60000);
  if (minute === clockMinute) return;
  clockMinute = minute;
  var offsets = {
    japan: zoneOffset(now, 'Asia/Tokyo', function () { return 540; }),
    france: zoneOffset(now, 'Europe/Paris', franceOffsetRule)
  };
  var each = function (selector, fn) { Array.prototype.forEach.call(document.querySelectorAll(selector), fn); };
  each('[data-clock]', function (el) {
    var wall = zoneWall(now, offsets[el.dataset.clock]);
    el.textContent = pad2(wall.getUTCHours()) + ':' + pad2(wall.getUTCMinutes());
  });
  each('[data-clock-day]', function (el) { el.textContent = clockDayText(zoneWall(now, offsets[el.dataset.clockDay])); });
  var gap = String(Math.abs(offsets.japan - offsets.france) / 60).replace('.', ',') + ' h d\'écart';
  each('[data-clock-gap]', function (el) { el.textContent = gap; });
  clockListeners.forEach(function (fn) {
    try { fn(now); } catch (e) { console.error(e); }
  });
}

function startClock() {
  stopClock();
  clockMinute = null;
  tickClock();
  clockTimer = setInterval(tickClock, 1000);
  fitClock();
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

/* La page tient sans défilement : sur un écran peu haut, les heures passent sur une ligne ; clavier
   ouvert (saisie d'un montant), elles s'effacent le temps de la saisie. */
function fitClock() {
  var clock = byId('worldClock');
  var main = byId('content');
  clock.classList.remove('is-compact');
  clock.hidden = false;
  if (currentViewName() !== 'converter' || !main.clientHeight) return;
  if (main.scrollHeight <= main.clientHeight + 1) return;
  clock.classList.add('is-compact');
  if (main.scrollHeight > main.clientHeight + 1) clock.hidden = true;
}

window.addEventListener('resize', fitClock);
if (window.visualViewport) {
  // Clavier de l'iPhone : la hauteur utile change après ce redimensionnement (voir app.js).
  window.visualViewport.addEventListener('resize', function () { setTimeout(fitClock, 120); });
}
// Retour dans l'appli : l'heure est remise à jour aussitôt, et rien ne tourne en arrière-plan.
var CLOCK_VIEWS = { converter: true, weather: true };
document.addEventListener('visibilitychange', function () {
  if (!CLOCK_VIEWS[currentViewName()]) return;
  if (document.visibilityState === 'visible') startClock();
  else stopClock();
});
