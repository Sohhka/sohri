/* ---------- Outils d'interface ---------- */
function byId(id) {
  return document.getElementById(id);
}

/* Échappe le texte pour l'insérer dans du HTML (contenu ou attribut). */
function escapeHTML(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Crée un élément : h('button', { className: 'x', onclick: f }, ['texte', autreElement]).
   Les valeurs null, undefined ou false sont ignorées (attributs comme enfants). */
function h(tag, props, children) {
  var node = document.createElement(tag);
  Object.keys(props || {}).forEach(function (key) {
    var value = props[key];
    if (value === null || value === undefined || value === false) return;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
    else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key.indexOf('aria-') === 0) node.setAttribute(key, String(value));
    else node.setAttribute(key, value === true ? '' : value);
  });
  [].concat(children === undefined ? [] : children).forEach(function (child) {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateTime(ts) {
  return formatDate(ts) + ' à ' + new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
/* « 24 sept. », avec l'année seulement si ce n'est pas l'année en cours. */
function formatShortDate(ts) {
  var date = new Date(ts);
  var options = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('fr-FR', options);
}
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
}
function plural(count, singular, pluralForm) {
  return count + ' ' + (count > 1 ? pluralForm : singular);
}
/* Texte sans accents ni majuscules, pour la recherche. */
function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function byName(a, b) {
  return (a.name || '').localeCompare(b.name || '', 'fr');
}
function byTitle(a, b) {
  return (a.title || '').localeCompare(b.title || '', 'fr');
}
function mapById(list) {
  var map = {};
  list.forEach(function (item) { map[item.id] = item; });
  return map;
}

/* Adresses temporaires pour afficher des images (Blob), libérées par groupe quand une vue se ferme. */
var blobUrlGroups = {};
function blobUrl(group, blob) {
  if (typeof blob === 'string') return blob;
  var url = URL.createObjectURL(blob);
  (blobUrlGroups[group] = blobUrlGroups[group] || []).push(url);
  return url;
}
function releaseBlobUrls(group) {
  (blobUrlGroups[group] || []).forEach(function (url) { URL.revokeObjectURL(url); });
  blobUrlGroups[group] = [];
}

/* Ouvre un lien (itinéraire Google Maps, site web, téléphone...) dans l'appli adaptée du téléphone. */
function openExternal(url) {
  if (window.AndroidBridge) window.AndroidBridge.openExternal(url);
  else if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener');
  else location.href = url; // tel:, mailto: : l'iPhone propose d'appeler, d'écrire...
}

function copyText(text) {
  if (window.AndroidBridge) {
    window.AndroidBridge.copyText(text);
    return Promise.resolve();
  }
  return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('Presse-papiers indisponible'));
}

/* ---------- Boîte de dialogue ----------
   Remplace alert(), confirm() et prompt(), qui dans l'appli Android afficheraient l'adresse
   interne de la page en guise de titre. Renvoie une promesse.
   options.onConfirm : appelée dès le toucher sur OK (et non plus tard, quand la promesse est
   résolue), pour les actions permises seulement en réponse directe à un toucher, comme le partage
   sur iPhone ; la promesse prend alors son résultat. */
var dialogEl = byId('dialog');
var dialogResolve = null;
var dialogIsPrompt = false;
var dialogIcon = null;
var dialogOnConfirm = null;

function showDialog(message, options) {
  options = options || {};
  closeDialog(false);
  dialogOnConfirm = options.onConfirm || null;
  byId('dialogTitle').textContent = options.title || '';
  byId('dialogTitle').hidden = !options.title;
  byId('dialogMessage').textContent = message || '';
  byId('dialogMessage').hidden = !message;
  dialogIsPrompt = !!options.input;
  byId('dialogField').hidden = !dialogIsPrompt;
  dialogIcon = options.icon || null;
  byId('dialogIconBtn').hidden = !dialogIcon;
  byId('dialogIconBtn').textContent = dialogIcon || '';
  if (dialogIsPrompt) {
    byId('dialogInput').value = options.input.value || '';
    byId('dialogInput').placeholder = options.input.placeholder || '';
  }
  var okBtn = byId('dialogOkBtn');
  okBtn.textContent = options.okLabel || 'OK';
  okBtn.classList.toggle('is-danger', !!options.danger);
  byId('dialogCancelBtn').hidden = !options.cancelable;
  dialogEl.hidden = false;
  if (dialogIsPrompt) byId('dialogInput').focus();
  else okBtn.focus();
  return new Promise(function (resolve) { dialogResolve = resolve; });
}

function closeDialog(ok) {
  if (!dialogResolve) return;
  var resolve = dialogResolve;
  var onConfirm = dialogOnConfirm;
  var result = dialogIsPrompt ? (ok ? { value: byId('dialogInput').value.trim(), icon: dialogIcon } : null) : ok;
  dialogResolve = null;
  dialogOnConfirm = null;
  dialogEl.hidden = true;
  byId('dialogInput').blur();
  if (ok && onConfirm) {
    try {
      result = onConfirm();
    } catch (err) {
      result = Promise.reject(err);
    }
  }
  resolve(result);
}

function uiAlert(message) {
  return showDialog(message);
}

function uiConfirm(message, okLabel, danger) {
  return showDialog(message, { cancelable: true, okLabel: okLabel, danger: danger });
}

/* Demande un nom (et une icône emoji si options.icon est fourni) : { value, icon }, ou null. */
function uiPrompt(title, options) {
  options = options || {};
  return showDialog(options.message, {
    title: title,
    cancelable: true,
    okLabel: options.okLabel,
    icon: options.icon,
    input: { value: options.value, placeholder: options.placeholder }
  });
}

/* Avant de quitter un formulaire : confirmation seulement s'il y a des modifications à perdre. */
function confirmDiscard(dirty, message) {
  return dirty ? uiConfirm(message, 'Abandonner', true) : Promise.resolve(true);
}

byId('dialogOkBtn').addEventListener('click', function () { closeDialog(true); });
byId('dialogCancelBtn').addEventListener('click', function () { closeDialog(false); });
byId('dialogBackdrop').addEventListener('click', function () { closeDialog(false); });
byId('dialogInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') closeDialog(true); });
byId('dialogIconBtn').addEventListener('click', function () {
  openEmojiPicker(function (emoji) {
    dialogIcon = emoji;
    byId('dialogIconBtn').textContent = emoji;
  });
});

