/* ---------- Rubriques que mes proches me partagent, en lecture seule ----------
   Programme, carnet d'adresses, notes et documents d'un proche qui me les montre (grants, voir
   cloud.js). Ils viennent de ses rubriques synchronisées (sync.js) et sont copiés sur ce téléphone
   pour être consultés même sans connexion : magasin « sharedItems » (un élément, tel qu'en ligne :
   description en JSON, propriétaire, date de modification) et « sharedFiles » (leurs fichiers, par
   empreinte SHA-256 : une photo ou un billet présent dans deux éléments n'est gardé qu'une fois).
   Les fichiers de plus de 15 Mo ne sont téléchargés qu'à l'ouverture. Rien n'y est modifiable : le
   serveur ne laisse écrire chacun que chez lui (firestore.rules). */
var SHARED_ITEM_KINDS = { schedule: ['event'], addresses: ['address'], notes: ['note', 'folder'], documents: ['document', 'folder'] };
var SHARED_FILE_EAGER = 15 * 1024 * 1024;
var SHARED_LIST_PAGE = 300;

/* Ce que mes proches me partagent, élément par élément : { propriétaire : { kind : true } }. */
function sharedItemKinds() {
  var wanted = {};
  cloudState.grantsToMe.forEach(function (g) {
    g.categories.forEach(function (category) {
      (SHARED_ITEM_KINDS[category] || []).forEach(function (kind) {
        (wanted[g.owner] = wanted[g.owner] || {})[kind] = true;
      });
    });
  });
  return wanted;
}

/* Rubrique d'un élément reçu (un dossier : celle de son contenu). */
function sharedCategoryOf(item) {
  if (item.kind === 'folder') return item.data.kind === 'documents' ? 'documents' : 'notes';
  return { event: 'schedule', address: 'addresses', note: 'notes', document: 'documents' }[item.kind] || null;
}

/* ---------- Réception (depuis syncNow, cloud.js) ----------
   Pour chaque proche : la liste de ses éléments partagés (leur seule date de modification), puis ceux
   qui ont changé depuis la dernière fois ; ceux qui ne sont plus en ligne, ou plus partagés, partent. */
function receiveSharedItems() {
  var wanted = sharedItemKinds();
  var changed = false;
  return dbGetAll('sharedItems').then(function (local) {
    var gone = local.filter(function (item) { return !(wanted[item.owner] && wanted[item.owner][item.kind]); });
    changed = gone.length > 0;
    return (gone.length ? dbWrite(['sharedItems'], function (tx) {
      gone.forEach(function (item) { tx.objectStore('sharedItems')['delete'](item.key); });
    }) : Promise.resolve()).then(function () {
      return Object.keys(wanted).reduce(function (chain, owner) {
        return chain.then(function () {
          var mine = local.filter(function (item) { return item.owner === owner; });
          return receiveOwnerItems(owner, wanted[owner], mine).then(function (did) {
            changed = changed || did;
          }, function (err) {
            if (err.cloud === 'offline' || err.cloud === 'signed-out') throw err;
            console.warn('Rubriques partagées pas encore reçues', owner, err);
          });
        });
      }, Promise.resolve());
    });
  }).then(function () {
    if (changed) notifyCloud('shared-items');
    return downloadSharedFiles();
  }).then(forgetUnusedSharedFiles);
}

/* Promesse de true si quelque chose a changé ici. */
function receiveOwnerItems(owner, kinds, local) {
  var known = {};
  local.forEach(function (item) { known[item.rid] = item; });
  var online = {};
  return Object.keys(kinds).reduce(function (chain, kind) {
    return chain.then(function () {
      return listSharedKind(owner, kind).then(function (docs) {
        docs.forEach(function (doc) { online[doc._id] = doc; });
      });
    });
  }, Promise.resolve()).then(function () {
    var fresh = Object.keys(online).filter(function (rid) { return !known[rid] || known[rid].updatedAt !== online[rid].updatedAt; });
    var gone = local.filter(function (item) { return kinds[item.kind] && !online[item.rid]; });
    return fetchSharedDocs(owner, fresh).then(function (docs) {
      if (!docs.length && !gone.length) return false;
      return dbWrite(['sharedItems'], function (tx) {
        var store = tx.objectStore('sharedItems');
        docs.forEach(function (doc) {
          var data;
          try { data = JSON.parse(doc.data); } catch (e) { return; }
          if (!data || typeof data !== 'object') return;
          store.put({ key: owner + '/' + doc._id, owner: owner, rid: doc._id, kind: doc.kind, data: data, updatedAt: doc.updatedAt });
        });
        gone.forEach(function (item) { store['delete'](item.key); });
      }).then(function () { return true; });
    });
  });
}

