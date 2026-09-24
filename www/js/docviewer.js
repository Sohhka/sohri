/* ---------- Visionneuse de documents ----------
   Affiche un fichier dans l'appli : PDF (avec pdf.js, dans js/vendor/pdfjs), image, vidéo, son,
   texte et markdown. Les autres formats (Word, Excel...) proposent une autre appli du téléphone. */
var PDFJS_DIR = 'js/vendor/pdfjs/';
var TEXT_PREVIEW_MAX = 2 * 1024 * 1024;  // texte affiché au plus (2 Mo)
var PDF_THUMB_MAX_SIZE = 40 * 1024 * 1024;
var PDF_MAX_CANVAS_PIXELS = 16 * 1000 * 1000; // taille maximale d'une page dessinée (mémoire)
var DOC_MAX_ZOOM = 4;
var DOC_ZOOM_STEPS = [1, 1.5, 2, 3, 4];
var IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];
var VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', '3gp', 'mkv'];
var AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'];
var TEXT_EXTENSIONS = ['txt', 'csv', 'json', 'log', 'xml', 'ics', 'vcf', 'gpx'];

var pdfjsPromise = null;
var pdfRenderTimer = null;
var docViewer = { doc: null, kind: null, actions: [], pdf: null, pages: [], observer: null, image: null, zoom: 1, session: 0 };
var docGesture = { pinch: null, start: null, lastTap: null, lastTouch: 0 };

