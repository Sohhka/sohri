/* ---------- Dossiers (notes, documents) et albums (images) ----------
   Tous rangés dans le magasin « folders », distingués par « kind ». */
var FOLDER_KINDS = {
  notes: { icon: '📁', create: 'Nouveau dossier', rename: 'Renommer le dossier', placeholder: 'Ex. : Tokyo, Réservations…' },
  documents: { icon: '📁', create: 'Nouveau dossier', rename: 'Renommer le dossier', placeholder: 'Ex. : Billets, Hôtels, Assurance…' },
  photos: { icon: '🖼️', create: 'Nouvel album', rename: "Renommer l'album", placeholder: 'Ex. : Tokyo, Shibuya…' }
};

function folderIcon(folder) {
  return folder.icon || FOLDER_KINDS[folder.kind].icon;
}

function folderLabel(folder) {
  return folderIcon(folder) + ' ' + folder.name;
}

/* Ligne d'un dossier dans une liste : l'ouvre dans la vue viewName ({ folderId }). */
function folderRow(folder, count, viewName) {
  return h('div', { className: 'list-row', onclick: function () { openView(viewName, { folderId: folder.id }); } }, [
    h('span', { className: 'row-icon', text: folderIcon(folder) }),
    h('div', { className: 'list-row-main' }, [h('p', { className: 'list-row-title', text: folder.name })]),
    h('span', { className: 'row-count', text: String(count) }),
    h('span', { className: 'row-chevron', text: '›' })
  ]);
}

function newFolderRow(kind) {
  return h('button', {
    type: 'button', className: 'add-row',
    onclick: function () { createFolder(kind).then(function (folder) { if (folder) refreshView(); }); }
  }, '＋ ' + FOLDER_KINDS[kind].create);
}

function listFolders(kind) {
  return dbGetAll('folders').then(function (all) {
    return all.filter(function (f) { return f.kind === kind; }).sort(byName);
  });
}

/* Demande un nom (et une icône) puis crée le dossier : promesse du dossier, ou null si annulé. */
function createFolder(kind) {
  var info = FOLDER_KINDS[kind];
  return uiPrompt(info.create, { placeholder: info.placeholder, okLabel: 'Créer', icon: info.icon })
    .then(function (answer) {
      if (!answer || !answer.value) return null;
      var folder = { kind: kind, name: answer.value, icon: answer.icon || info.icon, createdAt: Date.now() };
      return dbPut('folders', folder).then(function (id) {
        folder.id = id;
        return folder;
      });
    })
    .catch(function (err) {
      console.error(err);
      uiAlert("Le dossier n'a pas pu être créé.");
      return null;
    });
}

function renameFolder(folder) {
  return uiPrompt(FOLDER_KINDS[folder.kind].rename, { value: folder.name, icon: folderIcon(folder), okLabel: 'Renommer' })
    .then(function (answer) {
      if (!answer || !answer.value) return;
      folder.name = answer.value;
      folder.icon = answer.icon || folder.icon;
      return dbPut('folders', folder).then(refreshView);
    })
    .catch(function (err) {
      console.error(err);
      uiAlert("Le changement de nom n'a pas pu être enregistré.");
    });
}

/* Choix d'un dossier dans une liste (avec « Nouveau dossier… ») : promesse de son id,
   null pour options.noneLabel (« Aucun dossier »), undefined si annulé.
   options.exclude : id d'un dossier à ne pas proposer. */
function chooseFolder(kind, currentId, title, options) {
  options = options || {};
  return listFolders(kind).then(function (folders) {
    var items = options.noneLabel ? [{ icon: '🗂️', label: options.noneLabel, value: null, selected: !currentId }] : [];
    folders.forEach(function (f) {
      if (f.id !== options.exclude) items.push({ icon: folderIcon(f), label: f.name, value: f.id, selected: f.id === currentId });
    });
    return pickFromList(title, items, { createLabel: FOLDER_KINDS[kind].create + '…' });
  }).then(function (choice) {
    if (!choice) return undefined;
    if (!choice.create) return choice.value;
    return createFolder(kind).then(function (folder) { return folder ? folder.id : undefined; });
  });
}

/* Supprime un dossier de notes ou de documents : son contenu (storeName) revient à la racine. */
function deleteFolderKeepingItems(folder, storeName, explanation, section) {
  uiConfirm('Supprimer le dossier « ' + folder.name + ' » ? ' + explanation, 'Supprimer', true)
    .then(function (ok) {
      if (!ok) return;
      return dbChangedRecords(storeName, function (item) {
        if (item.folderId !== folder.id) return false;
        item.folderId = null;
        return true;
      }).then(function (items) {
        return dbWrite(['folders', storeName], function (tx) {
          tx.objectStore('folders')['delete'](folder.id);
          items.forEach(function (item) { tx.objectStore(storeName).put(item); });
        });
      }).then(function () {
        leaveAfterDelete(section);
        showToast('Dossier supprimé');
      });
    })
    .catch(function (err) {
      console.error(err);
      uiAlert("Le dossier n'a pas pu être supprimé.");
    });
}

/* Menu ⋮ d'un dossier de notes ou de documents. */
function showFolderMenu(folderId, storeName, explanation, section) {
  dbGet('folders', folderId).then(function (folder) {
    if (!folder) return;
    showActions([
      { icon: '✏️', label: FOLDER_KINDS[folder.kind].rename, onClick: function () { renameFolder(folder); } },
      { icon: '🗑️', label: 'Supprimer le dossier', danger: true, onClick: function () { deleteFolderKeepingItems(folder, storeName, explanation, section); } }
    ], folderLabel(folder));
  });
}
