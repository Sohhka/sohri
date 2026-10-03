/* ---------- Fichiers : photos, pièces jointes, échanges avec Android ---------- */
var NOTE_PHOTO_SIZE = 1600;           // côté le plus long des photos d'une note, en pixels
var ALBUM_PHOTO_SIZE = 2048;          // côté le plus long des photos d'un album
var THUMB_SIZE = 400;                 // miniatures des albums
var JPEG_QUALITY = 0.85;
var KEEP_ORIGINAL_BELOW = 600 * 1024; // une image déjà légère est gardée telle quelle
var MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
var TRANSFER_CHUNK = 1536 * 1024;     // morceaux envoyés à Android (1,5 Mo)
var VIEWABLE_IMAGE = /^image\/(jpeg|png|gif|webp|avif|bmp)$/;
var MIME_BY_EXTENSION = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime'
};

function fileExtension(name) {
  var match = /\.([a-z0-9]+)$/i.exec(name || '');
  return match ? match[1].toLowerCase() : '';
}

function guessType(name) {
  return MIME_BY_EXTENSION[fileExtension(name)] || 'application/octet-stream';
}

/* « PDF », « JPG », « MP4 »... pour les listes de fichiers. */
function fileTypeLabel(type, name) {
  var ext = fileExtension(name);
  if (ext) return ext.toUpperCase();
  var subtype = (type || '').split('/')[1];
  return subtype && subtype !== 'octet-stream' ? subtype.toUpperCase() : 'Fichier';
}

/* Nom de fichier sans caractères interdits sur Android ou Windows. */
function safeFileName(name, fallback) {
  var cleaned = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100);
  return cleaned || fallback || 'fichier';
}

function fileIcon(type, name) {
  type = type || guessType(name);
  if (type.indexOf('image/') === 0) return '🖼️';
  if (type === 'application/pdf') return '📄';
  if (type.indexOf('audio/') === 0) return '🎵';
  if (type.indexOf('video/') === 0) return '🎬';
  if (/zip|compressed/.test(type)) return '🗜️';
  if (type.indexOf('text/') === 0) return '📃';
  return '📎';
}

/* Copie en mémoire d'un fichier choisi : ne dépend plus du fichier d'origine (qui peut devenir
   illisible pour l'appli une fois le sélecteur de fichiers fermé). */
function copyFile(file) {
  return file.arrayBuffer().then(function (data) {
    return new Blob([data], { type: file.type || guessType(file.name) });
  });
}

function loadImage(blob) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible : ' + (blob.name || '')));
    };
    img.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (blob) {
      if (blob) resolve(blob);
      else reject(new Error('Conversion impossible'));
    }, 'image/jpeg', quality);
  });
}

/* Dessine l'image (ou l'image d'une vidéo) en JPEG, côté le plus long ≤ maxSize : { blob, width, height }. */
function drawJpeg(img, maxSize, quality) {
  var width = img.naturalWidth || img.videoWidth;
  var height = img.naturalHeight || img.videoHeight;
  var scale = Math.min(1, maxSize / Math.max(width, height));
  var canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; // fond blanc sous les zones transparentes (le JPEG n'en a pas)
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToJpeg(canvas, quality).then(function (blob) {
    return { blob: blob, width: canvas.width, height: canvas.height };
  });
}

/* Photo d'une note : réduite (les photos d'un téléphone pèsent plusieurs Mo), ou copiée telle
   quelle si elle est déjà légère. */
function shrinkImage(file) {
  return loadImage(file).then(function (img) {
    if (Math.max(img.naturalWidth, img.naturalHeight) <= NOTE_PHOTO_SIZE && file.size <= KEEP_ORIGINAL_BELOW) return copyFile(file);
    return drawJpeg(img, NOTE_PHOTO_SIZE, JPEG_QUALITY).then(function (result) { return result.blob; });
  });
}

/* Photo d'un album : image réduite, miniature et date de prise de vue. */
function preparePhoto(file) {
  return readExifDate(file).then(function (takenAt) {
    return loadImage(file).then(function (img) {
      return Promise.all([drawJpeg(img, ALBUM_PHOTO_SIZE, JPEG_QUALITY), drawJpeg(img, THUMB_SIZE, 0.8)]).then(function (r) {
        return {
          blob: r[0].blob, thumb: r[1].blob, width: r[0].width, height: r[0].height,
          name: file.name || '', takenAt: takenAt || file.lastModified || Date.now()
        };
      });
    });
  });
}

