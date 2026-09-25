/* ---------- Partage entre proches (facultatif) : comptes, contacts, rubriques partagées ----------
   Sans compte, rien ici ne contacte de serveur : l'appli reste entièrement hors connexion.
   Serveur : Firebase (Google), formule gratuite : comptes (Authentication) et base Firestore,
   utilisés par leur API web, sans bibliothèque. Qui peut lire ou écrire quoi est décidé par le
   serveur (règles de sécurité : firebase/firestore.rules).
   Configuration : js/cloud-config.js (window.SOHRI_CLOUD = { apiKey, projectId }), ajouté à la mise
   en ligne et à la construction de l'APK, jamais dans le dépôt.

   Données en ligne : users/{id} (nom, code), ses contacts, et les rubriques qu'il partage (albums,
   photos en morceaux) ; grants/{propriétaire}_{proche} : rubriques montrées à un proche.
   Sur le téléphone : magasin « cloud » (session, cache, état des envois), « sharedAlbums » et
   « sharedPhotos » (ce que les proches partagent, gardé pour le hors connexion). Rien de tout ça
   n'entre dans les sauvegardes. */
var CLOUD = window.SOHRI_CLOUD || null;
var CLOUD_CATEGORIES = { albums: { icon: '🖼️', label: 'Images' } };
var SHARE_PHOTO_SIZE = 1600;       // photos envoyées : réduites (1 Go gratuit pour tout le monde)
var SHARE_PHOTO_QUALITY = 0.8;
var SHARE_THUMB_MAX = 180 * 1024;
var PHOTO_PART_SIZE = 900 * 1024;  // un document Firestore ne dépasse pas 1 Mo
var CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans 0, O, 1, I : pas de confusion
var PASSWORD_MIN = 8;
var SYNC_QUERY_PAGE = 40;

var cloudSession = null;  // { uid, email, refreshToken, idToken, expiresAt }
var cloudState = { profile: null, contacts: [], myGrants: {}, grantsToMe: [], deviceId: null };
var cloudStatus = { state: 'idle', progress: null, lastSync: 0, error: null };
var cloudListeners = [];
var cloudRefreshing = null;
var cloudSyncRunning = null;
var cloudSyncAgain = false;
var cloudPublishTimer = null;

function cloudEnabled() {
  return !!(CLOUD && CLOUD.apiKey && CLOUD.projectId);
}

function isSignedIn() {
  return !!cloudSession;
}

function cloudUrls() {
  var emulator = CLOUD.emulator; // essais sur l'émulateur Firebase (jamais dans l'appli publiée)
  var google = emulator ? emulator.auth + '/' : 'https://';
  return {
    auth: google + 'identitytoolkit.googleapis.com/v1/accounts:',
    token: google + 'securetoken.googleapis.com/v1/token',
    docs: (emulator ? emulator.firestore : 'https://firestore.googleapis.com') + '/v1/projects/' + CLOUD.projectId + '/databases/(default)/documents',
    root: 'projects/' + CLOUD.projectId + '/databases/(default)/documents'
  };
}

/* Abonnement aux changements : fn(what, detail). what : 'status' (synchronisation), 'data' (compte,
   contacts, partages), 'shared' (albums reçus), 'photo:<clé>' (photo reçue), 'comment' (commentaires
   d'une photo, detail = sa clé), 'comments' (nouveaux commentaires reçus, detail = leur nombre). */
function onCloudChange(fn) {
  cloudListeners.push(fn);
}
function notifyCloud(what, detail) {
  cloudListeners.forEach(function (fn) {
    try { fn(what, detail); } catch (e) { console.error(e); }
  });
}
function setCloudStatus(state, extra) {
  cloudStatus.state = state;
  cloudStatus.progress = (extra && extra.progress) || null;
  cloudStatus.error = (extra && extra.error) || null;
  if (state === 'done') cloudStatus.lastSync = Date.now();
  notifyCloud('status');
}

/* ---------- Requêtes ---------- */
function cloudError(code, message) {
  var err = new Error(message || code);
  err.cloud = code;
  return err;
}

function cloudFetch(url, options) {
  return fetch(url, options).then(function (response) {
    return response.text().then(function (text) {
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* réponse sans JSON */ }
      if (response.ok) return json;
      var error = json && (Array.isArray(json) ? json[0] && json[0].error : json.error);
      var message = (error && (error.message || error.status)) || 'HTTP ' + response.status;
      var code = response.status === 403 ? 'denied' : response.status === 404 ? 'not-found'
        : response.status === 401 ? 'auth' : response.status >= 500 || response.status === 429 ? 'server' : 'request';
      throw cloudError(code, message);
    });
  }, function () {
    throw cloudError('offline', 'Pas de connexion Internet');
  });
}

/* Message compréhensible pour une erreur du serveur. */
function cloudErrorText(err) {
  var m = (err && err.message) || '';
  if (err && err.cloud === 'offline') return 'Pas de connexion Internet.';
  if (/^EMAIL_EXISTS/.test(m)) return 'Un compte existe déjà avec cette adresse e-mail.';
  if (/^INVALID_EMAIL/.test(m)) return 'Adresse e-mail invalide.';
  if (/^WEAK_PASSWORD/.test(m)) return 'Mot de passe trop faible (' + PASSWORD_MIN + ' caractères minimum).';
  if (/^(INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND)/.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/^TOO_MANY_ATTEMPTS/.test(m)) return "Trop d'essais : réessaie dans quelques minutes.";
  if (/^USER_DISABLED/.test(m)) return 'Ce compte est désactivé.';
  if (/^CREDENTIAL_TOO_OLD/.test(m)) return 'Reconnecte-toi, puis recommence.';
  if (err && err.cloud === 'signed-out') return 'Ta session a expiré : reconnecte-toi.';
  if (err && err.cloud === 'denied') return "Le serveur a refusé l'opération.";
  if (err && err.userMessage) return err.userMessage;
  return 'Le serveur ne répond pas pour le moment (' + m + '). Réessaie plus tard.';
}

