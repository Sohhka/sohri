/* ---------- Fiche d'une photo : description, lieu et commentaires (façon Instagram) ----------
   Mes photos : description et lieu modifiables (même sans compte) et, si elles sont partagées
   depuis cet appareil, les commentaires de mes proches, auxquels je réponds. Photo d'un proche :
   sa description, son lieu, et les commentaires de tous ceux qui la voient.
   Échanges avec le serveur : cloud.js. */
var PHOTO_CAPTION_MAX = 2000;
var PHOTO_LOCATION_MAX = 100;
var photoDetail = null;    // photo affichée : { own, photo, image, caption, location, owner, rid, photoKey, fresh... }
var editingCaption = false;
var commentRefreshTimer = null;
var commentInput = byId('commentInput');

defineView('photo', {
  el: 'view-photo',
  section: function (params) { return params.local !== undefined ? 'albums' : 'sharing'; },
  title: 'Photo',
  enter: renderPhotoDetail,
  exit: function () {
    releaseBlobUrls('photoDetail');
    photoDetail = null;
    editingCaption = false;
  },
  canLeave: function () {
    return confirmDiscard(!!commentInput.value.trim(), 'Abandonner ton commentaire ?').then(function (ok) {
      if (ok) commentInput.value = '';
      return ok;
    });
  },
  commentBar: function (params) {
    if (!isSignedIn()) return false;
    return params.local !== undefined ? sharingOwnPhotosHere() : canCommentOn(params.owner);
  }
});

/* Description et lieu d'une de mes photos (facultatifs : vides, ils sont effacés). */
function setPhotoInfo(photo, caption, location) {
  photo.caption = tidyText(caption, PHOTO_CAPTION_MAX);
  photo.location = String(location || '').replace(/\s+/g, ' ').trim().slice(0, PHOTO_LOCATION_MAX);
  return dbPut('photos', photo); // partage : envoyés par la synchronisation (cloud.js)
}

