/* ---------- Notes ---------- */
var DEFAULT_NOTE_ICON = '📝';
var NOTE_FOLDER_DELETE_INFO = 'Ses notes ne sont pas supprimées : elles reviennent dans Notes.';

var editingNote = null;       // note ouverte dans l'éditeur (null : nouvelle note)
var noteDraft = {};           // choix en cours dans l'éditeur : icône, dossier, adresse
var currentImages = [];       // photos de la note ouverte (Blob, ou data URL pour d'anciennes notes)
var currentAttachments = [];  // pièces jointes de la note ouverte
var noteFormSnapshot = '';    // état du formulaire à l'ouverture, pour repérer les modifications
var noteEditorSession = 0;    // change à chaque ouverture/fermeture de l'éditeur
var imagesBusy = false;
var savingNote = false;
var viewedNote = null;        // note affichée en lecture
var notesRenderId = 0;
var notesSearchTimer = null;

function isNoteFolder(folder) {
  return folder.kind === 'notes';
}

/* Épinglées d'abord, puis les dernières modifiées. */
function sortNotes(notes) {
  return notes.sort(function (a, b) {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
}

function chip(text, muted) {
  return h('span', { className: 'chip' + (muted ? ' chip-muted' : ''), text: text });
}

function showEmpty(el, show, text) {
  el.textContent = text;
  el.hidden = !show;
}

/* ---------- Liste des notes et dossiers ---------- */
defineView('notes', {
  el: 'view-notes',
  section: 'notes',
  title: 'Notes',
  enter: renderNotes,
  actions: function (params) {
    var actions = [{ icon: '+', label: 'Nouvelle note', onClick: function () { openView('note-edit', { folderId: params.folderId || null }); } }];
    if (params.folderId) {
      actions.push({ icon: '⋮', label: 'Options du dossier', onClick: function () {
        showFolderMenu(params.folderId, 'notes', NOTE_FOLDER_DELETE_INFO, 'notes');
      } });
    }
    return actions;
  }
});

function noteRow(note, folderMap, addrMap, showFolder) {
  var chips = [];
  var folder = showFolder && note.folderId ? folderMap[note.folderId] : null;
  var address = note.addressId ? addrMap[note.addressId] : null;
  var photos = (note.images || []).length;
  var files = (note.attachments || []).length;
  if (folder) chips.push(chip(folderLabel(folder), true));
  if (address) chips.push(chip('📍 ' + address.title));
  if (photos) chips.push(chip('📷 ' + photos, true));
  if (files) chips.push(chip('📎 ' + files, true));
  var excerpt = markdownExcerpt(note.body, 140);
  return h('div', { className: 'list-row', onclick: function () { openView('note', { id: note.id }); } }, [
    h('span', { className: 'row-icon', text: note.icon || DEFAULT_NOTE_ICON }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: (note.pinned ? '📌 ' : '') + (note.title || 'Sans titre') }),
      excerpt ? h('p', { className: 'list-row-sub clamp-2', text: excerpt }) : null,
      chips.length ? h('div', { className: 'chips' }, chips) : null
    ]),
    h('span', { className: 'row-date', text: formatShortDate(note.updatedAt || note.createdAt) })
  ]);
}