/* Les éléments d'un type que ce proche me partage : leur seule date de modification. */
function listSharedKind(owner, kind) {
  var all = [];
  function next(after) {
    var query = {
      from: [{ collectionId: 'items' }],
      where: fieldEquals('kind', kind),
      select: { fields: [{ fieldPath: 'updatedAt' }] },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: SHARED_LIST_PAGE
    };
    if (after) query.startAt = { values: [{ referenceValue: after }], before: false };
    return fsQuery(userPath(owner), query).then(function (docs) {
      all = all.concat(docs);
      return docs.length < SHARED_LIST_PAGE ? all : next(docs[docs.length - 1]._name);
    });
  }
  return next(null);
}

/* Éléments complets, par lots ; un élément supprimé entre-temps (plus lisible) fait refuser son lot :
   ils sont alors demandés un par un. */
function fetchSharedDocs(owner, rids) {
  var path = userPath(owner) + '/items/';
  var base = cloudUrls().root + '/' + path;
  var docs = [];
  var groups = [];
  for (var i = 0; i < rids.length; i += 50) groups.push(rids.slice(i, i + 50));
  return groups.reduce(function (chain, group) {
    return chain.then(function () {
      return fsRequest('POST', ':batchGet', { documents: group.map(function (rid) { return base + rid; }) }).then(function (rows) {
        (rows || []).forEach(function (row) { if (row.found) docs.push(decodeDoc(row.found)); });
      }, function (err) {
        if (err.cloud === 'offline' || err.cloud === 'signed-out') throw err;
        return group.reduce(function (one, rid) {
          return one.then(function () {
            return fsGet(path + rid).then(function (doc) { if (doc) docs.push(doc); }, function (e) {
              if (e.cloud === 'offline' || e.cloud === 'signed-out') throw e;
            });
          });
        }, Promise.resolve());
      });
    });
  }, Promise.resolve()).then(function () {
    return docs.filter(function (doc) { return doc.kind && !doc.deleted && typeof doc.data === 'string'; });
  });
}

/* ---------- Fichiers ---------- */
function sharedFileMap() {
  return dbGetAll('sharedFiles').then(function (rows) {
    var map = {};
    rows.forEach(function (row) { map[row.hash] = row.blob; });
    return map;
  });
}

/* Tous les fichiers (sauf les très gros), téléchargés une fois. */
function downloadSharedFiles() {
  return Promise.all([dbGetAll('sharedItems'), sharedFileMap()]).then(function (r) {
    var have = r[1];
    var seen = {};
    var todo = [];
    r[0].forEach(function (item) {
      itemRefs(item.kind, item.data).forEach(function (ref) {
        if (have[ref.$blob] || seen[ref.$blob] || (ref.size || 0) > SHARED_FILE_EAGER) return;
        seen[ref.$blob] = true;
        todo.push({ owner: item.owner, ref: ref });
      });
    });
    return todo.reduce(function (chain, job, i) {
      return chain.then(function () {
        setCloudStatus('syncing', { progress: { label: 'Réception des rubriques partagées', done: i, total: todo.length } });
        return fetchSharedFile(job.owner, job.ref).then(null, function (err) {
          if (err.cloud === 'offline' || err.cloud === 'signed-out') throw err;
          console.warn('Fichier partagé pas encore reçu', job.ref.$blob, err);
        });
      });
    }, Promise.resolve()).then(function () {
      if (todo.length) notifyCloud('shared-items');
    });
  });
}

function fetchSharedFile(owner, ref) {
  return downloadItemBlob(ref, owner).then(function (blob) {
    return dbPut('sharedFiles', { hash: ref.$blob, blob: blob, size: blob.size, type: blob.type }).then(function () { return blob; });
  });
}