/* Lien vers la carte (Google Maps) pour un lieu écrit à la main. */
function openLocation(location) {
  openExternal('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location));
}

/* params : { local: id } pour une de mes photos (edit : description à écrire tout de suite, juste
   après l'ajout), { owner, rid } pour celle d'un proche. */
function loadPhotoDetail(params) {
  if (params.local !== undefined) {
    return dbGet('photos', params.local).then(function (photo) {
      if (!photo) return null;
      return dbGet('folders', photo.albumId).then(function (album) {
        var owner = isSignedIn() ? cloudSession.uid : null;
        return {
          own: true, photo: photo, image: photo.blob, caption: photo.caption || '', location: photo.location || '',
          takenAt: photo.takenAt, album: album ? folderLabel(album) : 'Photo',
          author: (cloudState.profile && cloudState.profile.name) || 'Moi',
          owner: owner, rid: photoRemoteId(photo), photoKey: ownPhotoKey(photo), fresh: {}
        };
      });
    });
  }
  var key = params.owner + '/' + params.rid;
  return dbGet('sharedPhotos', key).then(function (photo) {
    if (!photo) return null;
    return dbGet('sharedAlbums', photo.albumKey).then(function (album) {
      return {
        own: false, photo: photo, image: photo.blob || photo.thumb, caption: photo.caption || '', location: photo.location || '',
        takenAt: photo.takenAt, album: album ? (album.icon ? album.icon + ' ' : '') + album.name : 'Photo',
        author: ownerName(params.owner), owner: params.owner, rid: params.rid, photoKey: key, fresh: {}
      };
    });
  });
}

function renderPhotoDetail(params) {
  // Rien de la photo précédente pendant le chargement de celle-ci.
  byId('photoDetail').innerHTML = '';
  byId('photoComments').innerHTML = '';
  return loadPhotoDetail(params).then(function (detail) {
    if (currentViewName() !== 'photo') return;
    var box = byId('photoDetail');
    releaseBlobUrls('photoDetail');
    box.innerHTML = '';
    byId('photoComments').innerHTML = '';
    photoDetail = detail;
    editingCaption = !!(detail && detail.own && params.edit);
    if (!detail) {
      box.appendChild(h('p', { className: 'empty', text: "Cette photo n'existe plus." }));
      return;
    }
    setViewTitle(detail.album);
    var img = h('img', { className: 'photo-detail-img', src: blobUrl('photoDetail', detail.image), alt: detail.caption || 'Photo' });
    img.addEventListener('click', function () { openViewer([detail.image], 0); });
    box.appendChild(img);
    box.appendChild(h('div', { className: 'card caption-card', id: 'photoCaption' }));
    renderCaption();
    // Les nouveaux commentaires restent mis en évidence pendant cette visite, puis sont « lus ».
    photoComments(detail.photoKey).then(function (list) {
      list.forEach(function (c) { if (c.unread) detail.fresh[c.key] = true; });
      renderComments();
      if (detail.photoKey) markCommentsRead(detail.photoKey);
    });
    // Photo d'un proche pas encore reçue en taille réelle : téléchargée maintenant.
    if (!detail.own && !detail.photo.blob && isSignedIn()) {
      downloadSharedPhoto(detail.photo).then(function (blob) {
        if (photoDetail !== detail) return;
        detail.photo.blob = blob;
        detail.image = blob;
        img.src = blobUrl('photoDetail', blob);
      }, function () { /* hors connexion : la miniature reste */ });
    }
  });
}

/* Carte sous la photo : auteur, date, 📍 lieu, description ; ou, pour mes photos, leur édition. */
function renderCaption() {
  var detail = photoDetail;
  var box = byId('photoCaption');
  if (!detail || !box) return;
  box.innerHTML = '';
  byId('photoDetail').classList.toggle('is-editing', editingCaption); // photo plus petite : le formulaire reste visible
  box.appendChild(h('p', { className: 'caption-meta' }, [
    h('span', { className: 'caption-author', text: detail.author }),
    detail.takenAt ? ' · ' + formatShortDate(detail.takenAt) : null
  ]));
  if (editingCaption) {
    renderCaptionEditor(box, detail);
    return;
  }
  if (detail.location) {
    box.appendChild(h('button', {
      type: 'button', className: 'location-link', 'aria-label': 'Voir ' + detail.location + ' sur la carte',
      onclick: function () { openLocation(detail.location); }
    }, [h('span', { className: 'location-pin', text: '📍' }), detail.location]));
  }
  if (detail.caption) box.appendChild(h('p', { className: 'caption-text', text: detail.caption }));
  if (!detail.caption && !detail.location) box.appendChild(h('p', { className: 'hint caption-empty', text: 'Pas de description.' }));
  if (detail.own) {
    box.appendChild(h('button', {
      type: 'button', className: 'link-btn', text: detail.caption || detail.location ? '✏️ Modifier la description ou le lieu' : '✏️ Ajouter une description ou un lieu',
      onclick: function () { editingCaption = true; renderCaption(); }
    }));
  }
}

function renderCaptionEditor(box, detail) {
  var justAdded = !!currentEntry().params.edit;
  var caption = h('textarea', {
    id: 'captionInput', className: 'text-area caption-input', maxlength: String(PHOTO_CAPTION_MAX),
    placeholder: 'Quelques mots sur cette photo… (facultatif)'
  });
  var location = h('input', {
    id: 'locationInput', type: 'text', className: 'text-input', maxlength: String(PHOTO_LOCATION_MAX),
    autocomplete: 'off', placeholder: 'Ex. : Tokyo, Japon (facultatif)'
  });
  caption.value = detail.caption;
  location.value = detail.location;
  if (justAdded) box.appendChild(h('p', { className: 'hint caption-intro', text: 'Photo ajoutée ! Tu peux lui donner une description et un lieu : les deux sont facultatifs.' }));
  box.appendChild(h('label', { className: 'field-label', 'for': 'captionInput', text: 'Description' }));
  box.appendChild(caption);
  box.appendChild(h('label', { className: 'field-label', 'for': 'locationInput' }, ['📍 Lieu']));
  box.appendChild(location);
  box.appendChild(h('div', { className: 'card-actions' }, [
    h('button', { type: 'button', className: 'action-btn', text: 'Enregistrer', onclick: function () { saveCaption(caption.value, location.value); } }),
    h('button', { type: 'button', className: 'link-btn', text: justAdded ? 'Plus tard' : 'Annuler', onclick: cancelCaption })
  ]));
  if (!justAdded) caption.focus();
}

function saveCaption(caption, location) {
  var detail = photoDetail;
  if (!detail) return;
  setPhotoInfo(detail.photo, caption, location).then(function () {
    detail.caption = detail.photo.caption;
    detail.location = detail.photo.location;
    showToast(detail.caption || detail.location ? 'Enregistré' : 'Description et lieu effacés');
    finishCaption();
  }, function (err) {
    console.error(err);
    uiAlert("La description n'a pas pu être enregistrée.");
  });
}

function cancelCaption() {
  finishCaption();
}

/* Juste après l'ajout d'une photo : retour à l'album ; sinon, la fiche reste affichée. */
function finishCaption() {
  editingCaption = false;
  if (currentEntry().params.edit) goBack(true);
  else renderCaption();
}

/* ---------- Commentaires ---------- */
function renderComments() {
  var detail = photoDetail;
  var box = byId('photoComments');
  if (!detail) return;
  if (detail.own && !(isSignedIn() && sharedWith('albums').length)) {
    box.innerHTML = '';
    if (cloudEnabled()) box.appendChild(h('p', { className: 'hint', text: 'Partage tes Images (menu Partage) : tes proches verront cette photo et pourront la commenter.' }));
    return;
  }
  var here = !detail.own || sharingOwnPhotosHere();
  Promise.all([photoComments(detail.photoKey), detail.own && here ? dbGet('cloud', 'pub:' + detail.rid) : null]).then(function (r) {
    if (photoDetail !== detail) return;
    var list = r[0];
    box.innerHTML = '';
    if (!here) {
      // Mes Images partent d'un autre appareil : les photos de celui-ci ne sont pas en ligne.
      box.appendChild(h('p', { className: 'hint', text: "Tes Images partagées partent d'un autre appareil : les photos de celui-ci ne sont pas en ligne, tes proches ne les voient pas et ne peuvent pas les commenter. (Partage → Images pour envoyer plutôt celles d'ici.)" }));
    } else if (detail.own && !r[1]) {
      box.appendChild(h('p', { className: 'hint', text: '📤 Photo en cours d\'envoi : elle sera visible (et commentable) par tes proches dans un instant.' }));
    }
    if (!here && !list.length) return;
    box.appendChild(h('h2', { className: 'section-title', text: list.length ? plural(list.length, 'commentaire', 'commentaires') : 'Commentaires' }));
    if (!list.length) box.appendChild(h('p', { className: 'hint', text: detail.own ? 'Pas encore de commentaire.' : 'Pas encore de commentaire : écris le premier !' }));
    list.forEach(function (c) { box.appendChild(commentRow(detail, c)); });
  });
}

/* État d'un commentaire à côté de son auteur : date, ou envoi en attente (et pourquoi). */
function commentStatus(c) {
  if (c.failed) return '⚠️ non envoyé';
  if (!c.pending) return timeAgo(c.createdAt);
  if (c.waiting === 'offline') return "⏳ envoi au retour d'Internet";
  if (c.waiting === 'photo') return '⏳ envoi avec la photo';
  if (c.waiting === 'server') return '⏳ nouvel essai dans un instant';
  return '⏳ envoi…';
}

function commentRow(detail, c) {
  var me = cloudSession && cloudSession.uid;
  var mine = c.author === me;
  return h('div', { className: 'comment' + (c.pending || c.failed ? ' is-pending' : '') + (detail.fresh[c.key] ? ' is-new' : '') }, [
    h('p', { className: 'comment-head' }, [
      h('span', { className: 'comment-author', text: mine ? 'Toi' : c.authorName }),
      h('span', { className: 'comment-time', text: commentStatus(c) })
    ]),
    h('p', { className: 'comment-text', text: c.text }),
    c.failed ? h('p', { className: 'comment-failed', text: c.failed }) : null,
    h('div', { className: 'comment-actions' }, [
      !mine ? h('button', { type: 'button', className: 'link-btn', text: 'Répondre', onclick: function () { replyTo(c.authorName); } }) : null,
      mine || detail.owner === me ? h('button', { type: 'button', className: 'link-btn muted-link', text: 'Supprimer', onclick: function () { deleteComment(c); } }) : null
    ])
  ]);
}

/* « il y a 5 min », « hier », « 24 sept. » */
function timeAgo(ts) {
  var seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return "à l'instant";
  if (seconds < 3600) return 'il y a ' + Math.floor(seconds / 60) + ' min';
  if (seconds < 86400) return 'il y a ' + Math.floor(seconds / 3600) + ' h';
  if (seconds < 172800) return 'hier';
  return formatShortDate(ts);
}

function replyTo(name) {
  var mention = '@' + name + ' ';
  if (commentInput.value.indexOf(mention) !== 0) commentInput.value = mention + commentInput.value.replace(/^@\S+\s*/, '');
  commentInputChanged();
  commentInput.focus();
  commentInput.setSelectionRange(commentInput.value.length, commentInput.value.length);
}

function deleteComment(c) {
  uiConfirm('Supprimer ce commentaire ?', 'Supprimer', true).then(function (ok) {
    if (!ok) return;
    return cloudDeleteComment(c).then(function () {
      showToast('Commentaire supprimé');
    }, function (err) { uiAlert(cloudErrorText(err)); });
  });
}

function commentInputChanged() {
  commentInput.style.height = 'auto';
  commentInput.style.height = Math.min(commentInput.scrollHeight + 2, 120) + 'px';
  byId('commentSendBtn').disabled = !commentInput.value.trim();
}

var WAITING_MESSAGES = {
  offline: "Hors connexion : ton commentaire partira au retour d'Internet",
  photo: 'Ton commentaire partira avec la photo, dans un instant',
  server: 'Serveur indisponible : nouvel essai dans un instant'
};

function sendCurrentComment() {
  var detail = photoDetail;
  if (!detail || !commentInput.value.trim()) return;
  byId('commentSendBtn').disabled = true;
  cloudPostComment(detail.owner, detail.rid, commentInput.value).then(function (comment) {
    commentInput.value = '';
    commentInputChanged();
    if (comment.pending) showToast(WAITING_MESSAGES[comment.waiting] || 'Envoi en cours…');
    setTimeout(function () { byId('content').scrollTop = byId('content').scrollHeight; }, 50);
  }, function (err) {
    uiAlert(cloudErrorText(err));
    commentInputChanged();
  });
}

commentInput.addEventListener('input', commentInputChanged);
commentInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendCurrentComment(); // Ctrl+Entrée sur ordinateur
});
byId('commentSendBtn').addEventListener('click', sendCurrentComment);