function renderNotes(params) {
  var renderId = ++notesRenderId;
  var folderId = params.folderId || null;
  var query = normalizeText(byId('notesSearch').value.trim());
  byId('notesSearch').placeholder = folderId ? 'Rechercher dans ce dossier' : 'Rechercher dans les notes';
  return Promise.all([dbGetAll('notes'), dbGetAll('folders'), dbGetAll('addresses')]).then(function (results) {
    if (renderId !== notesRenderId) return;
    var notes = results[0];
    var folders = results[1].filter(isNoteFolder).sort(byName);
    var folderMap = mapById(folders);
    var addrMap = mapById(results[2]);
    var container = byId('notesContent');
    var empty = byId('notesEmpty');
    container.innerHTML = '';
    empty.hidden = true;

    if (folderId && !folderMap[folderId]) {
      showEmpty(empty, true, "Ce dossier n'existe plus.");
      return;
    }
    if (folderId) setViewTitle(folderLabel(folderMap[folderId]));

    if (query) {
      var found = sortNotes(notes.filter(function (n) {
        return (!folderId || n.folderId === folderId) && normalizeText((n.title || '') + ' ' + (n.body || '')).indexOf(query) >= 0;
      }));
      found.forEach(function (n) { container.appendChild(noteRow(n, folderMap, addrMap, !folderId)); });
      showEmpty(empty, !found.length, 'Aucune note ne correspond à ta recherche.');
      return;
    }

    if (folderId) {
      var inFolder = sortNotes(notes.filter(function (n) { return n.folderId === folderId; }));
      inFolder.forEach(function (n) { container.appendChild(noteRow(n, folderMap, addrMap, false)); });
      showEmpty(empty, !inFolder.length, 'Ce dossier est vide. Appuie sur + pour y créer une note.');
      return;
    }

    var counts = {};
    notes.forEach(function (n) { if (folderMap[n.folderId]) counts[n.folderId] = (counts[n.folderId] || 0) + 1; });
    if (folders.length) container.appendChild(h('p', { className: 'section-title', text: 'Dossiers' }));
    folders.forEach(function (f) { container.appendChild(folderRow(f, counts[f.id] || 0, 'notes')); });
    container.appendChild(newFolderRow('notes'));
    var loose = sortNotes(notes.filter(function (n) { return !folderMap[n.folderId]; }));
    if (loose.length && folders.length) container.appendChild(h('p', { className: 'section-title', text: 'Notes' }));
    loose.forEach(function (n) { container.appendChild(noteRow(n, folderMap, addrMap, false)); });
    showEmpty(empty, !notes.length, "Aucune note pour l'instant. Appuie sur + pour en créer une.");
  });
}

byId('notesSearch').addEventListener('input', function () {
  clearTimeout(notesSearchTimer);
  notesSearchTimer = setTimeout(function () {
    if (currentViewName() === 'notes') renderNotes(currentEntry().params);
  }, 150);
});

/* Choix du dossier d'une note (voir folders.js) : id, null pour « Aucun dossier », undefined si annulé. */
function chooseNoteFolder(currentId) {
  return chooseFolder('notes', currentId, 'Dossier', { noneLabel: 'Aucun dossier' });
}

/* ---------- Note en lecture ---------- */
defineView('note', {
  el: 'view-note',
  section: 'notes',
  title: 'Notes',
  enter: renderNoteView,
  exit: function () {
    releaseBlobUrls('note-view');
    viewedNote = null;
  },
  actions: function (params) {
    return [
      { icon: '✎', label: 'Modifier', onClick: function () { openView('note-edit', { id: params.id }); } },
      { icon: '⋮', label: "Plus d'options", onClick: showNoteMenu }
    ];
  }
});

function renderNoteView(params) {
  return Promise.all([dbGet('notes', params.id), dbGetAll('addresses'), dbGetAll('folders')]).then(function (results) {
    var note = results[0];
    var detail = byId('noteDetail');
    detail.innerHTML = '';
    releaseBlobUrls('note-view');
    viewedNote = note;
    if (!note) {
      detail.appendChild(h('p', { className: 'empty', text: "Cette note n'existe plus." }));
      return;
    }
    var folder = note.folderId ? mapById(results[2])[note.folderId] : null;
    var address = note.addressId ? mapById(results[1])[note.addressId] : null;
    setViewTitle(folder ? folderLabel(folder) : 'Notes');

    detail.appendChild(h('div', { className: 'detail-head' }, [
      h('span', { className: 'detail-icon', text: note.icon || DEFAULT_NOTE_ICON }),
      h('div', { className: 'detail-heading' }, [
        h('h2', { className: 'detail-title', text: note.title || 'Sans titre' }),
        h('p', { className: 'detail-meta', text: (note.pinned ? '📌 Épinglée · ' : '') + 'Modifiée le ' + formatDateTime(note.updatedAt || note.createdAt) })
      ])
    ]));
    if (address) detail.appendChild(addressCard(address));
    if (note.body) {
      var body = h('div', { className: 'markdown' });
      showMarkdown(body, note.body, function (index, checked) { toggleNoteTask(note, index, checked); });
      detail.appendChild(body);
    }
    var images = note.images || [];
    if (images.length) {
      detail.appendChild(h('p', { className: 'section-title', text: 'Photos' }));
      detail.appendChild(h('div', { className: 'image-grid' }, images.map(function (image, index) {
        return h('button', { type: 'button', className: 'image-cell', onclick: function () { openViewer(images, index); } }, [
          h('img', { src: blobUrl('note-view', image), alt: 'Photo ' + (index + 1) })
        ]);
      })));
    }
    if ((note.attachments || []).length) {
      detail.appendChild(h('p', { className: 'section-title', text: 'Pièces jointes' }));
      detail.appendChild(renderAttachmentList(note.attachments));
    }
  });
}