/* Date de prise de vue (EXIF DateTimeOriginal) d'une photo JPEG, ou null. */
function readExifDate(file) {
  return file.slice(0, 256 * 1024).arrayBuffer().then(function (buffer) {
    var view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return null;
    var offset = 2;
    while (offset + 10 < view.byteLength) {
      var marker = view.getUint16(offset);
      if ((marker & 0xFF00) !== 0xFF00) return null;
      if (marker === 0xFFE1 && view.getUint32(offset + 4) === 0x45786966) return exifDate(view, offset + 10);
      offset += 2 + view.getUint16(offset + 2);
    }
    return null;
  }).catch(function () { return null; });
}

function exifDate(view, tiff) {
  var little = view.getUint16(tiff) === 0x4949;
  function u16(pos) { return view.getUint16(tiff + pos, little); }
  function u32(pos) { return view.getUint32(tiff + pos, little); }
  function findTag(ifd, tag) {
    var count = u16(ifd);
    for (var i = 0; i < count; i++) {
      if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
    }
    return -1;
  }
  var ifd0 = u32(4);
  var entry = -1;
  var exifPointer = findTag(ifd0, 0x8769);
  if (exifPointer >= 0) entry = findTag(u32(exifPointer + 8), 0x9003); // DateTimeOriginal
  if (entry < 0) entry = findTag(ifd0, 0x0132);                         // DateTime
  if (entry < 0) return null;
  var text = '';
  for (var i = 0; i < 19; i++) text += String.fromCharCode(view.getUint8(tiff + u32(entry + 8) + i));
  var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

/* ---------- Pièces jointes ---------- */
function makeAttachment(file) {
  if (file.size > MAX_ATTACHMENT_SIZE) return Promise.reject(new Error('trop volumineux'));
  return copyFile(file).then(function (blob) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: file.name || 'fichier', type: blob.type, size: file.size, blob: blob
    };
  });
}

/* Ajoute des fichiers choisis à une liste de pièces jointes (un par un), puis appelle done(). */
function addAttachments(files, list, done) {
  var refused = [];
  files.reduce(function (chain, file) {
    return chain.then(function () {
      return makeAttachment(file).then(function (att) { list.push(att); }, function () { refused.push(file.name); });
    });
  }, Promise.resolve()).then(function () {
    done();
    if (refused.length) uiAlert('Fichier trop volumineux (50 Mo maximum) : ' + refused.join(', '));
  });
}

function isViewableImage(att) {
  return VIEWABLE_IMAGE.test(att.type || '');
}

/* Images : visionneuse photo (on passe de l'une à l'autre) ; autres fichiers : visionneuse de
   documents (PDF, vidéo, texte...), qui propose une autre appli pour les formats inconnus. */
function openAttachment(att, list) {
  if (isViewableImage(att)) {
    var images = list.filter(isViewableImage);
    openViewer(images.map(function (a) { return a.blob; }), images.indexOf(att), imageFileActions(function (i) {
      return { blob: images[i].blob, name: images[i].name };
    }));
  } else {
    openDocument(att);
  }
}

function attachmentRow(att, children, onclick) {
  return h('div', { className: 'attachment', onclick: onclick }, [
    h('span', { className: 'attachment-icon', text: fileIcon(att.type, att.name) }),
    h('span', { className: 'attachment-main' }, [
      h('span', { className: 'attachment-name', text: att.name }),
      h('span', { className: 'attachment-size', text: formatSize(att.size) })
    ])
  ].concat(children));
}

/* Liste modifiable (formulaire) : bouton × pour retirer. */
function renderAttachmentEditor(container, list) {
  container.innerHTML = '';
  list.forEach(function (att, index) {
    container.appendChild(attachmentRow(att, [h('button', {
      type: 'button', className: 'icon-btn', 'aria-label': 'Retirer ' + att.name, text: '×',
      onclick: function () {
        list.splice(index, 1);
        renderAttachmentEditor(container, list);
      }
    })]));
  });
}

/* Liste consultable (fiche) : toucher pour ouvrir, ↗ pour partager. */
function renderAttachmentList(list) {
  return h('div', { className: 'attachments' }, list.map(function (att) {
    return attachmentRow(att, [h('button', {
      type: 'button', className: 'icon-btn', 'aria-label': 'Partager ' + att.name, title: 'Partager', text: '↗',
      onclick: function (e) {
        e.stopPropagation();
        shareFile(att.blob, att.name);
      }
    })], function () { openAttachment(att, list); });
  }));
}

/* ---------- Transmission d'un fichier à Android ----------
   La page ne peut ni ouvrir un PDF ni enregistrer un fichier elle-même : elle l'envoie à Android
   (en morceaux, encodés en base64), qui l'ouvre, le partage ou propose de l'enregistrer. */