/* ---------- Menu du bas (feuille) ---------- */
var sheetEl = byId('sheet');
var sheetOnClose = null;

function openSheet(content, onClose) {
  closeSheet();
  byId('sheetPanel').appendChild(content);
  sheetOnClose = onClose || null;
  sheetEl.hidden = false;
}

function closeSheet() {
  if (sheetEl.hidden) return;
  sheetEl.hidden = true;
  byId('sheetPanel').innerHTML = '';
  var onClose = sheetOnClose;
  sheetOnClose = null;
  if (onClose) onClose();
}

byId('sheetBackdrop').addEventListener('click', closeSheet);

/* Menu d'actions (bouton ⋮) : actions = [{ icon, label, danger, onClick }]. */
function showActions(actions, title) {
  openSheet(h('div', null, [
    title ? h('p', { className: 'sheet-title', text: title }) : null,
    h('div', { className: 'sheet-list' }, actions.map(function (action) {
      return h('button', {
        type: 'button',
        className: 'sheet-item' + (action.danger ? ' is-danger' : ''),
        onclick: function () { closeSheet(); action.onClick(); }
      }, [h('span', { className: 'sheet-icon', text: action.icon || '' }), action.label]);
    }))
  ]));
}

/* Choix dans une liste : items = [{ icon, label, sub, value, selected }].
   Promesse : { value } pour un élément, { create: true } pour « options.createLabel », null si fermé. */
