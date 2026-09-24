/* ---------- Carnet d'adresses ---------- */
var ADDRESS_CATEGORIES = [
  { id: 'hebergement', icon: '🏨', label: 'Hébergement' },
  { id: 'restaurant', icon: '🍜', label: 'Restaurant' },
  { id: 'visite', icon: '⛩️', label: 'À visiter' },
  { id: 'shopping', icon: '🛍️', label: 'Shopping' },
  { id: 'transport', icon: '🚉', label: 'Transport' },
  { id: 'autre', icon: '📍', label: 'Autre' }
];
var DEFAULT_CATEGORY = 'autre';
var ADDRESS_FIELDS = {
  title: 'addrTitle', address: 'addrAddress', addressJa: 'addrAddressJa',
  phone: 'addrPhone', website: 'addrWebsite', description: 'addrDesc'
};

var addressFilter = 'all';          // catégorie affichée dans la liste
var editingAddress = null;          // adresse ouverte dans l'éditeur (null : nouvelle adresse)
var addressDraftCategory = DEFAULT_CATEGORY;
var currentAddressFiles = [];       // pièces jointes de l'adresse ouverte
var addressFormSnapshot = '';
var addressEditorSession = 0;
var savingAddress = false;
var viewedAddress = null;           // adresse affichée en fiche
var addressesRenderId = 0;
var addressSearchTimer = null;

function categoryOf(address) {
  for (var i = 0; i < ADDRESS_CATEGORIES.length; i++) {
    if (ADDRESS_CATEGORIES[i].id === address.category) return ADDRESS_CATEGORIES[i];
  }
  return ADDRESS_CATEGORIES[ADDRESS_CATEGORIES.length - 1];
}

function openMaps(address) {
  if (!address) return;
  openExternal('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address));
}

function websiteUrl(site) {
  return /^https?:\/\//i.test(site) ? site : 'https://' + site;
}

function phoneUrl(phone) {
  return 'tel:' + phone.replace(/[^\d+]/g, '');
}

function copyAndNotify(text, message) {
  copyText(text).then(function () { showToast(message); }, function () { uiAlert('La copie a échoué.'); });
}

/* Carte d'une adresse (dans une note) : toucher pour voir la fiche, 🧭 pour l'itinéraire. */
function addressCard(address) {
  return h('div', { className: 'card link-card', onclick: function () { openView('address', { id: address.id }); } }, [
    h('span', { className: 'row-icon', text: categoryOf(address).icon }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: address.title }),
      address.address ? h('p', { className: 'list-row-address', text: address.address }) : null
    ]),
    address.address ? h('button', {
      type: 'button', className: 'icon-btn', 'aria-label': 'Itinéraire', title: 'Itinéraire', text: '🧭',
      onclick: function (e) {
        e.stopPropagation();
        openMaps(address.address);
      }
    }) : null
  ]);
}

/* ---------- Liste ---------- */
defineView('addresses', {
  el: 'view-addresses',
  section: 'addresses',
  title: "Carnet d'adresses",
  enter: renderAddressList,
  actions: function () {
    return [{ icon: '+', label: 'Nouvelle adresse', onClick: function () { openView('address-edit', {}); } }];
  }
});

function addressRow(address) {
  return h('div', { className: 'list-row', onclick: function () { openView('address', { id: address.id }); } }, [
    h('span', { className: 'row-icon', text: categoryOf(address).icon }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: address.title || 'Sans titre' }),
      address.description ? h('p', { className: 'list-row-sub clamp-2', text: markdownExcerpt(address.description, 120) }) : null,
      h('p', { className: 'list-row-address', text: address.address || '' })
    ]),
    address.address ? h('button', {
      type: 'button', className: 'icon-btn route-btn', 'aria-label': 'Itinéraire', title: 'Itinéraire', text: '🧭',
      onclick: function (e) {
        e.stopPropagation();
        openMaps(address.address);
      }
    }) : null
  ]);
}

