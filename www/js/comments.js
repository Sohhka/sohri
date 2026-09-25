/* ---------- Fiche d'une photo : description et commentaires (façon Instagram) ----------
   Mes photos : description modifiable (même sans compte) et, si je partage mes Images, les
   commentaires de mes proches, auxquels je réponds. Photo d'un proche : sa description, et les
   commentaires de tous ceux qui la voient. Échanges avec le serveur : cloud.js. */
var PHOTO_CAPTION_MAX = 2000;
var photoDetail = null;    // photo affichée : { own, photo, image, caption, owner, rid, photoKey, fresh... }
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
    return params.local !== undefined ? sharedWith('albums').length > 0 : canCommentOn(params.owner);
  }
});

/* Description d'une de mes photos (vide : effacée). */
function setPhotoCaption(photo, text) {
  photo.caption = tidyText(text, PHOTO_CAPTION_MAX);
  return dbPut('photos', photo); // partage : envoyée par la synchronisation (cloud.js)
}

/* params : { local: id } pour une de mes photos, { owner, rid } pour celle d'un proche. */
function loadPhotoDetail(params) {
  if (params.local !== undefined) {
    return dbGet('photos', params.local).then(function (photo) {
      if (!photo) return null;
      return dbGet('folders', photo.albumId).then(function (album) {
        var owner = isSignedIn() ? cloudSession.uid : null;
        return {
          own: true, photo: photo, image: photo.blob, caption: photo.caption || '', takenAt: photo.takenAt,
          album: album ? folderLabel(album) : 'Photo', author: (cloudState.profile && cloudState.profile.name) || 'Moi',
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
        own: false, photo: photo, image: photo.blob || photo.thumb, caption: photo.caption || '', takenAt: photo.takenAt,
        album: album ? (album.icon ? album.icon + ' ' : '') + album.name : 'Photo', author: ownerName(params.owner),
        owner: params.owner, rid: params.rid, photoKey: key, fresh: {}
      };
    });
  });
}

function renderPhotoDetail(params) {
  return loadPhotoDetail(params).then(function (detail) {
    if (currentViewName() !== 'photo') return;
    var box = byId('photoDetail');
    releaseBlobUrls('photoDetail');
    box.innerHTML = '';
    byId('photoComments').innerHTML = '';
    photoDetail = detail;
    editingCaption = false;
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

function renderCaption() {
  var detail = photoDetail;
  var box = byId('photoCaption');
  if (!detail || !box) return;
  box.innerHTML = '';
  box.appendChild(h('p', { className: 'caption-meta' }, [
    h('span', { className: 'caption-author', text: detail.author }),
    detail.takenAt ? ' · ' + formatShortDate(detail.takenAt) : null
  ]));
  if (editingCaption) {
    var area = h('textarea', { className: 'text-area caption-input', maxlength: String(PHOTO_CAPTION_MAX), placeholder: 'Quelques mots sur cette photo… (emojis bienvenus)', 'aria-label': 'Description' });
    area.value = detail.caption;
    box.appendChild(area);
    box.appendChild(h('div', { className: 'card-actions' }, [
      h('button', { type: 'button', className: 'action-btn', text: 'Enregistrer', onclick: function () { saveCaption(area.value); } }),
      h('button', { type: 'button', className: 'link-btn', text: 'Annuler', onclick: function () { editingCaption = false; renderCaption(); } })
    ]));
    area.focus();
    return;
  }
  box.appendChild(detail.caption
    ? h('p', { className: 'caption-text', text: detail.caption })
    : h('p', { className: 'hint caption-empty', text: 'Pas de description.' }));
  if (detail.own) {
    box.appendChild(h('button', {
      type: 'button', className: 'link-btn', text: detail.caption ? '✏️ Modifier la description' : '✏️ Ajouter une description',
      onclick: function () { editingCaption = true; renderCaption(); }
    }));
  }
}

function saveCaption(text) {
  var detail = photoDetail;
  if (!detail) return;
  setPhotoCaption(detail.photo, text).then(function () {
    detail.caption = detail.photo.caption;
    editingCaption = false;
    renderCaption();
    showToast(detail.caption ? 'Description enregistrée' : 'Description effacée');
  }, function (err) {
    console.error(err);
    uiAlert("La description n'a pas pu être enregistrée.");
  });
}

/* ---------- Commentaires ---------- */
function renderComments() {
  var detail = photoDetail;
  var box = byId('photoComments');
  if (!detail) return;
  var shared = detail.own ? isSignedIn() && sharedWith('albums').length > 0 : true;
  if (!shared) {
    box.innerHTML = '';
    if (cloudEnabled()) box.appendChild(h('p', { className: 'hint', text: 'Partage tes Images (menu Partage) : tes proches verront cette photo et pourront la commenter.' }));
    return;
  }
  photoComments(detail.photoKey).then(function (list) {
    if (photoDetail !== detail) return;
    box.innerHTML = '';
    box.appendChild(h('h2', { className: 'section-title', text: list.length ? plural(list.length, 'commentaire', 'commentaires') : 'Commentaires' }));
    if (!list.length) box.appendChild(h('p', { className: 'hint', text: detail.own ? 'Pas encore de commentaire.' : 'Pas encore de commentaire : écris le premier !' }));
    list.forEach(function (c) { box.appendChild(commentRow(detail, c)); });
  });
}

function commentRow(detail, c) {
  var me = cloudSession && cloudSession.uid;
  var mine = c.author === me;
  return h('div', { className: 'comment' + (c.pending ? ' is-pending' : '') + (detail.fresh[c.key] ? ' is-new' : '') }, [
    h('p', { className: 'comment-head' }, [
      h('span', { className: 'comment-author', text: mine ? 'Toi' : c.authorName }),
      h('span', { className: 'comment-time', text: c.pending ? "⏳ envoi au retour d'Internet" : timeAgo(c.createdAt) })
    ]),
    h('p', { className: 'comment-text', text: c.text }),
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

function sendCurrentComment() {
  var detail = photoDetail;
  if (!detail || !commentInput.value.trim()) return;
  var button = byId('commentSendBtn');
  button.disabled = true;
  cloudPostComment(detail.owner, detail.rid, commentInput.value).then(function (comment) {
    commentInput.value = '';
    commentInputChanged();
    if (comment.pending) showToast("Hors connexion : ton commentaire partira au retour d'Internet");
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

/* Texte du bouton en bas de la visionneuse. */
function commentLabel(stats, shared, hasCaption) {
  if (stats && stats.count) return '💬 ' + plural(stats.count, 'commentaire', 'commentaires');
  if (shared) return '💬 Commenter';
  return hasCaption ? '✏️ Modifier la description' : '✏️ Ajouter une description';
}

/* « 3 photos · 💬 2 nouveaux » */
function unreadSuffix(count) {
  return count ? ' · 💬 ' + count + (count > 1 ? ' nouveaux' : ' nouveau') : '';
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
  if (what === 'comment' || what === 'comments' || what === 'shared') scheduleCommentRefresh();
  if (what === 'data' && currentViewName() === 'photo') updateBottomBars();
});

/* Écrans concernés redessinés (au plus deux fois par seconde). */
function scheduleCommentRefresh() {
  if (commentRefreshTimer) return;
  commentRefreshTimer = setTimeout(function () {
    commentRefreshTimer = null;
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
    if (!detail.own && fresh.caption !== detail.caption && !editingCaption) {
      detail.caption = fresh.caption;
      renderCaption();
    }
    return photoComments(detail.photoKey).then(function (list) {
      list.forEach(function (c) { if (c.unread) detail.fresh[c.key] = true; }); // arrivés pendant la visite
      renderComments();
      if (detail.photoKey) markCommentsRead(detail.photoKey);
    });
  });
}