/* Le fichier d'un élément partagé : celui gardé ici, sinon téléchargé (avec Internet). */
function sharedFile(owner, ref) {
  return dbGet('sharedFiles', ref.$blob).then(function (row) {
    if (row && row.blob) return row.blob;
    if (!cloudSession || navigator.onLine === false) throw cloudError('offline', 'Pas de connexion');
    var progress = showProgress('Téléchargement…');
    return fetchSharedFile(owner, ref).then(function (blob) {
      progress.close();
      return blob;
    }, function (err) {
      progress.close();
      throw err;
    });
  });
}

/* Fichiers dont plus aucun élément partagé n'a besoin : retirés du téléphone. */
function forgetUnusedSharedFiles() {
  return Promise.all([dbGetAll('sharedItems'), dbGetAll('sharedFiles')]).then(function (r) {
    var used = {};
    r[0].forEach(function (item) { itemRefs(item.kind, item.data).forEach(function (ref) { used[ref.$blob] = true; }); });
    var unused = r[1].filter(function (row) { return !used[row.hash]; });
    if (!unused.length) return null;
    return dbWrite(['sharedFiles'], function (tx) {
      unused.forEach(function (row) { tx.objectStore('sharedFiles')['delete'](row.hash); });
    });
  });
}

/* ---------- Éléments reçus, prêts à afficher ---------- */
function sharedItemsOf(owner) {
  return Promise.all([dbGetAllByIndex('sharedItems', 'owner', owner), sharedFileMap()]).then(function (r) {
    return { items: r[0], files: r[1] };
  });
}

/* Pièces jointes d'un élément reçu : { name, type, size, blob (null s'il n'est pas encore ici), ref }. */
function sharedAttachments(list, files) {
  return (list || []).map(function (att) {
    var ref = isBlobRef(att.blob) ? att.blob : null;
    return { id: att.id, name: att.name || 'fichier', type: att.type || (ref && ref.type) || '', size: att.size || (ref && ref.size) || 0, blob: ref ? files[ref.$blob] || null : null, ref: ref };
  });
}

/* Une adresse reçue, comme une adresse du carnet (rid : son identifiant chez son propriétaire). */
function sharedAddressRecord(item, files) {
  var a = Object.assign({}, item.data);
  a.rid = item.rid;
  a.attachments = sharedAttachments(item.data.attachments, files);
  return a;
}

/* Lieu recopié dans une étape du programme (sans le carnet d'adresses de son propriétaire). */
function placeRecord(place) {
  return { title: place.title || 'Lieu', address: place.address || '', addressJa: place.addressJa || '', phone: place.phone || '', category: place.category || 'autre' };
}

/* Liste de pièces jointes d'un élément reçu : toucher pour l'ouvrir (téléchargée d'abord si besoin),
   ↗ pour la partager. */
function sharedAttachmentList(owner, list) {
  return h('div', { className: 'attachments' }, list.map(function (att) {
    var withBlob = function (then) {
      return function (e) {
        if (e) e.stopPropagation();
        (att.blob ? Promise.resolve(att.blob) : sharedFile(owner, att.ref)).then(function (blob) {
          att.blob = blob;
          then(blob);
        }, function (err) {
          console.error(err);
          uiAlert(err.cloud === 'offline' ? 'Ce fichier n\'est pas encore sur ton téléphone : il faut Internet pour l\'ouvrir la première fois.' : 'Ce fichier n\'a pas pu être ouvert.');
        });
      };
    };
    return attachmentRow(att, [h('button', {
      type: 'button', className: 'icon-btn', 'aria-label': 'Partager ' + att.name, title: 'Partager', text: '↗',
      onclick: withBlob(function (blob) { shareFile(blob, att.name); })
    })], withBlob(function (blob) {
      var full = { name: att.name, type: att.type || blob.type, size: att.size || blob.size, blob: blob };
      if (isViewableImage(full)) openViewer([blob], 0, imageFileActions(function () { return full; }));
      else openDocument(full);
    }));
  }));
}

