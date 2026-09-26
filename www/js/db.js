/* ---------- Base de données locale (IndexedDB) ---------- */
var DB_NAME = 'travelAppDB';
var DB_VERSION = 5;
// Magasins des données de l'utilisateur (ceux des sauvegardes). Le partage (cloud.js) a les siens :
// « cloud », « sharedAlbums », « sharedPhotos », « sharedComments », jamais sauvegardés.
var DB_STORES = ['notes', 'addresses', 'settings', 'folders', 'photos', 'documents', 'documentFiles'];

function openDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('addresses')) {
        db.createObjectStore('addresses', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // Version 2 : dossiers (de notes, ou albums d'images selon « kind ») et photos des albums.
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true }).createIndex('albumId', 'albumId');
      }
      // Version 3 : rubrique Documents. Description des fichiers (nom, dossier, miniature) d'un côté,
      // contenu de l'autre : renommer ou déplacer un fichier ne recopie pas son contenu.
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('documentFiles')) {
        db.createObjectStore('documentFiles', { keyPath: 'id', autoIncrement: true });
      }
      // Version 4 : partage entre proches (compte, état des envois, ce que les proches partagent).
      if (!db.objectStoreNames.contains('cloud')) {
        db.createObjectStore('cloud', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('sharedAlbums')) {
        db.createObjectStore('sharedAlbums', { keyPath: 'key' }).createIndex('owner', 'owner');
      }
      if (!db.objectStoreNames.contains('sharedPhotos')) {
        var shared = db.createObjectStore('sharedPhotos', { keyPath: 'key' });
        shared.createIndex('owner', 'owner');
        shared.createIndex('albumKey', 'albumKey');
      }
      // Version 5 : commentaires des photos partagées (les miennes et celles des proches).
      if (!db.objectStoreNames.contains('sharedComments')) {
        var comments = db.createObjectStore('sharedComments', { keyPath: 'key' });
        comments.createIndex('owner', 'owner');
        comments.createIndex('photoKey', 'photoKey');
      }
    };
    req.onsuccess = function (e) {
      var db = e.target.result;
      db.onversionchange = function () { db.close(); };
      resolve(db);
    };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

var dbPromise = openDB().catch(function (err) { console.error('DB indisponible', err); return null; });

/* Prévenus après chaque écriture réussie : fn(noms des magasins modifiés, remote). Sert au partage,
   qui envoie les albums modifiés ; remote : changement venu d'un autre appareil (déjà en ligne). */
var dbChangeListeners = [];
function onDbChange(fn) {
  dbChangeListeners.push(fn);
}
function notifyDbChange(storeNames, remote) {
  var names = [].concat(storeNames);
  dbChangeListeners.forEach(function (fn) {
    try { fn(names, !!remote); } catch (e) { console.error(e); }
  });
}

/* Lectures : sans base, on renvoie une liste vide. Écritures : sans base, erreur (sinon la saisie
   serait perdue sans que personne ne le sache), et succès seulement une fois la transaction
   terminée : avec des photos, l'écriture peut encore échouer après la requête (stockage plein). */
function dbGetAll(storeName) {
  return dbPromise.then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return resolve([]);
      var tx = db.transaction(storeName, 'readonly');
      var req = tx.objectStore(storeName).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function dbGetAllByIndex(storeName, indexName, value) {
  return dbPromise.then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return resolve([]);
      var tx = db.transaction(storeName, 'readonly');
      var req = tx.objectStore(storeName).index(indexName).getAll(value);
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function dbGet(storeName, key) {
  return dbPromise.then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return resolve(null);
      var tx = db.transaction(storeName, 'readonly');
      var req = tx.objectStore(storeName).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
/* Safari (iPhone) : une image lue dans la base puis réenregistrée telle quelle (photo dont on change
   la description, photo reçue en grand ajoutée à sa fiche...) peut devenir illisible à la lecture
   suivante (carré bleu « ? » à la place de la vignette), jusqu'à une nouvelle lecture plusieurs
   secondes plus tard. On enregistre donc toujours des copies en mémoire des images (Blob) d'un
   enregistrement : detachBlobs les remplace sur place, à toute profondeur (pièces jointes...). */
function copyBlob(blob) {
  return blob.arrayBuffer().then(function (data) { return new Blob([data], { type: blob.type }); });
}
function detachBlobs(value, depth) {
  depth = depth || 0;
  if (!value || typeof value !== 'object' || depth > 4) return Promise.resolve(value);
  var keys = Array.isArray(value) ? value.map(function (item, i) { return i; }) : Object.keys(value);
  return Promise.all(keys.map(function (key) {
    var item = value[key];
    if (item instanceof Blob) return copyBlob(item).then(function (copy) { value[key] = copy; });
    if (item && typeof item === 'object' && !ArrayBuffer.isView(item) && !(item instanceof ArrayBuffer)) return detachBlobs(item, depth + 1);
    return null;
  })).then(function () { return value; });
}

/* Enregistrements d'un magasin que change(record) modifie (en renvoyant true), prêts à être
   réenregistrés (images recopiées) : dbWrite(..., function (tx) { records.forEach(put) }). */
function dbChangedRecords(storeName, change) {
  return dbGetAll(storeName).then(function (all) {
    var changed = all.filter(function (record) { return change(record); });
    return Promise.all(changed.map(function (record) { return detachBlobs(record); }));
  });
}

function dbPut(storeName, value) {
  return detachBlobs(value).then(function () {
    return dbPromise;
  }).then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return reject(new Error('Base de données indisponible'));
      var tx = db.transaction(storeName, 'readwrite');
      var req = tx.objectStore(storeName).put(value);
      tx.oncomplete = function () {
        resolve(req.result);
        notifyDbChange(storeName);
      };
      tx.onerror = function () { reject(tx.error || req.error); };
      tx.onabort = function () { reject(tx.error || new Error('Écriture annulée')); };
    });
  });
}
function dbDelete(storeName, key) {
  return dbPromise.then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return reject(new Error('Base de données indisponible'));
      var tx = db.transaction(storeName, 'readwrite');
      var req = tx.objectStore(storeName)['delete'](key);
      tx.oncomplete = function () {
        resolve();
        notifyDbChange(storeName);
      };
      tx.onerror = function () { reject(tx.error || req.error); };
      tx.onabort = function () { reject(tx.error || new Error('Suppression annulée')); };
    });
  });
}

/* Plusieurs écritures liées (ex. supprimer un dossier et libérer ses notes) en une seule
   transaction : tout est enregistré, ou rien. work(tx) lance les requêtes. options.remote :
   changements reçus d'un autre appareil (voir notifyDbChange). */
function dbWrite(storeNames, work, options) {
  return dbPromise.then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return reject(new Error('Base de données indisponible'));
      var tx = db.transaction(storeNames, 'readwrite');
      tx.oncomplete = function () {
        resolve();
        notifyDbChange(storeNames, options && options.remote);
      };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Écriture annulée')); };
      work(tx);
    });
  });
}

/* Remplace tout le contenu de la base (restauration d'une sauvegarde), en une seule transaction. */
function dbReplaceAll(data) {
  return dbWrite(DB_STORES, function (tx) {
    DB_STORES.forEach(function (name) {
      var store = tx.objectStore(name);
      store.clear();
      (data[name] || []).forEach(function (record) { store.put(record); });
    });
  });
}
