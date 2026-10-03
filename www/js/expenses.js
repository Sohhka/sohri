/* ---------- Dépenses du voyage ----------
   Chaque achat : son montant en yens (ou en euros), une catégorie, un libellé facultatif, sa date,
   et le taux du jour au moment de l'achat, qui sert à le convertir. En haut, les totaux du voyage,
   du jour et par catégorie ; en dessous, les achats jour par jour. Magasin « expenses » : dans les
   sauvegardes, et synchronisé entre mes appareils avec le reste (sync.js). Le convertisseur peut
   en créer une d'un toucher (🧾). Export en tableau (CSV) pour un tableur. */
var EXPENSE_CATEGORIES = [
  { id: 'repas', icon: '🍜', label: 'Repas' },
  { id: 'transport', icon: '🚆', label: 'Transport' },
  { id: 'shopping', icon: '🛍️', label: 'Shopping' },
  { id: 'hebergement', icon: '🏨', label: 'Hébergement' },
  { id: 'visites', icon: '⛩️', label: 'Visites' },
  { id: 'autre', icon: '💳', label: 'Autre' }
];
var editingExpense = null;   // dépense ouverte dans le formulaire (null : nouvelle)
var expenseDraft = null;     // { currency, amount, category }
var expenseFormSnapshot = '';
var savingExpense = false;
var expensesRenderId = 0;

function expenseCategory(id) {
  return EXPENSE_CATEGORIES.filter(function (c) { return c.id === id; })[0] || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}
