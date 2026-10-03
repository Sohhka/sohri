/* ---------- Toutes mes rubriques, les mêmes sur tous mes appareils (facultatif) ----------
   Réglage du compte « syncAll » (Partage → Mes appareils), valable pour tous ses appareils. Avec
   Internet, chacun envoie ses changements et reçoit ceux des autres : notes, carnet d'adresses,
   documents, leurs dossiers, dépenses et programme (les Images ont leur propre synchronisation :
   cloud.js).
   En ligne, visible de son seul propriétaire (firestore.rules) :
   - users/{moi}/items/{id} : un élément, décrit en JSON (data), avec les empreintes de ses fichiers
     (blobs). Son identifiant, tiré de sa date de création, est le même sur tous les appareils ;
   - users/{moi}/blobs/{empreinte SHA-256} et blobParts/{empreinte}-{n} : un fichier (photo d'une
     note, pièce jointe, document, miniature) et ses morceaux. Un fichier identique n'est envoyé
     qu'une fois.
   Comme pour les Images : la première fois, fusion sans rien perdre ; ensuite, seuls les changements
   depuis la dernière fois. Ce qui n'a changé qu'ici part, ce qui n'a changé qu'ailleurs arrive ;
   changé des deux côtés, la version la plus récente l'emporte. Une suppression vaut partout, sauf
   pour un élément modifié ailleurs entre-temps (il est gardé).
   Magasin « cloud » : « ipub:<id> » (empreinte de l'élément au dernier échange), « ipend:<id> »
   (élément pas encore reçu, redemandé), « iown » (repère des changements reçus), « iready » (fusion
   faite), « ikinds » (types d'éléments connus de cet appareil quand il a reçu les changements),
   « igc » (dernier ménage des fichiers en ligne). Les éléments venus d'un autre appareil
   sont marqués « fromAccount » : ils quittent le téléphone à la déconnexion (ils restent sur le
   compte et reviennent à la connexion suivante). */
var ITEM_STORES = { folder: 'folders', address: 'addresses', note: 'notes', document: 'documents', expense: 'expenses', event: 'schedule' };
var ITEM_ORDER = { folder: 0, address: 1, note: 2, document: 3, expense: 4, event: 5 }; // dossiers et adresses d'abord : notes et étapes y renvoient
var ITEM_PREFIX = { folder: 'f', address: 'l', note: 'n', document: 'd', expense: 'e', event: 'v' };
var ITEM_WITH_ADDRESS = { note: true, event: true }; // éléments liés à une adresse du carnet
var ITEM_FOLDER_KINDS = ['notes', 'documents']; // les albums (« photos ») sont ceux des Images
// Champs propres à ce téléphone (identifiants, marques de synchronisation), ou transmis à part.
var ITEM_OWN_FIELDS = {
  id: 1, rid: 1, fromAccount: 1, folderId: 1, addressId: 1, fileId: 1,
  images: 1, attachments: 1, thumb: 1, folder: 1, address: 1, file: 1, place: 1
};
var ITEM_FILE_MAX = 60 * 1024 * 1024;  // fichier le plus gros synchronisé (voir firestore.rules)
var BLOB_PART_SIZE = 900 * 1024;       // un document Firestore ne dépasse pas 1 Mo
var BLOB_PARTS_PER_REQUEST = 6;        // une requête ne dépasse pas 10 Mo
var BLOB_REUSE_AGE = 12 * 3600000;     // fichier déjà en ligne réutilisé : sa date est rafraîchie (voir collectUnusedBlobs)
var BLOB_GC_EVERY = 86400000;          // ménage des fichiers devenus inutiles : une fois par jour...
var BLOB_GC_MIN_AGE = 86400000;        // ... s'ils ont plus d'un jour (un autre appareil peut être en train de les envoyer)
var itemsLeftHere = [];                // éléments aux fichiers trop gros, restés seulement ici (écran Partage)

