/* ---------- Rubrique Partage : compte, contacts, ce que je partage, ce qu'on me partage ----------
   Écrans seulement ; les échanges avec le serveur sont dans cloud.js. */
var PUBLIC_SITE = 'https://sohhka.github.io/sohri/';
var PUBLIC_APK = 'https://github.com/Sohhka/sohri/releases/latest';
var shareToggleBusy = false;
var sharedRenderTimer = null;
var sharedInfoTimer = null;

byId('drawerSharing').hidden = !cloudEnabled();

defineView('sharing', {
  el: 'view-sharing',
  section: 'sharing',
  title: 'Partage',
  enter: renderSharing,
  actions: function () {
    if (!isSignedIn()) return [];
    return [
      { icon: '⟳', label: 'Synchroniser', onClick: function () { syncNow(); } },
      { icon: '⋮', label: 'Mon compte', onClick: showAccountMenu }
    ];
  }
});

function categoryLabel(category) {
  var info = CLOUD_CATEGORIES[category];
  return info ? info.label : category;
}

function namesOf(uids) {
  var contacts = mapByUid(cloudState.contacts);
  return uids.map(function (uid) { return contacts[uid] ? contacts[uid].name : 'un proche'; }).join(', ');
}

function renderSharing() {
  var box = byId('sharingContent');
  box.innerHTML = '';
  releaseBlobUrls('sharing');
  if (!cloudEnabled()) {
    box.appendChild(h('p', { className: 'empty', text: "Le partage n'est pas disponible dans cette version de l'appli." }));
    return;
  }
  if (!isSignedIn()) {
    box.appendChild(h('div', { className: 'card' }, [
      h('p', { className: 'share-intro-title', text: '👥 Partager avec tes proches' }),
      h('p', { className: 'card-text', text: 'Montre une rubrique, par exemple tes Images, aux proches de ton choix : ils la voient dans leur appli SOHRI, même sans connexion une fois reçue.' }),
      h('p', { className: 'hint', text: "C'est facultatif : sans compte, SOHRI fonctionne entièrement sans connexion et rien ne quitte ton téléphone." }),
      h('button', { type: 'button', className: 'primary-btn block-btn', text: 'Créer un compte', onclick: function () { openView('account', { mode: 'signup' }); } }),
      h('button', { type: 'button', className: 'secondary-btn block', text: "J'ai déjà un compte", onclick: function () { openView('account', { mode: 'signin' }); } })
    ]));
    return;
  }
  var profile = cloudState.profile || {};
  box.appendChild(h('div', { className: 'card' }, [
    h('div', { className: 'profile-head' }, [
      h('span', { className: 'profile-avatar', text: '👤' }),
      h('div', { className: 'profile-main' }, [
        h('p', { className: 'profile-name', text: profile.name || '…' }),
        h('p', { className: 'profile-email', text: cloudSession.email || '' })
      ])
    ]),
    h('p', { className: 'card-label profile-code-label', text: 'Mon code' }),
    h('p', { className: 'profile-code', id: 'myCode', text: profile.code || '…' }),
    h('p', { className: 'hint', text: "Donne-le à tes proches : il leur sert à créer leur compte (c'est leur invitation), ou à t'ajouter à leurs contacts." }),
    h('div', { className: 'card-actions' }, [
      h('button', { type: 'button', className: 'action-btn', onclick: copyMyCode }, [h('span', { className: 'action-icon', text: '📋' }), 'Copier']),
      h('button', { type: 'button', className: 'action-btn', onclick: sendInvitation }, [h('span', { className: 'action-icon', text: '✉️' }), 'Inviter'])
    ])
  ]));
  box.appendChild(h('p', { className: 'cloud-status js-cloud-status' }));
  updateStatusLine();

  var unread = box.appendChild(h('div', { id: 'unreadComments' }));
  renderUnreadComments(unread);

  box.appendChild(h('h2', { className: 'section-title', text: 'Partagés avec moi' }));
  if (!cloudState.grantsToMe.length) {
    box.appendChild(h('p', { className: 'hint', text: 'Personne ne partage encore avec toi.' }));
  }
  cloudState.grantsToMe.forEach(function (grant) {
    box.appendChild(h('div', { className: 'list-row', onclick: function () { openView('shared-albums', { owner: grant.owner }); } }, [
      h('span', { className: 'row-icon', text: '👤' }),
      h('div', { className: 'list-row-main' }, [
        h('p', { className: 'list-row-title', text: grant.name }),
        h('p', { className: 'list-row-sub', text: grant.categories.map(categoryLabel).join(', ') })
      ]),
      h('span', { className: 'unread-count', hidden: true, dataset: { ownerUnread: grant.owner } }), // nouveaux commentaires
      h('span', { className: 'row-chevron', text: '›' })
    ]));
  });
  updateUnreadIndicators();

  box.appendChild(h('h2', { className: 'section-title', text: 'Ce que je partage' }));
  Object.keys(CLOUD_CATEGORIES).forEach(function (category) {
    var people = sharedWith(category);
    box.appendChild(h('div', { className: 'list-row', onclick: function () { openView('share-category', { category: category }); } }, [
      h('span', { className: 'row-icon', text: CLOUD_CATEGORIES[category].icon }),
      h('div', { className: 'list-row-main' }, [
        h('p', { className: 'list-row-title', text: CLOUD_CATEGORIES[category].label }),
        h('p', { className: 'list-row-sub', text: people.length ? 'Partagé avec ' + namesOf(people) : 'Pas partagé' })
      ]),
      h('span', { className: 'row-chevron', text: '›' })
    ]));
  });

  box.appendChild(h('h2', { className: 'section-title', text: 'Mes contacts' }));
  cloudState.contacts.slice().sort(byName).forEach(function (contact) {
    box.appendChild(h('div', { className: 'list-row', onclick: function () { showContactMenu(contact); } }, [
      h('span', { className: 'row-icon', text: '👤' }),
      h('div', { className: 'list-row-main' }, [
        h('p', { className: 'list-row-title', text: contact.name }),
        h('p', { className: 'list-row-sub', text: contact.code })
      ]),
      h('span', { className: 'row-chevron', text: '⋮' })
    ]));
  });
  box.appendChild(h('button', { type: 'button', className: 'add-row', text: '＋ Ajouter un contact', onclick: addContact }));
  // Déconnexion, bien visible (aussi dans le menu ⋮ « Mon compte »).
  box.appendChild(h('button', { type: 'button', className: 'secondary-btn sign-out-btn', text: '🚪 Se déconnecter', onclick: signOut }));
}