function documentKind(type, name) {
  var ext = fileExtension(name);
  type = (type || '').toLowerCase();
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (VIEWABLE_IMAGE.test(type) || type === 'image/svg+xml' || IMAGE_EXTENSIONS.indexOf(ext) >= 0) return 'image';
  if (type.indexOf('video/') === 0 || VIDEO_EXTENSIONS.indexOf(ext) >= 0) return 'video';
  if (type.indexOf('audio/') === 0 || AUDIO_EXTENSIONS.indexOf(ext) >= 0) return 'audio';
  if (type === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown';
  if (type.indexOf('text/') === 0 || type === 'application/json' || TEXT_EXTENSIONS.indexOf(ext) >= 0) return 'text';
  return 'other';
}

/* ---------- pdf.js, chargé seulement au premier PDF ---------- */
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./vendor/pdfjs/pdf.min.mjs').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_DIR + 'pdf.worker.min.mjs', document.baseURI).href;
      return { lib: lib, worker: new lib.PDFWorker() }; // un seul worker, partagé par tous les PDF
    });
    pdfjsPromise['catch'](function () { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

/* Libère un PDF ouvert (le worker partagé reste disponible pour le suivant). */
function closePdf(pdf) {
  pdf.loadingTask.destroy();
}

function openPdf(blob) {
  return Promise.all([loadPdfJs(), blob.arrayBuffer()]).then(function (results) {
    var base = new URL(PDFJS_DIR, document.baseURI).href;
    return results[0].lib.getDocument({
      data: new Uint8Array(results[1]),
      worker: results[0].worker,
      cMapUrl: base + 'cmaps/',       // polices asiatiques (japonais...) non incluses dans le PDF
      cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/',
      wasmUrl: base + 'wasm/',
      iccUrl: base + 'iccs/',
      useWorkerFetch: false,          // ces fichiers sont lus par la page : hors connexion, la copie locale est utilisée
      enableXfa: false
    }).promise;
  });
}

/* ---------- Ouverture et fermeture ---------- */
/* doc : { name, type, size, blob } ; options.actions : actions ajoutées au menu ⋮ (renommer...). */
function openDocument(doc, options) {
  resetDocumentViewer();
  var session = docViewer.session;
  var kind = documentKind(doc.type, doc.name);
  docViewer.doc = doc;
  docViewer.kind = kind;
  docViewer.actions = (options && options.actions) || [];
  byId('docName').textContent = doc.name;
  byId('docInfo').textContent = fileTypeLabel(doc.type, doc.name) + ' · ' + formatSize(doc.size || doc.blob.size);
  byId('docViewer').className = 'doc-viewer kind-' + kind;
  byId('docViewer').hidden = false;
  if (kind === 'pdf') showPdfDocument(doc, session);
  else if (kind === 'image') showImageDocument(doc, session);
  else if (kind === 'video' || kind === 'audio') showMediaDocument(doc, kind, session);
  else if (kind === 'text' || kind === 'markdown') showTextDocument(doc, kind, session);
  else byId('docBody').appendChild(unsupportedDocument(doc));
}

function resetDocumentViewer() {
  docViewer.session++;
  clearTimeout(pdfRenderTimer);
  if (docViewer.observer) docViewer.observer.disconnect();
  docViewer.pages.forEach(releasePdfPage);
  if (docViewer.pdf) closePdf(docViewer.pdf);
  var media = byId('docBody').querySelector('video, audio');
  if (media) {
    media.pause();
    media.removeAttribute('src');
    media.load();
  }
  docViewer.doc = null;
  docViewer.pdf = null;
  docViewer.pages = [];
  docViewer.observer = null;
  docViewer.image = null;
  docViewer.zoom = 1;
  byId('docBody').innerHTML = '';
  byId('docPage').hidden = true;
  byId('docZoom').hidden = true;
  releaseBlobUrls('document');
}

function closeDocument() {
  resetDocumentViewer();
  byId('docViewer').hidden = true;
}

function isDocumentOpen() {
  return !byId('docViewer').hidden;
}

/* Remplace le contenu par un message (fichier illisible...) et ses boutons de secours. */
function showDocumentProblem(doc, session, message) {
  if (session !== docViewer.session) return;
  byId('docBody').innerHTML = '';
  byId('docZoom').hidden = true;
  byId('docPage').hidden = true;
  byId('docBody').appendChild(unsupportedDocument(doc, message));
}

function unsupportedDocument(doc, message) {
  return h('div', { className: 'doc-card' }, [
    h('span', { className: 'doc-card-icon', text: fileIcon(doc.type, doc.name) }),
    h('p', { className: 'doc-card-name', text: doc.name }),
    h('p', { className: 'hint', text: message || "Ce type de fichier ne peut pas être affiché dans l'appli." }),
    h('button', { type: 'button', className: 'primary-btn', text: 'Ouvrir avec une autre appli', onclick: function () { openFile(doc.blob, doc.name); } }),
    h('button', { type: 'button', className: 'ghost-btn', text: 'Partager', onclick: function () { shareFile(doc.blob, doc.name); } })
  ]);
}

byId('docCloseBtn').addEventListener('click', closeDocument);
byId('docShareBtn').addEventListener('click', function () {
  if (docViewer.doc) shareFile(docViewer.doc.blob, docViewer.doc.name);
});
byId('docMenuBtn').addEventListener('click', function () {
  var doc = docViewer.doc;
  if (!doc) return;
  showActions([
    { icon: '📲', label: 'Ouvrir avec une autre appli', onClick: function () { openFile(doc.blob, doc.name); } },
    {
      icon: '💾', label: 'Enregistrer sous…',
      onClick: function () {
        saveFile(doc.blob, doc.name).catch(function (err) {
          console.error(err);
          uiAlert("Le fichier n'a pas pu être enregistré.");
        });
      }
    }
  ].concat(docViewer.actions), doc.name);
});

/* ---------- PDF ---------- */
function showPdfDocument(doc, session) {
  var body = byId('docBody');
  body.appendChild(h('p', { className: 'doc-loading', text: 'Ouverture du PDF…' }));
  openPdf(doc.blob).then(function (pdf) {
    if (session !== docViewer.session) {
      closePdf(pdf);
      return null;
    }
    docViewer.pdf = pdf;
    return pdf.getPage(1).then(function (first) {
      if (session !== docViewer.session) return;
      var size = first.getViewport({ scale: 1 });
      var container = h('div', { className: 'pdf-pages' });
      for (var n = 1; n <= pdf.numPages; n++) {
        docViewer.pages.push({
          number: n, ratio: size.height / size.width, canvas: null, task: null, zoom: 0, visible: false,
          el: container.appendChild(h('div', { className: 'pdf-page', dataset: { page: n } }))
        });
      }
      body.innerHTML = '';
      body.appendChild(container);
      layoutDocument();
      updatePdfPageIndicator();
      byId('docPage').hidden = pdf.numPages < 2;
      byId('docZoom').hidden = false;
      updateZoomButtons();
      // Pages dessinées à l'approche de l'écran (une hauteur d'écran d'avance), libérées ensuite.
      docViewer.observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          docViewer.pages[entry.target.dataset.page - 1].visible = entry.isIntersecting;
        });
        schedulePdfRender();
      }, { root: body, rootMargin: '100% 0px' });
      docViewer.pages.forEach(function (page) { docViewer.observer.observe(page.el); });
    });
  })['catch'](function (err) {
    console.warn('PDF illisible : ' + doc.name, err);
    showDocumentProblem(doc, session, err && err.name === 'PasswordException'
      ? "Ce PDF est protégé par un mot de passe : il ne peut pas être affiché dans l'appli."
      : "Ce PDF n'a pas pu être affiché dans l'appli.");
  });
}