/* ---------- Le programme d'un proche (voir scheduleSource, schedule.js) ---------- */
function sharedScheduleSource(owner) {
  var name = ownerName(owner);
  return {
    readOnly: true,
    owner: owner,
    ownerName: name,
    title: 'Programme de ' + name,
    load: function () {
      return sharedItemsOf(owner).then(function (r) {
        var addresses = {};
        r.items.forEach(function (item) { if (item.kind === 'address') addresses[item.rid] = sharedAddressRecord(item, r.files); });
        var events = r.items.filter(function (item) { return item.kind === 'event'; }).map(function (item) {
          var e = Object.assign({}, item.data);
          e.id = item.rid;
          e.attachments = sharedAttachments(item.data.attachments, r.files);
          // Le lieu : la fiche partagée (carnet d'adresses), sinon celui recopié dans l'étape.
          var place = addresses[item.data.address] || (item.data.place ? placeRecord(item.data.place) : null);
          e.addressId = place ? 'lieu:' + item.rid : null;
          if (place) addresses[e.addressId] = place;
          return e;
        });
        return { events: events, addresses: addresses };
      });
    },
    openAddress: function (address) { openView('shared-item', { owner: owner, rid: address.rid }); },
    canOpenAddress: function (address) { return !!address.rid; }, // (le lieu recopié dans l'étape n'a pas de fiche)
    attachmentList: function (list) { return sharedAttachmentList(owner, list); }
  };
}

/* En haut du Programme : ceux de mes proches. */
function renderSharedSchedules(box) {
  if (!cloudSession) return;
  dbGetAll('sharedItems').then(function (items) {
    var byOwner = {};
    items.forEach(function (item) { if (item.kind === 'event') (byOwner[item.owner] = byOwner[item.owner] || []).push(item.data); });
    var owners = Object.keys(byOwner);
    if (!owners.length || currentViewName() !== 'schedule') return;
    box.innerHTML = '';
    box.appendChild(h('p', { className: 'section-title', text: 'De mes proches' }));
    var today = dayKey(Date.now());
    owners.sort(function (a, b) { return ownerName(a).localeCompare(ownerName(b), 'fr'); }).forEach(function (owner) {
      var list = byOwner[owner].slice().sort(byEventTime);
      var first = list[0].date;
      var last = list[list.length - 1].date;
      var when = today < first ? 'départ dans ' + plural(daysBetween(today, first), 'jour', 'jours')
        : today > last ? 'voyage terminé' : 'aujourd\'hui : jour ' + (daysBetween(first, today) + 1);
      box.appendChild(sharedEntryRow('📅', 'Programme de ' + ownerName(owner), plural(list.length, 'étape', 'étapes') + ' · ' + when, function () {
        openView('schedule', { owner: owner });
      }));
    });
    // Pas encore de programme à moi : dit simplement, sous ceux de mes proches.
    var empty = byId('scheduleEmpty');
    if (!empty.hidden) empty.textContent = 'Ton programme à toi est vide : appuie sur + pour y ajouter une étape.';
  });
}

function sharedEntryRow(icon, title, sub, onClick) {
  return h('div', { className: 'list-row shared-entry', onclick: onClick }, [
    h('span', { className: 'row-icon', text: icon }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: title }),
      h('p', { className: 'list-row-sub', text: sub })
    ]),
    h('span', { className: 'row-chevron', text: '›' })
  ]);
}

/* En haut du carnet d'adresses, des notes et des documents : ceux de mes proches (show : pas pendant
   une recherche, ni dans un dossier). */
var SHARED_UNITS = { addresses: ['adresse', 'adresses'], notes: ['note', 'notes'], documents: ['fichier', 'fichiers'] };
var SHARED_ENTRY_KIND = { addresses: 'address', notes: 'note', documents: 'document' };

function renderSharedEntries(category, box, show) {
  box.innerHTML = '';
  if (!show || !cloudSession) return;
  var view = currentViewName();
  dbGetAll('sharedItems').then(function (items) {
    var counts = {};
    items.forEach(function (item) { if (item.kind === SHARED_ENTRY_KIND[category]) counts[item.owner] = (counts[item.owner] || 0) + 1; });
    var owners = Object.keys(counts);
    if (!owners.length || currentViewName() !== view) return;
    box.innerHTML = '';
    box.appendChild(h('p', { className: 'section-title', text: 'De mes proches' }));
    owners.sort(function (a, b) { return ownerName(a).localeCompare(ownerName(b), 'fr'); }).forEach(function (owner) {
      var info = CLOUD_CATEGORIES[category];
      box.appendChild(sharedEntryRow(info.icon, info.label + ' de ' + ownerName(owner), plural(counts[owner], SHARED_UNITS[category][0], SHARED_UNITS[category][1]) + ' · en lecture seule', function () {
        openView('shared-items', { owner: owner, category: category });
      }));
    });
    box.appendChild(h('p', { className: 'section-title', text: category === 'addresses' ? 'Mes adresses' : category === 'notes' ? 'Mes notes' : 'Mes documents' }));
  });
}