/* Montant d'une dépense dans chaque devise, au taux de son jour. */
function expenseYen(e) { return e.currency === 'EUR' ? e.amount * e.rate : e.amount; }
function expenseEuro(e) { return e.currency === 'EUR' ? e.amount : e.amount / e.rate; }
function moneyPair(yen, euro) { return formatMoney(yen, 'JPY') + ' · ' + formatMoney(euro, 'EUR'); }
function dayKey(time) { var d = new Date(time); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

/* ---------- Liste et totaux ---------- */
defineView('expenses', {
  el: 'view-expenses',
  section: 'expenses',
  title: 'Dépenses',
  enter: renderExpenses,
  actions: function () {
    return [
      { icon: '+', label: 'Nouvelle dépense', onClick: function () { openView('expense-edit', {}); } },
      { icon: '⋮', label: 'Options des dépenses', onClick: showExpensesMenu }
    ];
  }
});

function renderExpenses() {
  var renderId = ++expensesRenderId;
  return dbGetAll('expenses').then(function (all) {
    if (renderId !== expensesRenderId) return;
    var expenses = all.sort(function (a, b) { return (b.spentAt || 0) - (a.spentAt || 0); });
    var summary = byId('expensesSummary');
    var list = byId('expensesList');
    summary.innerHTML = '';
    list.innerHTML = '';
    showEmpty(byId('expensesEmpty'), !expenses.length, 'Aucune dépense pour l\'instant. Appuie sur + pour noter un achat, ou sur 🧾 dans le convertisseur.');
    if (!expenses.length) return;

    var total = { yen: 0, euro: 0 };
    var today = { yen: 0, euro: 0, count: 0 };
    var byCategory = {};
    var todayKey = dayKey(Date.now());
    expenses.forEach(function (e) {
      var yen = expenseYen(e);
      var euro = expenseEuro(e);
      total.yen += yen;
      total.euro += euro;
      if (dayKey(e.spentAt) === todayKey) { today.yen += yen; today.euro += euro; today.count++; }
      var c = byCategory[e.category] = byCategory[e.category] || { yen: 0, euro: 0 };
      c.yen += yen;
      c.euro += euro;
    });

    summary.appendChild(h('div', { className: 'card expense-total' }, [
      h('p', { className: 'card-label', text: 'Total du voyage · ' + plural(expenses.length, 'dépense', 'dépenses') }),
      h('p', { className: 'expense-total-yen', text: formatMoney(total.yen, 'JPY') }),
      h('p', { className: 'expense-total-euro', text: '≈ ' + formatMoney(total.euro, 'EUR') }),
      h('p', { className: 'expense-today', text: today.count ? 'Aujourd\'hui : ' + moneyPair(today.yen, today.euro) : 'Rien aujourd\'hui pour l\'instant.' })
    ]));
    // Par catégorie, de la plus grosse à la plus petite, avec une barre proportionnelle.
    var categories = EXPENSE_CATEGORIES.filter(function (c) { return byCategory[c.id]; }).sort(function (a, b) { return byCategory[b.id].yen - byCategory[a.id].yen; });
    summary.appendChild(h('div', { className: 'card expense-categories' }, categories.map(function (c) {
      var share = total.yen > 0 ? byCategory[c.id].yen / total.yen : 0;
      return h('div', { className: 'expense-category' }, [
        h('span', { className: 'expense-category-name', text: c.icon + ' ' + c.label }),
        h('span', { className: 'expense-category-amount', text: moneyPair(byCategory[c.id].yen, byCategory[c.id].euro) }),
        h('span', { className: 'expense-bar' }, [h('span', { className: 'expense-bar-fill', style: 'width:' + Math.max(2, Math.round(share * 100)) + '%' })])
      ]);
    })));

    // Jour par jour, du plus récent au plus ancien.
    var day = null;
    expenses.forEach(function (e) {
      var key = dayKey(e.spentAt);
      if (key !== day) {
        day = key;
        var ofDay = expenses.filter(function (x) { return dayKey(x.spentAt) === key; });
        var yen = ofDay.reduce(function (s, x) { return s + expenseYen(x); }, 0);
        var euro = ofDay.reduce(function (s, x) { return s + expenseEuro(x); }, 0);
        list.appendChild(h('div', { className: 'expense-day' }, [
          h('span', { className: 'expense-day-name', text: formatDay(e.spentAt) }),
          h('span', { className: 'expense-day-total', text: moneyPair(yen, euro) })
        ]));
      }
      list.appendChild(expenseRow(e));
    });
  });
}

function expenseRow(e) {
  var category = expenseCategory(e.category);
  var time = new Date(e.spentAt);
  var main = e.currency === 'EUR' ? formatMoney(e.amount, 'EUR') : formatMoney(e.amount, 'JPY');
  var other = e.currency === 'EUR' ? formatMoney(expenseYen(e), 'JPY') : formatMoney(expenseEuro(e), 'EUR');
  return h('div', { className: 'list-row expense-row', onclick: function () { openView('expense-edit', { id: e.id }); } }, [
    h('span', { className: 'row-icon', text: category.icon }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: e.label || category.label }),
      h('p', { className: 'list-row-sub', text: (e.label ? category.label + ' · ' : '') + pad2(time.getHours()) + ':' + pad2(time.getMinutes()) })
    ]),
    h('div', { className: 'expense-amounts' }, [
      h('span', { className: 'expense-amount', text: main }),
      h('span', { className: 'expense-amount-other', text: other })
    ])
  ]);
}

function showExpensesMenu() {
  showActions([
    { icon: '📊', label: 'Exporter en tableau (CSV)', onClick: exportExpenses }
  ], 'Dépenses');
}