function schedulePdfRender() {
  clearTimeout(pdfRenderTimer);
  pdfRenderTimer = setTimeout(renderPdfPages, 80);
}

/* Dessine les pages visibles à la résolution du zoom actuel ; libère les autres. */
function renderPdfPages() {
  if (!docViewer.pdf) return;
  docViewer.pages.forEach(function (page) {
    if (!page.visible) releasePdfPage(page);
    else if (!page.task && page.zoom !== docViewer.zoom) renderPdfPage(page, docViewer.session);
  });
}

function releasePdfPage(page) {
  if (page.task) page.task.cancel();
  page.task = null;
  if (page.canvas) {
    page.canvas.width = 0;
    page.canvas.height = 0;
    page.canvas.remove();
    page.canvas = null;
  }
  page.zoom = 0;
}

function renderPdfPage(page, session) {
  var zoom = docViewer.zoom;
  var pending = { cancel: function () {} }; // réserve la page : pas deux rendus en même temps
  page.task = pending;
  docViewer.pdf.getPage(page.number).then(function (pdfPage) {
    if (session !== docViewer.session || page.task !== pending) return null;
    var size = pdfPage.getViewport({ scale: 1 });
    if (Math.abs(page.ratio - size.height / size.width) > 0.001) {
      page.ratio = size.height / size.width; // page de format différent de la première
      layoutDocument();
    }
    var scale = page.el.clientWidth * Math.min(window.devicePixelRatio || 1, 2) / size.width;
    scale = Math.min(scale, Math.sqrt(PDF_MAX_CANVAS_PIXELS / (size.width * size.height)));
    var viewport = pdfPage.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    var task = pdfPage.render({ canvas: canvas, viewport: viewport });
    page.task = task;
    return task.promise.then(function () {
      if (page.task !== task) return;
      page.task = null;
      if (page.canvas) {
        page.canvas.width = 0;
        page.canvas.remove();
      }
      page.canvas = canvas;
      page.zoom = zoom;
      page.el.appendChild(canvas);
      if (zoom !== docViewer.zoom) schedulePdfRender(); // zoom changé pendant le dessin
    });
  })['catch'](function (err) {
    if (page.task === pending) page.task = null;
    if (!err || err.name !== 'RenderingCancelledException') console.error(err);
  });
}

function updatePdfPageIndicator() {
  if (docViewer.kind !== 'pdf' || !docViewer.pages.length) return;
  var body = byId('docBody');
  var middle = body.scrollTop + body.clientHeight / 2;
  var current = 1;
  for (var i = 0; i < docViewer.pages.length && docViewer.pages[i].el.offsetTop <= middle; i++) current = i + 1;
  byId('docPage').textContent = current + ' / ' + docViewer.pages.length;
}