/* Case cochée dans une note affichée : enregistrée aussitôt dans le texte markdown. */
function toggleNoteTask(note, index, checked) {
  note.body = setTaskInMarkdown(note.body, index, checked);
  note.updatedAt = Date.now();
  dbPut('notes', note).catch(function (err) {
    console.error(err);
    uiAlert("La modification n'a pas pu être enregistrée.");
  });
}

function saveViewedNote(note, message) {
  dbPut('notes', note).then(function () {
    refreshView();
    showToast(message);
  }, function (err) {
    console.error(err);
    uiAlert("La modification n'a pas pu être enregistrée.");
  });
}

function showNoteMenu() {
  var note = viewedNote;
  if (!note) return;
  showActions([
    {
      icon: '📌', label: note.pinned ? 'Désépingler' : 'Épingler en haut de la liste',
      onClick: function () {
        note.pinned = !note.pinned;
        saveViewedNote(note, note.pinned ? 'Note épinglée' : 'Note désépinglée');
      }
    },
    {
      icon: '📁', label: 'Déplacer vers un dossier',
      onClick: function () {
        chooseNoteFolder(note.folderId).then(function (folderId) {
          if (folderId === undefined) return;
          note.folderId = folderId;
          saveViewedNote(note, 'Note déplacée');
        });
      }
    },
    { icon: '↗️', label: 'Partager (fichier .md)', onClick: function () { exportNote(note, 'share'); } },
    { icon: '💾', label: 'Enregistrer (fichier .md)', onClick: function () { exportNote(note, 'save'); } },
    { icon: '🗑️', label: 'Supprimer la note', danger: true, onClick: function () { deleteNote(note); } }
  ]);
}

/* Export en fichier markdown (.md), lisible par la plupart des applis de notes. */
function exportNote(note, action) {
  (note.addressId ? dbGet('addresses', note.addressId) : Promise.resolve(null)).then(function (address) {
    var lines = ['# ' + (note.icon ? note.icon + ' ' : '') + (note.title || 'Sans titre'), ''];
    if (note.body) lines.push(note.body, '');
    if (address) lines.push('---', '', '📍 **' + address.title + '** : ' + (address.address || ''), '');
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    var name = safeFileName(note.title, 'note') + '.md';
    return action === 'share' ? shareFile(blob, name) : saveFile(blob, name);
  }).catch(function (err) {
    console.error(err);
    uiAlert("La note n'a pas pu être exportée.");
  });
}

