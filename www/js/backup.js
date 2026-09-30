/* ---------- Sauvegarde et restauration ----------
   Une sauvegarde est un fichier .zip : « sohri.json » (notes, adresses, dossiers, albums, documents,
   réglages) et un fichier par photo, pièce jointe ou document (dossier files/). Les fichiers sont rangés sans
   compression (photos et PDF sont déjà compressés), ce qui permet de construire le zip sans tout
   charger en mémoire.
   À la restauration, on lit aussi un zip transformé en route : l'iPhone décompresse un zip qu'on
   touche dans l'app Fichiers, et en fait un nouveau (compressé, rangé dans un dossier) quand on
   envoie ce dossier ; très gros fichiers (ZIP64) ; fichiers « __MACOSX » ajoutés par un Mac. */
var BACKUP_FORMAT = 1;
var BACKUP_MANIFEST = 'sohri.json';
var ZIP_READ_CHUNK = 4 * 1024 * 1024;

var CRC_TABLE = (function () {
  var table = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(blob) {
  var crc = 0xFFFFFFFF;
  var offset = 0;
  function next() {
    if (offset >= blob.size) return Promise.resolve((crc ^ 0xFFFFFFFF) >>> 0);
    return blob.slice(offset, offset + ZIP_READ_CHUNK).arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
      offset += ZIP_READ_CHUNK;
      return next();
    });
  }
  return next();
}

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/* entries = [{ name, blob }] → Blob du fichier zip. */
function buildZip(entries, onProgress) {
  var total = entries.reduce(function (sum, e) { return sum + e.blob.size; }, 0);
  if (entries.length > 65000 || total > 0xF0000000) return Promise.reject(new Error('Sauvegarde trop volumineuse'));
  var stamp = dosDateTime(new Date());
  var encoder = new TextEncoder();
  var parts = [];
  var central = [];
  var offset = 0;
  var done = 0;
  return entries.reduce(function (chain, entry) {
    return chain.then(function () { return crc32(entry.blob); }).then(function (crc) {
      var name = encoder.encode(entry.name);
      var size = entry.blob.size;
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);       // version nécessaire
      local.setUint16(6, 0x0800, true);   // noms en UTF-8
      local.setUint16(8, 0, true);        // sans compression
      local.setUint16(10, stamp.time, true);
      local.setUint16(12, stamp.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, entry.blob);

      var header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 20, true);
      header.setUint16(8, 0x0800, true);
      header.setUint16(10, 0, true);
      header.setUint16(12, stamp.time, true);
      header.setUint16(14, stamp.date, true);
      header.setUint32(16, crc, true);
      header.setUint32(20, size, true);
      header.setUint32(24, size, true);
      header.setUint16(28, name.length, true);
      header.setUint32(42, offset, true); // position de l'en-tête local
      central.push(header.buffer, name);

      offset += 30 + name.length + size;
      done += size;
      if (onProgress) onProgress(total ? done / total : 1);
    });
  }, Promise.resolve()).then(function () {
    var centralSize = central.reduce(function (sum, part) { return sum + part.byteLength; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  });
}

/* Erreur expliquée à l'utilisateur (voir restoreBackup). */
function backupError(message) {
  var err = new Error(message);
  err.userMessage = message;
  return err;
}
var NOT_A_BACKUP = "Ce fichier n'est pas une sauvegarde SOHRI : il faut le fichier « SOHRI-sauvegarde-….zip » créé par l'appli.";

/* Entier de 64 bits (ZIP64) : exact jusqu'à 8 millions de Go. */
function uint64(view, at) {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 4294967296;
}

/* Index d'un zip : { nom: { method, start, csize, size } } (position et taille des données dans le
   fichier ; method 0 : rangé tel quel, 8 : compressé). Dossiers et « __MACOSX » ignorés. */
function readZipEntries(file) {
  var tailSize = Math.min(file.size, 65557 + 20);
  return file.slice(file.size - tailSize).arrayBuffer().then(function (buffer) {
    var tail = new DataView(buffer);
    var eocd = -1;
    for (var i = tailSize - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return notZip(file);
    var count = tail.getUint16(eocd + 10, true);
    var cdSize = tail.getUint32(eocd + 12, true);
    var cdOffset = tail.getUint32(eocd + 16, true);
    // Très gros zip (ZIP64) : les vraies valeurs sont dans une fin de fichier à part.
    var locator = eocd - 20;
    if ((count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) && locator >= 0 && tail.getUint32(locator, true) === 0x07064b50) {
      var end64 = uint64(tail, locator + 8);
      return file.slice(end64, end64 + 56).arrayBuffer().then(function (b) {
        var e = new DataView(b);
        if (e.getUint32(0, true) !== 0x06064b50) throw backupError('Sauvegarde abîmée (zip incomplet).');
        return readZipDirectory(file, uint64(e, 32), uint64(e, 40), uint64(e, 48));
      });
    }
    return readZipDirectory(file, count, cdSize, cdOffset);
  });
}

/* Pas un zip : la liste seule (sohri.json, sortie d'un zip décompressé) ou autre chose. */
function notZip(file) {
  return file.slice(0, 200).text().then(function (start) {
    if (/^\s*\{/.test(start) && /"app"\s*:\s*"SOHRI"/.test(start)) {
      throw backupError("Ce fichier n'est que la liste de la sauvegarde (sohri.json), sans les photos ni les documents : choisis le fichier « SOHRI-sauvegarde-….zip » complet.");
    }
    throw backupError(NOT_A_BACKUP);
  });
}

function readZipDirectory(file, count, cdSize, cdOffset) {
  return file.slice(cdOffset, cdOffset + cdSize).arrayBuffer().then(function (cdBuffer) {
    var cd = new DataView(cdBuffer);
    var decoder = new TextDecoder();
    var entries = {};
    var list = [];
    var p = 0;
    for (var n = 0; n < count; n++) {
      if (p + 46 > cdBuffer.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw backupError('Sauvegarde abîmée (zip incomplet).');
      var nameLength = cd.getUint16(p + 28, true);
      var extraLength = cd.getUint16(p + 30, true);
      var entry = {
        method: cd.getUint16(p + 10, true),
        csize: cd.getUint32(p + 20, true),
        size: cd.getUint32(p + 24, true),
        localOffset: cd.getUint32(p + 42, true)
      };
      var name = decoder.decode(new Uint8Array(cdBuffer, p + 46, nameLength));
      // ZIP64 : tailles et position (0xFFFFFFFF dans l'en-tête) dans le champ supplémentaire n° 1.
      if (entry.size === 0xFFFFFFFF || entry.csize === 0xFFFFFFFF || entry.localOffset === 0xFFFFFFFF) {
        for (var x = p + 46 + nameLength, last = x + extraLength; x + 4 <= last; x += 4 + cd.getUint16(x + 2, true)) {
          if (cd.getUint16(x, true) !== 1) continue;
          var q = x + 4;
          if (entry.size === 0xFFFFFFFF) { entry.size = uint64(cd, q); q += 8; }
          if (entry.csize === 0xFFFFFFFF) { entry.csize = uint64(cd, q); q += 8; }
          if (entry.localOffset === 0xFFFFFFFF) entry.localOffset = uint64(cd, q);
          break;
        }
      }
      if (!/\/$/.test(name) && !/^__MACOSX\//.test(name)) {
        entries[name] = entry;
        list.push(entry);
      }
      p += 46 + nameLength + extraLength + cd.getUint16(p + 32, true);
    }
    // Les données commencent après l'en-tête local de chaque fichier.
    return list.reduce(function (chain, e) {
      return chain.then(function () {
        return file.slice(e.localOffset, e.localOffset + 30).arrayBuffer().then(function (b) {
          var local = new DataView(b);
          if (local.getUint32(0, true) !== 0x04034b50) throw backupError('Sauvegarde abîmée (zip incomplet).');
          e.start = e.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
        });
      });
    }, Promise.resolve()).then(function () { return entries; });
  });
}

/* Contenu d'un fichier du zip (lu en mémoire, un à la fois : voir readBackup), décompressé si le
   zip a été recompressé en route. Pas un simple morceau du fichier choisi : Safari (iPhone)
   enregistre alors le zip entier à la place de chaque photo. */
function zipEntryBlob(zip, name, type) {
  var entry = zip.entries[name];
  if (!entry) return Promise.reject(backupError('Sauvegarde incomplète : il y manque « ' + name + ' ».'));
  if (entry.method === 0) {
    return zip.file.slice(entry.start, entry.start + entry.size).arrayBuffer().then(function (data) {
      return new Blob([data], { type: type });
    });
  }
  if (entry.method !== 8) return Promise.reject(backupError('Sauvegarde compressée d\'une façon que SOHRI ne sait pas lire : renvoie le fichier .zip d\'origine.'));
  if (typeof DecompressionStream !== 'function' || !Blob.prototype.stream) {
    return Promise.reject(backupError("Cette sauvegarde a été recompressée en route et ce téléphone ne sait pas la décompresser : renvoie le fichier .zip d'origine, sans l'ouvrir sur l'iPhone."));
  }
  var compressed = zip.file.slice(entry.start, entry.start + entry.csize);
  return new Response(compressed.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob().then(function (blob) {
    return new Blob([blob], { type: type });
  });
}

/* Remplace chaque fichier (Blob) d'un enregistrement par une référence { $blob: chemin }. */
function extractBlobs(value, files) {
  if (value instanceof Blob) {
    var path = 'files/' + (files.length + 1) + (/^image\/jpeg$/.test(value.type) ? '.jpg' : '');
    files.push({ name: path, blob: value });
    return { $blob: path, type: value.type };
  }
  if (Array.isArray(value)) return value.map(function (v) { return extractBlobs(v, files); });
  if (value && typeof value === 'object') {
    var copy = {};
    Object.keys(value).forEach(function (key) { copy[key] = extractBlobs(value[key], files); });
    return copy;
  }
  return value;
}

/* Inverse : chaque référence redevient un Blob (voir zipEntryBlob). Promesse de l'enregistrement. */
function restoreBlobs(value, zip) {
  if (Array.isArray(value)) return Promise.all(value.map(function (v) { return restoreBlobs(v, zip); }));
  if (value && typeof value === 'object') {
    if (typeof value.$blob === 'string') return zipEntryBlob(zip, zip.prefix + value.$blob, value.type || '');
    var keys = Object.keys(value);
    return Promise.all(keys.map(function (key) { return restoreBlobs(value[key], zip); })).then(function (values) {
      var copy = {};
      keys.forEach(function (key, i) { copy[key] = values[i]; });
      return copy;
    });
  }
  return Promise.resolve(value);
}

function backupFileName() {
  var d = new Date();
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return 'SOHRI-sauvegarde-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.zip';
}

function createBackup() {
  var progress = showProgress('Préparation de la sauvegarde…');
  var files = [];
  var data = {};
  return DB_STORES.reduce(function (chain, store) {
    return chain.then(function () { return dbGetAll(store); }).then(function (records) {
      data[store] = records.map(function (record) { return extractBlobs(record, files); });
    });
  }, Promise.resolve()).then(function () {
    var manifest = { app: 'SOHRI', format: BACKUP_FORMAT, createdAt: Date.now(), data: data };
    var entries = [{ name: BACKUP_MANIFEST, blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) }].concat(files);
    return buildZip(entries, function (fraction) { progress.update(null, fraction / 2); });
  }).then(function (zip) {
    if (!window.AndroidBridge) {
      progress.close(); // la suite se passe dans la feuille de partage (iPhone) ou le téléchargement
      return saveFile(zip, backupFileName());
    }
    progress.update('Enregistrement de la sauvegarde… (' + formatSize(zip.size) + ')', 0.5);
    return saveFile(zip, backupFileName(), function (fraction) { progress.update(null, 0.5 + fraction / 2); });
  }).then(function () {
    progress.close();
  }, function (err) {
    progress.close();
    throw err;
  });
}

/* « sohri.json » : à la racine du zip, ou dans un dossier (zip refait par l'iPhone). */
function findManifest(entries) {
  if (entries[BACKUP_MANIFEST]) return BACKUP_MANIFEST;
  var ending = '/' + BACKUP_MANIFEST;
  return Object.keys(entries).filter(function (name) {
    return name.slice(-ending.length) === ending;
  }).sort(function (a, b) { return a.length - b.length; })[0] || null;
}

/* onProgress(fraction) : lecture des enregistrements (longue si le zip a été recompressé). */
function readBackup(file, onProgress) {
  return readZipEntries(file).then(function (entries) {
    var manifestName = findManifest(entries);
    if (!manifestName) throw backupError(NOT_A_BACKUP);
    var zip = { file: file, entries: entries, prefix: manifestName.slice(0, manifestName.length - BACKUP_MANIFEST.length) };
    return zipEntryBlob(zip, manifestName, 'application/json').then(function (blob) {
      return blob.text();
    }).then(function (text) {
      var manifest;
      try { manifest = JSON.parse(text); } catch (e) { throw backupError('Sauvegarde abîmée : sa liste (sohri.json) est illisible.'); }
      if (manifest.app !== 'SOHRI' || !manifest.data) throw backupError(NOT_A_BACKUP);
      if (manifest.format > BACKUP_FORMAT) throw backupError("Cette sauvegarde vient d'une version plus récente de SOHRI : mets d'abord l'appli à jour.");
      var total = DB_STORES.reduce(function (sum, store) { return sum + (manifest.data[store] || []).length; }, 0);
      var done = 0;
      var data = {};
      // Un enregistrement à la fois : une sauvegarde recompressée est décompressée petit à petit.
      return DB_STORES.reduce(function (chain, store) {
        data[store] = [];
        return (manifest.data[store] || []).reduce(function (next, record) {
          return next.then(function () {
            return restoreBlobs(record, zip).then(function (restored) {
              data[store].push(restored);
              if (onProgress && total) onProgress(++done / total);
            });
          });
        }, chain);
      }, Promise.resolve()).then(function () {
        return { createdAt: manifest.createdAt, data: data };
      });
    });
  });
}

function backupSummary(data) {
  var albums = (data.folders || []).filter(isAlbum).length;
  return [
    plural((data.notes || []).length, 'note', 'notes'),
    plural((data.addresses || []).length, 'adresse', 'adresses'),
    plural(albums, 'album', 'albums'),
    plural((data.photos || []).length, 'photo', 'photos'),
    plural((data.documents || []).length, 'document', 'documents')
  ].join(', ');
}

function restoreBackup(file) {
  var progress = showProgress('Lecture de la sauvegarde…');
  readBackup(file, function (fraction) { progress.update(null, fraction); }).then(function (backup) {
    progress.close();
    return uiConfirm('Restaurer la sauvegarde du ' + formatDateTime(backup.createdAt) + ' (' + backupSummary(backup.data) +
      ') ? Toutes les données actuelles de l\'appli seront remplacées.', 'Restaurer', true).then(function (ok) {
      if (!ok) return;
      progress = showProgress('Restauration en cours…');
      return dbReplaceAll(backup.data).then(function () {
        // Images partagées, rubriques synchronisées : la sauvegarde sera fusionnée avec ce qu'a le
        // compte (rien n'est effacé en ligne parce qu'il manque dans la sauvegarde).
        return Promise.all([forgetPublishedState(), forgetItemState()]).then(null, function (err) { console.error(err); });
      }).then(function () {
        location.reload();
      }, function (err) {
        progress.close();
        console.error(err);
        uiAlert("La restauration a échoué (stockage plein ?). Tes données actuelles n'ont pas été modifiées.");
      });
    });
  }, function (err) {
    progress.close();
    console.error(err);
    uiAlert(err.userMessage || "Ce fichier n'est pas une sauvegarde SOHRI valide.");
  });
}