function authRequest(method, body) {
  return cloudFetch(cloudUrls().auth + method + '?key=' + encodeURIComponent(CLOUD.apiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

/* ---------- Session ---------- */
function storeSession(data, email) {
  cloudSession = {
    uid: data.localId || data.user_id,
    email: email || data.email || (cloudSession && cloudSession.email) || '',
    refreshToken: data.refreshToken || data.refresh_token,
    idToken: data.idToken || data.id_token,
    expiresAt: Date.now() + (parseInt(data.expiresIn || data.expires_in, 10) - 120) * 1000
  };
  return dbPut('cloud', { key: 'session', value: cloudSession }).then(function () { return cloudSession; });
}

/* Jeton d'accès valable (renouvelé toutes les heures avec le jeton de longue durée). */
function idToken() {
  if (!cloudSession) return Promise.reject(cloudError('signed-out'));
  if (cloudSession.idToken && Date.now() < cloudSession.expiresAt) return Promise.resolve(cloudSession.idToken);
  if (!cloudRefreshing) {
    cloudRefreshing = cloudFetch(cloudUrls().token + '?key=' + encodeURIComponent(CLOUD.apiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cloudSession.refreshToken)
    }).then(function (data) {
      return storeSession(data);
    }, function (err) {
      // Jeton refusé : compte supprimé, désactivé, ou mot de passe changé ailleurs.
      if (err.cloud !== 'offline' && err.cloud !== 'server') err.cloud = 'signed-out';
      throw err;
    });
    cloudRefreshing.then(function () { cloudRefreshing = null; }, function () { cloudRefreshing = null; });
  }
  return cloudRefreshing.then(function (session) { return session.idToken; });
}

/* ---------- Firestore : valeurs, documents, requêtes ---------- */
function bytesToBase64(bytes) {
  var binary = '';
  for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function base64ToBytes(text) {
  var binary = atob(text);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Math.floor(v) === v ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Uint8Array) return { bytesValue: bytesToBase64(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
function toFields(obj) {
  var fields = {};
  Object.keys(obj).forEach(function (key) { fields[key] = toValue(obj[key]); });
  return fields;
}
function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue; // texte : se compare et sert de repère
  if ('bytesValue' in v) return base64ToBytes(v.bytesValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(fields) {
  var obj = {};
  Object.keys(fields || {}).forEach(function (key) { obj[key] = fromValue(fields[key]); });
  return obj;
}
function decodeDoc(doc) {
  var data = fromFields(doc.fields);
  data._id = doc.name.split('/').pop();
  data._name = doc.name;
  return data;
}

function fsRequest(method, path, body, anonymous) {
  function send(token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return cloudFetch(cloudUrls().docs + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  }
  return anonymous ? send(null) : idToken().then(send);
}

/* Document (ou null s'il n'existe pas). */
function fsGet(path, anonymous) {
  return fsRequest('GET', '/' + path, null, anonymous).then(decodeDoc, function (err) {
    if (err.cloud === 'not-found') return null;
    throw err;
  });
}

/* Écritures groupées, toutes réussies ou toutes refusées. */
function fsCommit(writes) {
  return writes.length ? fsRequest('POST', ':commit', { writes: writes }) : Promise.resolve();
}
/* options : time (champs mis à l'heure du serveur), mask (seuls ces champs sont modifiés),
   create (refusé si le document existe déjà). */
function fsSet(path, fields, options) {
  options = options || {};
  var write = { update: { name: cloudUrls().root + '/' + path, fields: toFields(fields) } };
  if (options.mask) write.updateMask = { fieldPaths: options.mask };
  if (options.create) write.currentDocument = { exists: false };
  if (options.time) write.updateTransforms = options.time.map(function (f) { return { fieldPath: f, setToServerValue: 'REQUEST_TIME' }; });
  return write;
}
function fsDelete(path) {
  return { 'delete': cloudUrls().root + '/' + path };
}

function fsQuery(parent, query) {
  return fsRequest('POST', (parent ? '/' + parent : '') + ':runQuery', { structuredQuery: query }).then(function (rows) {
    return (rows || []).filter(function (row) { return row.document; }).map(function (row) { return decodeDoc(row.document); });
  });
}
function fieldEquals(field, value) {
  return { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } };
}

/* Documents d'une collection modifiés depuis « since » (heure du serveur), page par page, par
   ordre de modification : onPage(docs) pour chaque page. Promesse : dernière heure vue. */
function fsChangesSince(parent, collection, since, onPage, select) {
  var cursor = null;
  var last = since;
  function next() {
    var query = {
      from: [{ collectionId: collection }],
      orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: SYNC_QUERY_PAGE
    };
    if (select) query.select = { fields: select.map(function (f) { return { fieldPath: f }; }) };
    if (since) query.where = { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { timestampValue: since } } };
    if (cursor) query.startAt = { values: [{ timestampValue: cursor.updatedAt }, { referenceValue: cursor._name }], before: false };
    return fsQuery(parent, query).then(function (docs) {
      if (!docs.length) return last;
      cursor = docs[docs.length - 1];
      last = cursor.updatedAt; // pages par ordre de modification : la dernière est la plus récente
      return Promise.resolve(onPage(docs)).then(function () {
        return docs.length < SYNC_QUERY_PAGE ? last : next();
      });
    });
  }
  return next();
}

/* Tous les documents d'une collection (sans leur contenu si namesOnly). */
function fsListAll(parent, collection, namesOnly) {
  var all = [];
  function next(pageToken) {
    var query = '?pageSize=300' + (namesOnly ? '&mask.fieldPaths=_' : '') + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    return fsRequest('GET', '/' + parent + '/' + collection + query).then(function (page) {
      ((page && page.documents) || []).forEach(function (doc) { all.push(decodeDoc(doc)); });
      return page && page.nextPageToken ? next(page.nextPageToken) : all;
    });
  }
  return next(null);
}

/* ---------- Petits outils ---------- */
function randomText(alphabet, length) {
  var values = new Uint8Array(length);
  crypto.getRandomValues(values);
  var text = '';
  for (var i = 0; i < length; i++) text += alphabet.charAt(values[i] % alphabet.length);
  return text;
}
function newPersonalCode() {
  var raw = randomText(CODE_ALPHABET, 8);
  return raw.slice(0, 4) + '-' + raw.slice(4);
}
/* « k7f2 9qx4 » → « K7F2-9QX4 » ; null si ce n'est pas un code. */
function normalizeCode(text) {
  var raw = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (raw.length !== 8) return null;
  var code = raw.slice(0, 4) + '-' + raw.slice(4);
  return /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(code) ? code : null;
}
function cloudName(text, max) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
}
/* Texte sur plusieurs lignes (description, commentaire) : voir tidyText (ui.js). */
function cloudText(text, max) {
  return tidyText(text, max);
}
/* Heure du serveur (texte RFC 3339, jusqu'à 9 décimales) en millisecondes. */
function serverTime(text) {
  return Date.parse(String(text || '').replace(/(\.\d{3})\d+/, '$1')) || 0;
}
function userPath(uid) {
  return 'users/' + (uid || cloudSession.uid);
}
function cloudGet(key) {
  return dbGet('cloud', key).then(function (row) { return row ? row.value : null; });
}
function cloudPut(key, value) {
  return dbPut('cloud', { key: key, value: value });
}

/* ---------- Démarrage ---------- */
function cloudStart() {
  if (!cloudEnabled()) return Promise.resolve();
  return Promise.all([cloudGet('session'), cloudGet('profile'), cloudGet('contacts'), cloudGet('myGrants'), cloudGet('grantsToMe'), deviceId()])
    .then(function (r) {
      cloudSession = r[0];
      cloudState.profile = r[1];
      cloudState.contacts = r[2] || [];
      cloudState.myGrants = r[3] || {};
      cloudState.grantsToMe = r[4] || [];
      notifyCloud('data');
      if (cloudSession) syncNow();
    })['catch'](function (err) { console.error(err); });
}

/* Identifiant de cet appareil : celui qui envoie les photos partagées (voir publishAlbums). */
function deviceId() {
  if (cloudState.deviceId) return Promise.resolve(cloudState.deviceId);
  return cloudGet('device').then(function (id) {
    if (id) return (cloudState.deviceId = id);
    id = randomText('0123456789abcdefghijklmnopqrstuvwxyz', 12);
    return cloudPut('device', id).then(function () { return (cloudState.deviceId = id); });
  });
}

/* ---------- Compte ---------- */
/* Inscription : { name, email, password, invite }. Le tout premier compte n'a pas besoin d'invitation. */
function cloudSignUp(form) {
  var name = cloudName(form.name);
  var invite = form.invite ? normalizeCode(form.invite) : null;
  if (!name) return Promise.reject(userError('Indique ton prénom.'));
  if (form.invite && !invite) return Promise.reject(userError("Ce code d'invitation n'est pas valable (8 caractères, par exemple K7F2-9QX4)."));
  if (String(form.password || '').length < PASSWORD_MIN) return Promise.reject(userError('Mot de passe trop court (' + PASSWORD_MIN + ' caractères minimum).'));
  var inviter = null;
  return fsGet('meta/bootstrap', true).then(function (bootstrap) {
    if (!bootstrap) return null; // premier compte du projet
    if (!invite) throw userError("Il faut le code d'invitation d'un proche déjà inscrit.");
    return fsGet('codes/' + invite, true).then(function (code) {
      if (!code) throw userError("Code d'invitation inconnu : vérifie-le auprès de la personne qui te l'a donné.");
      inviter = { uid: code.uid, name: code.name, code: invite };
    });
  }).then(function () {
    return authRequest('signUp', { email: String(form.email || '').trim(), password: form.password, returnSecureToken: true });
  }).then(function (data) {
    return storeSession(data, String(form.email || '').trim());
  }).then(function () {
    return createProfile(name, inviter, 0)['catch'](function (err) {
      // Profil impossible à créer : le compte tout juste créé est retiré, pour pouvoir recommencer.
      return authRequest('delete', { idToken: cloudSession.idToken }).then(null, function () {}).then(function () {
        return forgetAccount();
      }).then(function () {
        if (err.cloud === 'denied') throw userError("Inscription refusée : il faut le code d'invitation d'un proche déjà inscrit.");
        throw err;
      });
    });
  }).then(function () {
    syncNow();
  });
}

function createProfile(name, inviter, attempt) {
  var code = newPersonalCode();
  var me = userPath();
  var writes = [
    fsSet(me, { name: name, code: code, invitedBy: inviter ? inviter.uid : null, invitedWith: inviter ? inviter.code : null }, { time: ['createdAt'] }),
    fsSet('codes/' + code, { uid: cloudSession.uid, name: name })
  ];
  if (!inviter) writes.push(fsSet('meta/bootstrap', { uid: cloudSession.uid }));
  else writes.push(fsSet(me + '/contacts/' + inviter.uid, { name: cloudName(inviter.name), code: inviter.code }, { time: ['addedAt'] }));
  return fsCommit(writes).then(function () {
    cloudState.profile = { name: name, code: code, sources: {} };
    cloudState.contacts = inviter ? [{ uid: inviter.uid, name: cloudName(inviter.name), code: inviter.code }] : [];
    return Promise.all([cloudPut('profile', cloudState.profile), cloudPut('contacts', cloudState.contacts)]);
  }, function (err) {
    // Code déjà pris par quelqu'un (très rare) : on en tire un autre.
    if (err.cloud === 'denied' && attempt < 2) return createProfile(name, inviter, attempt + 1);
    throw err;
  }).then(function () { notifyCloud('data'); });
}

function userError(message) {
  var err = new Error(message);
  err.userMessage = message;
  return err;
}

function cloudSignIn(email, password) {
  var previous = cloudSession && cloudSession.uid;
  email = String(email || '').trim();
  return authRequest('signInWithPassword', { email: email, password: password, returnSecureToken: true }).then(function (data) {
    // Autre compte que le précédent : rien de ce qui le concernait ne doit rester sur le téléphone.
    return (previous && previous !== data.localId ? clearCloudData() : Promise.resolve()).then(function () {
      return storeSession(data, email);
    });
  }).then(function () {
    return fsGet(userPath());
  }).then(function (profile) {
    if (!profile) {
      return forgetAccount().then(function () {
        throw userError("Ce compte n'a pas de profil SOHRI (inscription inachevée ou supprimée).");
      });
    }
    cloudState.profile = { name: profile.name, code: profile.code, sources: profile.sources || {} };
    return cloudPut('profile', cloudState.profile);
  }).then(function () {
    notifyCloud('data');
    syncNow();
  });
}

function cloudResetPassword(email) {
  return authRequest('sendOobCode', { requestType: 'PASSWORD_RESET', email: String(email || '').trim() });
}

/* Déconnexion : le téléphone oublie le compte et tout ce que les proches y avaient partagé.
   Les rubriques partagées restent en ligne (visibles des proches) tant que le compte existe. */
function cloudSignOut() {
  return forgetAccount().then(function () { notifyCloud('data'); });
}

function forgetAccount() {
  cloudSession = null;
  return clearCloudData();
}

function clearCloudData() {
  cloudState.profile = null;
  cloudState.contacts = [];
  cloudState.myGrants = {};
  cloudState.grantsToMe = [];
  return dbGetAll('cloud').then(function (rows) {
    return dbWrite(['cloud', 'sharedAlbums', 'sharedPhotos', 'sharedComments'], function (tx) {
      rows.forEach(function (row) { if (row.key !== 'device') tx.objectStore('cloud')['delete'](row.key); });
      tx.objectStore('sharedAlbums').clear();
      tx.objectStore('sharedPhotos').clear();
      tx.objectStore('sharedComments').clear();
    });
  });
}

/* Change le nom visible des proches (profil, code personnel, partages). */
function cloudRename(newName) {
  var name = cloudName(newName);
  if (!name) return Promise.reject(userError('Indique un nom.'));
  var writes = [
    fsSet(userPath(), { name: name }, { mask: ['name'] }),
    fsSet('codes/' + cloudState.profile.code, { uid: cloudSession.uid, name: name })
  ];
  Object.keys(cloudState.myGrants).forEach(function (to) {
    writes.push(fsSet('grants/' + cloudSession.uid + '_' + to, { ownerName: name }, { mask: ['ownerName'], time: ['updatedAt'] }));
  });
  return fsCommit(writes).then(function () {
    cloudState.profile.name = name;
    return cloudPut('profile', cloudState.profile);
  }).then(function () { notifyCloud('data'); });
}

/* Suppression du compte : tout ce qui est en ligne est effacé (mot de passe demandé à nouveau). */
var MY_COLLECTIONS = ['albums', 'photos', 'photoParts', 'comments', 'contacts'];

function cloudDeleteAccount(password) {
  var uid = cloudSession.uid;
  var me = userPath();
  return authRequest('signInWithPassword', { email: cloudSession.email, password: password, returnSecureToken: true }).then(function (data) {
    return storeSession(data);
  }).then(function () {
    return deleteMyCommentsElsewhere();
  }).then(function () {
    return Promise.all(MY_COLLECTIONS.map(function (c) { return fsListAll(me, c, true); }));
  }).then(function (lists) {
    var paths = [];
    lists.forEach(function (docs, i) {
      docs.forEach(function (doc) { paths.push(me + '/' + MY_COLLECTIONS[i] + '/' + doc._id); });
    });
    return fsQuery(null, { from: [{ collectionId: 'grants' }], where: fieldEquals('owner', uid) }).then(function (grants) {
      grants.forEach(function (g) { paths.push('grants/' + g._id); });
      return deleteInBatches(paths);
    });
  }).then(function () {
    return fsCommit([fsDelete('codes/' + cloudState.profile.code), fsDelete(me)]);
  }).then(function () {
    return authRequest('delete', { idToken: cloudSession.idToken });
  }).then(function () {
    return forgetAccount();
  }).then(function () { notifyCloud('data'); });
}

/* Mes commentaires sur les photos des proches : effacés (une trace datée les retire aussi chez eux). */
function deleteMyCommentsElsewhere() {
  var uid = cloudSession.uid;
  return commentOwnerList().filter(function (owner) { return owner !== uid; }).reduce(function (chain, owner) {
    return chain.then(function () {
      return fsQuery(userPath(owner), { from: [{ collectionId: 'comments' }], where: fieldEquals('author', uid) }).then(function (mine) {
        return fsCommit(mine.filter(function (c) { return !c.deleted; }).map(function (c) {
          return fsSet(userPath(owner) + '/comments/' + c._id, { deleted: true, photo: c.photo }, { time: ['updatedAt'] });
        }));
      })['catch'](function (err) {
        if (err.cloud === 'offline') throw err; // sinon : plus d'accès à ses photos, rien à effacer
      });
    });
  }, Promise.resolve());
}

function deleteInBatches(paths) {
  var batches = [];
  for (var i = 0; i < paths.length; i += 400) batches.push(paths.slice(i, i + 400));
  return batches.reduce(function (chain, batch) {
    return chain.then(function () { return fsCommit(batch.map(fsDelete)); });
  }, Promise.resolve());
}

/* ---------- Contacts ---------- */
function cloudAddContact(text) {
  var code = normalizeCode(text);
  if (!code) return Promise.reject(userError('Ce code ne semble pas valable (8 caractères, par exemple K7F2-9QX4).'));
  if (cloudState.profile && code === cloudState.profile.code) return Promise.reject(userError("C'est ton propre code !"));
  return fsGet('codes/' + code).then(function (found) {
    if (!found) throw userError('Aucun membre avec ce code.');
    var contact = { uid: found.uid, name: cloudName(found.name), code: code };
    return fsCommit([fsSet(userPath() + '/contacts/' + found.uid, { name: contact.name, code: code }, { time: ['addedAt'] })]).then(function () {
      cloudState.contacts = cloudState.contacts.filter(function (c) { return c.uid !== contact.uid; }).concat([contact]);
      return cloudPut('contacts', cloudState.contacts);
    }).then(function () {
      notifyCloud('data');
      return contact;
    });
  });
}

/* Retire un contact : il ne voit plus rien de ce qu'on partageait avec lui. */
function cloudRemoveContact(uid) {
  var writes = [fsDelete(userPath() + '/contacts/' + uid)];
  if (cloudState.myGrants[uid]) writes.push(fsDelete('grants/' + cloudSession.uid + '_' + uid));
  return fsCommit(writes).then(function () {
    cloudState.contacts = cloudState.contacts.filter(function (c) { return c.uid !== uid; });
    delete cloudState.myGrants[uid];
    return Promise.all([cloudPut('contacts', cloudState.contacts), cloudPut('myGrants', cloudState.myGrants)]);
  }).then(function () {
    notifyCloud('data');
    syncNow();
  });
}

/* Contacts en ligne, plus les proches inscrits avec mon code (ajoutés automatiquement). */
function syncContacts() {
  var me = userPath();
  return Promise.all([
    fsListAll(me, 'contacts'),
    fsQuery(null, { from: [{ collectionId: 'users' }], where: fieldEquals('invitedBy', cloudSession.uid) })
  ]).then(function (r) {
    var contacts = r[0].map(function (c) { return { uid: c._id, name: c.name, code: c.code }; });
    var known = mapByUid(contacts);
    var added = r[1].filter(function (u) { return !known[u._id] && u.code; });
    return fsCommit(added.map(function (u) {
      return fsSet(me + '/contacts/' + u._id, { name: cloudName(u.name), code: u.code }, { time: ['addedAt'] });
    })).then(function () {
      cloudState.contacts = contacts.concat(added.map(function (u) { return { uid: u._id, name: cloudName(u.name), code: u.code }; }));
      return cloudPut('contacts', cloudState.contacts);
    });
  });
}

function mapByUid(list) {
  var map = {};
  list.forEach(function (item) { map[item.uid] = item; });
  return map;
}

/* ---------- Partages ---------- */
function sharedWith(category) {
  return Object.keys(cloudState.myGrants).filter(function (to) { return cloudState.myGrants[to].indexOf(category) >= 0; });
}

function albumsSource() {
  return (cloudState.profile && cloudState.profile.sources && cloudState.profile.sources.albums) || null;
}

/* Montre (ou non) une rubrique à un contact. Le premier partage fait de cet appareil celui qui
   envoie les photos ; le dernier retiré efface les photos en ligne. */
function cloudSetShare(category, to, enabled) {
  var categories = (cloudState.myGrants[to] || []).filter(function (c) { return c !== category; });
  if (enabled) categories.push(category);
  var path = 'grants/' + cloudSession.uid + '_' + to;
  var write = categories.length
    ? fsSet(path, { owner: cloudSession.uid, to: to, ownerName: cloudState.profile.name, categories: categories }, { time: ['updatedAt'] })
    : fsDelete(path);
  return deviceId().then(function (device) {
    var writes = [write];
    if (enabled && category === 'albums' && !albumsSource()) {
      cloudState.profile.sources = Object.assign({}, cloudState.profile.sources, { albums: device });
      writes.push(fsSet(userPath(), { sources: cloudState.profile.sources }, { mask: ['sources'] }));
    }
    return fsCommit(writes);
  }).then(function () {
    if (categories.length) cloudState.myGrants[to] = categories;
    else delete cloudState.myGrants[to];
    return Promise.all([cloudPut('myGrants', cloudState.myGrants), cloudPut('profile', cloudState.profile)]);
  }).then(function () {
    notifyCloud('data');
    if (!enabled && category === 'albums' && !sharedWith('albums').length) return unpublishAlbums().then(function () { syncNow(); });
    syncNow();
  });
}

/* Les photos seront envoyées depuis cet appareil (à la place d'un autre). */
function cloudUseThisDevice(category) {
  return deviceId().then(function (device) {
    var sources = Object.assign({}, cloudState.profile.sources);
    sources[category] = device;
    return fsCommit([fsSet(userPath(), { sources: sources }, { mask: ['sources'] })]).then(function () {
      cloudState.profile.sources = sources;
      return Promise.all([cloudPut('profile', cloudState.profile), cloudPut('pubReady', null)]);
    });
  }).then(function () {
    notifyCloud('data');
    syncNow();
  });
}

function loadMyProfile() {
  return fsGet(userPath()).then(function (profile) {
    if (!profile) throw cloudError('signed-out', 'Profil introuvable');
    cloudState.profile = { name: profile.name, code: profile.code, sources: profile.sources || {} };
    return cloudPut('profile', cloudState.profile);
  });
}

function loadGrants() {
  return Promise.all([
    fsQuery(null, { from: [{ collectionId: 'grants' }], where: fieldEquals('owner', cloudSession.uid) }),
    fsQuery(null, { from: [{ collectionId: 'grants' }], where: fieldEquals('to', cloudSession.uid) })
  ]).then(function (r) {
    cloudState.myGrants = {};
    r[0].forEach(function (g) { if (g.categories && g.categories.length) cloudState.myGrants[g.to] = g.categories; });
    cloudState.grantsToMe = r[1].filter(function (g) { return g.categories && g.categories.length; }).map(function (g) {
      return { owner: g.owner, name: g.ownerName, categories: g.categories };
    }).sort(byName);
    return Promise.all([cloudPut('myGrants', cloudState.myGrants), cloudPut('grantsToMe', cloudState.grantsToMe)]);
  });
}

/* ---------- Synchronisation ---------- */
function syncNow() {
  if (!cloudEnabled() || !cloudSession) return Promise.resolve();
  if (cloudSyncRunning) {
    cloudSyncAgain = true;
    return cloudSyncRunning;
  }
  setCloudStatus('syncing');
  cloudSyncRunning = loadMyProfile()
    .then(syncContacts)
    .then(loadGrants)
    .then(function () { notifyCloud('data'); })
    .then(publishAlbums)
    .then(sendPendingComments)
    .then(receiveShares)
    .then(syncComments)
    .then(downloadSharedPhotos)
    .then(function () {
      setCloudStatus('done');
    }, function (err) {
      if (err.cloud !== 'offline') console.warn('Synchronisation interrompue', err);
      setCloudStatus(err.cloud === 'offline' ? 'offline' : err.cloud === 'signed-out' ? 'signed-out' : 'error', { error: err });
    })
    .then(function () {
      cloudSyncRunning = null;
      if (cloudSyncAgain) {
        cloudSyncAgain = false;
        return syncNow();
      }
    });
  return cloudSyncRunning;
}

/* Après une modification des albums ou des photos : envoi quelques secondes plus tard. */
function schedulePublish() {
  if (!cloudSession || !sharedWith('albums').length) return;
  clearTimeout(cloudPublishTimer);
  cloudPublishTimer = setTimeout(syncNow, 3000);
}

/* ---------- Envoi des albums partagés (depuis l'appareil choisi) ----------
   Chaque album et chaque photo a un identifiant tiré de ses propres données (date d'ajout...) :
   une photo envoyée deux fois (autre appareil, sauvegarde restaurée) garde le même. L'état des
   envois est gardé dans le magasin « cloud » (clés « pub:... »). */
function albumRemoteId(album) {
  return 'a' + (album.createdAt ? album.createdAt.toString(36) : 'n' + album.id);
}
function photoRemoteId(photo) {
  return 'p' + [photo.createdAt || 0, photo.takenAt || 0, photo.blob ? photo.blob.size : 0].map(function (n) { return n.toString(36); }).join('-');
}

function loadPublished() {
  return dbGetAll('cloud').then(function (rows) {
    var map = {};
    rows.forEach(function (row) { if (row.key.indexOf('pub:') === 0) map[row.value.rid] = row.value; });
    return map;
  });
}
function savePublished(record) {
  return cloudPut('pub:' + record.rid, record);
}
function forgetPublished(rid) {
  return dbDelete('cloud', 'pub:' + rid);
}

function publishAlbums() {
  return deviceId().then(function (device) {
    // Rien à envoyer d'ici (pas de partage, ou un autre appareil envoie les photos) : l'état local
    // des envois ne vaut plus, il sera reconstruit si cet appareil redevient celui qui envoie.
    if (!sharedWith('albums').length || albumsSource() !== device) return forgetPublishedState();
    return cloudGet('pubReady').then(function (ready) {
      return ready === cloudSession.uid ? null : reconcilePublished();
    }).then(function () {
      return Promise.all([dbGetAll('folders'), dbGetAll('photos'), loadPublished()]);
    }).then(function (r) {
      return publishChanges(r[0].filter(isAlbum), r[1], r[2]);
    });
  });
}

function forgetPublishedState() {
  return dbGetAll('cloud').then(function (rows) {
    var keys = rows.map(function (row) { return row.key; }).filter(function (key) { return key.indexOf('pub:') === 0 || key === 'pubReady'; });
    if (!keys.length) return null;
    return dbWrite(['cloud'], function (tx) {
      keys.forEach(function (key) { tx.objectStore('cloud')['delete'](key); });
    });
  });
}

/* Première fois (ou après une nouvelle connexion) : l'état des envois est reconstruit d'après ce
   qui est déjà en ligne, pour ne rien renvoyer inutilement. */
function reconcilePublished() {
  var me = userPath();
  return forgetPublishedState().then(function () {
    return Promise.all([fsListAll(me, 'albums'), fsListPhotoIndex(me)]);
  }).then(function (r) {
    var records = [];
    r[0].forEach(function (a) { if (!a.deleted) records.push({ kind: 'album', rid: a._id, name: a.name, icon: a.icon }); });
    r[1].forEach(function (p) {
      if (!p.deleted) records.push({ kind: 'photo', rid: p._id, album: p.album, parts: p.parts, caption: p.caption || '', location: p.location || '' });
    });
    return Promise.all(records.map(savePublished));
  }).then(function () {
    return cloudPut('pubReady', cloudSession.uid);
  });
}

/* Liste des photos en ligne, sans les miniatures (album, morceaux, description, lieu, suppression). */
function fsListPhotoIndex(parent) {
  var all = [];
  return fsChangesSince(parent, 'photos', null, function (docs) { all = all.concat(docs); }, ['album', 'parts', 'caption', 'location', 'deleted', 'updatedAt'])
    .then(function () { return all; });
}

function photoCaption(photo) {
  return cloudText(photo.caption, 2000);
}
function photoLocation(photo) {
  return cloudName(photo.location, 100);
}

function publishChanges(albums, photos, published) {
  var me = userPath();
  var tasks = [];
  var albumIds = {};
  albums.forEach(function (album) {
    var rid = albumRemoteId(album);
    var name = cloudName(album.name, 100) || 'Album';
    var icon = cloudName(folderIcon(album), 32);
    albumIds[album.id] = rid;
    var done = published[rid];
    if (!done || done.name !== name || done.icon !== icon) {
      tasks.push(function () {
        return fsCommit([fsSet(me + '/albums/' + rid, { name: name, icon: icon }, { time: ['updatedAt'] })]).then(function () {
          return savePublished({ kind: 'album', rid: rid, name: name, icon: icon });
        });
      });
    }
  });
  var wanted = {};
  var uploads = [];
  photos.forEach(function (photo) {
    var album = albumIds[photo.albumId];
    if (!album || !photo.blob) return;
    var rid = photoRemoteId(photo);
    wanted[rid] = true;
    var done = published[rid];
    var caption = photoCaption(photo);
    var location = photoLocation(photo);
    if (!done) uploads.push({ photo: photo, rid: rid, album: album });
    else if (done.album !== album || (done.caption || '') !== caption || (done.location || '') !== location) {
      // Déplacée dans un autre album, ou description / lieu modifiés (effacés si vides).
      tasks.push(function () {
        var fields = { album: album };
        if (caption) fields.caption = caption;
        if (location) fields.location = location;
        return fsCommit([fsSet(me + '/photos/' + rid, fields, { mask: ['album', 'caption', 'location'], time: ['updatedAt'] })]).then(function () {
          done.album = album;
          done.caption = caption;
          done.location = location;
          return savePublished(done);
        });
      });
    }
  });
  uploads.sort(function (a, b) { return (a.photo.takenAt || 0) - (b.photo.takenAt || 0); });
  uploads.forEach(function (item, i) {
    tasks.push(function () {
      setCloudStatus('syncing', { progress: { label: 'Envoi des photos partagées', done: i, total: uploads.length } });
      return uploadPhoto(item.photo, item.rid, item.album);
    });
  });
  // Photos, puis albums supprimés : une trace datée prévient les proches ; les commentaires de la
  // photo sont effacés avec elle.
  Object.keys(published).forEach(function (rid) {
    var done = published[rid];
    if (done.kind === 'photo' && !wanted[rid]) {
      tasks.push(function () {
        return fsQuery(me, { from: [{ collectionId: 'comments' }], where: fieldEquals('photo', rid), select: { fields: [{ fieldPath: 'photo' }] } }).then(function (comments) {
          var writes = [fsSet(me + '/photos/' + rid, { deleted: true }, { time: ['updatedAt'] })];
          for (var i = 0; i < (done.parts || 1); i++) writes.push(fsDelete(me + '/photoParts/' + rid + '-' + i));
          comments.forEach(function (c) { writes.push(fsDelete(me + '/comments/' + c._id)); });
          return fsCommit(writes);
        }).then(function () {
          return dbWrite(['sharedComments'], function (tx) { deleteCommentsOfPhoto(tx, cloudSession.uid + '/' + rid); });
        }).then(function () { return forgetPublished(rid); });
      });
    }
  });
  var liveAlbums = {};
  Object.keys(albumIds).forEach(function (id) { liveAlbums[albumIds[id]] = true; });
  Object.keys(published).forEach(function (rid) {
    if (published[rid].kind === 'album' && !liveAlbums[rid]) {
      tasks.push(function () {
        return fsCommit([fsSet(me + '/albums/' + rid, { deleted: true }, { time: ['updatedAt'] })]).then(function () { return forgetPublished(rid); });
      });
    }
  });
  return tasks.reduce(function (chain, task) { return chain.then(task); }, Promise.resolve());
}

/* Une photo : réduite (1600 px), en morceaux de moins de 1 Mo, avec sa miniature. */
function uploadPhoto(photo, rid, album) {
  var me = userPath();
  return loadImage(photo.blob).then(function (img) {
    return drawJpeg(img, SHARE_PHOTO_SIZE, SHARE_PHOTO_QUALITY);
  }).then(function (full) {
    return Promise.all([full.blob.arrayBuffer(), shareThumb(photo)]).then(function (r) {
      var bytes = new Uint8Array(r[0]);
      var writes = [];
      var parts = 0;
      for (var offset = 0; offset < bytes.length; offset += PHOTO_PART_SIZE) {
        writes.push(fsSet(me + '/photoParts/' + rid + '-' + parts, { photo: rid, index: parts, data: bytes.subarray(offset, offset + PHOTO_PART_SIZE) }));
        parts++;
      }
      var meta = {
        album: album, takenAt: Math.round(photo.takenAt || photo.createdAt || 0), width: full.width, height: full.height,
        thumb: r[1], parts: parts, size: bytes.length
      };
      var caption = photoCaption(photo);
      var location = photoLocation(photo);
      if (caption) meta.caption = caption;
      if (location) meta.location = location;
      writes.push(fsSet(me + '/photos/' + rid, meta, { time: ['updatedAt'] }));
      return fsCommit(writes).then(function () {
        return savePublished({ kind: 'photo', rid: rid, album: album, parts: parts, caption: caption, location: location });
      });
    });
  });
}

function shareThumb(photo) {
  var source = photo.thumb || photo.blob;
  if (photo.thumb && photo.thumb.size <= SHARE_THUMB_MAX) {
    return photo.thumb.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  return loadImage(source).then(function (img) { return drawJpeg(img, 320, 0.75); }).then(function (t) {
    return t.blob.arrayBuffer();
  }).then(function (b) { return new Uint8Array(b); });
}

/* Plus personne ne voit les Images : elles sont effacées du serveur, avec leurs commentaires. */
var ALBUM_COLLECTIONS = ['albums', 'photos', 'photoParts', 'comments'];

function unpublishAlbums() {
  var me = userPath();
  return Promise.all(ALBUM_COLLECTIONS.map(function (c) { return fsListAll(me, c, true); })).then(function (lists) {
    var paths = [];
    ALBUM_COLLECTIONS.forEach(function (c, i) {
      lists[i].forEach(function (doc) { paths.push(me + '/' + c + '/' + doc._id); });
    });
    return deleteInBatches(paths);
  }).then(function () {
    return dbGetAll('cloud');
  }).then(function (rows) {
    return dbWrite(['cloud'], function (tx) {
      rows.forEach(function (row) { if (row.key.indexOf('pub:') === 0) tx.objectStore('cloud')['delete'](row.key); });
    });
  }).then(function () {
    var sources = Object.assign({}, cloudState.profile.sources);
    delete sources.albums;
    return fsCommit([fsSet(userPath(), { sources: sources }, { mask: ['sources'] })]).then(function () {
      cloudState.profile.sources = sources;
      return Promise.all([cloudPut('profile', cloudState.profile), cloudPut('pubReady', null)]);
    });
  });
}

/* ---------- Réception : ce que les proches partagent avec moi ----------
   Seules les modifications depuis la dernière fois sont demandées ; tout est gardé sur le
   téléphone, pour le hors connexion. */
function receiveShares() {
  var owners = {};
  cloudState.grantsToMe.forEach(function (g) { if (g.categories.indexOf('albums') >= 0) owners[g.owner] = g; });
  return Promise.all([dbGetAll('sharedAlbums'), dbGetAll('sharedPhotos'), dbGetAll('cloud')]).then(function (r) {
    // Partage retiré : ses albums disparaissent du téléphone.
    var gone = {};
    r[0].concat(r[1]).forEach(function (item) { if (!owners[item.owner]) gone[item.owner] = true; });
    r[2].forEach(function (row) {
      if (row.key.indexOf('recv:') === 0 && !owners[row.key.slice(5)]) gone[row.key.slice(5)] = true;
    });
    return Object.keys(gone).reduce(function (chain, owner) {
      return chain.then(function () { return forgetOwner(owner); });
    }, Promise.resolve());
  }).then(function () {
    return Object.keys(owners).reduce(function (chain, owner) {
      return chain.then(function () { return receiveAlbums(owner); });
    }, Promise.resolve());
  });
}

function forgetOwner(owner) {
  return Promise.all([dbGetAllByIndex('sharedAlbums', 'owner', owner), dbGetAllByIndex('sharedPhotos', 'owner', owner)]).then(function (r) {
    return dbWrite(['sharedAlbums', 'sharedPhotos', 'cloud'], function (tx) {
      r[0].forEach(function (a) { tx.objectStore('sharedAlbums')['delete'](a.key); });
      r[1].forEach(function (p) { tx.objectStore('sharedPhotos')['delete'](p.key); });
      tx.objectStore('cloud')['delete']('recv:' + owner);
    });
  }).then(function () { notifyCloud('shared'); });
}

/* Supprime de ce téléphone les commentaires d'une photo (retirée par son propriétaire). */
function deleteCommentsOfPhoto(tx, photoKey) {
  var store = tx.objectStore('sharedComments');
  store.index('photoKey').openKeyCursor(IDBKeyRange.only(photoKey)).onsuccess = function (e) {
    var cursor = e.target.result;
    if (!cursor) return;
    store['delete'](cursor.primaryKey);
    cursor['continue']();
  };
}

function receiveAlbums(owner) {
  var parent = userPath(owner);
  var key = 'recv:' + owner;
  return cloudGet(key).then(function (state) {
    state = state || { albums: null, photos: null };
    return fsChangesSince(parent, 'albums', state.albums, function (docs) {
      return dbWrite(['sharedAlbums'], function (tx) {
        docs.forEach(function (doc) {
          var id = owner + '/' + doc._id;
          if (doc.deleted) tx.objectStore('sharedAlbums')['delete'](id);
          else tx.objectStore('sharedAlbums').put({ key: id, owner: owner, rid: doc._id, name: doc.name, icon: doc.icon });
        });
      });
    }).then(function (albumsSince) {
      state.albums = albumsSince;
      return cloudPut(key, state);
    }).then(function () {
      return fsChangesSince(parent, 'photos', state.photos, function (docs) {
        return Promise.all(docs.map(function (doc) { return dbGet('sharedPhotos', owner + '/' + doc._id); })).then(function (existing) {
          return dbWrite(['sharedPhotos', 'sharedComments'], function (tx) {
            docs.forEach(function (doc, i) {
              var id = owner + '/' + doc._id;
              if (doc.deleted) {
                tx.objectStore('sharedPhotos')['delete'](id);
                deleteCommentsOfPhoto(tx, id);
                return;
              }
              var old = existing[i];
              tx.objectStore('sharedPhotos').put({
                key: id, owner: owner, rid: doc._id, albumKey: owner + '/' + doc.album,
                takenAt: doc.takenAt, width: doc.width, height: doc.height, parts: doc.parts, size: doc.size,
                caption: doc.caption || '', location: doc.location || '',
                thumb: new Blob([doc.thumb], { type: 'image/jpeg' }),
                blob: old && old.size === doc.size ? old.blob : null
              });
            });
          });
        }).then(function () { notifyCloud('shared'); });
      });
    }).then(function (photosSince) {
      state.photos = photosSince;
      return cloudPut(key, state);
    });
  });
}

/* Photos en taille réelle, téléchargées en arrière-plan (hors connexion ensuite). */
function downloadSharedPhotos() {
  return dbGetAll('sharedPhotos').then(function (photos) {
    var missing = photos.filter(function (p) { return !p.blob; }).sort(function (a, b) { return (a.takenAt || 0) - (b.takenAt || 0); });
    return missing.reduce(function (chain, photo, i) {
      return chain.then(function () {
        setCloudStatus('syncing', { progress: { label: 'Réception des photos', done: i, total: missing.length } });
        return downloadSharedPhoto(photo);
      });
    }, Promise.resolve());
  });
}

/* Contenu d'une photo reçue (téléchargé si besoin) : promesse du Blob. */
function downloadSharedPhoto(photo) {
  var names = [];
  for (var i = 0; i < photo.parts; i++) names.push(cloudUrls().root + '/users/' + photo.owner + '/photoParts/' + photo.rid + '-' + i);
  return fsRequest('POST', ':batchGet', { documents: names }).then(function (rows) {
    var parts = [];
    (rows || []).forEach(function (row) {
      if (row.found) {
        var part = decodeDoc(row.found);
        parts[part.index] = part.data;
      }
    });
    if (parts.length !== photo.parts || parts.some(function (p) { return !p; })) throw cloudError('not-found', 'Photo incomplète');
    var blob = new Blob(parts, { type: 'image/jpeg' });
    return dbGet('sharedPhotos', photo.key).then(function (current) {
      if (!current) return blob; // retirée entre-temps
      current.blob = blob;
      return dbPut('sharedPhotos', current).then(function () {
        notifyCloud('photo:' + photo.key);
        return blob;
      });
    });
  });
}

/* ---------- Commentaires des photos ----------
   En ligne : users/{propriétaire}/comments/{id} (photo, auteur, texte). Sur le téléphone : magasin
   « sharedComments », clé « propriétaire/id », avec la photo (« photoKey » : propriétaire/photo),
   pending (pas encore envoyé : hors connexion) et unread (nouveau, écrit par quelqu'un d'autre). */
var COMMENT_MAX = 1000;

/* Clé d'une de mes photos pour les commentaires (null sans compte). */
function ownPhotoKey(photo) {
  return cloudSession ? cloudSession.uid + '/' + photoRemoteId(photo) : null;
}

/* Propriétaires dont je suis les commentaires : ceux qui me partagent leurs Images, et moi si je
   partage les miennes. */
function commentOwnerList() {
  var owners = {};
  cloudState.grantsToMe.forEach(function (g) { if (g.categories.indexOf('albums') >= 0) owners[g.owner] = true; });
  if (cloudSession && sharedWith('albums').length) owners[cloudSession.uid] = true;
  return Object.keys(owners);
}

function canCommentOn(owner) {
  return !!cloudSession && commentOwnerList().indexOf(owner) >= 0;
}

function syncComments() {
  var owners = commentOwnerList();
  var fresh = 0;
  return Promise.all([dbGetAll('sharedComments'), dbGetAll('cloud')]).then(function (r) {
    // Plus d'accès (ou partage arrêté) : les commentaires quittent le téléphone.
    var gone = r[0].filter(function (c) { return owners.indexOf(c.owner) < 0; });
    var states = r[1].filter(function (row) { return row.key.indexOf('com:') === 0 && owners.indexOf(row.key.slice(4)) < 0; });
    if (!gone.length && !states.length) return null;
    return dbWrite(['sharedComments', 'cloud'], function (tx) {
      gone.forEach(function (c) { tx.objectStore('sharedComments')['delete'](c.key); });
      states.forEach(function (row) { tx.objectStore('cloud')['delete'](row.key); });
    }).then(function () { notifyCloud('comment', null); });
  }).then(function () {
    return owners.reduce(function (chain, owner) {
      return chain.then(function () {
        return receiveComments(owner).then(function (count) { fresh += count; });
      });
    }, Promise.resolve());
  }).then(function () {
    if (fresh) notifyCloud('comments', fresh);
  });
}

/* Commentaires modifiés depuis la dernière fois : promesse du nombre de nouveaux (d'un autre).
   La toute première fois (nouvel appareil, reconnexion, mise à jour de l'appli), seuls ceux des
   deux dernières semaines sont « nouveaux ». */
var RECENT_COMMENT = 14 * 86400000;

function receiveComments(owner) {
  var key = 'com:' + owner;
  var fresh = 0;
  return cloudGet(key).then(function (state) {
    // since : heure (du serveur) du dernier commentaire reçu ; seen : première visite déjà faite.
    var first = !state;
    var since = state ? state.since : null;
    return fsChangesSince(userPath(owner), 'comments', since, function (docs) {
      return Promise.all(docs.map(function (doc) { return dbGet('sharedComments', owner + '/' + doc._id); })).then(function (existing) {
        var photos = {};
        return dbWrite(['sharedComments'], function (tx) {
          var store = tx.objectStore('sharedComments');
          docs.forEach(function (doc, i) {
            var id = owner + '/' + doc._id;
            photos[owner + '/' + doc.photo] = true;
            if (doc.deleted) {
              store['delete'](id);
              return;
            }
            var old = existing[i];
            var createdAt = serverTime(doc.createdAt);
            var unread = old ? !!old.unread
              : doc.author !== cloudSession.uid && (!first || Date.now() - createdAt < RECENT_COMMENT);
            if (!old && unread) fresh++;
            store.put({
              key: id, owner: owner, id: doc._id, photo: doc.photo, photoKey: owner + '/' + doc.photo,
              author: doc.author, authorName: doc.authorName, text: doc.text,
              createdAt: createdAt, pending: false, unread: unread
            });
          });
        }).then(function () {
          Object.keys(photos).forEach(function (photoKey) { notifyCloud('comment', photoKey); });
        });
      });
    }).then(function (last) {
      return cloudPut(key, { since: last, seen: true });
    });
  }).then(function () { return fresh; });
}

/* Nouveau commentaire : affiché tout de suite, envoyé dès que possible (hors connexion : plus tard). */
function cloudPostComment(owner, photoRid, text) {
  var body = cloudText(text, COMMENT_MAX);
  if (!body) return Promise.reject(userError('Écris d\'abord ton commentaire.'));
  var id = randomText('0123456789abcdefghijklmnopqrstuvwxyz', 20);
  var comment = {
    key: owner + '/' + id, owner: owner, id: id, photo: photoRid, photoKey: owner + '/' + photoRid,
    author: cloudSession.uid, authorName: cloudState.profile ? cloudState.profile.name : '', text: body,
    createdAt: Date.now(), pending: true, unread: false
  };
  return dbPut('sharedComments', comment).then(function () {
    notifyCloud('comment', comment.photoKey);
    return sendComment(comment).then(function () { return null; }, function (err) {
      if (err.retry) return err.wait; // envoyé plus tard (sans réseau, ou avec la photo)
      // Refusé pour de bon : le commentaire disparaît, son texte reste dans le champ.
      return dbDelete('sharedComments', comment.key).then(function () {
        notifyCloud('comment', comment.photoKey);
        throw err;
      });
    });
  }).then(function (waiting) {
    comment.pending = !!waiting;
    comment.waiting = waiting || null;
    if (waiting === 'photo') syncNow(); // la photo part tout de suite, et le commentaire avec elle
    return comment;
  });
}

/* Mes photos partent-elles de cet appareil ? Sinon (un autre appareil envoie mes Images), celles
   d'ici ne sont pas en ligne : personne ne peut les voir ni les commenter. */
function sharingOwnPhotosHere() {
  return !!cloudSession && sharedWith('albums').length > 0 && !!cloudState.deviceId && albumsSource() === cloudState.deviceId;
}

/* Envoi d'un commentaire. Échec provisoire : err.retry, et err.wait = 'offline' (pas de réseau),
   'server' (serveur indisponible) ou 'photo' (ma photo, pas encore envoyée). Échec définitif :
   noté dans le commentaire (failed), qui reste affiché avec la raison. */
function sendComment(comment) {
  var path = userPath(comment.owner) + '/comments/' + comment.id;
  function later(err, wait) {
    err.retry = true;
    err.wait = wait;
    throw err;
  }
  return fsCommit([fsSet(path, { photo: comment.photo, author: comment.author, authorName: comment.authorName, text: comment.text },
    { time: ['createdAt', 'updatedAt'], create: true })])
    .then(null, function (err) {
      if (err.cloud === 'offline' || err.cloud === 'server') later(err, err.cloud);
      // Refusé : déjà arrivé (la réponse s'était perdue en route), ou impossible.
      return fsGet(path).then(function (doc) {
        return !!doc && doc.author === comment.author;
      }, function (e) {
        if (e.cloud === 'offline' || e.cloud === 'server') later(e, e.cloud);
        return false;
      }).then(function (arrived) {
        if (arrived) return null;
        if (comment.owner === cloudSession.uid && sharingOwnPhotosHere()) later(err, 'photo'); // photo tout juste ajoutée
        throw userError(comment.owner === cloudSession.uid
          ? "Cette photo n'est pas en ligne : tes Images partagées partent d'un autre appareil."
          : "Cette photo n'est plus partagée avec toi.");
      });
    })
    .then(function () {
      return updateComment(comment.key, { pending: false, waiting: null, failed: null });
    }, function (err) {
      return updateComment(comment.key, err.retry ? { waiting: err.wait } : { pending: false, waiting: null, failed: cloudErrorText(err) })
        .then(function () { throw err; });
    });
}

function updateComment(key, changes) {
  return dbGet('sharedComments', key).then(function (current) {
    if (!current) return null;
    Object.keys(changes).forEach(function (k) { current[k] = changes[k]; });
    return dbPut('sharedComments', current).then(function () {
      notifyCloud('comment', current.photoKey);
      return current;
    });
  });
}

/* Commentaires en attente (écrits hors connexion...) : envoyés dès que possible. */
function sendPendingComments() {
  return dbGetAll('sharedComments').then(function (all) {
    return all.filter(function (c) { return c.pending && !c.failed; }).reduce(function (chain, comment) {
      return chain.then(function () {
        return sendComment(comment)['catch'](function (err) {
          if (err.cloud === 'offline') throw err; // la synchronisation s'arrête : plus de réseau
          if (!err.retry) console.warn(err);
        });
      });
    }, Promise.resolve());
  });
}

/* Supprime un commentaire (le sien, ou n'importe lequel sur ses propres photos). */
function cloudDeleteComment(comment) {
  var sent = comment.pending || comment.failed ? Promise.resolve() // jamais arrivé : rien à effacer en ligne
    : fsCommit([fsSet(userPath(comment.owner) + '/comments/' + comment.id, { deleted: true, photo: comment.photo }, { time: ['updatedAt'] })]);
  return sent.then(function () {
    return dbDelete('sharedComments', comment.key);
  }).then(function () { notifyCloud('comment', comment.photoKey); });
}

/* Commentaires d'une photo, du plus ancien au plus récent. */
function photoComments(photoKey) {
  if (!photoKey) return Promise.resolve([]);
  return dbGetAllByIndex('sharedComments', 'photoKey', photoKey).then(function (list) {
    return list.sort(function (a, b) { return a.createdAt - b.createdAt; });
  });
}

/* La photo est affichée : ses commentaires ne sont plus « nouveaux ». */
function markCommentsRead(photoKey) {
  return photoComments(photoKey).then(function (list) {
    var unread = list.filter(function (c) { return c.unread; });
    if (!unread.length) return false;
    return dbWrite(['sharedComments'], function (tx) {
      unread.forEach(function (c) {
        c.unread = false;
        tx.objectStore('sharedComments').put(c);
      });
    }).then(function () {
      notifyCloud('comment', photoKey);
      return true;
    });
  });
}

/* Nombre de commentaires (et de nouveaux) par photo : { clé : { count, unread } }. */
function commentStats() {
  return dbGetAll('sharedComments').then(function (all) {
    var stats = {};
    all.forEach(function (c) {
      var s = stats[c.photoKey] = stats[c.photoKey] || { count: 0, unread: 0 };
      s.count++;
      if (c.unread) s.unread++;
    });
    return stats;
  });
}

/* ---------- Événements ---------- */
onDbChange(function (stores) {
  if (stores.indexOf('folders') >= 0 || stores.indexOf('photos') >= 0) schedulePublish();
});
window.addEventListener('online', function () { if (cloudSession) syncNow(); });
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && cloudSession && Date.now() - cloudStatus.lastSync > 60000) syncNow();
});
