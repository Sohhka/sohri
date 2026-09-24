/* ---------- Documents : fichiers rangés dans des dossiers ----------
   Magasin « documents » : description d'un fichier (nom, type, taille, dossier, miniature) ;
   magasin « documentFiles » : son contenu (lien : fileId). Affichage : docviewer.js. */
var DOCUMENT_THUMB_SIZE = 160;
var DOC_FOLDER_DELETE_INFO = 'Ses fichiers ne sont pas supprimés : ils reviennent dans Documents.';
var openedDocumentId = null;   // document affiché dans la visionneuse
var documentsRenderId = 0;
var documentsSearchTimer = null;

/* Tri par nom, « billet 2 » avant « billet 10 ». */
function byFileName(a, b) {
  return (a.name || '').localeCompare(b.name || '', 'fr', { numeric: true, sensitivity: 'base' });
}

/* Le document avec son contenu : { name, type, size, blob }. */
function loadDocument(doc) {
  return dbGet('documentFiles', doc.fileId).then(function (file) {
    if (!file) throw new Error('Contenu introuvable : ' + doc.name);
    return { name: doc.name, type: doc.type, size: doc.size, blob: file.blob };
  });
}

function refreshDocumentsView() {
  if (currentViewName() === 'documents') refreshView();
}

/* ---------- Liste ---------- */
defineView('documents', {
  el: 'view-documents',
  section: 'documents',
  title: 'Documents',
  enter: renderDocuments,
  exit: function () { releaseBlobUrls('documents'); },
  actions: function (params) {
    var actions = [{ icon: '+', label: 'Ajouter des fichiers', onClick: function () { byId('docFiles').click(); } }];
    if (params.folderId) {
      actions.push({ icon: '⋮', label: 'Options du dossier', onClick: function () {
        showFolderMenu(params.folderId, 'documents', DOC_FOLDER_DELETE_INFO, 'documents');
      } });
    }
    return actions;
  }
});

function documentRow(doc, folderMap, showFolder) {
  var folder = showFolder ? folderMap[doc.folderId] : null;
  var isPage = documentKind(doc.type, doc.name) === 'pdf'; // miniature d'une page entière, non recadrée
  return h('div', { className: 'list-row doc-row', onclick: function () { openStoredDocument(doc); } }, [
    h('span', { className: 'doc-thumb' + (isPage ? ' is-page' : '') }, doc.thumb
      ? h('img', { src: blobUrl('documents', doc.thumb), alt: '' })
      : h('span', { text: fileIcon(doc.type, doc.name) })),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title doc-name', text: doc.name }),
      h('p', { className: 'list-row-sub', text: fileTypeLabel(doc.type, doc.name) + ' · ' + formatSize(doc.size) + ' · ' + formatShortDate(doc.createdAt) }),
      folder ? h('div', { className: 'chips' }, chip(folderLabel(folder), true)) : null
    ]),
    h('button', {
      type: 'button', className: 'icon-btn', 'aria-label': 'Options de ' + doc.name, text: '⋮',
      onclick: function (e) {
        e.stopPropagation();
        showDocumentMenu(doc);
      }
    })
  ]);
}