function readBase64(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result.slice(reader.result.indexOf(',') + 1)); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsDataURL(blob);
  });
}

/* Promesse de l'identifiant du transfert (voir onGallerySaved). */
function sendToAndroid(blob, name, action, onProgress) {
  var bridge = window.AndroidBridge;
  var id = bridge.fileBegin(safeFileName(name), blob.type || guessType(name));
  var offset = 0;
  function next() {
    if (offset >= blob.size) {
      bridge.fileFinish(id, action);
      return Promise.resolve(id);
    }
    return readBase64(blob.slice(offset, offset + TRANSFER_CHUNK)).then(function (chunk) {
      bridge.fileAppend(id, chunk);
      offset += TRANSFER_CHUNK;
      if (onProgress) onProgress(Math.min(1, offset / blob.size));
      return next();
    });
  }
  return next();
}

/* ---------- Dans un navigateur (iPhone...) ----------
   Sur un téléphone, le fichier passe par la feuille de partage du système, qui propose de
   l'enregistrer (« Enregistrer dans Fichiers »), de l'ouvrir dans une autre appli ou de l'envoyer.
   Sur un ordinateur : ouverture dans un onglet, ou téléchargement. */
var TOUCH_DEVICE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
var SHARE_LABELS = { open: 'Ouvrir', share: 'Partager', save: 'Enregistrer', gallery: 'Enregistrer' };

function shareableFile(blob, name) {
  if (!navigator.share || !navigator.canShare || typeof File !== 'function') return null;
  var file = new File([blob], safeFileName(name), { type: blob.type || guessType(name) });
  return navigator.canShare({ files: [file] }) ? file : null;
}

/* La feuille de partage ne s'ouvre qu'en réponse directe à un toucher : si la préparation du
   fichier a été trop longue (sauvegarde volumineuse...), il faut toucher une seconde fois.
   Promesse : true si un choix y a été fait (Enregistrer dans Fichiers...), false si elle a été fermée. */
function shareWithSheet(file, action) {
  function share() {
    return navigator.share({ files: [file] }).then(function () { return true; });
  }
  return share()['catch'](function (err) {
    if (!err || err.name !== 'NotAllowedError') throw err;
    return showDialog('« ' + file.name + ' » est prêt.', { cancelable: true, okLabel: SHARE_LABELS[action], onConfirm: share })
      .then(function (done) { return done === true; });
  })['catch'](function (err) {
    if (!err || err.name !== 'AbortError') throw err; // AbortError : feuille de partage fermée sans rien choisir
    return false;
  });
}

function browserHandOver(blob, name, action) {
  var file = TOUCH_DEVICE || action === 'share' ? shareableFile(blob, name) : null;
  if (file) return shareWithSheet(file, action);
  if (action === 'open') {
    var url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  } else {
    downloadFile(blob, name);
  }
  return Promise.resolve(true);
}