byId('docBody').addEventListener('scroll', updatePdfPageIndicator, { passive: true });

/* ---------- Image ---------- */
function showImageDocument(doc, session) {
  var img = new Image();
  img.className = 'doc-image';
  img.alt = doc.name;
  img.addEventListener('load', function () {
    if (session !== docViewer.session) return;
    layoutDocument();
    byId('docZoom').hidden = false;
    updateZoomButtons();
  });
  img.addEventListener('error', function () {
    showDocumentProblem(doc, session, "Cette image ne peut pas être affichée dans l'appli.");
  });
  img.src = blobUrl('document', doc.blob);
  docViewer.image = img;
  byId('docBody').appendChild(h('div', { className: 'zoom-image' }, img));
}

/* ---------- Vidéo et son ---------- */
function showMediaDocument(doc, kind, session) {
  var media = document.createElement(kind);
  media.controls = true;
  media.preload = 'metadata';
  media.setAttribute('controlsList', 'nodownload noremoteplayback');
  if (kind === 'video') media.setAttribute('playsinline', '');
  media.addEventListener('error', function () {
    showDocumentProblem(doc, session, kind === 'video'
      ? "Cette vidéo ne peut pas être lue dans l'appli (format non pris en charge)."
      : "Ce fichier audio ne peut pas être lu dans l'appli.");
  });
  media.src = blobUrl('document', doc.blob);
  byId('docBody').appendChild(kind === 'video'
    ? h('div', { className: 'doc-media' }, media)
    : h('div', { className: 'doc-card' }, [
      h('span', { className: 'doc-card-icon', text: '🎵' }),
      h('p', { className: 'doc-card-name', text: doc.name }),
      media
    ]));
}

/* ---------- Texte et markdown ---------- */
/* Texte en UTF-8 (le plus courant), sinon Shift_JIS (fichiers japonais) ou Latin-1 (Windows). */
function decodeText(buffer) {
  var bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
  } catch (e) { /* pas de l'UTF-8 */ }
  var sjis = new TextDecoder('shift_jis').decode(bytes, { stream: true });
  var japanese = (sjis.match(/[぀-ヿ一-鿿]/g) || []).length;
  var nonAscii = (sjis.match(/[^\x00-\x7f]/g) || []).length;
  return nonAscii && japanese / nonAscii > 0.7 && sjis.indexOf('�') < 0 ? sjis : new TextDecoder('windows-1252').decode(bytes);
}

function showTextDocument(doc, kind, session) {
  var truncated = doc.blob.size > TEXT_PREVIEW_MAX;
  doc.blob.slice(0, TEXT_PREVIEW_MAX).arrayBuffer().then(function (buffer) {
    if (session !== docViewer.session) return;
    var text = decodeText(buffer);
    var paper = h('div', { className: 'doc-paper' });
    if (kind === 'markdown') {
      var content = h('div', { className: 'markdown' });
      showMarkdown(content, text);
      paper.appendChild(content);
    } else {
      paper.appendChild(h('pre', { className: 'doc-text', text: text }));
    }
    if (truncated) paper.appendChild(h('p', { className: 'hint', text: 'Aperçu limité aux 2 premiers Mo du fichier.' }));
    byId('docBody').appendChild(paper);
  })['catch'](function (err) {
    console.error(err);
    showDocumentProblem(doc, session, "Ce fichier n'a pas pu être lu.");
  });
}

/* ---------- Zoom (PDF et images) : boutons, deux doigts, double toucher ---------- */
function isZoomable() {
  return docViewer.kind === 'pdf' ? !!docViewer.pages.length : docViewer.kind === 'image' && !!docViewer.image;
}