/* ---------- Carnet d'adresses, notes ou documents d'un proche ---------- */
defineView('shared-items', {
  el: 'view-shared-items',
  section: function (params) { return params.category; },
  title: function (params) { return CLOUD_CATEGORIES[params.category].label + ' de ' + ownerName(params.owner); },
  enter: renderSharedItems,
  exit: function () { releaseBlobUrls('shared-items'); }
});

function renderSharedItems(params) {
  return sharedItemsOf(params.owner).then(function (r) {
    if (currentViewName() !== 'shared-items') return;
    releaseBlobUrls('shared-items');
    var box = byId('sharedItemsContent');
    box.innerHTML = '';
    var kind = SHARED_ENTRY_KIND[params.category];
    var items = r.items.filter(function (item) { return item.kind === kind; });
    box.appendChild(h('p', { className: 'hint shared-note', text: '👁️ Partagé par ' + ownerName(params.owner) + ', en lecture seule. Gardé sur ton téléphone, même sans connexion.' }));
    if (!items.length) {
      box.appendChild(h('p', { className: 'empty', text: 'Rien pour l\'instant.' }));
      return;
    }
    if (params.category === 'addresses') {
      items.map(function (item) { return sharedAddressRecord(item, r.files); }).sort(byTitle).forEach(function (a) {
        box.appendChild(sharedAddressRow(params.owner, a));
      });
      return;
    }
    // Notes et documents : rangés dans les dossiers de leur propriétaire.
    var folders = {};
    r.items.forEach(function (item) { if (item.kind === 'folder' && item.data.kind === params.category) folders[item.rid] = item.data; });
    var groups = {};
    items.forEach(function (item) {
      var folder = item.data.folder && folders[item.data.folder] ? item.data.folder : '';
      (groups[folder] = groups[folder] || []).push(item);
    });
    var order = Object.keys(groups).sort(function (a, b) {
      if (!a || !b) return a ? 1 : -1;
      return (folders[a].name || '').localeCompare(folders[b].name || '', 'fr');
    });
    order.forEach(function (folder) {
      if (order.length > 1 || folder) box.appendChild(h('p', { className: 'section-title', text: folder ? (folders[folder].icon || '📁') + ' ' + folders[folder].name : 'Sans dossier' }));
      var list = groups[folder];
      if (params.category === 'notes') {
        list.sort(function (a, b) { return (b.data.updatedAt || 0) - (a.data.updatedAt || 0); }).forEach(function (item) { box.appendChild(sharedNoteRow(params.owner, item)); });
      } else {
        list.sort(function (a, b) { return byFileName(a.data, b.data); }).forEach(function (item) { box.appendChild(sharedDocumentRow(params.owner, item, r.files)); });
      }
    });
  });
}

function sharedAddressRow(owner, a) {
  return h('div', { className: 'list-row', onclick: function () { openView('shared-item', { owner: owner, rid: a.rid }); } }, [
    h('span', { className: 'row-icon', text: categoryOf(a).icon }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: a.title || 'Sans titre' }),
      a.description ? h('p', { className: 'list-row-sub clamp-2', text: markdownExcerpt(a.description, 120) }) : null,
      h('p', { className: 'list-row-address', text: a.address || '' })
    ]),
    a.address ? h('button', {
      type: 'button', className: 'icon-btn route-btn', 'aria-label': 'Itinéraire', title: 'Itinéraire', text: '🧭',
      onclick: function (e) {
        e.stopPropagation();
        openMaps(a.address);
      }
    }) : null
  ]);
}

function sharedNoteRow(owner, item) {
  var n = item.data;
  var chips = [];
  if ((n.images || []).length) chips.push(chip('📷 ' + n.images.length, true));
  if ((n.attachments || []).length) chips.push(chip('📎 ' + n.attachments.length, true));
  var excerpt = markdownExcerpt(n.body, 140);
  return h('div', { className: 'list-row', onclick: function () { openView('shared-item', { owner: owner, rid: item.rid }); } }, [
    h('span', { className: 'row-icon', text: n.icon || DEFAULT_NOTE_ICON }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: (n.pinned ? '📌 ' : '') + (n.title || 'Sans titre') }),
      excerpt ? h('p', { className: 'list-row-sub clamp-2', text: excerpt }) : null,
      chips.length ? h('div', { className: 'chips' }, chips) : null
    ]),
    h('span', { className: 'row-date', text: formatShortDate(n.updatedAt || n.createdAt || Date.now()) })
  ]);
}