function deleteNote(note) {
  uiConfirm('Supprimer cette note ?', 'Supprimer', true).then(function (ok) {
    if (!ok) return;
    return dbDelete('notes', note.id).then(function () {
      leaveAfterDelete('notes');
      showToast('Note supprimée');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("La note n'a pas pu être supprimée.");
  });
}

/* ---------- Éditeur de note ---------- */
defineView('note-edit', {
  el: 'view-note-edit',
  section: 'notes',
  title: function (params) { return params.id ? 'Modifier la note' : 'Nouvelle note'; },
  enter: openNoteEditor,
  exit: resetNoteEditor,
  canLeave: function () { return confirmDiscard(isNoteDirty(), 'Abandonner les modifications de cette note ?'); },
  actions: function () { return [{ text: 'Enregistrer', label: 'Enregistrer la note', onClick: saveNote }]; },
  toolbar: function () { return byId('notePreview').hidden; }
});

registerTextField(byId('noteTitle'));
registerMarkdownField(byId('noteBody'));

function noteFormState() {
  return JSON.stringify([byId('noteTitle').value, byId('noteBody').value, noteDraft.icon, noteDraft.folderId, noteDraft.addressId]);
}

function sameItems(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isNoteDirty() {
  if (noteFormState() !== noteFormSnapshot) return true;
  return !sameItems((editingNote && editingNote.images) || [], currentImages) ||
    !sameItems((editingNote && editingNote.attachments) || [], currentAttachments);
}

/* Vide l'éditeur (à l'ouverture, et quand on le quitte) : libère les aperçus en mémoire et fait
   ignorer les photos d'un ajout encore en cours. */
function resetNoteEditor() {
  noteEditorSession++;
  editingNote = null;
  currentImages = [];
  currentAttachments = [];
  renderImagePreview();
  byId('noteAttachments').innerHTML = '';
  setImagesBusy(false);
}

function openNoteEditor(params) {
  resetNoteEditor();
  var session = noteEditorSession;
  byId('noteTitle').value = '';
  byId('noteBody').value = '';
  setNoteEditTab(false);
  var load = params.id ? dbGet('notes', params.id) : Promise.resolve(null);
  return Promise.all([load, dbGetAll('folders'), dbGetAll('addresses')]).then(function (results) {
    if (session !== noteEditorSession) return;
    var note = results[0];
    if (params.id && !note) {
      uiAlert("Cette note n'existe plus.");
      goBack(true);
      return;
    }
    var folderMap = mapById(results[1]);
    var addrMap = mapById(results[2]);
    editingNote = note;
    noteDraft = {
      icon: (note && note.icon) || DEFAULT_NOTE_ICON,
      folderId: note ? note.folderId || null : params.folderId || null,
      addressId: note ? note.addressId || null : params.addressId || null
    };
    if (!folderMap[noteDraft.folderId]) noteDraft.folderId = null;
    if (!addrMap[noteDraft.addressId]) noteDraft.addressId = null;
    byId('noteTitle').value = note ? note.title || '' : '';
    byId('noteBody').value = note ? note.body || '' : '';
    currentImages = note && note.images ? note.images.slice() : [];
    currentAttachments = note && note.attachments ? note.attachments.slice() : [];
    renderImagePreview();
    renderAttachmentEditor(byId('noteAttachments'), currentAttachments);
    updateNoteDraftButtons(folderMap, addrMap);
    activeMarkdownField = byId('noteBody');
    autoGrow(byId('noteBody'));
    noteFormSnapshot = noteFormState();
  });
}

function updateNoteDraftButtons(folderMap, addrMap) {
  var folder = folderMap[noteDraft.folderId];
  var address = addrMap[noteDraft.addressId];
  byId('noteIconBtn').textContent = noteDraft.icon;
  byId('noteFolderBtn').textContent = folder ? folderLabel(folder) : '🗂️ Aucun dossier';
  byId('noteAddressBtn').textContent = address ? categoryOf(address).icon + ' ' + address.title : '📍 Aucune adresse';
}

function refreshNoteDraftButtons() {
  Promise.all([dbGetAll('folders'), dbGetAll('addresses')]).then(function (results) {
    updateNoteDraftButtons(mapById(results[0]), mapById(results[1]));
  });
}

function setNoteEditTab(preview) {
  byId('noteWriteTab').setAttribute('aria-selected', String(!preview));
  byId('notePreviewTab').setAttribute('aria-selected', String(preview));
  byId('noteBody').hidden = preview;
  byId('notePreview').hidden = !preview;
  if (preview) showMarkdown(byId('notePreview'), byId('noteBody').value.trim() || "_Rien à afficher pour l'instant._");
  else autoGrow(byId('noteBody'));
  updateBottomBars();
}

byId('noteWriteTab').addEventListener('click', function () { setNoteEditTab(false); });
byId('notePreviewTab').addEventListener('click', function () { setNoteEditTab(true); });

byId('noteIconBtn').addEventListener('click', function () {
  openEmojiPicker(function (emoji) {
    noteDraft.icon = emoji;
    byId('noteIconBtn').textContent = emoji;
  });
});

byId('noteFolderBtn').addEventListener('click', function () {
  chooseNoteFolder(noteDraft.folderId).then(function (folderId) {
    if (folderId === undefined) return;
    noteDraft.folderId = folderId;
    refreshNoteDraftButtons();
  });
});

byId('noteAddressBtn').addEventListener('click', function () {
  dbGetAll('addresses').then(function (addresses) {
    var items = [{ icon: '🚫', label: 'Aucune adresse', value: null, selected: !noteDraft.addressId }];
    addresses.sort(byTitle).forEach(function (a) {
      items.push({ icon: categoryOf(a).icon, label: a.title, sub: a.address, value: a.id, selected: a.id === noteDraft.addressId });
    });
    return pickFromList('Adresse liée', items, { search: addresses.length > 6 });
  }).then(function (choice) {
    if (!choice) return;
    noteDraft.addressId = choice.value;
    refreshNoteDraftButtons();
  });
});

/* Photos de la note */
function renderImagePreview() {
  releaseBlobUrls('note-edit');
  var wrap = byId('imagePreview');
  wrap.innerHTML = '';
  currentImages.forEach(function (image, idx) {
    wrap.appendChild(h('div', { className: 'image-cell' }, [
      h('img', { src: blobUrl('note-edit', image), alt: 'Photo ' + (idx + 1), dataset: { idx: idx } }),
      h('button', { type: 'button', className: 'image-remove', 'aria-label': 'Retirer cette photo', text: '×', dataset: { idx: idx } })
    ]));
  });
}

byId('imagePreview').addEventListener('click', function (e) {
  var idx = parseInt(e.target.dataset.idx, 10);
  if (isNaN(idx)) return;
  if (e.target.classList.contains('image-remove')) {
    currentImages.splice(idx, 1);
    renderImagePreview();
  } else if (e.target.tagName === 'IMG') {
    openViewer(currentImages, idx);
  }
});

function setImagesBusy(busy) {
  imagesBusy = busy;
  byId('addImagesBtn').disabled = busy;
  byId('addImagesBtn').textContent = busy ? 'Ajout en cours…' : '📷 Ajouter des photos';
}

byId('addImagesBtn').addEventListener('click', function () {
  byId('noteImages').click();
});

byId('noteImages').addEventListener('change', function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  var session = noteEditorSession;
  var failed = 0;
  setImagesBusy(true);
  // Une photo à la fois : les décoder toutes ensemble pourrait saturer la mémoire du téléphone.
  files.reduce(function (chain, file) {
    return chain.then(function () {
      return shrinkImage(file).then(function (image) {
        if (session !== noteEditorSession) return;
        currentImages.push(image);
        renderImagePreview();
      }, function (err) {
        console.error(err);
        failed++;
      });
    });
  }, Promise.resolve()).then(function () {
    if (session !== noteEditorSession) return;
    setImagesBusy(false);
    if (failed) {
      uiAlert(failed === 1
        ? "Une image n'a pas pu être ajoutée : format non pris en charge."
        : failed + " images n'ont pas pu être ajoutées : format non pris en charge.");
    }
  });
});

/* Pièces jointes de la note */
byId('addNoteFilesBtn').addEventListener('click', function () {
  byId('noteFiles').click();
});

byId('noteFiles').addEventListener('change', function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  var session = noteEditorSession;
  var list = currentAttachments;
  addAttachments(files, list, function () {
    if (session === noteEditorSession) renderAttachmentEditor(byId('noteAttachments'), list);
  });
});

function saveNote() {
  if (savingNote) return;
  if (imagesBusy) {
    showToast("Patiente : les photos sont en cours d'ajout.");
    return;
  }
  var title = byId('noteTitle').value.trim();
  var body = byId('noteBody').value.trim();
  if (!title && !body && !currentImages.length && !currentAttachments.length) {
    uiAlert('Ajoute au moins un titre, du texte, une photo ou un fichier.');
    return;
  }
  var now = Date.now();
  var isNew = !editingNote;
  var note = {
    title: title,
    body: body,
    icon: noteDraft.icon,
    folderId: noteDraft.folderId,
    addressId: noteDraft.addressId,
    pinned: !!(editingNote && editingNote.pinned),
    images: currentImages.slice(),
    attachments: currentAttachments.slice(),
    createdAt: (editingNote && editingNote.createdAt) || now,
    updatedAt: now
  };
  if (editingNote) note.id = editingNote.id;
  savingNote = true;
  dbPut('notes', note).then(function (id) {
    if (isNew) replaceView('note', { id: id });
    else goBack(true);
  }, function (err) {
    console.error(err);
    uiAlert("La note n'a pas pu être enregistrée. Le stockage du téléphone est peut-être plein.");
  }).then(function () { savingNote = false; });
}