/* Tableau pour un tableur (Excel, Numbers, Google Sheets) : séparateur « ; » et virgule décimale. */
function exportExpenses() {
  dbGetAll('expenses').then(function (all) {
    if (!all.length) return uiAlert('Aucune dépense à exporter.');
    var number = function (value, digits) { return value.toFixed(digits).replace('.', ','); };
    var cell = function (text) { return '"' + String(text || '').replace(/"/g, '""') + '"'; };
    var lines = ['Date;Heure;Catégorie;Libellé;Montant;Devise;Taux (¥ pour 1 €);En yens;En euros'];
    all.sort(function (a, b) { return a.spentAt - b.spentAt; }).forEach(function (e) {
      var d = new Date(e.spentAt);
      lines.push([
        dayKey(e.spentAt), pad2(d.getHours()) + ':' + pad2(d.getMinutes()), cell(expenseCategory(e.category).label), cell(e.label),
        number(e.amount, e.currency === 'EUR' ? 2 : 0), e.currency === 'EUR' ? 'EUR' : 'JPY', number(e.rate, 2),
        number(expenseYen(e), 0), number(expenseEuro(e), 2)
      ].join(';'));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
    return shareFile(blob, 'SOHRI-depenses-' + dayKey(Date.now()) + '.csv');
  }).catch(function (err) {
    console.error(err);
    uiAlert("Les dépenses n'ont pas pu être exportées.");
  });
}

/* ---------- Une dépense : nouvelle ou modifiée ---------- */
defineView('expense-edit', {
  el: 'view-expense-edit',
  section: 'expenses',
  title: function (params) { return params.id ? 'Modifier la dépense' : 'Nouvelle dépense'; },
  enter: openExpenseEditor,
  exit: function () { editingExpense = null; },
  canLeave: function () { return confirmDiscard(expenseFormState() !== expenseFormSnapshot, 'Abandonner cette dépense ?'); },
  actions: function () { return [{ text: 'Enregistrer', label: 'Enregistrer la dépense', onClick: saveExpense }]; }
});

/* « 2026-10-03T14:05 » (heure du téléphone) pour le champ date et heure. */
function localDateTimeValue(time) {
  var d = new Date(time);
  return dayKey(time) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function expenseFormState() {
  if (!expenseDraft) return '';
  return JSON.stringify([expenseDraft.currency, expenseDraft.amount, expenseDraft.category, byId('expenseLabel').value.trim(), byId('expenseDate').value]);
}

function openExpenseEditor(params) {
  var load = params.id ? dbGet('expenses', params.id) : Promise.resolve(null);
  return load.then(function (expense) {
    if (params.id && !expense) {
      uiAlert("Cette dépense n'existe plus.");
      goBack(true);
      return;
    }
    editingExpense = expense;
    expenseDraft = expense
      ? { currency: expense.currency, amount: expense.amount, category: expense.category, rate: expense.rate }
      : { currency: params.currency === 'EUR' ? 'EUR' : 'JPY', amount: params.amount > 0 ? params.amount : 0, category: 'repas', rate: currentRate };
    byId('expenseLabel').value = expense ? expense.label || '' : '';
    byId('expenseDate').value = localDateTimeValue(expense ? expense.spentAt : Date.now());
    byId('expenseDeleteBtn').hidden = !expense;
    showExpenseAmount();
    renderExpenseForm();
    expenseFormSnapshot = expenseFormState();
    if (!expense && !expenseDraft.amount) byId('expenseAmount').focus();
  });
}

function showExpenseAmount() {
  var a = expenseDraft.amount;
  byId('expenseAmount').value = !a ? '' : expenseDraft.currency === 'EUR' && !Number.isInteger(a) ? formatEuro(a) : formatYen(Math.round(a));
}

function renderExpenseForm() {
  var eur = expenseDraft.currency === 'EUR';
  var buttons = document.querySelectorAll('[data-currency]');
  for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-selected', String(buttons[i].dataset.currency === expenseDraft.currency));
  byId('expenseSign').textContent = eur ? '€' : '¥';
  byId('expenseAmount').setAttribute('inputmode', eur ? 'decimal' : 'numeric');
  var row = byId('expenseCategories');
  row.innerHTML = '';
  EXPENSE_CATEGORIES.forEach(function (c) {
    row.appendChild(h('button', {
      type: 'button', className: 'filter-chip', 'aria-pressed': c.id === expenseDraft.category,
      onclick: function () {
        expenseDraft.category = c.id;
        renderExpenseForm();
      }
    }, c.icon + ' ' + c.label));
  });
  var a = expenseDraft.amount;
  byId('expenseConverted').textContent = a > 0 ? '≈ ' + (eur ? formatMoney(a * expenseDraft.rate, 'JPY') : formatMoney(a / expenseDraft.rate, 'EUR')) : '';
  byId('expenseRate').textContent = 'Taux ' + (editingExpense ? 'du jour de la dépense' : 'du jour') + ' : 1 € = ' + fmtRate(expenseDraft.rate) + ' ¥.';
}

/* Montant : en yens, des chiffres ; en euros, deux décimales au plus. */
function readExpenseAmount(text) {
  if (expenseDraft.currency === 'JPY') {
    var digits = text.replace(/[^\d]/g, '').slice(0, MAX_YEN_DIGITS);
    return { value: digits ? parseInt(digits, 10) : 0, text: digits ? formatYen(parseInt(digits, 10)) : '' };
  }
  var parts = text.replace(/[^\d,.]/g, '').replace('.', ',').split(',');
  var whole = parts[0].replace(/^0+(?=\d)/, '').slice(0, MAX_EURO_DIGITS);
  var cents = parts.length > 1 ? parts.slice(1).join('').slice(0, 2) : null;
  return {
    value: (whole ? parseInt(whole, 10) : 0) + (cents ? parseInt((cents + '0').slice(0, 2), 10) / 100 : 0),
    text: (whole ? formatYen(parseInt(whole, 10)) : cents !== null ? '0' : '') + (cents !== null ? ',' + cents : '')
  };
}

byId('expenseAmount').addEventListener('input', function () {
  var read = readExpenseAmount(byId('expenseAmount').value);
  expenseDraft.amount = read.value;
  byId('expenseAmount').value = read.text;
  renderExpenseForm();
});

/* Changer de devise : le montant tapé est gardé tel quel (12 000 ¥ → 12 000 € serait absurde : on
   le convertit). */
document.querySelector('.expense-currency').addEventListener('click', function (e) {
  var button = e.target.closest('[data-currency]');
  if (!button || !expenseDraft || button.dataset.currency === expenseDraft.currency) return;
  var a = expenseDraft.amount;
  expenseDraft.amount = !a ? 0 : button.dataset.currency === 'EUR' ? Math.round(a / expenseDraft.rate * 100) / 100 : Math.round(a * expenseDraft.rate);
  expenseDraft.currency = button.dataset.currency;
  showExpenseAmount();
  renderExpenseForm();
});

function saveExpense() {
  if (savingExpense || !expenseDraft) return;
  if (!(expenseDraft.amount > 0)) {
    uiAlert('Indique le montant de la dépense.');
    return;
  }
  var when = Date.parse(byId('expenseDate').value); // heure du téléphone
  var now = Date.now();
  var expense = {
    amount: expenseDraft.amount,
    currency: expenseDraft.currency,
    rate: expenseDraft.rate,
    category: expenseDraft.category,
    label: byId('expenseLabel').value.trim().slice(0, 80),
    spentAt: isNaN(when) ? (editingExpense ? editingExpense.spentAt : now) : when,
    createdAt: (editingExpense && editingExpense.createdAt) || now,
    updatedAt: now
  };
  if (editingExpense) {
    expense.id = editingExpense.id;
    keepSyncMarks(expense, editingExpense);
  }
  savingExpense = true;
  dbPut('expenses', expense).then(function () {
    expenseFormSnapshot = expenseFormState();
    showToast(editingExpense ? 'Dépense modifiée' : 'Dépense notée : ' + formatMoney(expense.amount, expense.currency));
    if (navStack.length > 1) goBack(true);
    else goToSection('expenses');
  }, function (err) {
    console.error(err);
    uiAlert("La dépense n'a pas pu être enregistrée.");
  }).then(function () { savingExpense = false; });
}

byId('expenseDeleteBtn').addEventListener('click', function () {
  var expense = editingExpense;
  if (!expense) return;
  uiConfirm('Supprimer cette dépense ?', 'Supprimer', true).then(function (ok) {
    if (!ok) return;
    return dbDelete('expenses', expense.id).then(function () {
      expenseFormSnapshot = expenseFormState();
      leaveAfterDelete('expenses');
      showToast('Dépense supprimée');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("La dépense n'a pas pu être supprimée.");
  });
});