/* ---------- Pastilles 💬 et « Nouveaux commentaires » ---------- */
function commentBadge(stats) {
  if (!stats || !stats.count) return null;
  return h('span', { className: 'photo-badge' + (stats.unread ? ' is-unread' : ''), text: '💬 ' + stats.count });
}

/* Sur la couverture d'un album : nouveaux commentaires sur ses photos. */
function albumBadge(unread) {
  return unread ? h('span', { className: 'album-badge', text: '💬 ' + unread }) : null;
}

/* Bouton en bas de la visionneuse. */
function commentLabel(stats, shared, hasInfo) {
  if (stats && stats.count) return '💬 ' + plural(stats.count, 'commentaire', 'commentaires');
  if (shared) return '💬 Commenter';
  return hasInfo ? '✏️ Modifier la description' : '✏️ Ajouter une description';
}

/* « 3 photos · 💬 2 nouveaux » */
function unreadSuffix(count) {
  return count ? ' · 💬 ' + count + (count > 1 ? ' nouveaux' : ' nouveau') : '';
}

/* Nouveaux commentaires : sur mes photos (présentes ici), et sur celles de chaque proche. */
function unreadCounts() {
  if (!isSignedIn()) return Promise.resolve({ mine: 0, others: 0, byOwner: {} });
  return Promise.all([dbGetAll('sharedComments'), dbGetAll('photos')]).then(function (r) {
    var mine = {};
    r[1].forEach(function (p) { var key = ownPhotoKey(p); if (key) mine[key] = true; });
    var counts = { mine: 0, others: 0, byOwner: {} };
    r[0].forEach(function (c) {
      if (!c.unread) return;
      if (c.owner === cloudSession.uid) {
        if (mine[c.photoKey]) counts.mine++;
      } else {
        counts.others++;
        counts.byOwner[c.owner] = (counts.byOwner[c.owner] || 0) + 1;
      }
    });
    return counts;
  });
}