/* Téléchargement classique (dossier Téléchargements). */
function downloadFile(blob, name) {
  var url = URL.createObjectURL(blob);
  var link = h('a', { href: url, download: safeFileName(name) });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

/* action : 'open' (ouvrir), 'share' (partager) ou 'save' (enregistrer sous). Promesse : dans un
   navigateur, false si la feuille de partage a été fermée sans rien choisir ; sur Android,
   l'identifiant du transfert (voir whenAndroidSaved). */
function handOverFile(blob, name, action, onProgress) {
  if (!window.AndroidBridge) return browserHandOver(blob, name, action);
  var progress = !onProgress && blob.size > 4 * 1024 * 1024 ? showProgress('Préparation du fichier…') : null;
  return sendToAndroid(blob, name, action, onProgress || (progress && function (f) { progress.update(null, f); }))
    .then(function (id) {
      if (progress) progress.close();
      return id;
    }, function (err) {
      if (progress) progress.close();
      throw err;
    });
}

/* « Enregistrer sous » sur Android : réponse une fois l'emplacement choisi et le fichier copié, ou
   la fenêtre fermée (MainActivity.reportSaved). Promesse de true si le fichier est enregistré. */
var saveWaits = {};
var saveEarly = {};
window.onFileSaved = function (id, ok) {
  if (saveWaits[id]) {
    saveWaits[id](!!ok);
    delete saveWaits[id];
  } else {
    saveEarly[id] = !!ok;
  }
};

function whenAndroidSaved(id) {
  return new Promise(function (resolve) {
    if (id in saveEarly) {
      resolve(saveEarly[id]);
      delete saveEarly[id];
      return;
    }
    saveWaits[id] = resolve; // (rien si l'appli a été fermée entre-temps)
  });
}

function openFile(blob, name) {
  return handOverFile(blob, name, 'open').catch(function (err) {
    console.error(err);
    uiAlert("Le fichier n'a pas pu être ouvert.");
  });
}

function shareFile(blob, name) {
  return handOverFile(blob, name, 'share').catch(function (err) {
    console.error(err);
    uiAlert("Le fichier n'a pas pu être partagé.");
  });
}

function saveFile(blob, name, onProgress) {
  return handOverFile(blob, name, 'save', onProgress);
}

/* Texte à envoyer par message (WhatsApp, SMS, e-mail...) : feuille de partage du téléphone, sinon
   copié. Sur l'iPhone, si l'attente a été trop longue, un toucher de plus est demandé. */
function shareText(text, title) {
  if (window.AndroidBridge && window.AndroidBridge.shareText) {
    window.AndroidBridge.shareText(text);
    return Promise.resolve();
  }
  if (navigator.share) {
    var share = function () { return navigator.share({ title: title, text: text }); };
    return share()['catch'](function (err) {
      if (!err || err.name !== 'NotAllowedError') throw err;
      return showDialog((title || 'Le texte') + ' est prêt.', { cancelable: true, okLabel: 'Envoyer', onConfirm: share });
    })['catch'](function (err) {
      if (!err || err.name !== 'AbortError') throw err; // feuille de partage fermée sans rien choisir
    });
  }
  return copyText(text).then(function () { showToast('Copié : colle-le dans un message.'); });
}

/* ---------- Télécharger des photos dans la galerie du téléphone ----------
   Appli Android : copiées directement dans la galerie (album « SOHRI »), une à une, Android
   répondant pour chacune (onGallerySaved). iPhone : une appli web ne peut pas écrire dans Photos ;
   la feuille de partage s'ouvre, et « Enregistrer l'image » (ou « Enregistrer 12 images ») les y
   met (expliqué la première fois). Ailleurs (ordinateur...) : fichiers téléchargés. */
var GALLERY_HINT_PREF = 'galleryHintSeen';
var IOS_SHARE_BATCH = 20; // photos par feuille de partage, au plus
var DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11.5"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>';

/* Réponse d'Android pour une photo (MainActivity.reportGallery) : { ok, reason }. */
var galleryWaits = {};
var galleryEarly = {};
window.onGallerySaved = function (id, ok, reason) {
  var result = { ok: !!ok, reason: reason || '' };
  if (galleryWaits[id]) {
    galleryWaits[id](result);
    delete galleryWaits[id];
  } else {
    galleryEarly[id] = result;
  }
};

function androidGallerySave(file) {
  return sendToAndroid(file.blob, file.name, 'gallery').then(function (id) {
    return new Promise(function (resolve) {
      if (galleryEarly[id]) {
        resolve(galleryEarly[id]);
        delete galleryEarly[id];
        return;
      }
      galleryWaits[id] = resolve;
      setTimeout(function () {
        if (!galleryWaits[id]) return;
        delete galleryWaits[id];
        resolve({ ok: false, reason: 'timeout' });
      }, 300000); // le temps de répondre à la demande d'autorisation (Android 8 et 9)
    });
  });
}

function galleryRefused(reason) {
  uiAlert(reason === 'permission'
    ? "Android n'a pas autorisé SOHRI à enregistrer des photos. Pour changer d'avis : Paramètres d'Android → Applis → SOHRI → Autorisations."
    : "La photo n'a pas pu être enregistrée dans la galerie.");
}

function saveToGallery(blob, name) {
  return saveManyToGallery([{ blob: blob, name: name }]);
}

/* files : [{ blob, name }]. */
function saveManyToGallery(files) {
  if (!files.length) return Promise.resolve();
  var many = files.length > 1;
  var failed = function (err) {
    console.error(err);
    uiAlert(many ? "Les photos n'ont pas pu être enregistrées." : "La photo n'a pas pu être enregistrée.");
  };
  if (window.AndroidBridge) {
    var progress = many ? showProgress('Enregistrement dans la galerie…') : null;
    var saved = 0;
    var refused = null;
    return files.reduce(function (chain, file, i) {
      return chain.then(function () {
        if (refused === 'permission') return null; // inutile d'insister
        if (progress) progress.update('Enregistrement dans la galerie (' + (i + 1) + ' / ' + files.length + ')…', i / files.length);
        return androidGallerySave(file).then(function (result) {
          if (result.ok) saved++;
          else refused = refused || result.reason;
        });
      });
    }, Promise.resolve()).then(function () {
      if (progress) progress.close();
      if (saved === files.length) {
        showToast((many ? plural(saved, 'photo enregistrée', 'photos enregistrées') : 'Photo enregistrée') + ' dans la galerie (album SOHRI)');
      } else if (saved) {
        uiAlert(plural(saved, 'photo enregistrée', 'photos enregistrées') + ' dans la galerie sur ' + files.length + " : les autres n'ont pas pu l'être.");
      } else {
        galleryRefused(refused);
      }
    }, function (err) {
      if (progress) progress.close();
      failed(err);
    });
  }
  var all = IS_IOS && navigator.share && navigator.canShare && typeof File === 'function'
    ? files.map(function (f) { return new File([f.blob], safeFileName(f.name), { type: f.blob.type || guessType(f.name) }); })
    : null;
  if (all && navigator.canShare({ files: all.slice(0, IOS_SHARE_BATCH) })) {
    var batches = [];
    for (var b = 0; b < all.length; b += IOS_SHARE_BATCH) batches.push(all.slice(b, b + IOS_SHARE_BATCH));
    // Une feuille de partage par groupe ; le suivant attend un toucher (exigé par l'iPhone).
    var shareBatch = function (index) {
      var again = function (text) {
        return showDialog(text, { cancelable: true, okLabel: 'Enregistrer', onConfirm: function () { return shareBatch(index); } });
      };
      return navigator.share({ files: batches[index] }).then(function () {
        if (index + 1 >= batches.length) return null;
        var from = (index + 1) * IOS_SHARE_BATCH + 1;
        return showDialog('Photos ' + from + ' à ' + Math.min(all.length, from + IOS_SHARE_BATCH - 1) + ' (sur ' + all.length + ') prêtes.', {
          cancelable: true, okLabel: 'Enregistrer', onConfirm: function () { return shareBatch(index + 1); }
        });
      }, function (err) {
        if (err && err.name === 'NotAllowedError') return again(many ? 'Les photos sont prêtes.' : '« ' + batches[index][0].name + ' » est prête.');
        if (!err || err.name !== 'AbortError') throw err; // feuille fermée sans rien choisir : on s'arrête
      });
    };
    var start = function () { return shareBatch(0); };
    if (readPref(GALLERY_HINT_PREF)) return start().then(null, failed);
    writePref(GALLERY_HINT_PREF, true);
    return showDialog(many
      ? "Dans le menu qui s'ouvre, touche « Enregistrer " + Math.min(all.length, IOS_SHARE_BATCH) + " images » : les photos iront dans l'app Photos."
      : "Dans le menu qui s'ouvre, touche « Enregistrer l'image » : la photo ira dans l'app Photos.", {
      title: many ? 'Télécharger les photos' : 'Télécharger la photo', cancelable: true, okLabel: 'Continuer', onConfirm: start
    }).then(null, failed);
  }
  files.forEach(function (f, i) {
    setTimeout(function () { downloadFile(f.blob, f.name); }, i * 400); // un à un : le navigateur suit
  });
  showToast(many ? plural(files.length, 'photo téléchargée', 'photos téléchargées') : 'Photo téléchargée');
  return Promise.resolve();
}

/* Boutons « Télécharger » et « Partager » de la visionneuse de photos. file(index) : { blob, name },
   sa promesse (photo à télécharger d'abord), ou null s'il n'y a rien à faire. Avec la photo déjà là,
   l'action part tout de suite : sur iPhone, la feuille de partage ne s'ouvre qu'en réponse directe
   à un toucher. */
function imageFileActions(file) {
  var withFile = function (index, use) {
    var found = file(index);
    if (found && typeof found.then === 'function') found.then(function (f) { if (f) use(f); });
    else if (found) use(found);
  };
  return [
    { svg: DOWNLOAD_ICON, label: 'Télécharger', onClick: function (i) { withFile(i, function (f) { saveToGallery(f.blob, f.name); }); } },
    { icon: '↗', label: 'Partager', onClick: function (i) { withFile(i, function (f) { shareFile(f.blob, f.name); }); } }
  ];
}

/* Photo d'une note (Blob, ou texte « data: » pour de très anciennes notes) : { blob, name }, ou sa
   promesse. */
function imageFile(image, baseName) {
  var named = function (blob) { return { blob: blob, name: baseName + '.' + extensionFor(blob.type) }; };
  if (image instanceof Blob) return named(image);
  return fetch(image).then(function (response) { return response.blob(); }).then(named);
}

function extensionFor(type) {
  return Object.keys(MIME_BY_EXTENSION).filter(function (ext) { return MIME_BY_EXTENSION[ext] === type; })[0] || 'jpg';
}