function renderCategoryFilters(addresses) {
  var counts = {};
  addresses.forEach(function (a) { counts[categoryOf(a).id] = (counts[categoryOf(a).id] || 0) + 1; });
  if (addressFilter !== 'all' && !counts[addressFilter]) addressFilter = 'all';
  var row = byId('addressFilters');
  row.innerHTML = '';
  row.hidden = addresses.length === 0;
  [{ id: 'all', label: 'Tous' }].concat(ADDRESS_CATEGORIES.filter(function (c) { return counts[c.id]; })).forEach(function (filter) {
    row.appendChild(h('button', {
      type: 'button', className: 'filter-chip', 'aria-pressed': filter.id === addressFilter,
      onclick: function () {
        addressFilter = filter.id;
        renderAddressList();
      }
    }, filter.id === 'all' ? 'Tous ' + addresses.length : filter.icon + ' ' + filter.label + ' ' + counts[filter.id]));
  });
}

function renderAddressList() {
  var renderId = ++addressesRenderId;
  var query = normalizeText(byId('addressSearch').value.trim());
  return dbGetAll('addresses').then(function (addresses) {
    if (renderId !== addressesRenderId) return;
    renderCategoryFilters(addresses);
    var shown = addresses.filter(function (a) {
      if (addressFilter !== 'all' && categoryOf(a).id !== addressFilter) return false;
      return !query || normalizeText([a.title, a.address, a.addressJa, a.description].join(' ')).indexOf(query) >= 0;
    }).sort(byTitle);
    var listEl = byId('addressList');
    listEl.innerHTML = '';
    shown.forEach(function (a) { listEl.appendChild(addressRow(a)); });
    showEmpty(byId('addressesEmpty'), !shown.length, addresses.length
      ? 'Aucune adresse ne correspond à ta recherche.'
      : 'Aucune adresse enregistrée. Appuie sur + pour en ajouter une.');
  });
}

byId('addressSearch').addEventListener('input', function () {
  clearTimeout(addressSearchTimer);
  addressSearchTimer = setTimeout(function () {
    if (currentViewName() === 'addresses') renderAddressList();
  }, 150);
});

/* ---------- Fiche d'une adresse ---------- */
defineView('address', {
  el: 'view-address',
  section: 'addresses',
  title: "Carnet d'adresses",
  enter: renderAddressView,
  exit: function () { viewedAddress = null; },
  actions: function (params) {
    return [
      { icon: '✎', label: 'Modifier', onClick: function () { openView('address-edit', { id: params.id }); } },
      { icon: '⋮', label: "Plus d'options", onClick: showAddressMenu }
    ];
  }
});

function actionButton(icon, label, onClick) {
  return h('button', { type: 'button', className: 'action-btn', onclick: onClick }, [
    h('span', { className: 'action-icon', text: icon }), label
  ]);
}