/* Lignes d'état de la synchronisation (mises à jour sans redessiner l'écran). */
function updateStatusLine() {
  var lines = document.querySelectorAll('.js-cloud-status');
  for (var i = 0; i < lines.length; i++) fillStatusLine(lines[i]);
}

function fillStatusLine(line) {
  line.innerHTML = '';
  var s = cloudStatus;
  if (s.state === 'syncing') {
    line.textContent = s.progress ? '🔄 ' + s.progress.label + ' : ' + (s.progress.done + 1) + ' / ' + s.progress.total : '🔄 Synchronisation…';
  } else if (s.state === 'done') {
    line.textContent = '✓ À jour (' + new Date(s.lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ')';
  } else if (s.state === 'offline') {
    line.textContent = "📴 Hors connexion : tout se mettra à jour au retour d'Internet.";
  } else if (s.state === 'signed-out') {
    line.appendChild(document.createTextNode('⚠️ Ta session a expiré. '));
    line.appendChild(h('button', { type: 'button', className: 'link-btn', text: 'Se reconnecter', onclick: function () { openView('account', { mode: 'signin' }); } }));
  } else if (s.state === 'error') {
    line.appendChild(document.createTextNode('⚠️ ' + cloudErrorText(s.error) + ' '));
    line.appendChild(h('button', { type: 'button', className: 'link-btn', text: 'Réessayer', onclick: function () { syncNow(); } }));
  }
}

function copyMyCode() {
  copyText(cloudState.profile.code).then(function () { showToast('Code copié'); }, function () { uiAlert('La copie a échoué.'); });
}

function invitationText() {
  return 'Rejoins-moi sur SOHRI pour voir ce que je partage !\n\n'
    + "1. Installe l'appli : sur iPhone, ouvre " + PUBLIC_SITE + ' dans Safari, puis Partager → « Sur l\'écran d\'accueil ». '
    + "Sur Android, installe l'APK : " + PUBLIC_APK + '\n'
    + '2. Dans le menu, Partage → Créer un compte, avec mon code d\'invitation : ' + cloudState.profile.code;
}

/* Invitation envoyée par SMS, WhatsApp, e-mail... (sinon copiée). */
function sendInvitation() {
  var text = invitationText();
  if (window.AndroidBridge && window.AndroidBridge.shareText) {
    window.AndroidBridge.shareText(text);
  } else if (navigator.share) {
    navigator.share({ text: text })['catch'](function () { /* partage annulé */ });
  } else {
    copyText(text).then(function () { showToast('Invitation copiée'); }, function () { uiAlert('La copie a échoué.'); });
  }
}

function addContact() {
  uiPrompt('Ajouter un contact', {
    message: 'Demande son code à ton proche : il le trouve dans Partage, sur son téléphone.',
    placeholder: 'Par exemple K7F2-9QX4', okLabel: 'Ajouter'
  }).then(function (answer) {
    if (!answer || !answer.value) return;
    var progress = showProgress('Recherche du contact…');
    return cloudAddContact(answer.value).then(function (contact) {
      progress.close();
      showToast(contact.name + ' ajouté à tes contacts');
      refreshView();
    }, function (err) {
      progress.close();
      uiAlert(cloudErrorText(err));
    });
  });
}

function showContactMenu(contact) {
  var shared = cloudState.myGrants[contact.uid] || [];
  showActions([
    { icon: '📋', label: 'Copier son code', onClick: function () { copyText(contact.code).then(function () { showToast('Code copié'); }); } },
    {
      icon: '🗑️', label: 'Retirer des contacts', danger: true,
      onClick: function () {
        uiConfirm('Retirer ' + contact.name + ' de tes contacts ?' + (shared.length ? ' Il ne verra plus ce que tu lui partages.' : ''), 'Retirer', true).then(function (ok) {
          if (!ok) return;
          return cloudRemoveContact(contact.uid).then(function () { refreshView(); }, function (err) { uiAlert(cloudErrorText(err)); });
        });
      }
    }
  ], contact.name);
}

function showAccountMenu() {
  showActions([
    { icon: '✏️', label: 'Changer mon nom', onClick: renameMe },
    { icon: '🚪', label: 'Se déconnecter', onClick: signOut },
    { icon: '🗑️', label: 'Supprimer mon compte', danger: true, onClick: deleteAccount }
  ], cloudState.profile ? cloudState.profile.name : '');
}

function renameMe() {
  uiPrompt('Changer mon nom', { value: cloudState.profile.name, message: 'Le nom que voient tes proches.', okLabel: 'Enregistrer' }).then(function (answer) {
    if (!answer || !answer.value) return;
    return cloudRename(answer.value).then(function () { refreshView(); }, function (err) { uiAlert(cloudErrorText(err)); });
  });
}

function signOut() {
  uiConfirm('Se déconnecter ? Ce que tes proches partagent avec toi, et les photos venues de tes autres appareils, disparaissent de ce téléphone (tu les retrouveras en te reconnectant). Ce que tu partages reste visible pour eux.', 'Se déconnecter').then(function (ok) {
    if (!ok) return;
    return cloudSignOut().then(function () { refreshView(); });
  });
}

function deleteAccount() {
  uiConfirm('Supprimer ton compte ? Tes contacts et tout ce que tu partages seront effacés du serveur, et tes proches ne verront plus rien. Tes notes, adresses, images et documents restent sur ce téléphone.', 'Supprimer', true)
    .then(function (ok) {
      if (!ok) return null;
      return uiPrompt('Confirme avec ton mot de passe', { okLabel: 'Supprimer le compte', type: 'password' });
    }).then(function (answer) {
      if (!answer || !answer.value) return;
      var progress = showProgress('Suppression du compte…');
      return cloudDeleteAccount(answer.value).then(function () {
        progress.close();
        showToast('Compte supprimé');
        refreshView();
      }, function (err) {
        progress.close();
        uiAlert(cloudErrorText(err));
      });
    });
}

/* ---------- Créer un compte, se connecter ---------- */
defineView('account', {
  el: 'view-account',
  section: 'sharing',
  title: function (params) { return params.mode === 'signup' ? 'Créer un compte' : 'Se connecter'; },
  enter: renderAccountForm
});

function formField(label, input, hint) {
  return [h('label', { className: 'field-label', 'for': input.id }, label), input, hint ? h('p', { className: 'hint', text: hint }) : null];
}

function renderAccountForm(params) {
  var signup = params.mode === 'signup';
  var form = byId('accountForm');
  form.innerHTML = '';
  var name = h('input', { id: 'accName', type: 'text', className: 'text-input', autocomplete: 'given-name', maxlength: '40' });
  var email = h('input', { id: 'accEmail', type: 'email', className: 'text-input', autocomplete: 'email', inputmode: 'email', value: (cloudSession && cloudSession.email) || '' });
  var password = h('input', { id: 'accPassword', type: 'password', className: 'text-input', autocomplete: signup ? 'new-password' : 'current-password' });
  var invite = h('input', { id: 'accInvite', type: 'text', className: 'text-input', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'K7F2-9QX4' });
  var error = h('p', { className: 'form-error', role: 'alert', hidden: true });
  var submit = h('button', { type: 'submit', className: 'primary-btn block-btn', text: signup ? 'Créer mon compte' : 'Se connecter' });
  if (signup) {
    formField('Ton prénom', name, 'Ce que verront tes proches.').forEach(append);
  }
  formField('Adresse e-mail', email, signup ? 'Sert seulement à te connecter : tes proches ne la voient pas.' : null).forEach(append);
  formField('Mot de passe', password, signup ? PASSWORD_MIN + ' caractères minimum.' : null).forEach(append);
  if (signup) {
    formField("Code d'invitation", invite, "Le code d'un proche déjà inscrit (dans son onglet Partage). Seul le tout premier compte n'en a pas besoin.").forEach(append);
  }
  append(error);
  append(submit);
  if (!signup) {
    append(h('button', { type: 'button', className: 'link-btn', text: 'Mot de passe oublié ?', onclick: function () { forgotPassword(email.value); } }));
  }
  function append(node) { if (node) form.appendChild(node); }

  form.onsubmit = function (e) {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = signup ? 'Création du compte…' : 'Connexion…';
    var job = signup
      ? cloudSignUp({ name: name.value, email: email.value, password: password.value, invite: invite.value })
      : cloudSignIn(email.value, password.value);
    job.then(function () {
      password.value = '';
      showToast(signup ? 'Compte créé' : 'Connecté');
      goBack(true);
    }, function (err) {
      error.textContent = cloudErrorText(err);
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = signup ? 'Créer mon compte' : 'Se connecter';
    });
  };
  (signup ? name : email.value ? password : email).focus();
}

function forgotPassword(email) {
  uiPrompt('Mot de passe oublié', { value: email, message: 'Un e-mail te permettra de choisir un nouveau mot de passe.', placeholder: 'Adresse e-mail', okLabel: 'Envoyer' })
    .then(function (answer) {
      if (!answer || !answer.value) return;
      return cloudResetPassword(answer.value).then(function () {
        uiAlert('E-mail envoyé à ' + answer.value + ' (regarde aussi dans les indésirables).');
      }, function (err) { uiAlert(cloudErrorText(err)); });
    });
}

/* ---------- Ce que je partage : une rubrique, et avec qui ---------- */
defineView('share-category', {
  el: 'view-share-category',
  section: 'sharing',
  title: function (params) { return 'Partager : ' + categoryLabel(params.category); },
  enter: renderShareCategory
});

function renderShareCategory(params) {
  var category = params.category;
  var box = byId('shareCategoryContent');
  box.innerHTML = '';
  box.appendChild(h('p', { className: 'hint', text: 'Choisis qui peut voir tes albums photo, avec leurs photos. Tes proches ne peuvent ni les modifier, ni les supprimer.' }));
  if (!cloudState.contacts.length) {
    box.appendChild(h('p', { className: 'empty', text: "Ajoute d'abord un contact avec son code, depuis l'écran Partage." }));
  }
  cloudState.contacts.slice().sort(byName).forEach(function (contact) {
    var checkbox = h('input', { type: 'checkbox', className: 'toggle', 'aria-label': 'Partager avec ' + contact.name });
    checkbox.checked = (cloudState.myGrants[contact.uid] || []).indexOf(category) >= 0;
    checkbox.addEventListener('change', function () {
      var wanted = checkbox.checked;
      shareToggleBusy = true;
      setTogglesDisabled(true);
      cloudSetShare(category, contact.uid, wanted).then(function () {
        showToast(wanted ? 'Partagé avec ' + contact.name : 'Plus partagé avec ' + contact.name);
      }, function (err) {
        checkbox.checked = !wanted;
        uiAlert(cloudErrorText(err));
      }).then(function () {
        shareToggleBusy = false;
        if (currentViewName() === 'share-category') renderShareCategory(params);
      });
    });
    box.appendChild(h('label', { className: 'list-row toggle-row' }, [
      h('span', { className: 'row-icon', text: '👤' }),
      h('span', { className: 'list-row-main' }, [h('span', { className: 'list-row-title', text: contact.name })]),
      checkbox
    ]));
  });
  if (sharedWith(category).length) {
    box.appendChild(h('div', { className: 'card source-card' }, [
      h('p', { className: 'card-text', text: '📱 Tes Images sont les mêmes sur tous les appareils connectés à ton compte : chacun peut en ajouter, les modifier ou en supprimer.' }),
      h('p', { className: 'cloud-status js-cloud-status' })
    ]));
    updateStatusLine();
  }
  box.appendChild(h('p', { className: 'hint', text: "Les photos sont envoyées réduites sur le serveur Firebase (Google), avec leur description ; tes proches peuvent les commenter. Tes autres appareils en reçoivent une copie. Tes autres rubriques restent seulement sur ce téléphone. Arrêter tous les partages efface les photos et leurs commentaires du serveur (chaque appareil garde les siennes)." }));
}

function setTogglesDisabled(disabled) {
  var toggles = document.querySelectorAll('#shareCategoryContent .toggle');
  for (var i = 0; i < toggles.length; i++) toggles[i].disabled = disabled;
}

/* ---------- Ce qu'un proche partage : ses albums ---------- */
function ownerName(owner) {
  var grant = cloudState.grantsToMe.filter(function (g) { return g.owner === owner; })[0];
  return grant ? grant.name : 'Un proche';
}

defineView('shared-albums', {
  el: 'view-shared-albums',
  section: 'sharing',
  title: function (params) { return 'Images de ' + ownerName(params.owner); },
  enter: renderSharedAlbums,
  exit: function () { releaseBlobUrls('sharedAlbums'); }
});

function renderSharedAlbums(params) {
  return Promise.all([dbGetAllByIndex('sharedAlbums', 'owner', params.owner), dbGetAllByIndex('sharedPhotos', 'owner', params.owner), commentStats()]).then(function (r) {
    if (currentViewName() !== 'shared-albums') return;
    releaseBlobUrls('sharedAlbums');
    var byAlbum = {};
    r[1].forEach(function (p) { (byAlbum[p.albumKey] = byAlbum[p.albumKey] || []).push(p); });
    var grid = byId('sharedAlbumGrid');
    grid.innerHTML = '';
    r[0].sort(byName).forEach(function (album) {
      var photos = (byAlbum[album.key] || []).sort(function (a, b) { return (a.takenAt || 0) - (b.takenAt || 0); });
      var unread = photos.reduce(function (sum, p) { return sum + (r[2][p.key] ? r[2][p.key].unread : 0); }, 0);
      grid.appendChild(h('button', { type: 'button', className: 'album-card', onclick: function () { openView('shared-album', { owner: params.owner, album: album.key }); } }, [
        h('span', { className: 'album-cover' }, [
          photos[0]
            ? sharedThumbImage(photos[0], 'sharedAlbums')
            : h('span', { className: 'album-cover-icon', text: album.icon || '🖼️' }),
          albumBadge(unread)
        ]),
        h('span', { className: 'album-name', text: (album.icon ? album.icon + ' ' : '') + album.name }),
        h('span', { className: 'album-count' + (unread ? ' has-unread' : ''), text: plural(photos.length, 'photo', 'photos') + unreadSuffix(unread) })
      ]));
    });
    byId('sharedAlbumsInfo').textContent = sharedInfoText(r[1]);
    showEmpty(byId('sharedAlbumsEmpty'), !r[0].length, cloudStatus.state === 'syncing' ? 'Réception en cours…' : ownerName(params.owner) + " n'a pas encore d'album.");
  });
}

/* Vignette d'une photo reçue ; illisible, elle est relue dans la base (voir healingImage), et au
   dernier essai remplacée par la photo en grand si elle est là. */
function sharedThumbImage(photo, group, lazy) {
  var img = h('img', { src: blobUrl(group, photo.thumb), alt: '', loading: lazy ? 'lazy' : undefined });
  return healingImage(img, group, function (attempt) {
    return dbGet('sharedPhotos', photo.key).then(function (current) {
      if (!current) return null;
      return attempt >= IMAGE_RETRY_DELAYS.length - 1 ? current.blob || current.thumb : current.thumb;
    });
  });
}

/* « 12 photos, dont 3 encore à recevoir » : ce qui est déjà consultable hors connexion. */
function sharedInfoText(photos) {
  var missing = photos.filter(function (p) { return !p.blob; }).length;
  if (!photos.length) return '';
  return missing ? plural(missing, 'photo encore à recevoir', 'photos encore à recevoir') + ' (en taille réelle).' : 'Tout est enregistré sur ce téléphone : consultable hors connexion.';
}

defineView('shared-album', {
  el: 'view-shared-album',
  section: 'sharing',
  title: 'Album',
  enter: renderSharedAlbum,
  exit: function () { releaseBlobUrls('sharedAlbum'); }
});

var sharedAlbumPhotos = [];
var sharedAlbumStats = {};

function renderSharedAlbum(params) {
  return Promise.all([dbGet('sharedAlbums', params.album), dbGetAllByIndex('sharedPhotos', 'albumKey', params.album), commentStats()]).then(function (r) {
    if (currentViewName() !== 'shared-album') return;
    var album = r[0];
    sharedAlbumStats = r[2];
    releaseBlobUrls('sharedAlbum');
    setViewTitle(album ? (album.icon ? album.icon + ' ' : '') + album.name : 'Album');
    sharedAlbumPhotos = album ? r[1].sort(function (a, b) { return (a.takenAt || 0) - (b.takenAt || 0); }) : [];
    var container = byId('sharedPhotoGrid');
    container.innerHTML = '';
    var day = null;
    var grid = null;
    sharedAlbumPhotos.forEach(function (photo, index) {
      var photoDay = new Date(photo.takenAt).toDateString();
      if (photoDay !== day) {
        day = photoDay;
        container.appendChild(h('p', { className: 'photo-day', text: formatDay(photo.takenAt) }));
        grid = container.appendChild(h('div', { className: 'photo-grid' }));
      }
      grid.appendChild(h('button', { type: 'button', className: 'photo-cell', 'aria-label': 'Photo ' + (index + 1), dataset: { index: index } }, [
        sharedThumbImage(photo, 'sharedAlbum', true),
        commentBadge(sharedAlbumStats[photo.key])
      ]));
    });
    var info = byId('sharedAlbumInfo');
    info.textContent = sharedInfoText(sharedAlbumPhotos);
    info.hidden = !info.textContent;
    showEmpty(byId('sharedAlbumEmpty'), !sharedAlbumPhotos.length, album ? 'Album vide.' : "Cet album n'est plus partagé.");
  });
}

byId('sharedPhotoGrid').addEventListener('click', function (e) {
  var cell = e.target.closest('.photo-cell');
  if (!cell) return;
  var photos = sharedAlbumPhotos.slice();
  var index = parseInt(cell.dataset.index, 10);
  openViewer(photos.map(function (p) { return p.blob || p.thumb; }), index, [
    { icon: '↗', label: 'Partager', onClick: function (i) {
      if (photos[i].blob) shareFile(photos[i].blob, photoFileName(photos[i]));
      else showToast('Photo pas encore reçue en taille réelle');
    } }
  ], {
    info: function (i) {
      var stats = sharedAlbumStats[photos[i].key];
      return { caption: photos[i].caption || '', location: photos[i].location || '', label: commentLabel(stats, true, false), unread: stats && stats.unread > 0 };
    },
    open: function (i) { openView('photo', { owner: photos[i].owner, rid: photos[i].rid }); },
    // Photo qui ne s'affiche pas : relue dans la base, puis (celle enregistrée étant sans doute
    // abîmée) téléchargée de nouveau.
    reload: function (i, attempt) {
      return dbGet('sharedPhotos', photos[i].key).then(function (current) {
        if (!current) return null;
        if (attempt >= 1 && current.blob && isSignedIn()) {
          return downloadSharedPhoto(current, true).then(function (blob) {
            photos[i].blob = blob;
            return blob;
          }, function () { return current.thumb; });
        }
        if (current.blob) photos[i].blob = current.blob;
        return current.blob || current.thumb;
      });
    }
  });
  // Photo pas encore reçue (d'après la grille) : celle déjà arrivée, sinon téléchargée tout de
  // suite (la miniature s'affiche en attendant).
  if (!photos[index].blob && isSignedIn()) {
    downloadSharedPhoto(photos[index]).then(function (blob) {
      photos[index].blob = blob;
      viewerReplace(index, blob);
    }, function () { /* hors connexion : la miniature reste */ });
  }
});

/* ---------- Mises à jour venues du serveur ---------- */
onCloudChange(function (what) {
  var view = currentViewName();
  var sharedView = view === 'shared-albums' || view === 'shared-album';
  if (what === 'status') {
    updateStatusLine();
    // Pendant la réception, seul le décompte « encore à recevoir » change ; à la fin, tout est
    // réaffiché une fois.
    if (sharedView) {
      if (cloudStatus.state === 'syncing') scheduleSharedInfo();
      else scheduleSharedRender();
    }
  } else if (what === 'data') {
    if (view === 'sharing') { renderSharing(); renderTopActions(); }
    else if (view === 'share-category' && !shareToggleBusy) renderShareCategory(currentEntry().params);
  } else if (what === 'shared') {
    if (sharedView) scheduleSharedRender();
  } else if (what.indexOf('photo:') === 0) {
    if (sharedView) scheduleSharedInfo();
  }
});

/* Pas plus d'un nouvel affichage par seconde pendant la réception ; pendant qu'une photo est
   affichée, il attend qu'elle soit fermée. */
function scheduleSharedRender() {
  if (sharedRenderTimer) return;
  sharedRenderTimer = setTimeout(function () {
    sharedRenderTimer = null;
    if (!byId('viewer').hidden) {
      scheduleSharedRender();
      return;
    }
    var entry = currentEntry();
    if (entry.name === 'shared-albums') renderSharedAlbums(entry.params);
    else if (entry.name === 'shared-album') renderSharedAlbum(entry.params);
  }, 1000);
}

/* Décompte des photos encore à recevoir en taille réelle, sans refaire la grille. */
function scheduleSharedInfo() {
  if (sharedInfoTimer) return;
  sharedInfoTimer = setTimeout(function () {
    sharedInfoTimer = null;
    var entry = currentEntry();
    if (entry.name === 'shared-album') {
      dbGetAllByIndex('sharedPhotos', 'albumKey', entry.params.album).then(function (photos) {
        if (currentEntry() !== entry || !sharedAlbumPhotos.length) return;
        var info = byId('sharedAlbumInfo');
        info.textContent = sharedInfoText(photos);
        info.hidden = !info.textContent;
      });
    } else if (entry.name === 'shared-albums') {
      dbGetAllByIndex('sharedPhotos', 'owner', entry.params.owner).then(function (photos) {
        if (currentEntry() === entry) byId('sharedAlbumsInfo').textContent = sharedInfoText(photos);
      });
    }
  }, 1000);
}