/* Pastilles du menu (Images, Partage) et point sur ☰ : visibles de partout. */
var drawerBadges = {};
['albums', 'sharing'].forEach(function (section) {
  var item = document.querySelector('.drawer-item[data-section="' + section + '"]');
  drawerBadges[section] = item.appendChild(h('span', { className: 'drawer-badge', hidden: true }));
});

function updateUnreadIndicators() {
  return unreadCounts().then(function (counts) {
    [['albums', counts.mine], ['sharing', counts.others]].forEach(function (pair) {
      drawerBadges[pair[0]].textContent = pair[1] ? '💬 ' + pair[1] : '';
      drawerBadges[pair[0]].hidden = !pair[1];
    });
    byId('navBtn').classList.toggle('has-dot', counts.mine + counts.others > 0);
    var rows = document.querySelectorAll('[data-owner-unread]');
    for (var i = 0; i < rows.length; i++) {
      var n = counts.byOwner[rows[i].dataset.ownerUnread] || 0;
      rows[i].textContent = n ? '💬 ' + n : '';
      rows[i].hidden = !n;
    }
  });
}

/* Écran Partage : les photos qui ont de nouveaux commentaires. */
function renderUnreadComments(container) {
  if (!isSignedIn()) return;
  Promise.all([dbGetAll('sharedComments'), dbGetAll('photos')]).then(function (r) {
    var byPhoto = {};
    r[0].forEach(function (c) { if (c.unread) (byPhoto[c.photoKey] = byPhoto[c.photoKey] || []).push(c); });
    var keys = Object.keys(byPhoto);
    var own = {};
    r[1].forEach(function (p) { var key = ownPhotoKey(p); if (key && byPhoto[key]) own[key] = p; });
    return Promise.all(keys.map(function (key) { return own[key] ? null : dbGet('sharedPhotos', key); })).then(function (shared) {
      container.innerHTML = '';
      var rows = [];
      keys.forEach(function (key, i) {
        var photo = own[key] || shared[i];
        if (!photo) return;
        var list = byPhoto[key].sort(function (a, b) { return a.createdAt - b.createdAt; });
        var last = list[list.length - 1];
        var params = own[key] ? { local: photo.id } : { owner: photo.owner, rid: photo.rid };
        rows.push({ at: last.createdAt, row: h('div', { className: 'list-row', onclick: function () { openView('photo', params); } }, [
          h('img', { className: 'row-thumb', src: blobUrl('sharing', photo.thumb || photo.blob), alt: '' }),
          h('div', { className: 'list-row-main' }, [
            h('p', { className: 'list-row-title', text: last.authorName }),
            h('p', { className: 'list-row-sub clamp-2', text: last.text })
          ]),
          h('span', { className: 'unread-count', text: String(list.length) })
        ]) });
      });
      if (!rows.length) return;
      container.appendChild(h('h2', { className: 'section-title', text: 'Nouveaux commentaires' }));
      rows.sort(function (a, b) { return b.at - a.at; }).forEach(function (r) { container.appendChild(r.row); });
    });
  });
}