/* Taille des pages (ou de l'image) selon la largeur de l'écran et le zoom. */
function layoutDocument() {
  var body = byId('docBody');
  if (docViewer.kind === 'pdf') {
    var width = Math.round(Math.min(body.clientWidth - 16, 900) * docViewer.zoom);
    docViewer.pages.forEach(function (page) {
      page.el.style.width = width + 'px';
      page.el.style.height = Math.round(width * page.ratio) + 'px';
    });
  } else if (docViewer.kind === 'image' && docViewer.image && docViewer.image.naturalWidth) {
    var img = docViewer.image;
    var fit = Math.min(1, (body.clientWidth - 16) / img.naturalWidth, (body.clientHeight - 16) / img.naturalHeight);
    img.style.width = Math.round(img.naturalWidth * fit * docViewer.zoom) + 'px';
  }
}

/* Change le zoom en gardant immobile le point (x, y) de la zone d'affichage (par défaut, le centre). */
function setDocumentZoom(zoom, x, y) {
  var body = byId('docBody');
  var old = docViewer.zoom;
  zoom = Math.max(1, Math.min(DOC_MAX_ZOOM, zoom));
  if (!isZoomable() || Math.abs(zoom - old) < 0.01) return;
  if (x === undefined) {
    x = body.clientWidth / 2;
    y = body.clientHeight / 2;
  }
  var contentX = body.scrollLeft + x;
  var contentY = body.scrollTop + y;
  docViewer.zoom = zoom;
  layoutDocument();
  body.scrollLeft = contentX * zoom / old - x;
  body.scrollTop = contentY * zoom / old - y;
  updateZoomButtons();
  if (docViewer.kind === 'pdf') schedulePdfRender();
}

function stepDocumentZoom(direction) {
  var zoom = docViewer.zoom;
  var next = direction > 0
    ? DOC_ZOOM_STEPS.filter(function (s) { return s > zoom + 0.01; })[0]
    : DOC_ZOOM_STEPS.filter(function (s) { return s < zoom - 0.01; }).pop();
  setDocumentZoom(next === undefined ? (direction > 0 ? DOC_MAX_ZOOM : 1) : next);
}

function updateZoomButtons() {
  byId('docZoomOut').disabled = docViewer.zoom <= 1;
  byId('docZoomIn').disabled = docViewer.zoom >= DOC_MAX_ZOOM;
}

byId('docZoomIn').addEventListener('click', function () { stepDocumentZoom(1); });
byId('docZoomOut').addEventListener('click', function () { stepDocumentZoom(-1); });

function touchDistance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

/* Deux doigts : aperçu immédiat (transformation CSS), puis vrai zoom (pages redessinées nettes). */
byId('docBody').addEventListener('touchstart', function (e) {
  docGesture.lastTouch = Date.now();
  if (!isZoomable()) return;
  if (e.touches.length === 2) {
    var rect = this.getBoundingClientRect();
    docGesture.start = null;
    docGesture.pinch = {
      distance: touchDistance(e.touches), scale: 1,
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
    };
    this.firstElementChild.style.transformOrigin = (this.scrollLeft + docGesture.pinch.x) + 'px ' + (this.scrollTop + docGesture.pinch.y) + 'px';
  } else if (e.touches.length === 1 && !docGesture.pinch) {
    docGesture.start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
}, { passive: true });

byId('docBody').addEventListener('touchmove', function (e) {
  var pinch = docGesture.pinch;
  if (!pinch || e.touches.length !== 2) return;
  var target = Math.max(1, Math.min(DOC_MAX_ZOOM, docViewer.zoom * touchDistance(e.touches) / pinch.distance));
  pinch.scale = target / docViewer.zoom;
  this.firstElementChild.style.transform = 'scale(' + pinch.scale + ')';
}, { passive: true });

byId('docBody').addEventListener('touchend', function (e) {
  var pinch = docGesture.pinch;
  if (pinch) {
    if (e.touches.length) return; // attendre que les deux doigts soient levés
    docGesture.pinch = null;
    docGesture.lastTap = null;
    this.firstElementChild.style.transform = '';
    this.firstElementChild.style.transformOrigin = '';
    setDocumentZoom(docViewer.zoom * pinch.scale, pinch.x, pinch.y);
    return;
  }
  var start = docGesture.start;
  docGesture.start = null;
  if (!start || !isZoomable() || e.touches.length || e.changedTouches.length !== 1) return;
  var touch = e.changedTouches[0];
  if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12) return; // défilement, pas un toucher
  var now = Date.now();
  var last = docGesture.lastTap;
  if (last && now - last.time < 320 && Math.hypot(touch.clientX - last.x, touch.clientY - last.y) < 40) {
    var rect = this.getBoundingClientRect();
    docGesture.lastTap = null;
    setDocumentZoom(docViewer.zoom > 1 ? 1 : 2.5, touch.clientX - rect.left, touch.clientY - rect.top);
  } else {
    docGesture.lastTap = { time: now, x: touch.clientX, y: touch.clientY };
  }
});