function sharedDocumentRow(owner, item, files) {
  var d = item.data;
  var thumb = isBlobRef(d.thumb) ? files[d.thumb.$blob] : null;
  var fileRef = isBlobRef(d.file) ? d.file : null;
  var here = fileRef && files[fileRef.$blob];
  var isPage = documentKind(d.type, d.name) === 'pdf';
  return h('div', { className: 'list-row doc-row', onclick: function () { openSharedDocument(owner, d); } }, [
    h('span', { className: 'doc-thumb' + (isPage ? ' is-page' : '') }, thumb
      ? h('img', { src: blobUrl('shared-items', thumb), alt: '' })
      : h('span', { text: fileIcon(d.type, d.name) })),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title doc-name', text: d.name }),
      h('p', { className: 'list-row-sub', text: fileTypeLabel(d.type, d.name) + ' · ' + formatSize(d.size || 0) + (here || !fileRef ? '' : ' · à télécharger') })
    ])
  ]);
}

function openSharedDocument(owner, d) {
  if (!isBlobRef(d.file)) return uiAlert('Ce fichier n\'est pas en ligne (trop volumineux) : demande-le à son propriétaire.');
  sharedFile(owner, d.file).then(function (blob) {
    openDocument({ name: d.name, type: d.type || blob.type, size: d.size || blob.size, blob: blob });
  }, function (err) {
    console.error(err);
    uiAlert(err.cloud === 'offline' ? 'Ce fichier n\'est pas encore sur ton téléphone : il faut Internet pour l\'ouvrir la première fois.' : 'Ce fichier n\'a pas pu être ouvert.');
  });
}

/* ---------- Une adresse ou une note d'un proche ---------- */
defineView('shared-item', {
  el: 'view-shared-item',
  section: function () { return null; },
  title: '',
  enter: renderSharedItem,
  exit: function () { releaseBlobUrls('shared-item'); }
});

function renderSharedItem(params) {
  return sharedItemsOf(params.owner).then(function (r) {
    if (currentViewName() !== 'shared-item') return;
    releaseBlobUrls('shared-item');
    var detail = byId('sharedItemDetail');
    detail.innerHTML = '';
    var item = r.items.filter(function (it) { return it.rid === params.rid; })[0];
    if (!item) {
      detail.appendChild(h('p', { className: 'empty', text: 'Plus partagé, ou supprimé par son propriétaire.' }));
      return;
    }
    var shared = h('p', { className: 'hint shared-note', text: '👁️ Partagé par ' + ownerName(params.owner) + ', en lecture seule.' });
    if (item.kind === 'address') {
      renderSharedAddress(detail, params.owner, sharedAddressRecord(item, r.files));
      detail.appendChild(shared);
      return;
    }
    if (item.kind === 'note') {
      var addresses = {};
      r.items.forEach(function (it) { if (it.kind === 'address') addresses[it.rid] = sharedAddressRecord(it, r.files); });
      renderSharedNote(detail, params.owner, item, r.files, addresses);
      detail.appendChild(shared);
    }
  });
}

