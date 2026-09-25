/* ---------- Images : albums photo ----------
   Un album est un dossier (magasin « folders », kind « photos ») ; ses photos (magasin « photos »)
   gardent une image réduite, une miniature et leur date de prise de vue. */
var currentAlbum = null;
var albumPhotos = [];          // photos de l'album affiché, par date de prise de vue
var albumCommentStats = {};    // commentaires de ces photos (si elles sont partagées)
var selectingPhotos = false;
var selectedPhotoIds = {};
var albumsRenderId = 0;
var albumRenderId = 0;

function isAlbum(folder) {
  return folder.kind === 'photos';
}

function byTakenAt(a, b) {
  return (a.takenAt || 0) - (b.takenAt || 0) || a.id - b.id;
}

function photoFileName(photo) {
  var d = new Date(photo.takenAt || photo.createdAt || Date.now());
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return 'SOHRI-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.jpg';
}

function formatDay(ts) {
  var text = new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- Liste des albums ---------- */
defineView('albums', {
  el: 'view-albums',
  section: 'albums',
  title: 'Images',
  enter: renderAlbums,
  exit: function () { releaseBlobUrls('albums'); },
  actions: function () {
    return [{ icon: '+', label: 'Nouvel album', onClick: function () {
      createFolder('photos').then(function (album) { if (album) openView('album', { id: album.id }); });
    } }];
  }
});

function renderAlbums() {
  var renderId = ++albumsRenderId;
  return Promise.all([dbGetAll('folders'), dbGetAll('photos'), commentStats()]).then(function (results) {
    if (renderId !== albumsRenderId) return;
    releaseBlobUrls('albums');
    var albums = results[0].filter(isAlbum).sort(byName);
    var stats = results[2];
    var photosByAlbum = {};
    results[1].forEach(function (photo) { (photosByAlbum[photo.albumId] = photosByAlbum[photo.albumId] || []).push(photo); });
    var grid = byId('albumGrid');
    grid.innerHTML = '';
    albums.forEach(function (album) {
      var photos = (photosByAlbum[album.id] || []).sort(byTakenAt);
      var cover = photos[0];
      var unread = photos.reduce(function (sum, p) { var s = stats[ownPhotoKey(p)]; return sum + (s ? s.unread : 0); }, 0);
      grid.appendChild(h('button', { type: 'button', className: 'album-card', onclick: function () { openView('album', { id: album.id }); } }, [
        h('span', { className: 'album-cover' }, cover
          ? h('img', { src: blobUrl('albums', cover.thumb || cover.blob), alt: '' })
          : h('span', { className: 'album-cover-icon', text: folderIcon(album) })),
        h('span', { className: 'album-name', text: folderLabel(album) }),
        h('span', { className: 'album-count' + (unread ? ' has-unread' : ''), text: plural(photos.length, 'photo', 'photos') + unreadSuffix(unread) })
      ]));
    });
    showEmpty(byId('albumsEmpty'), !albums.length, 'Aucun album pour l\'instant. Appuie sur + pour en créer un, par exemple « Tokyo ».');
  });
}

/* ---------- Un album ---------- */
defineView('album', {
  el: 'view-album',
  section: 'albums',
  title: 'Album',
  enter: renderAlbum,
  exit: function () {
    releaseBlobUrls('album');
    stopPhotoSelection();
    currentAlbum = null;
  },
  actions: function () {
    if (selectingPhotos) return [{ text: 'Tout', label: 'Tout sélectionner', onClick: selectAllPhotos }];
    return [
      { icon: '+', label: 'Ajouter des photos', onClick: function () { byId('albumPhotos').click(); } },
      { icon: '⋮', label: "Options de l'album", onClick: showAlbumMenu }
    ];
  }
});

function renderAlbum(params) {
  var renderId = ++albumRenderId;
  return Promise.all([dbGet('folders', params.id), dbGetAllByIndex('photos', 'albumId', params.id), commentStats()]).then(function (results) {
    if (renderId !== albumRenderId) return;
    currentAlbum = results[0];
    albumPhotos = results[1].sort(byTakenAt);
    albumCommentStats = results[2];
    if (!currentAlbum) {
      albumPhotos = [];
      renderPhotoGrid();
      showEmpty(byId('albumEmpty'), true, "Cet album n'existe plus.");
      return;
    }
    renderPhotoGrid();
    updateSelectionUI();
  });
}

/* Grille de miniatures, regroupées par jour de prise de vue. */
function renderPhotoGrid() {
  releaseBlobUrls('album');
  var container = byId('photoGrid');
  container.innerHTML = '';
  var day = null;
  var grid = null;
  albumPhotos.forEach(function (photo, index) {
    var photoDay = new Date(photo.takenAt).toDateString();
    if (photoDay !== day) {
      day = photoDay;
      container.appendChild(h('p', { className: 'photo-day', text: formatDay(photo.takenAt) }));
      grid = container.appendChild(h('div', { className: 'photo-grid' }));
    }
    grid.appendChild(h('button', {
      type: 'button', className: 'photo-cell' + (selectedPhotoIds[photo.id] ? ' is-selected' : ''),
      'aria-label': 'Photo ' + (index + 1), dataset: { index: index }
    }, [
      h('img', { src: blobUrl('album', photo.thumb || photo.blob), alt: '', loading: 'lazy' }),
      selectingPhotos ? null : commentBadge(albumCommentStats[ownPhotoKey(photo)])
    ]));
  });
  container.classList.toggle('selecting', selectingPhotos);
  showEmpty(byId('albumEmpty'), !albumPhotos.length, 'Album vide. Appuie sur + pour ajouter des photos.');
}

byId('photoGrid').addEventListener('click', function (e) {
  var cell = e.target.closest('.photo-cell');
  if (!cell) return;
  var index = parseInt(cell.dataset.index, 10);
  if (selectingPhotos) {
    var id = albumPhotos[index].id;
    if (selectedPhotoIds[id]) delete selectedPhotoIds[id];
    else selectedPhotoIds[id] = true;
    cell.classList.toggle('is-selected', !!selectedPhotoIds[id]);
    updateSelectionUI();
  } else {
    openAlbumViewer(index);
  }
});

function openAlbumViewer(index) {
  var photos = albumPhotos.slice();
  var shared = isSignedIn() && sharedWith('albums').length > 0;
  var details = {
    info: function (i) {
      var stats = albumCommentStats[ownPhotoKey(photos[i])];
      return { caption: photos[i].caption || '', label: commentLabel(stats, shared, !!photos[i].caption), unread: stats && stats.unread > 0 };
    },
    open: function (i) { openView('photo', { local: photos[i].id }); }
  };
  openViewer(photos.map(function (p) { return p.blob; }), index, [
    { icon: '↗', label: 'Partager', onClick: function (i) { shareFile(photos[i].blob, photoFileName(photos[i])); } },
    {
      icon: '🗑', label: 'Supprimer',
      onClick: function (i) {
        uiConfirm('Supprimer cette photo ?', 'Supprimer', true).then(function (ok) {
          if (!ok) return;
          return dbDelete('photos', photos[i].id).then(function () {
            photos.splice(i, 1);
            viewerRemoveCurrent();
            renderAlbum({ id: currentAlbum.id });
          });
        }).catch(function (err) {
          console.error(err);
          uiAlert("La photo n'a pas pu être supprimée.");
        });
      }
    }
  ], details);
}

/* Ajout de photos : une à une (réduction, miniature, date), avec une barre de progression.
   Une seule photo : une description est proposée tout de suite (comme sur Instagram). */
byId('albumPhotos').addEventListener('change', function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = '';
  if (!files.length || !currentAlbum) return;
  var albumId = currentAlbum.id;
  var progress = showProgress('Ajout des photos…');
  var added = [];
  var failed = 0;
  files.reduce(function (chain, file, i) {
    return chain.then(function () {
      progress.update('Ajout des photos… ' + (i + 1) + ' / ' + files.length, i / files.length);
      return preparePhoto(file).then(function (photo) {
        photo.albumId = albumId;
        photo.createdAt = Date.now();
        return dbPut('photos', photo).then(function (id) {
          photo.id = id;
          added.push(photo);
        });
      }).then(null, function (err) {
        console.error(err);
        failed++;
      });
    });
  }, Promise.resolve()).then(function () {
    progress.close();
    if (currentAlbum && currentAlbum.id === albumId) renderAlbum({ id: albumId });
    if (failed) {
      uiAlert(plural(failed, "photo n'a pas pu être ajoutée", "photos n'ont pas pu être ajoutées") + ' (format non pris en charge ou stockage plein).');
    } else if (added.length === 1) {
      askPhotoCaption(added[0]);
    } else if (added.length) {
      showToast(plural(added.length, 'photo ajoutée', 'photos ajoutées'));
    }
  });
});