function renderDocuments(params) {
  var renderId = ++documentsRenderId;
  var folderId = params.folderId || null;
  var query = normalizeText(byId('docsSearch').value.trim());
  byId('docsSearch').placeholder = folderId ? 'Rechercher dans ce dossier' : 'Rechercher un document';
  return Promise.all([dbGetAll('documents'), listFolders('documents')]).then(function (results) {
    if (renderId !== documentsRenderId) return;
    releaseBlobUrls('documents');
    var docs = results[0].sort(byFileName);
    var folders = results[1];
    var folderMap = mapById(folders);
    var container = byId('docsContent');
    var empty = byId('docsEmpty');
    container.innerHTML = '';
    empty.hidden = true;

    if (folderId && !folderMap[folderId]) {
      showEmpty(empty, true, "Ce dossier n'existe plus.");
      return;
    }
    if (folderId) setViewTitle(folderLabel(folderMap[folderId]));

    if (query) {
      var found = docs.filter(function (d) {
        return (!folderId || d.folderId === folderId) && normalizeText(d.name).indexOf(query) >= 0;
      });
      found.forEach(function (d) { container.appendChild(documentRow(d, folderMap, !folderId)); });
      showEmpty(empty, !found.length, 'Aucun document ne correspond à ta recherche.');
      return;
    }

    if (folderId) {
      var inFolder = docs.filter(function (d) { return d.folderId === folderId; });
      inFolder.forEach(function (d) { container.appendChild(documentRow(d, folderMap, false)); });
      showEmpty(empty, !inFolder.length, 'Ce dossier est vide. Appuie sur + pour y ajouter des fichiers.');
      return;
    }

    var counts = {};
    docs.forEach(function (d) { if (folderMap[d.folderId]) counts[d.folderId] = (counts[d.folderId] || 0) + 1; });
    if (folders.length) container.appendChild(h('p', { className: 'section-title', text: 'Dossiers' }));
    folders.forEach(function (f) { container.appendChild(folderRow(f, counts[f.id] || 0, 'documents')); });
    container.appendChild(newFolderRow('documents'));
    var loose = docs.filter(function (d) { return !folderMap[d.folderId]; });
    if (loose.length && folders.length) container.appendChild(h('p', { className: 'section-title', text: 'Fichiers' }));
    loose.forEach(function (d) { container.appendChild(documentRow(d, folderMap, false)); });
    showEmpty(empty, !docs.length, "Aucun document pour l'instant. Appuie sur + pour ajouter des PDF, images, vidéos...");
  });
}

byId('docsSearch').addEventListener('input', function () {
  clearTimeout(documentsSearchTimer);
  documentsSearchTimer = setTimeout(function () {
    if (currentViewName() === 'documents') renderDocuments(currentEntry().params);
  }, 150);
});

/* ---------- Ajout de fichiers ---------- */
byId('docFiles').addEventListener('change', function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = '';
  var entry = currentEntry();
  if (!files.length || !entry || entry.name !== 'documents') return;
  importDocuments(files, entry.params.folderId || null);
});

/* Un fichier à la fois : miniature, puis contenu et description enregistrés ensemble. Le fichier
   est enregistré tel quel (même une grande vidéo), sans être chargé en mémoire. */
function importDocuments(files, folderId) {
  var progress = showProgress('Ajout des fichiers…');
  var added = 0;
  var failed = [];
  files.reduce(function (chain, file, i) {
    return chain.then(function () {
      progress.update('Ajout de « ' + file.name + ' » (' + (i + 1) + ' / ' + files.length + ')…', i / files.length);
      var type = file.type || guessType(file.name);
      var blob = file.slice(0, file.size, type);
      return makeDocumentThumb(blob, type, file.name, DOCUMENT_THUMB_SIZE).then(function (thumb) {
        var now = Date.now();
        return saveNewDocument({
          folderId: folderId, name: file.name || 'fichier', type: type, size: file.size,
          thumb: thumb, createdAt: now, updatedAt: now
        }, blob);
      }).then(function () { added++; }, function (err) {
        console.error(err);
        failed.push(file.name);
      });
    });
  }, Promise.resolve()).then(function () {
    progress.close();
    refreshDocumentsView();
    if (failed.length) uiAlert("Ces fichiers n'ont pas pu être ajoutés (stockage du téléphone plein ?) : " + failed.join(', '));
    else if (added) showToast(plural(added, 'fichier ajouté', 'fichiers ajoutés'));
  });
}

function saveNewDocument(doc, blob) {
  return dbWrite(['documentFiles', 'documents'], function (tx) {
    tx.objectStore('documentFiles').add({ blob: blob }).onsuccess = function (e) {
      doc.fileId = e.target.result;
      tx.objectStore('documents').add(doc);
    };
  });
}