function pickFromList(title, items, options) {
  options = options || {};
  return new Promise(function (resolve) {
    var choice = null;
    var list = h('div', { className: 'sheet-list' });
    var search = options.search ? h('input', {
      type: 'search', className: 'search-input', placeholder: 'Rechercher', autocomplete: 'off',
      oninput: function () { renderItems(); }
    }) : null;

    function choose(result) {
      choice = result;
      closeSheet();
    }
    function renderItems() {
      var query = search ? normalizeText(search.value.trim()) : '';
      list.innerHTML = '';
      items.filter(function (item) {
        return !query || normalizeText(item.label + ' ' + (item.sub || '')).indexOf(query) >= 0;
      }).forEach(function (item) {
        list.appendChild(h('button', {
          type: 'button',
          className: 'sheet-item' + (item.selected ? ' is-selected' : ''),
          onclick: function () { choose({ value: item.value }); }
        }, [
          h('span', { className: 'sheet-icon', text: item.icon || '' }),
          h('span', { className: 'sheet-item-text' }, [
            h('span', { text: item.label }),
            item.sub ? h('span', { className: 'sheet-item-sub', text: item.sub }) : null
          ])
        ]));
      });
      if (!list.children.length) list.appendChild(h('p', { className: 'sheet-empty', text: 'Aucun résultat' }));
    }

    renderItems();
    openSheet(h('div', null, [
      h('p', { className: 'sheet-title', text: title }),
      search,
      list,
      options.createLabel ? h('button', {
        type: 'button', className: 'sheet-item sheet-create',
        onclick: function () { choose({ create: true }); }
      }, [h('span', { className: 'sheet-icon', text: '＋' }), options.createLabel]) : null
    ]), function () { resolve(choice); });
  });
}

/* ---------- Message temporaire ---------- */
var toastTimer = null;