/* À la souris (navigateur d'ordinateur) : double-clic. Ignoré juste après un toucher (déjà traité). */
byId('docBody').addEventListener('dblclick', function (e) {
  if (!isZoomable() || Date.now() - docGesture.lastTouch < 800) return;
  var rect = this.getBoundingClientRect();
  setDocumentZoom(docViewer.zoom > 1 ? 1 : 2.5, e.clientX - rect.left, e.clientY - rect.top);
});

/* Rotation de l'écran : pages et image recalculées. */
window.addEventListener('resize', function () {
  if (!isDocumentOpen()) return;
  layoutDocument();
  if (docViewer.kind === 'pdf') schedulePdfRender();
});

/* ---------- Miniatures (liste des documents) ---------- */
/* Image, première page d'un PDF ou image d'une vidéo, en JPEG ; null si impossible. */
function makeDocumentThumb(blob, type, name, size) {
  var kind = documentKind(type, name);
  var job = null;
  if (kind === 'image') job = loadImage(blob).then(function (img) { return drawJpeg(img, size, 0.8); });
  else if (kind === 'pdf' && blob.size <= PDF_THUMB_MAX_SIZE) job = pdfThumb(blob, size);
  else if (kind === 'video') job = videoThumb(blob, size);
  if (!job) return Promise.resolve(null);
  return job.then(function (result) { return result.blob; }, function (err) {
    console.warn('Miniature impossible pour ' + name, err);
    return null;
  });
}

function pdfThumb(blob, size) {
  return openPdf(blob).then(function (pdf) {
    return pdf.getPage(1).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: size / Math.max(base.width, base.height) });
      var canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      return page.render({ canvas: canvas, viewport: viewport }).promise.then(function () {
        return canvasToJpeg(canvas, 0.8);
      });
    }).then(function (thumb) {
      closePdf(pdf);
      return { blob: thumb };
    }, function (err) {
      closePdf(pdf);
      throw err;
    });
  });
}

function videoThumb(blob, size) {
  return new Promise(function (resolve, reject) {
    var video = document.createElement('video');
    var url = URL.createObjectURL(blob);
    var timer = setTimeout(function () { finish(new Error('délai dépassé')); }, 6000);
    function finish(err, result) {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      if (err) reject(err);
      else resolve(result);
    }
    video.muted = true;
    video.playsInline = true; // iPhone : pas d'ouverture en plein écran
    video.preload = 'auto';
    // Dès que la durée est connue (l'iPhone ne charge pas plus loin d'avance), on se place sur l'image voulue.
    video.addEventListener('loadedmetadata', function () {
      video.currentTime = Math.min(1, (video.duration || 0) / 3) || 0.01;
    });
    video.addEventListener('seeked', function () {
      if (!video.videoWidth) return finish(new Error("pas d'image"));
      drawJpeg(video, size, 0.8).then(function (result) { finish(null, result); }, finish);
    });
    video.addEventListener('error', function () { finish(new Error('vidéo illisible')); });
    video.src = url;
  });
}