/* ---------- Actions sur un fichier ---------- */
function openStoredDocument(doc) {
  loadDocument(doc).then(function (full) {
    openDocument(full, { actions: [
      { icon: '✏️', label: 'Renommer', onClick: function () { renameDocument(doc); } },
      { icon: '📁', label: 'Déplacer vers un dossier', onClick: function () { moveDocument(doc); } },
      { icon: '🗑️', label: 'Supprimer', danger: true, onClick: function () { deleteDocument(doc); } }
    ] });
    openedDocumentId = doc.id;
  }).catch(function (err) {
    console.error(err);
    uiAlert("Ce fichier n'a pas pu être ouvert.");
  });
}

function showDocumentMenu(doc) {
  function withContent(action) {
    return function () {
      loadDocument(doc).then(action).catch(function (err) {
        console.error(err);
        uiAlert("Ce fichier n'a pas pu être lu.");
      });
    };
  }
  showActions([
    { icon: '👁️', label: 'Ouvrir', onClick: function () { openStoredDocument(doc); } },
    { icon: '↗️', label: 'Partager', onClick: withContent(function (full) { return shareFile(full.blob, full.name); }) },
    { icon: '📲', label: 'Ouvrir avec une autre appli', onClick: withContent(function (full) { return openFile(full.blob, full.name); }) },
    { icon: '💾', label: 'Enregistrer sous…', onClick: withContent(function (full) { return saveFile(full.blob, full.name); }) },
    { icon: '✏️', label: 'Renommer', onClick: function () { renameDocument(doc); } },
    { icon: '📁', label: 'Déplacer vers un dossier', onClick: function () { moveDocument(doc); } },
    { icon: '🗑️', label: 'Supprimer', danger: true, onClick: function () { deleteDocument(doc); } }
  ], doc.name);
}

/* Nouveau nom ; l'extension (.pdf...) est gardée si elle a été effacée. */
function renameDocument(doc) {
  uiPrompt('Renommer le fichier', { value: doc.name, okLabel: 'Renommer' }).then(function (answer) {
    if (!answer || !answer.value || answer.value === doc.name) return;
    var name = safeFileName(answer.value);
    var ext = fileExtension(doc.name);
    if (ext && !fileExtension(name)) name += '.' + ext;
    doc.name = name;
    doc.updatedAt = Date.now();
    return dbPut('documents', doc).then(function () {
      if (isDocumentOpen() && openedDocumentId === doc.id) {
        docViewer.doc.name = name;
        byId('docName').textContent = name;
      }
      refreshDocumentsView();
      showToast('Fichier renommé');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("Le fichier n'a pas pu être renommé.");
  });
}

function moveDocument(doc) {
  chooseFolder('documents', doc.folderId, 'Déplacer vers', { noneLabel: 'Aucun dossier' }).then(function (folderId) {
    if (folderId === undefined || folderId === (doc.folderId || null)) return;
    doc.folderId = folderId;
    doc.updatedAt = Date.now();
    return dbPut('documents', doc).then(function () {
      refreshDocumentsView();
      showToast('Fichier déplacé');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("Le fichier n'a pas pu être déplacé.");
  });
}

function deleteDocument(doc) {
  uiConfirm('Supprimer « ' + doc.name + ' » ?', 'Supprimer', true).then(function (ok) {
    if (!ok) return;
    return dbWrite(['documents', 'documentFiles'], function (tx) {
      tx.objectStore('documents')['delete'](doc.id);
      tx.objectStore('documentFiles')['delete'](doc.fileId);
    }).then(function () {
      if (isDocumentOpen() && openedDocumentId === doc.id) closeDocument();
      refreshDocumentsView();
      showToast('Fichier supprimé');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("Le fichier n'a pas pu être supprimé.");
  });
}
