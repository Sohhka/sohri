/* ---------- Base de données locale (IndexedDB) ---------- */
var DB_NAME = 'travelAppDB';
var DB_VERSION = 3;
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
function dbPut(storeName, value) {
  return dbPromise.then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return reject(new Error('Base de données indisponible'));
      var tx = db.transaction(storeName, 'readwrite');
      var req = tx.objectStore(storeName).put(value);
      tx.oncomplete = function () { resolve(req.result); };
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
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || req.error); };
      tx.onabort = function () { reject(tx.error || new Error('Suppression annulée')); };
    });
  });
}

/* Plusieurs écritures liées (ex. supprimer un dossier et libérer ses notes) en une seule
   transaction : tout est enregistré, ou rien. work(tx) lance les requêtes. */
function dbWrite(storeNames, work) {
  return dbPromise.then(function (db) {
    return new Promise(function (resolve, reject) {
      if (!db) return reject(new Error('Base de données indisponible'));
      var tx = db.transaction(storeNames, 'readwrite');
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Écriture annulée')); };
      work(tx);
    });
  });
}

/* Parcourt un magasin et modifie chaque enregistrement pour lequel change(record) renvoie true. */
function dbUpdateEach(tx, storeName, change) {
  tx.objectStore(storeName).openCursor().onsuccess = function (e) {
    var cursor = e.target.result;
    if (!cursor) return;
    var record = cursor.value;
    if (change(record)) cursor.update(record);
    cursor['continue']();
  };
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