function renderAddressView(params) {
  return Promise.all([dbGet('addresses', params.id), dbGetAll('notes'), dbGetAll('folders')]).then(function (results) {
    var address = results[0];
    var detail = byId('addressDetail');
    detail.innerHTML = '';
    viewedAddress = address;
    if (!address) {
      detail.appendChild(h('p', { className: 'empty', text: "Cette adresse n'existe plus." }));
      return;
    }
    var category = categoryOf(address);
    setViewTitle(category.icon + ' ' + category.label);
    detail.appendChild(h('div', { className: 'detail-head' }, [
      h('span', { className: 'detail-icon', text: category.icon }),
      h('div', { className: 'detail-heading' }, [
        h('h2', { className: 'detail-title', text: address.title }),
        h('p', { className: 'detail-meta', text: category.label })
      ])
    ]));

    if (address.address) {
      detail.appendChild(h('div', { className: 'card' }, [
        h('p', { className: 'card-label', text: 'Adresse' }),
        h('p', { className: 'card-text', text: address.address }),
        h('div', { className: 'card-actions' }, [
          actionButton('🧭', 'Itinéraire', function () { openMaps(address.address); }),
          actionButton('📋', 'Copier', function () { copyAndNotify(address.address, 'Adresse copiée'); }),
          actionButton('🚕', 'Pour le taxi', function () { showTaxiCard(address.title, address.addressJa || address.address); })
        ])
      ]));
    }
    if (address.addressJa) {
      detail.appendChild(h('div', { className: 'card' }, [
        h('p', { className: 'card-label', text: 'Adresse en japonais' }),
        h('p', { className: 'card-text', lang: 'ja', text: address.addressJa }),
        h('div', { className: 'card-actions' }, [
          actionButton('📋', 'Copier', function () { copyAndNotify(address.addressJa, 'Adresse copiée'); })
        ])
      ]));
    }
    if (address.phone || address.website) {
      detail.appendChild(h('div', { className: 'card card-actions' }, [
        address.phone ? actionButton('📞', address.phone, function () { openExternal(phoneUrl(address.phone)); }) : null,
        address.website ? actionButton('🌐', 'Site web', function () { openExternal(websiteUrl(address.website)); }) : null
      ]));
    }
    if (address.description) {
      var description = h('div', { className: 'markdown' });
      showMarkdown(description, address.description, function (index, checked) {
        address.description = setTaskInMarkdown(address.description, index, checked);
        address.updatedAt = Date.now();
        dbPut('addresses', address).catch(function (err) {
          console.error(err);
          uiAlert("La modification n'a pas pu être enregistrée.");
        });
      });
      detail.appendChild(description);
    }
    if ((address.attachments || []).length) {
      detail.appendChild(h('p', { className: 'section-title', text: 'Pièces jointes' }));
      detail.appendChild(renderAttachmentList(address.attachments));
    }
    var linked = sortNotes(results[1].filter(function (n) { return String(n.addressId) === String(address.id); }));
    if (linked.length) {
      var folderMap = mapById(results[2].filter(isNoteFolder));
      detail.appendChild(h('p', { className: 'section-title', text: 'Notes liées' }));
      linked.forEach(function (n) { detail.appendChild(noteRow(n, folderMap, {}, true)); });
    }
  });
}

function showAddressMenu() {
  var address = viewedAddress;
  if (!address) return;
  showActions([
    { icon: '📝', label: 'Nouvelle note sur ce lieu', onClick: function () { openView('note-edit', { addressId: address.id }); } },
    { icon: '🗑️', label: "Supprimer l'adresse", danger: true, onClick: function () { deleteAddress(address); } }
  ], address.title);
}

