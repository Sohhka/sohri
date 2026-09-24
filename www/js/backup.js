/* ---------- Sauvegarde et restauration ----------
   Une sauvegarde est un fichier .zip : « sohri.json » (notes, adresses, dossiers, albums, documents,
   réglages) et un fichier par photo, pièce jointe ou document (dossier files/). Les fichiers sont rangés sans
   compression (photos et PDF sont déjà compressés), ce qui permet de construire le zip sans tout
   charger en mémoire. */
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

/* Index d'un zip non compressé : { nom: { start, size } } (position des données dans le fichier). */
function readZipEntries(file) {
  var tailSize = Math.min(file.size, 65557);
  return file.slice(file.size - tailSize).arrayBuffer().then(function (buffer) {
    var tail = new DataView(buffer);
    var eocd = -1;
    for (var i = tailSize - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Ce n'est pas un fichier zip");
    var count = tail.getUint16(eocd + 10, true);
    var cdSize = tail.getUint32(eocd + 12, true);
    var cdOffset = tail.getUint32(eocd + 16, true);
    return file.slice(cdOffset, cdOffset + cdSize).arrayBuffer().then(function (cdBuffer) {
      var cd = new DataView(cdBuffer);
      var decoder = new TextDecoder();
      var entries = {};
      var list = [];
      var p = 0;
      for (var n = 0; n < count; n++) {
        if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Zip invalide');
        var nameLength = cd.getUint16(p + 28, true);
        var entry = {
          method: cd.getUint16(p + 10, true),
          size: cd.getUint32(p + 20, true),
          localOffset: cd.getUint32(p + 42, true)
        };
        var name = decoder.decode(new Uint8Array(cdBuffer, p + 46, nameLength));
        if (entry.method !== 0) throw new Error('Fichier compressé non pris en charge : ' + name);
        entries[name] = entry;
        list.push(entry);
        p += 46 + nameLength + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
      }
      // Les données commencent après l'en-tête local de chaque fichier.
      return list.reduce(function (chain, e) {
        return chain.then(function () {
          return file.slice(e.localOffset, e.localOffset + 30).arrayBuffer().then(function (b) {
            var local = new DataView(b);
            if (local.getUint32(0, true) !== 0x04034b50) throw new Error('Zip invalide');
            e.start = e.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
          });
        });
      }, Promise.resolve()).then(function () { return entries; });
    });
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

/* Inverse : chaque référence redevient un Blob (morceau du fichier zip, lu seulement au besoin). */
function restoreBlobs(value, entries, file) {
  if (Array.isArray(value)) return value.map(function (v) { return restoreBlobs(v, entries, file); });
  if (value && typeof value === 'object') {
    if (typeof value.$blob === 'string') {
      var entry = entries[value.$blob];
      if (!entry) throw new Error('Fichier manquant dans la sauvegarde : ' + value.$blob);
      return file.slice(entry.start, entry.start + entry.size, value.type || '');
    }
    var copy = {};
    Object.keys(value).forEach(function (key) { copy[key] = restoreBlobs(value[key], entries, file); });
    return copy;
  }
  return value;
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

function readBackup(file) {
  return readZipEntries(file).then(function (entries) {
    var manifestEntry = entries[BACKUP_MANIFEST];
    if (!manifestEntry) throw new Error('Pas une sauvegarde SOHRI');
    return file.slice(manifestEntry.start, manifestEntry.start + manifestEntry.size).text().then(function (text) {
      var manifest = JSON.parse(text);
      if (manifest.app !== 'SOHRI' || !manifest.data || manifest.format > BACKUP_FORMAT) throw new Error('Format inconnu');
      var data = {};
      DB_STORES.forEach(function (store) {
        data[store] = (manifest.data[store] || []).map(function (record) { return restoreBlobs(record, entries, file); });
      });
      return { createdAt: manifest.createdAt, data: data };
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
  readBackup(file).then(function (backup) {
    progress.close();
    return uiConfirm('Restaurer la sauvegarde du ' + formatDateTime(backup.createdAt) + ' (' + backupSummary(backup.data) +
      ') ? Toutes les données actuelles de l\'appli seront remplacées.', 'Restaurer', true).then(function (ok) {
      if (!ok) return;
      progress = showProgress('Restauration en cours…');
      return dbReplaceAll(backup.data).then(function () {
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
    uiAlert("Ce fichier n'est pas une sauvegarde SOHRI valide.");
  });
}