/* ---------- Mises à jour venues du serveur ---------- */
onCloudChange(function (what, detail) {
  if (what === 'comments' && detail > 0 && currentViewName() !== 'photo') {
    showToast('💬 ' + plural(detail, 'nouveau commentaire', 'nouveaux commentaires'));
  }
  if (what === 'comment' || what === 'comments' || what === 'shared' || what === 'data') scheduleCommentRefresh();
  if (what === 'data' && currentViewName() === 'photo') updateBottomBars();
});
onDbChange(function (stores) {
  if (stores.indexOf('photos') >= 0) scheduleCommentRefresh(); // photo supprimée : ses commentaires ne comptent plus
});

/* Écrans concernés redessinés (au plus deux fois par seconde). */
function scheduleCommentRefresh() {
  if (commentRefreshTimer) return;
  commentRefreshTimer = setTimeout(function () {
    commentRefreshTimer = null;
    updateUnreadIndicators();
    var view = currentViewName();
    if (view === 'photo' && photoDetail) {
      refreshPhotoDetail();
    } else if (view === 'album' || view === 'albums') {
      if (!isSelectingPhotos() && byId('viewer').hidden) (view === 'album' ? renderAlbum : renderAlbums)(currentEntry().params);
    } else if (view === 'shared-album' || view === 'shared-albums') {
      scheduleSharedRender();
    } else if (view === 'sharing') {
      var box = byId('unreadComments');
      if (box) renderUnreadComments(box);
    }
  }, 500);
}

/* Fiche affichée : nouveaux commentaires, description changée par son propriétaire. */
function refreshPhotoDetail() {
  var detail = photoDetail;
  loadPhotoDetail(currentEntry().params).then(function (fresh) {
    if (photoDetail !== detail) return;
    if (!fresh) {
      renderPhotoDetail(currentEntry().params); // photo retirée entre-temps
      return;
    }
    if (!detail.own && !editingCaption && (fresh.caption !== detail.caption || fresh.location !== detail.location)) {
      detail.caption = fresh.caption;
      detail.location = fresh.location;
      renderCaption();
    }
    return photoComments(detail.photoKey).then(function (list) {
      list.forEach(function (c) { if (c.unread) detail.fresh[c.key] = true; }); // arrivés pendant la visite
      renderComments();
      if (detail.photoKey) markCommentsRead(detail.photoKey);
    });
  });
}