/* ---------- Identifiants, empreintes ---------- */
function shortTextHash(text) {
  var h = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/* Identifiant commun d'un élément : tiré de sa date de création (et de sa taille pour un document,
   plusieurs fichiers ajoutés d'un coup pouvant avoir la même date), il est le même sur tous les
   appareils et ne change pas quand on le modifie, le renomme ou le déplace. */
function itemRemoteId(kind, record) {
  if (record.rid) return record.rid;
  var created = Math.round(Number(record.createdAt) || 0);
  var id = ITEM_PREFIX[kind] + (created > 0 ? created.toString(36) : 'x' + record.id);
  return kind === 'document' ? id + '-' + Math.round(Number(record.size) || 0).toString(36) : id;
}

/* JSON aux clés triées : le même contenu donne toujours le même texte. */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort().map(function (k) {
      return JSON.stringify(k) + ':' + canonicalJson(value[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}
function itemSignature(data) {
  var text = canonicalJson(data);
  return shortTextHash(text) + '.' + text.length.toString(36);
}

function sha256Hex(blob) {
  return blob.arrayBuffer().then(function (buffer) {
    return crypto.subtle.digest('SHA-256', buffer);
  }).then(function (digest) {
    var bytes = new Uint8Array(digest);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return hex;
  });
}

function itemTime(value) {
  return Number(value.updatedAt || value.createdAt) || 0;
}
function itemName(item) {
  return item.record.name || item.record.title || item.record.label || 'Sans titre';
}
function uniqueList(list) {
  var seen = {};
  return list.filter(function (x) {
    if (seen[x]) return false;
    seen[x] = true;
    return true;
  });
}

/* ---------- Élément ↔ description en ligne ----------
   Ses champs (sauf ceux propres à ce téléphone), ses liens (dossier, adresse) par identifiant
   commun, et ses fichiers remplacés par ref(fichier), toujours dans le même ordre : photos, pièces
   jointes, miniature, contenu. file : contenu d'un document (magasin documentFiles). */
/* Champ propre à ce téléphone, ou transmis à part ? Pour une adresse du carnet, « address » est son
   adresse postale, et part avec elle (ailleurs, c'est le lien vers une adresse ; avant la 2.4, elle
   ne partait pas : les adresses déjà en ligne repartent une fois avec elle). */
function isOwnField(kind, key) {
  return !!ITEM_OWN_FIELDS[key] && !(kind === 'address' && key === 'address');
}

function itemData(kind, record, ctx, ref, file) {
  var data = {};
  Object.keys(record).forEach(function (key) {
    var value = record[key];
    if (isOwnField(kind, key) || value === undefined || value instanceof Blob) return;
    data[key] = value;
  });
  if (kind === 'note' || kind === 'document') data.folder = record.folderId != null ? ctx.folderRid[record.folderId] || null : null;
  if (ITEM_WITH_ADDRESS[kind]) data.address = record.addressId != null ? ctx.addressRid[record.addressId] || null : null;
  if (kind === 'event') data.place = placeSnapshot(record.addressId != null ? ctx.addressRecord[record.addressId] : null);
  // Photos d'une note : très anciennes notes, parfois en texte (data URL), gardé tel quel.
  if (record.images) data.images = record.images.map(function (image) { return image instanceof Blob ? ref(image) : image; });
  if (record.attachments) {
    data.attachments = record.attachments.map(function (att) {
      var copy = {};
      Object.keys(att).forEach(function (k) { if (k !== 'blob' && att[k] !== undefined) copy[k] = att[k]; });
      copy.blob = att.blob instanceof Blob ? ref(att.blob) : null;
      return copy;
    });
  }
  if (kind === 'document') {
    data.thumb = record.thumb instanceof Blob ? ref(record.thumb) : null;
    data.file = file ? ref(file) : null;
  }
  return data;
}

/* Lieu d'une étape du programme, recopié dans sa description : un proche à qui je partage le
   programme (sans mon carnet d'adresses) le voit avec son adresse, pour l'itinéraire et le taxi.
   Lieu modifié dans le carnet : l'étape change aussi, et repart. */
function placeSnapshot(address) {
  if (!address) return null;
  var place = { title: address.title || '' };
  ['address', 'addressJa', 'phone', 'category'].forEach(function (key) { if (address[key]) place[key] = address[key]; });
  return place;
}

/* Pour l'empreinte d'un élément : un fichier y figure par sa taille et son type (sans le relire). */
function liteRef(blob) {
  return { $blob: 'size:' + blob.size, type: blob.type || '' };
}
function liteData(data) {
  if (Array.isArray(data)) return data.map(liteData);
  if (data && typeof data === 'object') {
    if (typeof data.$blob === 'string') return { $blob: 'size:' + data.size, type: data.type || '' };
    var copy = {};
    Object.keys(data).forEach(function (k) { copy[k] = liteData(data[k]); });
    return copy;
  }
  return data;
}
function isBlobRef(value) {
  return !!value && typeof value === 'object' && typeof value.$blob === 'string';
}

/* Fichiers d'une description en ligne, dans l'ordre de itemData. */
function itemRefs(kind, data) {
  var refs = [];
  var add = function (value) { if (isBlobRef(value)) refs.push(value); };
  (data.images || []).forEach(add);
  (data.attachments || []).forEach(function (att) { add(att && att.blob); });
  if (kind === 'document') {
    add(data.thumb);
    add(data.file);
  }
  return refs;
}

/* Élément de ce téléphone d'après sa description en ligne ; blobs : { empreinte : fichier }. */
function recordFromData(kind, data, ctx, blobs, existing) {
  var record = {};
  Object.keys(data).forEach(function (key) {
    if (!isOwnField(kind, key)) record[key] = data[key];
  });
  var blobOf = function (value) { return isBlobRef(value) ? blobs[value.$blob] : value; };
  if (kind === 'note' || kind === 'document') record.folderId = data.folder && ctx.folderId[data.folder] !== undefined ? ctx.folderId[data.folder] : null;
  if (ITEM_WITH_ADDRESS[kind]) record.addressId = data.address && ctx.addressId[data.address] !== undefined ? ctx.addressId[data.address] : null;
  if (Array.isArray(data.images)) record.images = data.images.map(blobOf);
  if (Array.isArray(data.attachments)) {
    record.attachments = data.attachments.map(function (a) {
      var att = {};
      Object.keys(a || {}).forEach(function (k) { if (k !== 'blob') att[k] = a[k]; });
      att.blob = a && a.blob ? blobOf(a.blob) : null;
      return att;
    });
  }
  if (kind === 'document') record.thumb = data.thumb ? blobOf(data.thumb) : null;
  if (existing) {
    record.id = existing.id;
    if (existing.fromAccount) record.fromAccount = existing.fromAccount;
  }
  return record;
}

/* ---------- Ce qui est sur ce téléphone ---------- */
function rememberItem(ctx, item) {
  ctx.byRid[item.rid] = item;
  if (item.kind === 'folder') { ctx.folderRid[item.record.id] = item.rid; ctx.folderId[item.rid] = item.record.id; }
  if (item.kind === 'address') {
    ctx.addressRid[item.record.id] = item.rid;
    ctx.addressId[item.rid] = item.record.id;
    ctx.addressRecord[item.record.id] = item.record;
  }
}

/* Tous les éléments d'ici, par identifiant commun, avec la correspondance des dossiers et adresses. */
function loadLocalItems() {
  return Promise.all([dbGetAll('folders'), dbGetAll('addresses'), dbGetAll('notes'), dbGetAll('documents'), dbGetAll('expenses'), dbGetAll('schedule')]).then(function (r) {
    var ctx = { byRid: {}, folderRid: {}, folderId: {}, addressRid: {}, addressId: {}, addressRecord: {} };
    var add = function (kind) {
      return function (record) {
        var rid = itemRemoteId(kind, record);
        if (ctx.byRid[rid]) rid += '~' + record.id; // même date de création (très rare) : distingués
        rememberItem(ctx, { kind: kind, rid: rid, record: record });
      };
    };
    r[0].filter(function (f) { return ITEM_FOLDER_KINDS.indexOf(f.kind) >= 0; }).forEach(add('folder'));
    r[1].forEach(add('address'));
    r[2].forEach(add('note'));
    r[3].forEach(add('document'));
    r[4].forEach(add('expense'));
    r[5].forEach(add('event'));
    return ctx;
  });
}

function documentFile(record) {
  if (record.fileId == null) return Promise.resolve(null);
  return dbGet('documentFiles', record.fileId).then(function (row) { return row ? row.blob : null; });
}

/* Empreinte d'un élément d'ici. Le contenu d'un document y figure tel que décrit par sa fiche. */
function localSignature(item, ctx) {
  var file = item.kind === 'document' ? { size: item.record.size || 0, type: item.record.type || '' } : null;
  return itemSignature(itemData(item.kind, item.record, ctx, liteRef, file));
}

/* Fichiers d'un élément d'ici : { list (dans l'ordre de itemData), file (contenu d'un document) }. */
function localBlobs(item, ctx) {
  return (item.kind === 'document' ? documentFile(item.record) : Promise.resolve(null)).then(function (file) {
    var list = [];
    itemData(item.kind, item.record, ctx, function (blob) { list.push(blob); return null; }, file);
    return { list: list, file: file };
  });
}

/* ---------- Synchronisation (depuis syncNow, cloud.js) ----------
   Un élément n'est écrit en ligne que s'il n'y a pas changé depuis le dernier échange (version
   « time » gardée avec son empreinte) : sinon l'envoi est refusé, l'élément relu, et la
   synchronisation refaite aussitôt ; le plus récent l'emporte. Aucun appareil n'écrase donc une
   modification qu'il n'a pas encore vue. */
var itemConflictRounds = 0; // synchronisations de suite avec des envois refusés

function syncOwnItems() {
  if (!syncAllEnabled()) return leaveItemSync();
  var outcome = null;
  return cloudGet('iready').then(function (ready) {
    return ready === cloudSession.uid ? pullOwnItems() : mergeOwnItems();
  }).then(publishOwnItems).then(function (result) {
    outcome = result;
    return collectUnusedBlobs().then(null, function (e) {
      if (e.cloud === 'offline' || e.cloud === 'signed-out') throw e;
      console.warn('Ménage des fichiers en ligne pas fait', e);
    });
  }).then(function () {
    itemConflictRounds = outcome.conflicts ? itemConflictRounds + 1 : 0;
    if (outcome.conflicts && itemConflictRounds <= 3) cloudSyncAgain = true;
    if (outcome.failure) throw outcome.failure;
  });
}

/* Écriture refusée parce que le document a changé (ou disparu) en ligne entre-temps. */
function isWriteConflict(err) {
  return err.status === 'FAILED_PRECONDITION' || err.status === 'ALREADY_EXISTS' || err.cloud === 'not-found';
}

function forgetItemState() {
  return dbGetAll('cloud').then(function (rows) {
    var keys = rows.map(function (row) { return row.key; }).filter(function (key) {
      return key.indexOf('ipub:') === 0 || key.indexOf('ipend:') === 0 || key === 'iown' || key === 'iready' || key === 'ikinds' || key === 'igc';
    });
    if (!keys.length) return null;
    return dbWrite(['cloud'], function (tx) {
      keys.forEach(function (key) { tx.objectStore('cloud')['delete'](key); });
    });
  });
}

/* Première synchronisation de cet appareil (ou synchronisation reprise) : ce qu'il a et ce qu'a le
   compte sont réunis ; seuls les éléments supprimés depuis sur un autre appareil le sont ici aussi. */
function mergeOwnItems() {
  var docs = [];
  return forgetItemState().then(function () {
    return fsChangesSince(userPath(), 'items', null, function (page) { docs = docs.concat(page); });
  }).then(function (last) {
    return applyOwnItems(docs, true).then(function () {
      return Promise.all([cloudPut('iown', last), cloudPut('iready', cloudSession.uid), cloudPut('ikinds', itemKinds())]);
    });
  });
}

/* Changements faits sur mes autres appareils depuis la dernière fois (et éléments à redemander). */
function pullOwnItems() {
  var docs = [];
  var last = null;
  return cloudGet('iown').then(function (since) {
    return fsChangesSince(userPath(), 'items', since, function (page) { docs = docs.concat(page); });
  }).then(function (seen) {
    last = seen;
    return newKindDocs(docs);
  }).then(function (extra) {
    docs = docs.concat(extra);
    return pendingItemDocs(docs);
  }).then(function (pending) {
    var all = docs.concat(pending);
    return all.length ? applyOwnItems(all, false) : null;
  }).then(function () {
    return Promise.all([cloudPut('iown', last), cloudPut('ikinds', itemKinds())]);
  });
}

/* Types d'éléments que cet appareil sait recevoir. Une version précédente passait ceux qu'elle ne
   connaissait pas (les dépenses, avant la 2.3) sans les retenir, tout en avançant son repère : mise
   à jour, elle relit une fois en entier les éléments de ces types. */
var ITEM_KINDS_BEFORE = ['address', 'document', 'folder', 'note']; // versions 2.1 et 2.2 (« ikinds » pas noté)
function itemKinds() {
  return Object.keys(ITEM_STORES).sort();
}

function newKindDocs(docs) {
  return cloudGet('ikinds').then(function (known) {
    known = known || ITEM_KINDS_BEFORE;
    var missing = itemKinds().filter(function (kind) { return known.indexOf(kind) < 0; });
    var seen = {};
    docs.forEach(function (doc) { seen[doc._id] = true; });
    return Promise.all(missing.map(listItemsOfKind)).then(function (lists) {
      return [].concat.apply([], lists).filter(function (doc) { return !seen[doc._id]; });
    });
  });
}

/* Tous mes éléments d'un type, page par page (les traces de suppression n'ont plus de type). */
function listItemsOfKind(kind) {
  var me = userPath();
  var all = [];
  function next(after) {
    var query = {
      from: [{ collectionId: 'items' }],
      where: fieldEquals('kind', kind),
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: SYNC_QUERY_PAGE
    };
    if (after) query.startAt = { values: [{ referenceValue: after }], before: false };
    return fsQuery(me, query).then(function (docs) {
      all = all.concat(docs);
      return docs.length < SYNC_QUERY_PAGE ? all : next(docs[docs.length - 1]._name);
    });
  }
  return next(null);
}

/* Éléments à relire : pas encore reçus (fichier pas encore en ligne...), ou dont l'envoi a été
   refusé (changés ailleurs entre-temps). */
function pendingItemDocs(docs) {
  var known = {};
  docs.forEach(function (doc) { known[doc._id] = true; });
  var me = userPath();
  return loadSyncRecords('ipend:').then(function (pend) {
    return Promise.all(Object.keys(pend).filter(function (rid) { return !known[rid]; }).map(function (rid) {
      return fsGet(me + '/items/' + rid).then(function (doc) {
        if (doc) return doc;
        // Plus du tout en ligne : s'il est encore ici, il repartira comme un nouvel élément.
        return dbWrite(['cloud'], function (tx) {
          tx.objectStore('cloud')['delete']('ipend:' + rid);
          tx.objectStore('cloud')['delete']('ipub:' + rid);
        }).then(function () { return null; });
      });
    }));
  }).then(function (list) {
    return list.filter(Boolean);
  });
}

/* Applique ici l'état en ligne : éléments nouveaux ou changés ailleurs (avec leurs fichiers), puis
   suppressions. Un élément qui ne vient pas n'empêche pas les autres : il sera redemandé. */
function applyOwnItems(docs, merging) {
  return Promise.all([loadLocalItems(), loadSyncRecords('ipub:'), loadSyncRecords('ipend:')]).then(function (r) {
    var ctx = r[0];
    var pub = r[1];
    var pend = r[2];
    var alive = docs.filter(function (doc) { return !doc.deleted && ITEM_STORES[doc.kind]; }).sort(function (a, b) {
      return ITEM_ORDER[a.kind] - ITEM_ORDER[b.kind];
    });
    var dead = docs.filter(function (doc) { return doc.deleted; });
    var changed = 0;
    return alive.reduce(function (chain, doc, i) {
      return chain.then(function () {
        setCloudStatus('syncing', { progress: { label: 'Réception de tes rubriques', done: i, total: alive.length } });
        return applyOwnItem(doc, ctx, pub, merging).then(function (did) {
          if (did) changed++;
          return pend[doc._id] ? dbDelete('cloud', 'ipend:' + doc._id) : null;
        }, function (err) {
          if (err.cloud === 'offline' || err.cloud === 'signed-out') throw err;
          console.warn('Élément de mes autres appareils pas encore reçu', doc._id, err);
          return cloudPut('ipend:' + doc._id, true);
        });
      });
    }, Promise.resolve()).then(function () {
      return dead.reduce(function (chain, doc) {
        return chain.then(function () {
          return removeOwnItem(doc, ctx, pub, merging).then(function (did) { if (did) changed++; });
        });
      }, Promise.resolve());
    }).then(function () {
      if (changed) notifyCloud('items');
    });
  });
}

/* Promesse de true si l'élément d'ici a été créé ou remplacé. */
function applyOwnItem(doc, ctx, pub, merging) {
  var rid = doc._id;
  var kind = doc.kind;
  var time = doc._updateTime || null;
  var data;
  try { data = JSON.parse(doc.data); } catch (e) { return Promise.reject(new Error('Élément illisible')); }
  if (!data || typeof data !== 'object' || (kind === 'folder' && ITEM_FOLDER_KINDS.indexOf(data.kind) < 0)) return Promise.resolve(false);
  var local = ctx.byRid[rid];
  var done = merging ? null : pub[rid];
  var remoteSig = itemSignature(liteData(data));
  // Rien à changer ici : la version en ligne est notée (c'est à elle que s'appliquera le prochain envoi).
  var keep = function (sig) {
    pub[rid] = { kind: kind, sig: sig, time: time };
    return savePub(rid, pub[rid]).then(function () { return false; });
  };
  if (!local) {
    // Supprimé ici depuis le dernier échange : la suppression partira, sauf s'il a changé ailleurs.
    if (done && remoteSig === done.sig) return keep(done.sig);
    return writeOwnItem(kind, rid, data, time, null, null, ctx, pub);
  }
  var localSig = localSignature(local, ctx);
  var mineWins = function () { return keep(done ? done.sig : ''); }; // celui d'ici repartira
  if (done && localSig === done.sig) {
    // Inchangé ici : la version en ligne est reprise si elle a changé.
    if (remoteSig === done.sig) return keep(done.sig);
    return writeOwnItem(kind, rid, data, time, local, localSig, ctx, pub).then(function (did) { return did || mineWins(); });
  }
  // Changé ici (ou premier échange) : même contenu en ligne, rien à faire ; sinon la version la plus
  // récente l'emporte.
  if (localSig === remoteSig) return keep(localSig);
  if (itemTime(data) > itemTime(local.record)) {
    return writeOwnItem(kind, rid, data, time, local, localSig, ctx, pub).then(function (did) { return did || mineWins(); });
  }
  return mineWins();
}

function savePub(rid, entry) {
  return cloudPut('ipub:' + rid, entry);
}

/* Enregistre ici la version en ligne d'un élément (time : sa version) : nouveau, ou à la place de
   celui d'ici s'il n'a pas changé pendant la réception (expectedSig). Promesse de true si c'est fait. */
function writeOwnItem(kind, rid, data, time, local, expectedSig, ctx, pub) {
  var store = ITEM_STORES[kind];
  var uid = cloudSession.uid;
  var fileRef = kind === 'document' && isBlobRef(data.file) ? data.file : null;
  var oldFileId = local && local.record.fileId != null ? local.record.fileId : null;
  var mine = { list: [], file: null };
  var written = false;
  var item = null;
  var entry = null;
  return (local ? localBlobs(local, ctx) : Promise.resolve(mine)).then(function (found) {
    mine = found;
    return gatherItemBlobs(itemRefs(kind, data), found.list);
  }).then(function (byHash) {
    var record = recordFromData(kind, data, ctx, byHash, local && local.record);
    record.rid = rid;
    if (!local) record.fromAccount = uid;
    item = { kind: kind, rid: rid, record: record };
    entry = { kind: kind, sig: localSignature(item, ctx), time: time };
    // Contenu d'un document : gardé s'il est le même qu'ici, sinon remplacé.
    var newFile = fileRef ? byHash[fileRef.$blob] : null;
    var keepFile = !newFile || newFile === mine.file;
    return detachReused(record, mine.list).then(function () {
      if (keepFile) return null;
      return mine.list.indexOf(newFile) >= 0 ? copyBlob(newFile) : newFile;
    }).then(function (file) {
      return dbWrite([store, 'documentFiles', 'cloud'], function (tx) {
        var records = tx.objectStore(store);
        var save = function () {
          records.put(record).onsuccess = function (e) { record.id = e.target.result; };
          tx.objectStore('cloud').put({ key: 'ipub:' + rid, value: entry });
          written = true;
        };
        var write = function () {
          if (!file) {
            if (oldFileId != null) record.fileId = oldFileId;
            return save();
          }
          if (oldFileId != null) tx.objectStore('documentFiles')['delete'](oldFileId);
          tx.objectStore('documentFiles').add({ blob: file }).onsuccess = function (e) {
            record.fileId = e.target.result;
            save();
          };
        };
        if (!local) return write();
        // Modifié ici pendant la réception : celui d'ici est gardé (il repartira).
        records.get(local.record.id).onsuccess = function (e) {
          var current = e.target.result;
          if (current && localSignature({ kind: kind, rid: rid, record: current }, ctx) === expectedSig) write();
        };
      }, { remote: true });
    });
  }).then(function () {
    if (!written) return false;
    rememberItem(ctx, item);
    pub[rid] = entry;
    return true;
  });
}

/* Fichiers d'un élément reçu : ceux déjà ici (même empreinte) sont repris, les autres téléchargés.
   Promesse de { empreinte : fichier }. */
function gatherItemBlobs(refs, localList) {
  var pool = localList.map(function (blob) { return { blob: blob, hash: null }; });
  var byHash = {};
  return refs.reduce(function (chain, ref) {
    return chain.then(function () {
      if (byHash[ref.$blob]) return null;
      return findLocalBlob(ref, pool).then(function (blob) {
        return blob || downloadItemBlob(ref);
      }).then(function (blob) { byHash[ref.$blob] = blob; });
    });
  }, Promise.resolve()).then(function () { return byHash; });
}

function findLocalBlob(ref, pool) {
  return pool.reduce(function (chain, entry) {
    return chain.then(function (found) {
      if (found || entry.blob.size !== ref.size) return found;
      entry.hash = entry.hash || sha256Hex(entry.blob).then(null, function () { return null; });
      return entry.hash.then(function (hash) { return hash === ref.$blob ? entry.blob : null; });
    });
  }, Promise.resolve(null));
}

/* Fichiers repris d'ici (lus dans la base) : recopiés en mémoire avant d'être réenregistrés (voir
   detachBlobs, db.js). Ceux tout juste téléchargés sont déjà en mémoire. */
function detachReused(record, localList) {
  var copy = function (blob, put) {
    return blob instanceof Blob && localList.indexOf(blob) >= 0 ? copyBlob(blob).then(put) : null;
  };
  var jobs = [];
  (record.images || []).forEach(function (image, i) {
    jobs.push(copy(image, function (b) { record.images[i] = b; }));
  });
  (record.attachments || []).forEach(function (att) {
    jobs.push(copy(att.blob, function (b) { att.blob = b; }));
  });
  jobs.push(copy(record.thumb, function (b) { record.thumb = b; }));
  return Promise.all(jobs);
}

/* Supprimé sur un autre appareil : supprimé ici aussi, sauf s'il a été modifié ici depuis (il
   repart alors en ligne, à la place de la trace de suppression). Promesse de true s'il a été supprimé. */
function removeOwnItem(doc, ctx, pub, merging) {
  var rid = doc._id;
  var local = ctx.byRid[rid];
  var done = merging ? null : pub[rid];
  var sig = local ? localSignature(local, ctx) : null;
  var keep = !!local && (done ? sig !== done.sig : itemTime(local.record) > serverTime(doc.updatedAt));
  var kept = local ? { kind: local.kind, sig: '', time: doc._updateTime || null } : null;
  var stays = false;
  var removed = false;
  return dbWrite(local ? ['cloud', ITEM_STORES[local.kind], 'documentFiles'] : ['cloud'], function (tx) {
    var cloud = tx.objectStore('cloud');
    var stay = function () {
      cloud.put({ key: 'ipub:' + rid, value: kept });
      stays = true;
    };
    cloud['delete']('ipend:' + rid);
    if (!local) return cloud['delete']('ipub:' + rid);
    if (keep) return stay();
    var records = tx.objectStore(ITEM_STORES[local.kind]);
    records.get(local.record.id).onsuccess = function (e) {
      var current = e.target.result;
      if (current && localSignature({ kind: local.kind, rid: rid, record: current }, ctx) !== sig) return stay(); // modifié ici entre-temps
      cloud['delete']('ipub:' + rid);
      if (!current) return;
      records['delete'](current.id);
      if (local.kind === 'document' && current.fileId != null) tx.objectStore('documentFiles')['delete'](current.fileId);
      removed = true;
    };
  }, { remote: true }).then(function () {
    if (stays) pub[rid] = kept;
    else delete pub[rid];
    if (removed) delete ctx.byRid[rid];
    return removed;
  });
}

/* Envoie ce qui a changé ici depuis le dernier échange (dossiers et adresses d'abord), puis les
   suppressions. Un élément qui ne part pas n'empêche pas les autres ; il sera renvoyé à la
   prochaine synchronisation. Promesse de { failure : erreur à signaler, conflicts : nombre
   d'envois refusés parce que l'élément a changé ailleurs entre-temps (il sera relu) }. */
function publishOwnItems() {
  return Promise.all([loadLocalItems(), loadSyncRecords('ipub:')]).then(function (r) {
    var ctx = r[0];
    var pub = r[1];
    var tasks = [];
    Object.keys(ctx.byRid).forEach(function (rid) {
      var item = ctx.byRid[rid];
      var sig = localSignature(item, ctx);
      if (!pub[rid] || pub[rid].sig !== sig) tasks.push({ item: item, sig: sig });
    });
    tasks.sort(function (a, b) { return ITEM_ORDER[a.item.kind] - ITEM_ORDER[b.item.kind]; });
    var gone = Object.keys(pub).filter(function (rid) { return !ctx.byRid[rid]; });
    var tooBig = [];
    var outcome = { failure: null, conflicts: 0 };
    var refused = function (rid, err, what) {
      if (err.cloud === 'offline' || err.cloud === 'signed-out') throw err;
      if (isWriteConflict(err)) {
        outcome.conflicts++;
        return cloudPut('ipend:' + rid, true);
      }
      console.warn('Pas encore envoyé', rid, err);
      outcome.failure = outcome.failure || (err.cloud === 'server' ? err
        : userError(what + " n'a pas pu être envoyé : nouvel essai à la prochaine synchronisation."));
    };
    return tasks.reduce(function (chain, task, i) {
      return chain.then(function () {
        setCloudStatus('syncing', { progress: { label: 'Envoi de tes rubriques', done: i, total: tasks.length } });
        return uploadOwnItem(task.item, ctx, task.sig, pub[task.item.rid]).then(function (sent) {
          if (!sent) tooBig.push(itemName(task.item));
        }, function (err) {
          return refused(task.item.rid, err, '« ' + itemName(task.item) + ' »');
        });
      });
    }, Promise.resolve()).then(function () {
      // Supprimés ici : une trace datée prévient mes autres appareils (sauf s'ils ont changé
      // ailleurs entre-temps : relus, ils reviennent ici).
      var me = userPath();
      return gone.reduce(function (chain, rid) {
        return chain.then(function () {
          var write = fsSet(me + '/items/' + rid, { deleted: true }, { time: ['updatedAt'] });
          if (pub[rid].time) write.currentDocument = { updateTime: pub[rid].time };
          return fsCommit([write]).then(function () {
            return dbDelete('cloud', 'ipub:' + rid);
          }, function (err) {
            return refused(rid, err, 'Une suppression');
          });
        });
      }, Promise.resolve());
    }).then(function () {
      if (tooBig.join('\n') !== itemsLeftHere.join('\n')) {
        itemsLeftHere = tooBig;
        notifyCloud('data');
      }
      return outcome;
    });
  });
}

/* Un élément : ses fichiers pas encore en ligne, puis sa description, seulement si elle n'a pas
   changé en ligne depuis le dernier échange (done). Promesse de false si un de ses fichiers est
   trop gros (il reste alors seulement ici). */
function uploadOwnItem(item, ctx, sig, done) {
  var me = userPath();
  var hashes = [];
  var mine = null;
  return localBlobs(item, ctx).then(function (found) {
    mine = found;
    if (found.list.some(function (blob) { return blob.size > ITEM_FILE_MAX; })) return false;
    return found.list.reduce(function (chain, blob) {
      return chain.then(function () {
        return sha256Hex(blob).then(function (hash) { hashes.push(hash); });
      });
    }, Promise.resolve()).then(function () {
      return onlineBlobs(uniqueList(hashes));
    }).then(function (online) {
      var refresh = [];
      var seen = {};
      return mine.list.reduce(function (chain, blob, i) {
        var hash = hashes[i];
        return chain.then(function () {
          if (seen[hash]) return null;
          seen[hash] = true;
          var meta = online[hash];
          if (!meta) return uploadItemBlob(hash, blob);
          // Déjà en ligne (autre élément, autre appareil) : réutilisé, sa date rafraîchie s'il est ancien.
          if (Date.now() - serverTime(meta.createdAt) > BLOB_REUSE_AGE) refresh.push(meta);
          return null;
        });
      }, Promise.resolve()).then(function () {
        var k = 0;
        var data = itemData(item.kind, item.record, ctx, function (blob) {
          return { $blob: hashes[k++], size: blob.size, type: blob.type || '' };
        }, mine.file);
        if (data.file) {
          // Contenu d'un document : tel que décrit par sa fiche (voir localSignature).
          data.file.size = item.record.size || 0;
          data.file.type = item.record.type || '';
        }
        var writes = refresh.map(function (meta) {
          var write = fsSet(me + '/blobs/' + meta._id, { size: meta.size, type: meta.type || '', parts: meta.parts }, { time: ['createdAt'] });
          write.currentDocument = { exists: true }; // effacé entre-temps : l'envoi échoue, et sera refait
          return write;
        });
        var write = fsSet(me + '/items/' + item.rid, { kind: item.kind, data: JSON.stringify(data), blobs: uniqueList(hashes) }, { time: ['updatedAt'] });
        write.currentDocument = done && done.time ? { updateTime: done.time } : { exists: false };
        writes.push(write);
        return fsCommit(writes);
      }).then(function (response) {
        var results = (response && response.writeResults) || [];
        var last = results[results.length - 1];
        return savePub(item.rid, { kind: item.kind, sig: sig, time: (last && last.updateTime) || null });
      }).then(function () { return true; });
    });
  });
}

/* ---------- Fichiers en ligne ---------- */
/* Ceux déjà en ligne parmi hashes : { empreinte : description }. */
function onlineBlobs(hashes) {
  var base = cloudUrls().root + '/' + userPath() + '/blobs/';
  var found = {};
  var groups = [];
  for (var i = 0; i < hashes.length; i += 100) groups.push(hashes.slice(i, i + 100));
  return groups.reduce(function (chain, group) {
    return chain.then(function () {
      return fsRequest('POST', ':batchGet', { documents: group.map(function (hash) { return base + hash; }) }).then(function (rows) {
        (rows || []).forEach(function (row) {
          if (!row.found) return;
          var meta = decodeDoc(row.found);
          found[meta._id] = meta;
        });
      });
    });
  }, Promise.resolve()).then(function () { return found; });
}

/* Un fichier, en morceaux de moins de 1 Mo ; il n'est annoncé qu'une fois tous ses morceaux en ligne. */
function uploadItemBlob(hash, blob) {
  var me = userPath();
  var parts = Math.ceil(blob.size / BLOB_PART_SIZE);
  var firsts = [];
  for (var first = 0; first < parts; first += BLOB_PARTS_PER_REQUEST) firsts.push(first);
  return firsts.reduce(function (chain, first) {
    return chain.then(function () {
      var indexes = [];
      for (var i = first; i < Math.min(parts, first + BLOB_PARTS_PER_REQUEST); i++) indexes.push(i);
      return Promise.all(indexes.map(function (i) {
        return blob.slice(i * BLOB_PART_SIZE, (i + 1) * BLOB_PART_SIZE).arrayBuffer();
      })).then(function (buffers) {
        return fsCommit(buffers.map(function (buffer, k) {
          return fsSet(me + '/blobParts/' + hash + '-' + indexes[k], { data: new Uint8Array(buffer) });
        }));
      });
    });
  }, Promise.resolve()).then(function () {
    return fsCommit([fsSet(me + '/blobs/' + hash, { size: blob.size, type: blob.type || '', parts: parts }, { time: ['createdAt'] })]);
  });
}

/* Un fichier en ligne, réassemblé et vérifié (son empreinte) : le mien, ou celui d'un proche qui me
   partage l'élément (owner). */
function downloadItemBlob(ref, owner) {
  var me = owner ? userPath(owner) : userPath();
  var base = cloudUrls().root + '/' + me + '/blobParts/' + ref.$blob + '-';
  return fsGet(me + '/blobs/' + ref.$blob).then(function (meta) {
    if (!meta) throw cloudError('not-found', 'Fichier pas encore en ligne');
    var count = meta.parts || 0;
    var parts = [];
    var firsts = [];
    for (var first = 0; first < count; first += BLOB_PARTS_PER_REQUEST) firsts.push(first);
    return firsts.reduce(function (chain, first) {
      return chain.then(function () {
        var names = [];
        for (var i = first; i < Math.min(count, first + BLOB_PARTS_PER_REQUEST); i++) names.push(base + i);
        return fsRequest('POST', ':batchGet', { documents: names }).then(function (rows) {
          (rows || []).forEach(function (row) {
            if (row.found) parts[parseInt(row.found.name.slice(row.found.name.lastIndexOf('-') + 1), 10)] = decodeDoc(row.found).data;
          });
        });
      });
    }, Promise.resolve()).then(function () {
      for (var n = 0; n < count; n++) {
        if (!parts[n]) throw cloudError('not-found', 'Fichier incomplet en ligne');
      }
      var blob = new Blob(parts.slice(0, count), { type: ref.type || meta.type || '' });
      return sha256Hex(blob).then(function (hash) {
        if (hash !== ref.$blob) throw cloudError('not-found', 'Fichier abîmé en ligne');
        return blob;
      });
    });
  });
}

/* Documents d'une de mes collections, page par page (seulement les champs mask) : onDoc(brut). */
function listOwnCollection(collection, mask, onDoc) {
  var path = '/' + userPath() + '/' + collection + '?pageSize=300' + (mask || []).map(function (f) { return '&mask.fieldPaths=' + f; }).join('');
  function next(pageToken) {
    return fsRequest('GET', path + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')).then(function (page) {
      ((page && page.documents) || []).forEach(onDoc);
      return page && page.nextPageToken ? next(page.nextPageToken) : null;
    });
  }
  return next(null);
}

/* Une fois par jour : les fichiers en ligne dont plus aucun élément n'a besoin (note supprimée,
   photo retirée...) sont effacés avec leurs morceaux, s'ils ont plus d'un jour et n'ont pas été
   réutilisés entre-temps (leur date change alors : l'effacement est refusé). */
function collectUnusedBlobs() {
  return cloudGet('igc').then(function (last) {
    if (last && Date.now() - last < BLOB_GC_EVERY) return null;
    var me = userPath();
    var used = {};
    var unused = [];
    return listOwnCollection('items', ['blobs'], function (doc) {
      (fromFields(doc.fields).blobs || []).forEach(function (hash) { used[hash] = true; });
    }).then(function () {
      return listOwnCollection('blobs', null, function (doc) {
        var meta = fromFields(doc.fields);
        var hash = doc.name.split('/').pop();
        if (!used[hash] && Date.now() - serverTime(meta.createdAt) > BLOB_GC_MIN_AGE) {
          unused.push({ hash: hash, parts: meta.parts || 0, updateTime: doc.updateTime });
        }
      });
    }).then(function () {
      // Un fichier et ses morceaux dans la même écriture : effacés ensemble, ou pas du tout.
      var batches = [];
      var batch = [];
      unused.forEach(function (blob) {
        var meta = fsDelete(me + '/blobs/' + blob.hash);
        meta.currentDocument = { updateTime: blob.updateTime };
        var writes = [meta];
        for (var i = 0; i < blob.parts; i++) writes.push(fsDelete(me + '/blobParts/' + blob.hash + '-' + i));
        if (batch.length && batch.length + writes.length > 400) {
          batches.push(batch);
          batch = [];
        }
        batch = batch.concat(writes);
      });
      if (batch.length) batches.push(batch);
      return batches.reduce(function (chain, writes) {
        return chain.then(function () {
          return fsCommit(writes).then(null, function (err) {
            if (err.cloud === 'offline' || err.cloud === 'signed-out') throw err;
            console.warn('Fichiers en ligne gardés (réutilisés entre-temps ?)', err);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return cloudPut('igc', Date.now());
    });
  });
}

/* ---------- Réglage, arrêt, déconnexion ---------- */
/* Active (ou arrête) la synchronisation de toutes mes rubriques, pour tous mes appareils. Arrêtée :
   leur copie en ligne est effacée (chaque appareil garde ce qu'il a), celle des Images aussi si
   elles ne sont partagées avec personne. */
function cloudSetSyncAll(enabled) {
  var setProfile = function () {
    return fsCommit([fsSet(userPath(), { syncAll: enabled }, { mask: ['syncAll'] })]).then(function () {
      cloudState.profile.syncAll = enabled;
      return cloudPut('profile', cloudState.profile);
    });
  };
  if (enabled) {
    return setProfile().then(function () {
      notifyCloud('data');
      syncNow();
    });
  }
  // Plus rien ne part pendant l'arrêt (voir syncAllEnabled) ; la synchronisation en cours finit d'abord.
  // Mes proches ne voient plus mes rubriques partagées (elles ne sont plus en ligne), sauf les Images.
  syncAllStopping = true;
  return (cloudSyncRunning || Promise.resolve()).then(null, function () {}).then(removeItemShares).then(setProfile).then(deleteOnlineItems).then(function () {
    return sharedWith('albums').length ? null : unpublishAlbums();
  }).then(leaveItemSync).then(function () {
    syncAllStopping = false;
    notifyCloud('data');
    syncNow();
  }, function (err) {
    syncAllStopping = false;
    notifyCloud('data');
    throw err;
  });
}

function deleteOnlineItems() {
  var me = userPath();
  var paths = [];
  return ['items', 'blobs', 'blobParts'].reduce(function (chain, collection) {
    return chain.then(function () {
      return fsListAll(me, collection, true).then(function (docs) {
        docs.forEach(function (doc) { paths.push(me + '/' + collection + '/' + doc._id); });
      });
    });
  }, Promise.resolve()).then(function () {
    return deleteInBatches(paths);
  });
}

/* Synchronisation arrêtée (ici ou sur un autre appareil) : les éléments venus des autres appareils
   deviennent ceux de ce téléphone (ils ne sont plus en ligne). */
function leaveItemSync() {
  return cloudGet('iready').then(function (ready) {
    if (!ready) return null;
    return adoptAccountItems().then(forgetItemState).then(function () {
      itemsLeftHere = [];
    });
  });
}

function adoptAccountItems() {
  var stores = ['folders', 'addresses', 'notes', 'documents', 'expenses', 'schedule'];
  return Promise.all(stores.map(function (store) { return dbGetAll(store); })).then(function (lists) {
    var changed = [];
    lists.forEach(function (records, i) {
      records.forEach(function (record) {
        if (record.fromAccount && (stores[i] !== 'folders' || ITEM_FOLDER_KINDS.indexOf(record.kind) >= 0)) {
          delete record.fromAccount;
          changed.push({ store: stores[i], record: record });
        }
      });
    });
    if (!changed.length) return null;
    return Promise.all(changed.map(function (c) { return detachBlobs(c.record); })).then(function () {
      return dbWrite(stores, function (tx) {
        changed.forEach(function (c) { tx.objectStore(c.store).put(c.record); });
      }, { remote: true });
    });
  });
}

/* Déconnexion : les éléments venus de mes autres appareils, et en ligne tels quels, quittent ce
   téléphone (ils restent sur le compte). Ceux modifiés ici et pas encore envoyés restent, comme un
   dossier ou une adresse dont un élément qui reste a besoin. */
function forgetAccountItems(uid) {
  if (!uid) return Promise.resolve();
  return Promise.all([loadLocalItems(), loadSyncRecords('ipub:')]).then(function (r) {
    var ctx = r[0];
    var pub = r[1];
    var items = Object.keys(ctx.byRid).map(function (rid) { return ctx.byRid[rid]; });
    var leaving = {};
    items.forEach(function (item) {
      if (item.record.fromAccount === uid && pub[item.rid] && pub[item.rid].sig === localSignature(item, ctx)) leaving[item.rid] = true;
    });
    items.forEach(function (item) {
      if (leaving[item.rid]) return;
      if (item.kind !== 'folder' && item.record.folderId != null) delete leaving[ctx.folderRid[item.record.folderId]];
      if (ITEM_WITH_ADDRESS[item.kind] && item.record.addressId != null) delete leaving[ctx.addressRid[item.record.addressId]];
    });
    var remove = items.filter(function (item) { return leaving[item.rid]; });
    var adopt = items.filter(function (item) { return item.record.fromAccount === uid && !leaving[item.rid]; });
    if (!remove.length && !adopt.length) return null;
    return Promise.all(adopt.map(function (item) { return detachBlobs(item.record); })).then(function () {
      return dbWrite(['folders', 'addresses', 'notes', 'documents', 'documentFiles', 'expenses', 'schedule'], function (tx) {
        remove.forEach(function (item) {
          tx.objectStore(ITEM_STORES[item.kind])['delete'](item.record.id);
          if (item.kind === 'document' && item.record.fileId != null) tx.objectStore('documentFiles')['delete'](item.record.fileId);
        });
        adopt.forEach(function (item) {
          delete item.record.fromAccount;
          tx.objectStore(ITEM_STORES[item.kind]).put(item.record);
        });
      }, { remote: true });
    });
  });
}

// Changements reçus de mes autres appareils : listes et fiches réaffichées (pas les formulaires).
onCloudChange(function (what) {
  if (what !== 'items') return;
  if (['notes', 'note', 'addresses', 'address', 'documents', 'expenses', 'schedule', 'schedule-day'].indexOf(currentViewName()) >= 0) refreshView();
});