function askPhotoCaption(photo) {
  uiPrompt('Photo ajoutée : une description ?', {
    message: 'Facultatif. Quelques mots sur cette photo ; si tu partages tes Images, tes proches la verront et pourront commenter.',
    placeholder: 'Ex. : premier soir à Shibuya 🌃', okLabel: 'Ajouter'
  }).then(function (answer) {
    if (!answer || !answer.value) return;
    return setPhotoCaption(photo, answer.value).then(function () {
      showToast('Description ajoutée');
      if (currentAlbum && currentAlbum.id === photo.albumId) renderAlbum({ id: photo.albumId });
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("La description n'a pas pu être enregistrée.");
  });
}

function showAlbumMenu() {
  var album = currentAlbum;
  if (!album) return;
  showActions([
    { icon: '☑️', label: 'Sélectionner des photos', onClick: startPhotoSelection },
    { icon: '✏️', label: "Renommer l'album", onClick: function () { renameFolder(album); } },
    { icon: '🗑️', label: "Supprimer l'album", danger: true, onClick: function () { deleteAlbum(album); } }
  ], folderLabel(album));
}

function deleteAlbum(album) {
  var count = albumPhotos.length;
  uiConfirm('Supprimer l\'album « ' + album.name + ' »' + (count ? ' et ses ' + plural(count, 'photo', 'photos') : '') + ' ?', 'Supprimer', true)
    .then(function (ok) {
      if (!ok) return;
      return dbWrite(['folders', 'photos'], function (tx) {
        tx.objectStore('folders')['delete'](album.id);
        tx.objectStore('photos').index('albumId').openKeyCursor(album.id).onsuccess = function (e) {
          var cursor = e.target.result;
          if (!cursor) return;
          tx.objectStore('photos')['delete'](cursor.primaryKey);
          cursor['continue']();
        };
      }).then(function () {
        leaveAfterDelete('albums');
        showToast('Album supprimé');
      });
    })
    .catch(function (err) {
      console.error(err);
      uiAlert("L'album n'a pas pu être supprimé.");
    });
}

/* ---------- Sélection de plusieurs photos ---------- */
function isSelectingPhotos() {
  return selectingPhotos;
}

function startPhotoSelection() {
  if (!albumPhotos.length) return;
  selectingPhotos = true;
  selectedPhotoIds = {};
  renderPhotoGrid();
  updateSelectionUI();
}

function stopPhotoSelection() {
  selectingPhotos = false;
  selectedPhotoIds = {};
  byId('photoGrid').classList.remove('selecting');
  byId('selectionBar').hidden = true;
  updateBottomBars();
}

function exitPhotoSelection() {
  stopPhotoSelection();
  renderPhotoGrid();
  updateSelectionUI();
}

function selectAllPhotos() {
  albumPhotos.forEach(function (photo) { selectedPhotoIds[photo.id] = true; });
  renderPhotoGrid();
  updateSelectionUI();
}

function selectedPhotos() {
  return albumPhotos.filter(function (photo) { return selectedPhotoIds[photo.id]; });
}

function updateSelectionUI() {
  if (currentViewName() !== 'album') return;
  var count = selectedPhotos().length;
  byId('selectionBar').hidden = !selectingPhotos;
  byId('selectionCount').textContent = count ? plural(count, 'sélectionnée', 'sélectionnées') : 'Touche les photos';
  byId('selectionMoveBtn').disabled = !count;
  byId('selectionDeleteBtn').disabled = !count;
  if (currentAlbum) setViewTitle(selectingPhotos ? 'Sélection' : folderLabel(currentAlbum));
  renderTopActions();
  updateBottomBars();
}

byId('selectionCancelBtn').addEventListener('click', exitPhotoSelection);

byId('selectionMoveBtn').addEventListener('click', function () {
  var photos = selectedPhotos();
  if (!photos.length || !currentAlbum) return;
  var fromId = currentAlbum.id;
  chooseFolder('photos', null, 'Déplacer vers', { exclude: fromId }).then(function (albumId) {
    return albumId === undefined ? null : dbGet('folders', albumId);
  }).then(function (target) {
    if (!target) return;
    return dbWrite(['photos'], function (tx) {
      photos.forEach(function (photo) {
        photo.albumId = target.id;
        tx.objectStore('photos').put(photo);
      });
    }).then(function () {
      exitPhotoSelection();
      renderAlbum({ id: fromId });
      showToast(plural(photos.length, 'photo déplacée', 'photos déplacées') + ' vers « ' + target.name + ' »');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("Les photos n'ont pas pu être déplacées.");
  });
});

byId('selectionDeleteBtn').addEventListener('click', function () {
  var photos = selectedPhotos();
  if (!photos.length || !currentAlbum) return;
  var albumId = currentAlbum.id;
  uiConfirm('Supprimer ' + plural(photos.length, 'photo', 'photos') + ' ?', 'Supprimer', true).then(function (ok) {
    if (!ok) return;
    return dbWrite(['photos'], function (tx) {
      photos.forEach(function (photo) { tx.objectStore('photos')['delete'](photo.id); });
    }).then(function () {
      exitPhotoSelection();
      renderAlbum({ id: albumId });
      showToast(plural(photos.length, 'photo supprimée', 'photos supprimées'));
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert("Les photos n'ont pas pu être supprimées.");
  });
});
