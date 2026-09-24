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
    openViewer(images.map(function (a) { return a.blob; }), images.indexOf(att));
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

function sendToAndroid(blob, name, action, onProgress) {
  var bridge = window.AndroidBridge;
  var id = bridge.fileBegin(safeFileName(name), blob.type || guessType(name));
  var offset = 0;
  function next() {
    if (offset >= blob.size) {
      bridge.fileFinish(id, action);
      return Promise.resolve();
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
var SHARE_LABELS = { open: 'Ouvrir', share: 'Partager', save: 'Enregistrer' };

function shareableFile(blob, name) {
  if (!navigator.share || !navigator.canShare || typeof File !== 'function') return null;
  var file = new File([blob], safeFileName(name), { type: blob.type || guessType(name) });
  return navigator.canShare({ files: [file] }) ? file : null;
}

/* La feuille de partage ne s'ouvre qu'en réponse directe à un toucher : si la préparation du
   fichier a été trop longue (sauvegarde volumineuse...), il faut toucher une seconde fois. */
function shareWithSheet(file, action) {
  function share() {
    return navigator.share({ files: [file] });
  }
  return share()['catch'](function (err) {
    if (!err || err.name !== 'NotAllowedError') throw err;
    return showDialog('« ' + file.name + ' » est prêt.', { cancelable: true, okLabel: SHARE_LABELS[action], onConfirm: share });
  })['catch'](function (err) {
    if (!err || err.name !== 'AbortError') throw err; // AbortError : feuille de partage fermée sans rien choisir
  });
}

function browserHandOver(blob, name, action) {
  var file = TOUCH_DEVICE || action === 'share' ? shareableFile(blob, name) : null;
  if (file) return shareWithSheet(file, action);
  var url = URL.createObjectURL(blob);
  if (action === 'open') {
    window.open(url, '_blank');
  } else {
    var link = h('a', { href: url, download: safeFileName(name) });
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  return Promise.resolve();
}

/* action : 'open' (ouvrir), 'share' (partager) ou 'save' (enregistrer sous). */
function handOverFile(blob, name, action, onProgress) {
  if (!window.AndroidBridge) return browserHandOver(blob, name, action);
  var progress = !onProgress && blob.size > 4 * 1024 * 1024 ? showProgress('Préparation du fichier…') : null;
  return sendToAndroid(blob, name, action, onProgress || (progress && function (f) { progress.update(null, f); }))
    .then(function () { if (progress) progress.close(); }, function (err) {
      if (progress) progress.close();
      throw err;
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