function showToast(message) {
  var toast = byId('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.hidden = true; }, 2600);
}

/* ---------- Bandeau en bas de l'écran (mise à jour, installation) ----------
   Reste affiché jusqu'au toucher de son bouton ou de × (onClose n'est appelée que pour ×). */
var bannerAction = null;
var bannerOnClose = null;

function showBanner(text, actionLabel, onAction, onClose) {
  byId('bannerText').textContent = text;
  byId('bannerActionBtn').textContent = actionLabel || '';
  byId('bannerActionBtn').hidden = !actionLabel;
  bannerAction = onAction || null;
  bannerOnClose = onClose || null;
  byId('banner').hidden = false;
}

function closeBanner() {
  byId('banner').hidden = true;
  bannerAction = null;
  bannerOnClose = null;
}

byId('bannerActionBtn').addEventListener('click', function () {
  var action = bannerAction;
  closeBanner();
  if (action) action();
});
byId('bannerCloseBtn').addEventListener('click', function () {
  var onClose = bannerOnClose;
  closeBanner();
  if (onClose) onClose();
});

/* ---------- Progression d'une opération longue ---------- */
function showProgress(text) {
  byId('progressText').textContent = text;
  byId('progressBar').style.width = '0%';
  byId('progress').hidden = false;
  return {
    update: function (newText, fraction) {
      if (newText) byId('progressText').textContent = newText;
      if (fraction !== undefined) byId('progressBar').style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    },
    close: function () { byId('progress').hidden = true; }
  };
}

/* ---------- Visionneuse de photos ----------
   Plein écran, balayage vers la gauche ou la droite pour passer d'une photo à l'autre,
   toucher la photo pour l'agrandir (puis la faire défiler), la retoucher pour la réduire. */
var VIEWER_ZOOM = 2.5;
var viewerEl = byId('viewer');
var viewerImg = byId('viewerImg');
var viewerScroll = byId('viewerScroll');
var viewerItems = [];
var viewerIndex = 0;
var viewerSwipe = null;

/* items : liste de Blob (ou d'URL) ; actions : boutons { icon, label, onClick(index) } en haut à droite. */
function openViewer(items, index, actions) {
  viewerItems = items.slice();
  var actionsEl = byId('viewerActions');
  actionsEl.innerHTML = '';
  (actions || []).forEach(function (action) {
    actionsEl.appendChild(h('button', {
      type: 'button', className: 'viewer-btn', 'aria-label': action.label, title: action.label, text: action.icon,
      onclick: function (e) { e.stopPropagation(); action.onClick(viewerIndex); }
    }));
  });
  viewerEl.hidden = false;
  viewerShow(index || 0);
}

function viewerShow(index, direction) {
  releaseBlobUrls('viewer');
  viewerIndex = Math.max(0, Math.min(index, viewerItems.length - 1));
  viewerEl.classList.remove('zoomed');
  viewerImg.style.width = '';
  viewerImg.src = blobUrl('viewer', viewerItems[viewerIndex]);
  byId('viewerCounter').textContent = viewerItems.length > 1 ? (viewerIndex + 1) + ' / ' + viewerItems.length : '';
  viewerImg.classList.remove('slide-next', 'slide-prev');
  if (direction) {
    void viewerImg.offsetWidth; // relance l'animation
    viewerImg.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
  }
}

/* Retire la photo affichée (après suppression) : passe à la suivante, ou ferme s'il n'y en a plus. */
function viewerRemoveCurrent() {
  viewerItems.splice(viewerIndex, 1);
  if (viewerItems.length) viewerShow(Math.min(viewerIndex, viewerItems.length - 1));
  else closeViewer();
}

function closeViewer() {
  viewerEl.hidden = true;
  viewerImg.removeAttribute('src');
  viewerItems = [];
  releaseBlobUrls('viewer');
}

viewerImg.addEventListener('click', function (e) {
  e.stopPropagation();
  if (viewerEl.classList.contains('zoomed')) {
    viewerEl.classList.remove('zoomed');
    viewerImg.style.width = '';
    return;
  }
  var rect = viewerImg.getBoundingClientRect();
  var x = (e.clientX - rect.left) / rect.width;
  var y = (e.clientY - rect.top) / rect.height;
  viewerEl.classList.add('zoomed');
  viewerImg.style.width = (rect.width * VIEWER_ZOOM) + 'px';
  viewerScroll.scrollLeft = x * viewerImg.offsetWidth - viewerScroll.clientWidth / 2;
  viewerScroll.scrollTop = y * viewerImg.offsetHeight - viewerScroll.clientHeight / 2;
});
viewerScroll.addEventListener('click', closeViewer);
byId('viewerCloseBtn').addEventListener('click', closeViewer);

viewerScroll.addEventListener('touchstart', function (e) {
  viewerSwipe = null;
  if (viewerEl.classList.contains('zoomed') || e.touches.length !== 1 || viewerItems.length < 2) return;
  viewerSwipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, horizontal: null };
}, { passive: true });
viewerScroll.addEventListener('touchmove', function (e) {
  if (!viewerSwipe) return;
  var dx = e.touches[0].clientX - viewerSwipe.x;
  var dy = e.touches[0].clientY - viewerSwipe.y;
  if (viewerSwipe.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) viewerSwipe.horizontal = Math.abs(dx) > Math.abs(dy);
  if (!viewerSwipe.horizontal) return;
  viewerSwipe.dx = dx;
  viewerImg.style.transition = 'none';
  viewerImg.style.transform = 'translateX(' + dx + 'px)';
}, { passive: true });
viewerScroll.addEventListener('touchend', function () {
  if (!viewerSwipe) return;
  var dx = viewerSwipe.dx;
  viewerSwipe = null;
  viewerImg.style.transition = '';
  viewerImg.style.transform = '';
  if (dx < -60 && viewerIndex < viewerItems.length - 1) viewerShow(viewerIndex + 1, 1);
  else if (dx > 60 && viewerIndex > 0) viewerShow(viewerIndex - 1, -1);
});

/* ---------- Adresse à montrer à un chauffeur de taxi ---------- */
function showTaxiCard(name, address) {
  byId('taxiName').textContent = name || '';
  byId('taxiAddress').textContent = address || '';
  byId('taxi').hidden = false;
}

function closeTaxiCard() {
  byId('taxi').hidden = true;
}

byId('taxiCloseBtn').addEventListener('click', closeTaxiCard);