function renderSharedAddress(detail, owner, a) {
  var category = categoryOf(a);
  setViewTitle(category.icon + ' ' + category.label);
  detail.appendChild(h('div', { className: 'detail-head' }, [
    h('span', { className: 'detail-icon', text: category.icon }),
    h('div', { className: 'detail-heading' }, [
      h('h2', { className: 'detail-title', text: a.title || 'Sans titre' }),
      h('p', { className: 'detail-meta', text: category.label + ' · carnet de ' + ownerName(owner) })
    ])
  ]));
  if (a.address) {
    detail.appendChild(h('div', { className: 'card' }, [
      h('p', { className: 'card-label', text: 'Adresse' }),
      h('p', { className: 'card-text', text: a.address }),
      h('div', { className: 'card-actions' }, [
        actionButton('🧭', 'Itinéraire', function () { openMaps(a.address); }),
        actionButton('📋', 'Copier', function () { copyAndNotify(a.address, 'Adresse copiée'); }),
        actionButton('🚕', 'Pour le taxi', function () { showTaxiCard(a.title, a.addressJa || a.address); })
      ])
    ]));
  }
  if (a.addressJa) {
    detail.appendChild(h('div', { className: 'card' }, [
      h('p', { className: 'card-label', text: 'Adresse en japonais' }),
      h('p', { className: 'card-text', lang: 'ja', text: a.addressJa }),
      h('div', { className: 'card-actions' }, [
        actionButton('📋', 'Copier', function () { copyAndNotify(a.addressJa, 'Adresse copiée'); })
      ])
    ]));
  }
  if (a.phone || a.website) {
    detail.appendChild(h('div', { className: 'card card-actions' }, [
      a.phone ? actionButton('📞', a.phone, function () { openExternal(phoneUrl(a.phone)); }) : null,
      a.website ? actionButton('🌐', 'Site web', function () { openExternal(websiteUrl(a.website)); }) : null
    ]));
  }
  if (a.description) {
    var description = h('div', { className: 'markdown' });
    showMarkdown(description, a.description, null);
    detail.appendChild(description);
  }
  if (a.attachments.length) {
    detail.appendChild(h('p', { className: 'section-title', text: 'Pièces jointes' }));
    detail.appendChild(sharedAttachmentList(owner, a.attachments));
  }
}

function renderSharedNote(detail, owner, item, files, addresses) {
  var n = item.data;
  setViewTitle('Note de ' + ownerName(owner));
  detail.appendChild(h('div', { className: 'detail-head' }, [
    h('span', { className: 'detail-icon', text: n.icon || DEFAULT_NOTE_ICON }),
    h('div', { className: 'detail-heading' }, [
      h('h2', { className: 'detail-title', text: n.title || 'Sans titre' }),
      h('p', { className: 'detail-meta', text: 'Modifiée le ' + formatDateTime(n.updatedAt || n.createdAt || Date.now()) })
    ])
  ]));
  var address = n.address ? addresses[n.address] : null;
  if (address) {
    detail.appendChild(h('div', { className: 'card link-card', onclick: function () { openView('shared-item', { owner: owner, rid: address.rid }); } }, [
      h('span', { className: 'row-icon', text: categoryOf(address).icon }),
      h('div', { className: 'list-row-main' }, [
        h('p', { className: 'list-row-title', text: address.title }),
        address.address ? h('p', { className: 'list-row-address', text: address.address }) : null
      ])
    ]));
  }
  if (n.body) {
    var body = h('div', { className: 'markdown' });
    showMarkdown(body, n.body, null);
    detail.appendChild(body);
  }
  var images = (n.images || []).map(function (ref) { return isBlobRef(ref) ? files[ref.$blob] || null : null; });
  var ready = images.filter(Boolean);
  if (images.length) {
    detail.appendChild(h('p', { className: 'section-title', text: 'Photos' }));
    if (ready.length < images.length) detail.appendChild(h('p', { className: 'hint', text: 'Photos pas encore toutes reçues : elles arrivent avec Internet.' }));
    var actions = imageFileActions(function (i) {
      return { blob: ready[i], name: safeFileName(n.title, 'Note') + '-' + (i + 1) + '.' + extensionFor(ready[i].type) };
    });
    detail.appendChild(h('div', { className: 'image-grid' }, ready.map(function (image, index) {
      return h('button', { type: 'button', className: 'image-cell', onclick: function () { openViewer(ready, index, actions); } }, [
        h('img', { src: blobUrl('shared-item', image), alt: 'Photo ' + (index + 1) })
      ]);
    })));
  }
  var atts = sharedAttachments(n.attachments, files);
  if (atts.length) {
    detail.appendChild(h('p', { className: 'section-title', text: 'Pièces jointes' }));
    detail.appendChild(sharedAttachmentList(owner, atts));
  }
}

// Reçu de mes proches : listes et fiches réaffichées.
onCloudChange(function (what) {
  if (what !== 'shared-items') return;
  var entry = currentEntry();
  if (!entry) return;
  var name = entry.name;
  if (name === 'shared-items' || name === 'shared-item' || ((name === 'schedule' || name === 'schedule-day') && entry.params.owner)) refreshView();
  else if (name === 'schedule' || ((name === 'notes' || name === 'documents') && !entry.params.folderId) || name === 'addresses') refreshView();
});