/* Supprime l'adresse et la retire des notes qui y étaient liées. */
function deleteAddress(address) {
  uiConfirm('Supprimer « ' + address.title + ' » du carnet ?', 'Supprimer', true).then(function (ok) {
    if (!ok) return;
    return dbWrite(['addresses', 'notes'], function (tx) {
      tx.objectStore('addresses')['delete'](address.id);
      dbUpdateEach(tx, 'notes', function (note) {
        if (String(note.addressId) !== String(address.id)) return false;
        note.addressId = null;
        return true;
      });
    }).then(function () {
      leaveAfterDelete('addresses');
      showToast('Adresse supprimée');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("L'adresse n'a pas pu être supprimée.");
  });
}

/* ---------- Éditeur d'adresse ---------- */
defineView('address-edit', {
  el: 'view-address-edit',
  section: 'addresses',
  title: function (params) { return params.id ? "Modifier l'adresse" : 'Nouvelle adresse'; },
  enter: openAddressEditor,
  exit: resetAddressEditor,
  canLeave: function () { return confirmDiscard(isAddressDirty(), 'Abandonner les modifications de cette adresse ?'); },
  actions: function () { return [{ text: 'Enregistrer', label: "Enregistrer l'adresse", onClick: saveAddress }]; },
  toolbar: true
});

['addrTitle', 'addrAddress', 'addrAddressJa', 'addrPhone', 'addrWebsite'].forEach(function (id) { registerTextField(byId(id)); });
registerMarkdownField(byId('addrDesc'));

function addressFormState() {
  var state = [addressDraftCategory];
  Object.keys(ADDRESS_FIELDS).forEach(function (key) { state.push(byId(ADDRESS_FIELDS[key]).value); });
  return JSON.stringify(state);
}

function isAddressDirty() {
  return addressFormState() !== addressFormSnapshot ||
    !sameItems((editingAddress && editingAddress.attachments) || [], currentAddressFiles);
}

function renderCategoryPicker() {
  var row = byId('addrCategories');
  row.innerHTML = '';
  ADDRESS_CATEGORIES.forEach(function (category) {
    row.appendChild(h('button', {
      type: 'button', className: 'filter-chip', 'aria-pressed': category.id === addressDraftCategory,
      onclick: function () {
        addressDraftCategory = category.id;
        renderCategoryPicker();
      }
    }, category.icon + ' ' + category.label));
  });
}

function resetAddressEditor() {
  addressEditorSession++;
  editingAddress = null;
  currentAddressFiles = [];
  byId('addrAttachments').innerHTML = '';
}

function openAddressEditor(params) {
  resetAddressEditor();
  var session = addressEditorSession;
  Object.keys(ADDRESS_FIELDS).forEach(function (key) { byId(ADDRESS_FIELDS[key]).value = ''; });
  return (params.id ? dbGet('addresses', params.id) : Promise.resolve(null)).then(function (address) {
    if (session !== addressEditorSession) return;
    if (params.id && !address) {
      uiAlert("Cette adresse n'existe plus.");
      goBack(true);
      return;
    }
    editingAddress = address;
    // Nouvelle adresse : catégorie du filtre en cours dans la liste.
    addressDraftCategory = address ? categoryOf(address).id : (addressFilter !== 'all' ? addressFilter : DEFAULT_CATEGORY);
    Object.keys(ADDRESS_FIELDS).forEach(function (key) { byId(ADDRESS_FIELDS[key]).value = address ? address[key] || '' : ''; });
    currentAddressFiles = address && address.attachments ? address.attachments.slice() : [];
    renderAttachmentEditor(byId('addrAttachments'), currentAddressFiles);
    renderCategoryPicker();
    activeMarkdownField = byId('addrDesc');
    autoGrow(byId('addrDesc'));
    addressFormSnapshot = addressFormState();
  });
}

byId('addAddrFilesBtn').addEventListener('click', function () {
  byId('addrFiles').click();
});

byId('addrFiles').addEventListener('change', function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  var session = addressEditorSession;
  var list = currentAddressFiles;
  addAttachments(files, list, function () {
    if (session === addressEditorSession) renderAttachmentEditor(byId('addrAttachments'), list);
  });
});

function saveAddress() {
  if (savingAddress) return;
  var entry = { category: addressDraftCategory };
  Object.keys(ADDRESS_FIELDS).forEach(function (key) { entry[key] = byId(ADDRESS_FIELDS[key]).value.trim(); });
  if (!entry.title || !entry.address) {
    uiAlert("Le nom du lieu et l'adresse sont obligatoires.");
    return;
  }
  var now = Date.now();
  var isNew = !editingAddress;
  entry.attachments = currentAddressFiles.slice();
  entry.createdAt = (editingAddress && editingAddress.createdAt) || now;
  entry.updatedAt = now;
  if (editingAddress) entry.id = editingAddress.id;
  savingAddress = true;
  dbPut('addresses', entry).then(function (id) {
    if (isNew) replaceView('address', { id: id });
    else goBack(true);
  }, function (err) {
    console.error(err);
    uiAlert("L'adresse n'a pas pu être enregistrée.");
  }).then(function () { savingAddress = false; });
}
